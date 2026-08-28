// ---------------------------------------------------------------
// Asda scraper — same tactic as Morrisons (real Chrome, slow scroll).
//
// Asda's groceries site is a React app that, like Morrisons, only serves the
// real product grid to a browser that looks like a real shopper. So this
// scraper reuses the exact Morrisons approach:
//     • drives REAL Chrome (channel: "chrome") when installed — no automation
//       fingerprints;
//     • loads the FULL normal page (CSS, images, everything);
//     • uses a real desktop fingerprint (user-agent, viewport, locale);
//     • closes the cookie + delivery/postcode popups that hide the grid;
//     • HARVESTS a single page by scrolling DOWN IN SMALL STEPS and collecting
//       beers as they pass through the virtualised grid (Asda lazy-loads /
//       virtualises results, so one read only ever holds a slice).
//
// Run:
//   npm run asda                (visible Chrome — the proving run)
//   HEADLESS=true npm run asda  (hidden — expect fewer/no results)
// ---------------------------------------------------------------

const { chromium } = require("playwright");
const { execSync } = require("child_process");
const path = require("path");

const {
    extractPrice,
    priceValue,
    detectPackLabel,
    absolute,
    productName,
    looksLikeBeer
} = require("./lib");

const { mergeCatalog, CATALOG_FILE, META_FILE } = require("./catalog");


// ---- Where the results go -------------------------------------

const SHOT_FILE = path.join(__dirname, "../catalog-asda-page1.png");
const BASE_URL  = "https://www.asda.com";

// Asda uses a path-based search: /groceries/search/<query>. encodeURIComponent
// gives the %20 spacing the site's own URL uses.
const searchUrl = (query) =>
    `${BASE_URL}/groceries/search/${encodeURIComponent(query)}`;


// ---- TUNING (same "make it faster until it breaks" knobs) ------
const TUNING = {
    // Asda shows its beers on one long, lazy-loading page — harvest it slowly.
    harvestMs:       180000, // up to 3 minutes on the page
    scrollStepPx:    450,    // small steps so the grid doesn't drop beers
    scrollPauseMs:   900,    // pause after each small step (let tiles load)
    gridTimeoutMs:   30000,  // how long to wait for the first product tile
    navTimeoutMs:    60000,  // how long to allow the page navigation itself
    enoughBeers:     30,     // "we've probably got them all" threshold
    stableRounds:    8,      // consecutive no-growth rounds that count as "done"
    // A run with fewer than this many priced beers is almost certainly the
    // bot wall / an empty grid, so we refuse to save it (can't wipe good data).
    minOk:           10
};

// Below this many beers we treat the run as failed and don't save.
const MIN_OK = TUNING.minOk;


// Asda product links look like /product/<slug>/<id> (or /groceries/product/...).
const PRODUCT_SELECTOR = "a[href*='/product/']";


// ---- The browser (identical to Morrisons) ---------------------

async function launchBrowser() {

    const headless = process.env.HEADLESS === "true";

    const launchOpts = {
        headless,
        args: [
            "--disable-blink-features=AutomationControlled",
            "--disable-features=IsolateOrigins,site-per-process",
            "--no-sandbox"
        ]
    };

    try {
        const browser = await chromium.launch({ ...launchOpts, channel: "chrome" });
        console.log("Using real Chrome (best for avoiding bot detection).");
        return browser;
    } catch {
        console.log("Real Chrome not found — falling back to bundled Chromium.");
    }

    if (process.env.CHROMIUM_PATH) {
        launchOpts.executablePath = process.env.CHROMIUM_PATH;
    }
    return chromium.launch(launchOpts);
}


async function makeContext(browser) {

    const context = await browser.newContext({
        locale: "en-GB",
        timezoneId: "Europe/London",
        viewport: { width: 1366, height: 900 },
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        extraHTTPHeaders: {
            "Accept-Language": "en-GB,en;q=0.9"
        }
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        Object.defineProperty(navigator, "languages", { get: () => ["en-GB", "en"] });
        Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
        window.chrome = window.chrome || { runtime: {} };
    });

    return context;
}


// ---- Cookie banner (Asda uses OneTrust, same as Morrisons) ----

async function dismissCookies(page) {
    const selectors = [
        "#onetrust-accept-btn-handler",
        "button[aria-label*='accept' i]",
        "button:has-text('Accept all cookies')",
        "button:has-text('Accept All Cookies')",
        "button:has-text('Accept all')",
        "button:has-text('I accept')"
    ];
    for (const selector of selectors) {
        try {
            await page.locator(selector).first().click({ timeout: 2500 });
            await page.waitForTimeout(400);
            return;
        } catch {
            // not present — try the next
        }
    }
}


