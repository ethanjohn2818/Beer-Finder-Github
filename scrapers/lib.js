// ---------------------------------------------------------------
// Shared scraper library.
//
// All supermarket scrapers are built from createScraper(config).
// This file owns the one shared browser, the caching, and the
// common logic for turning a search page into buy options.
// ---------------------------------------------------------------

const { chromium } = require("playwright");
const fs = require("fs");


// ---- One shared browser for every supermarket -----------------

let browser = null;
let context = null;


async function getContext() {

    if (browser && browser.isConnected()) {
        return context;
    }

    console.log("Starting scraper browser...");

    browser = await chromium.launch({
        // Headless is faster and won't pop a window open.
        // Set HEADED=true to watch the browser work.
        headless: process.env.HEADED !== "true",
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ["--disable-blink-features=AutomationControlled"]
    });

    context = await browser.newContext({ locale: "en-GB" });

    // Skip heavy resources we don't need. We still read image URLs
    // from the HTML, so we never need the image bytes to download.
    await context.route("**/*", route => {
        const type = route.request().resourceType();
        if (type === "font" || type === "media" ||
            type === "stylesheet" || type === "image") {
            return route.abort();
        }
        route.continue();
    });

    return context;
}


// Launch the browser ahead of time so the first search is fast.
async function warmUp() {
    try {
        await getContext();
    } catch (error) {
        console.log("Browser warm-up skipped:", error.message);
    }
}


// ---- Caching --------------------------------------------------

const FOUND_CACHE_TIME = 24 * 60 * 60 * 1000;      // 24 hours
const NOT_FOUND_CACHE_TIME = 24 * 60 * 60 * 1000;  // 24 hours (a warm run lasts a day)
const ERROR_CACHE_TIME = 5 * 60 * 1000;            // 5 minutes (retry soon after a failure)


function loadCache(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}


function saveCache(file, cache) {
    fs.writeFileSync(file, JSON.stringify(cache, null, 2));
}


function cacheValid(entry) {

    if (!entry || !entry.result || !entry.time) {
        return false;
    }

    let expiry;

    if (entry.result.error) {
        // A real failure (timeout / blocked): retry again soon
        expiry = ERROR_CACHE_TIME;
    } else if (entry.result.available) {
        expiry = FOUND_CACHE_TIME;
    } else {
        // Searched fine, Tesco just doesn't stock it: cache for a day
        expiry = NOT_FOUND_CACHE_TIME;
    }

    return (Date.now() - entry.time) < expiry;
}


// ---- Text helpers ---------------------------------------------

// Does the product name contain every meaningful word of the search?
function matchesSearch(searchTerm, name) {

    if (!name) return false;

    const words = searchTerm
        .toLowerCase()
        .replace("&", "")
        .split(" ")
        .filter(word => word.length > 2);

    const text = name.toLowerCase();

    return words.every(word => text.includes(word));
}


// Pull just the money value out of a messy price string.
// "£5.50 Clubcard Price" -> "£5.50"
function extractPrice(text) {
    if (!text) return null;
    const match = text.match(/£\s?\d+(?:\.\d{1,2})?/);
    return match ? match[0].replace(/\s/g, "") : null;
}


// Work out the pack size from a product name.
// "Neck Oil 4 x 330ml" -> "4 × 330ml"
function detectPackLabel(text) {

    if (!text) return "Pack";

    const t = text.toLowerCase();

    const multi = t.match(/(\d+)\s*[x×]\s*(\d+)\s*ml/);
    if (multi) {
        const count = Number(multi[1]);
        const vol = multi[2];
        if (count === 1) return `Single (${vol}ml)`;
        return `${count} × ${vol}ml`;
    }

    if (/\b(case|crate)\b/.test(t)) return "Case";

    const pack = t.match(/(\d+)\s*-?\s*pack/);
    if (pack) return `${pack[1]} pack`;

    const single = t.match(/(\d+)\s*ml/);
    if (single) return `Single (${single[1]}ml)`;

    return "Pack";
}


// Order options: singles first, then packs, then cases.
function packRank(label) {
    if (/single/i.test(label)) return 0;
    if (/case/i.test(label)) return 2;
    return 1;
}


