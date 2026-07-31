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
        // Tesco blocks headless browsers with an "Access Denied" page,
        // so run a VISIBLE browser by default (a window will open while
        // it works). Set HEADLESS=true to hide it - e.g. on a server -
        // but expect Tesco to block that.
        headless: process.env.HEADLESS === "true",
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ["--disable-blink-features=AutomationControlled"]
    });

    context = await browser.newContext({ locale: "en-GB" });

    // Hide the main "I'm automated" signal that bot-blockers check.
    await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

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

// Generic beer words that don't identify a specific beer on their own.
const GENERIC_WORDS = new Set([
    "ale", "ipa", "lager", "session", "stout", "porter", "bitter",
    "pale", "hazy", "double", "extra", "beer", "beers", "can", "cans",
    "brewery", "brewing", "brew", "blonde", "golden", "amber", "red",
    "helles", "pils", "pilsner", "keller", "sour", "new", "england",
    "west", "coast", "the", "and"
]);


// Split text into lowercase words of 3+ letters, punctuation stripped.
function words(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter(word => word.length > 2);
}


// Does a product tile match the beer we're looking for?
//
// We match on the beer's DISTINCTIVE words (e.g. "Neck Oil", "Lost",
// "Punk") — the name minus the brewery and minus generic style words —
// because supermarkets often drop the brewery from the product title
// ("Lost Lager", not "BrewDog Lost Lager"). Requiring those distinctive
// words avoids both false negatives (brewery missing) and false
// positives (matching a different beer from the same brewery).
function matchesBeer(name, brewery, productText) {

    if (!productText) return false;

    const text = productText.toLowerCase();

    const nameWords = words(name);
    const breweryWords = new Set(words(brewery));

    // Distinctive product words: not the brewery, not a generic style word
    const productWords = nameWords.filter(
        word => !breweryWords.has(word) && !GENERIC_WORDS.has(word)
    );

    if (productWords.length > 0) {
        // Every distinctive word must be present
        return productWords.every(word => text.includes(word));
    }

    // Name is only brewery + generic words (e.g. "Cloudwater Pale Ale").
    // Then we DO need the brewery, plus the style words, to be sure.
    const styleWords = nameWords.filter(word => !breweryWords.has(word));
    const breweryPresent = [...breweryWords].every(word => text.includes(word));

    return breweryPresent && styleWords.every(word => text.includes(word));
}


// Backwards-compatible helper (brewery unknown): treat the whole name
// as the beer identity.
function matchesSearch(searchTerm, name) {
    return matchesBeer(searchTerm, "", name);
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


// Click through a cookie-consent banner if one is shown. Best-effort:
// tries a few common "accept" buttons and quietly gives up if none exist.
async function dismissCookieBanner(page) {

    const selectors = [
        "#onetrust-accept-btn-handler",              // OneTrust (Tesco et al.)
        "button#accept-all-cookies",
        "button[aria-label*='accept' i]",
        "button:has-text('Accept all cookies')",
        "button:has-text('Accept all')",
        "button:has-text('I accept')"
    ];

    for (const selector of selectors) {
        try {
            const button = page.locator(selector).first();
            await button.click({ timeout: 2000 });
            // Give the page a moment to re-render after accepting
            await page.waitForTimeout(500);
            return;
        } catch {
            // this selector wasn't present; try the next
        }
    }
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

    async function search(searchTerm, brewery = "") {

        const cache = loadCache(config.cacheFile);

        // In debug mode, always re-scrape so we can see what's on the page.
        if (!process.env.DEBUG && cacheValid(cache[searchTerm])) {
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

            // Dismiss a cookie-consent banner if one appears, otherwise
            // the product grid may never render. Covers Tesco's OneTrust
            // banner and common "Accept all cookies" buttons. Best-effort.
            await dismissCookieBanner(page);

            // Give products a chance to appear. If none show up, that
            // usually just means Tesco doesn't stock this beer (zero
            // results) - NOT an error - so we don't fail here; we let
            // the empty result fall through as a genuine "not found".
            await page
                .locator(config.productSelector)
                .first()
                .waitFor({ timeout: 12000 })
                .catch(() => {});

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

                    // Start from a sensible tile container...
                    let tile =
                        a.closest("li, article, [class*='tile'], [class*='product']")
                        || a.parentElement;

                    // ...but climb up to the smallest ancestor that actually
                    // shows a price, so we capture the name AND the £ price
                    // together (Tesco keeps them in separate sub-elements).
                    let node = a.parentElement;
                    for (let i = 0; i < 8 && node; i++) {
                        if ((node.innerText || "").includes("£")) {
                            tile = node;
                            break;
                        }
                        node = node.parentElement;
                    }

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
                matchesBeer(searchTerm, brewery, tile.text)
            );

            // Debug: show every product on the page and whether it matched,
            // and save a screenshot so you can SEE what the scraper sees.
            if (process.env.DEBUG) {
                console.log(`\n[debug] ${config.name} "${searchTerm}" — ${tiles.length} products on page:`);
                if (tiles.length === 0) {
                    console.log("   (none — page had no product links: not stocked, blocked, or slow to load)");
                }
                tiles.forEach(tile => {
                    const firstLine = (tile.text || "").split("\n")[0].slice(0, 55);
                    if (matchesBeer(searchTerm, brewery, tile.text)) {
                        const label = detectPackLabel(tile.text);
                        const price = extractPrice(tile.text) || "NO PRICE FOUND";
                        console.log(`   MATCH | ${label} @ ${price} | ${firstLine}`);
                    } else {
                        console.log(`     --  | ${firstLine}`);
                    }
                });
                await page.screenshot({ path: "debug-page.png", fullPage: true }).catch(() => {});
                console.log("   (saved a screenshot of the page to debug-page.png)\n");
            }

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
    matchesSearch,
    matchesBeer
};