// Asda pops a delivery / postcode / "shop groceries" chooser over the results.
// Until it's closed the real grid stays hidden. Close it the same best-effort
// way as Morrisons: Escape, then click any X / close / "no thanks" control.
async function dismissDeliveryModal(page) {

    await page.keyboard.press("Escape").catch(() => {});

    const selectors = [
        "button[aria-label='Close']",
        "button[aria-label*='close' i]",
        "[data-test*='close' i]",
        "[data-testid*='close' i]",
        "[class*='modal'] button[aria-label*='close' i]",
        "[role='dialog'] button[aria-label*='close' i]",
        "button:has-text('No thanks')",
        "button:has-text('Not now')",
        "button:has-text('Maybe later')",
        "button:has-text('Continue shopping')",
        "button:has-text('Continue browsing')"
    ];

    for (const selector of selectors) {
        try {
            const button = page.locator(selector).first();
            if (await button.isVisible({ timeout: 500 })) {
                await button.click({ timeout: 1500 });
                await page.waitForTimeout(400);
                return true;
            }
        } catch {
            // not present / not clickable — try the next
        }
    }
    return false;
}


// Some Asda result pages use a "Load more" / "Show more" button instead of (or
// as well as) infinite scroll. Click it if it's there — best-effort, safe to
// call every harvest round.
async function clickLoadMore(page) {
    const selectors = [
        "button:has-text('Load more')",
        "button:has-text('Show more')",
        "button:has-text('View more')",
        "a:has-text('Load more')",
        "[data-testid*='load-more' i]"
    ];
    for (const selector of selectors) {
        try {
            const button = page.locator(selector).first();
            if (await button.isVisible({ timeout: 400 })) {
                await button.click({ timeout: 1500 });
                await page.waitForTimeout(600);
                return true;
            }
        } catch {
            // not present — try the next
        }
    }
    return false;
}


// ---- Read the search page (single-page slow-scroll harvest) ----

async function readPage(page, query) {

    console.log(`\n--- Asda search: "${query}" ---`);

    await page.goto(searchUrl(query), {
        waitUntil: "domcontentloaded",
        timeout: TUNING.navTimeoutMs
    });

    await dismissCookies(page);
    await dismissDeliveryModal(page);

    await page.locator(PRODUCT_SELECTOR).first()
        .waitFor({ timeout: TUNING.gridTimeoutMs })
        .catch(() => {});

    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    // HARVEST: scroll DOWN IN SMALL STEPS and COLLECT beers as they pass
    // through, accumulating them by link. Survives the grid virtualising /
    // dropping tiles you've scrolled past, and any self-refresh.
    const collected = new Map();   // href -> tile (prefer the priced version)

    const merge = (tiles) => {
        for (const t of tiles) {
            if (!t.href) continue;
            const existing = collected.get(t.href);
            const hasPrice = (t.text || "").includes("£");
            if (!existing || (hasPrice && !(existing.text || "").includes("£"))) {
                collected.set(t.href, t);
            }
        }
    };

    const pricedCount = () =>
        [...collected.values()].filter(t => (t.text || "").includes("£")).length;

    const harvestDeadline = Date.now() + TUNING.harvestMs;
    let stable = 0;
    let lastPriced = 0;
    let bottoms = 0;

    while (Date.now() < harvestDeadline) {

        await dismissDeliveryModal(page);

        merge(await extractTiles(page));

        // Try a "load more" button (no-op if the page uses infinite scroll).
        await clickLoadMore(page);

        const atBottom = await page.evaluate((stepPx) => {
            const nearBottom =
                window.innerHeight + window.scrollY >= document.body.scrollHeight - 50;
            if (nearBottom) {
                window.scrollTo(0, 0);   // wrap back to top for another pass
                return true;
            }
            window.scrollBy(0, stepPx);
            return false;
        }, TUNING.scrollStepPx);

        await page.waitForTimeout(TUNING.scrollPauseMs);

        merge(await extractTiles(page));

        const priced = pricedCount();
        if (atBottom) bottoms++;

        const secsLeft = Math.max(0, Math.round((harvestDeadline - Date.now()) / 1000));
        process.stdout.write(
            `\r  harvesting (slow scroll)... ${priced} beers collected, ` +
            `pass ${bottoms + 1}, ${secsLeft}s left      `
        );

        if (priced === lastPriced) {
            stable++;
            if (bottoms >= 2 && stable >= TUNING.stableRounds &&
                priced >= TUNING.enoughBeers) break;
        } else {
            stable = 0;
        }
        lastPriced = priced;
    }
    process.stdout.write("\n");

    await page.screenshot({ path: SHOT_FILE, fullPage: true }).catch(() => {});

    const result = [...collected.values()];
    console.log(`  Collected ${pricedCount()} priced beers over ${bottoms} full pass(es).`);
    return result;
}


// Read every product tile on the page right now: text (name + price), link,
// image. Returns [] on any error (e.g. mid-refresh).
async function extractTiles(page) {
    return page.evaluate((selector) => {

        const anchors = Array.from(document.querySelectorAll(selector));
        const seen = new Set();
        const out = [];

        for (const a of anchors) {
            const href = a.getAttribute("href");
            if (!href || seen.has(href)) continue;
            seen.add(href);

            let tile = a.closest("li, article, [class*='tile'], [class*='product']")
                || a.parentElement;
            let node = a.parentElement;
            for (let i = 0; i < 8 && node; i++) {
                if ((node.innerText || "").includes("£")) { tile = node; break; }
                node = node.parentElement;
            }

            const text = (tile.innerText || "").trim();
            const img = tile.querySelector("img");
            const image = img
                ? (img.getAttribute("src") || img.src || img.getAttribute("data-src"))
                : null;

            out.push({ text, href, image });
        }
        return out;
    }, PRODUCT_SELECTOR).catch(() => []);
}