// Make a link/image URL absolute against a base site.
function absolute(baseUrl, url) {
    if (!url) return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return baseUrl + url;
    return url;
}


// ---- The scraper factory --------------------------------------
//
// config = {
//   name:            "Tesco"            (shown to users)
//   cacheFile:       absolute path to this store's cache json
//   baseUrl:         "https://www.tesco.com"
//   searchUrl:       (term) => full search URL
//   productSelector: CSS selector that matches product links
//   imageHint:       substring that marks a real product image URL
// }
//
// NOTE: for stores other than Tesco the selectors/URLs below are
// best-effort and will likely need adjusting against the live site.

function createScraper(config) {

    async function search(searchTerm) {

        const cache = loadCache(config.cacheFile);

        if (cacheValid(cache[searchTerm])) {
            return cache[searchTerm].result;
        }

        console.log(`Searching ${config.name} for`, searchTerm);

        const ctx = await getContext();
        const page = await ctx.newPage();

        let result = {
            supermarket: config.name,
            name: null,
            price: null,
            image: null,
            link: null,
            available: false,
            options: [],
            error: false
        };

        let failed = false;

        try {

            await page.goto(config.searchUrl(searchTerm), {
                waitUntil: "domcontentloaded",
                timeout: 20000
            });

            await page
                .locator(config.productSelector)
                .first()
                .waitFor({ timeout: 7000 });

            // Grab several product tiles off the search page
            const tiles = await page.evaluate(({ selector, imageHint }) => {

                const anchors = Array.from(
                    document.querySelectorAll(selector)
                );

                const seen = new Set();
                const out = [];

                for (const a of anchors) {

                    const href = a.getAttribute("href");
                    if (!href || seen.has(href)) continue;
                    seen.add(href);

                    const tile =
                        a.closest("li, article, [class*='tile'], [class*='product']")
                        || a.parentElement;

                    const text = (tile.innerText || "").trim();

                    let image = null;
                    const img = tile.querySelector("img");
                    if (img) {
                        const candidates = [
                            img.getAttribute("src"),
                            img.src,
                            img.currentSrc,
                            img.getAttribute("data-src")
                        ].filter(Boolean);

                        image = (imageHint
                            ? candidates.find(s => s.includes(imageHint))
                            : null) || candidates[0] || null;
                    }

                    out.push({ text, href, image });
                    if (out.length >= 8) break;
                }

                return out;
            }, { selector: config.productSelector, imageHint: config.imageHint });


            // Keep only tiles that match the beer we searched for
            const matching = tiles.filter(tile =>
                matchesSearch(searchTerm, tile.text)
            );

            // One buy option per pack size
            const options = [];
            const usedLabels = new Set();

            for (const tile of matching) {

                const label = detectPackLabel(tile.text);
                if (usedLabels.has(label)) continue;
                usedLabels.add(label);

                options.push({
                    label,
                    price: extractPrice(tile.text),
                    image: absolute(config.baseUrl, tile.image),
                    link: absolute(config.baseUrl, tile.href),
                    name: tile.text.split("\n")[0] || tile.text
                });
            }

            if (options.length > 0) {

                options.sort((a, b) =>
                    packRank(a.label) - packRank(b.label)
                );

                result.options = options;
                result.available = true;

                const first = options[0];
                result.name = first.name;
                result.price = first.price;
                result.image = first.image;
                result.link = first.link;
            }

        } catch (error) {
            failed = true;
            console.log(`${config.name} failed:`, searchTerm, error.message);
        }

        await page.close().catch(() => {});

        if (failed) {
            result.name = null;
            result.error = true;
        }

        cache[searchTerm] = { time: Date.now(), result };
        saveCache(config.cacheFile, cache);

        return result;
    }

    // enabled defaults to true; a store can set enabled:false to be skipped
    return {
        name: config.name,
        search,
        enabled: config.enabled !== false
    };
}


module.exports = {
    createScraper,
    warmUp,
    getContext,
    // exported for reuse / testing
    extractPrice,
    detectPackLabel,
    matchesSearch
};