// ---- Crawl -----------------------------------------------------

async function crawl(query = "craft beer") {

    const browser = await launchBrowser();
    const context = await makeContext(browser);
    const page = await context.newPage();

    const products = [];
    const seen = new Set();

    try {
        const tiles = await readPage(page, query);

        let kept = 0;
        for (const tile of tiles) {
            if (!looksLikeBeer(tile.text)) continue;      // drop non-beers

            const price = extractPrice(tile.text);
            if (priceValue(price) <= 0) continue;         // no real price → skip

            const link = absolute(BASE_URL, tile.href);
            if (!link || seen.has(link)) continue;
            seen.add(link);

            products.push({
                supermarket: "Asda",
                title: productName(tile.text),
                text: tile.text,
                price,
                image: absolute(BASE_URL, tile.image),
                link,
                pack: detectPackLabel(tile.text)
            });
            kept++;
        }

        console.log(
            `Found ${tiles.length} tiles, kept ${kept} priced beers.`
        );
        if (kept < MIN_OK) {
            console.log(
                `  ⚠  Only ${kept} priced beers — that looks like the bot wall / empty grid, ` +
                `not the real range.`
            );
        }
    } catch (error) {
        console.log("Crawl error:", error.message);
    }

    // Leave the browser open — the caller owns closing it (see the runner).
    return { products, browser };
}


// ---- Put the beers live ---------------------------------------

// Merge just the Asda beers into the catalogue (keeping every other shop's).
// Refuses to save a run below MIN_OK, so a bad run can't wipe good data.
function mergeAsda(products) {

    if (products.length < MIN_OK) {
        console.log(
            `\nOnly ${products.length} beers — that looks like the bot wall, not the\n` +
            `real range, so NOT saving to the catalogue this time.`
        );
        return false;
    }

    mergeCatalog(products, ["Asda"]);
    console.log(`\nMerged ${products.length} Asda beers into the catalogue:`);
    console.log(`  ${CATALOG_FILE}`);
    return true;
}


// Commit + push catalog.json (NOPUSH=1 to skip). Same behaviour as Morrisons'.
function pushCatalog(message) {

    const cwd = path.join(__dirname, "..");

    if (process.env.NOPUSH === "1") {
        console.log(`\nNOPUSH set — saved locally, not pushed. To put it live yourself:\n` +
            `  git add public/data/catalog.json && git commit -m "${message}" && git push`);
        return;
    }

    try {
        execSync(`git add "${CATALOG_FILE}" "${META_FILE}"`, { cwd });

        let changed = true;
        try {
            execSync(`git diff --cached --quiet -- "${CATALOG_FILE}" "${META_FILE}"`, { cwd });
            changed = false;
        } catch { changed = true; }

        if (!changed) {
            console.log(`\nCatalogue unchanged since last time — nothing to push.`);
            return;
        }

        execSync(`git commit -m "${message}"`, { cwd });
        execSync(`git push`, { cwd });
        console.log(`\n✅ Pushed to GitHub — the live site will update in a minute or two.`);
    } catch (error) {
        console.log(
            `\nCouldn't auto-push (${error.message.split("\n")[0]}).\n` +
            `Saved locally though — to put it live, run:\n` +
            `  git add public/data/catalog.json && git commit -m "${message}" && git push`
        );
    }
}


function publish(products) {
    if (mergeAsda(products)) {
        pushCatalog(`Update Asda beers in catalogue (${products.length})`);
    }
}


function printFound(products) {
    console.log(`\n==================== RESULT ====================`);
    console.log(`Found ${products.length} Asda beer products.\n`);
    products.slice(0, 40).forEach((p, i) => {
        console.log(`  ${String(i + 1).padStart(2)}. ${p.price.padEnd(7)} ${p.title}`);
    });
    if (products.length > 40) console.log(`  ...and ${products.length - 40} more.`);
    console.log(`\nScreenshot of the page: ${SHOT_FILE}`);
}


// Reusable by the combined runner.
module.exports = {
    crawlAsda: crawl,
    mergeAsda,
    pushCatalog,
    printFound,
    MIN_OK
};


// ---- Run it standalone ('npm run asda') -----------------------
if (require.main === module) {
    (async () => {

        console.log('Asda scraper — opening a browser and searching "craft beer"...');

        const { products, browser } = await crawl("craft beer");

        printFound(products);
        publish(products);

        console.log(`\n>>> Browser left open. Press Ctrl+C here to close it when you're done. <<<`);

        process.on("SIGINT", async () => {
            console.log("\nClosing browser...");
            await browser.close().catch(() => {});
            process.exit(0);
        });

        await new Promise(() => {});
    })();
}
