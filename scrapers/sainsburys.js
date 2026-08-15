// ---------------------------------------------------------------
// Sainsbury's scraper — same tactic as Morrisons.
//
// Like Morrisons, Sainsbury's "groceries online" (GOL) UI is a React app
// that decides what to serve based on how real the browser looks, and it
// throws a cookie wall (and sometimes a location/delivery prompt) in front
// of the results. So this scraper copies the Morrisons approach:
//
//   • drives REAL Chrome (channel: "chrome") when installed — no automation
//     fingerprint;
//   • loads the FULL normal page (CSS, images, everything) like a shopper;
//   • uses a real desktop fingerprint (user-agent, viewport, locale);
//   • dismisses the cookie wall, and any location/delivery popup, then reads.
//
// THE ONE DIFFERENCE FROM MORRISONS: Sainsbury's PAGINATES. Morrisons puts
// every craft beer on one endlessly-scrolling page; Sainsbury's shows a
// fixed batch per page (?pageNumber=1, 2, 3 ...). So instead of harvesting a
// single page for minutes, we walk the pages one by one — scrolling each to
// load its tiles — and stop when a page adds no new beers (past the end).
//
// Run:
//   npm run sainsburys              (visible Chrome — the proving run)
//   HEADLESS=true npm run sainsburys (hidden — expect fewer/no results)
// ---------------------------------------------------------------

const { chromium } = require("playwright");
const path = require("path");

const {
    extractPrice,
    priceValue,
    detectPackLabel,
    absolute,
    productName
} = require("./lib");

const { mergeCatalog, CATALOG_FILE } = require("./catalog");
const { pushCatalog } = require("./morrisons");   // reuse the git add+commit+push


// ---- Where the results go -------------------------------------

const SHOT_FILE = path.join(__dirname, "../catalog-sainsburys-page1.png");
const BASE_URL  = "https://www.sainsburys.co.uk";

// e.g. https://www.sainsburys.co.uk/gol-ui/SearchResults/craft%20beer?pageNumber=1
const searchUrl = (query, page) =>
    `${BASE_URL}/gol-ui/SearchResults/${encodeURIComponent(query)}?pageNumber=${page}`;


// ---- TUNING ---------------------------------------------------
const TUNING = {
    // Craft beer spans a handful of pages — plenty of headroom, we stop early
    // when a page stops adding new beers.
    maxPages:        20,
    // Per PAGE (not the whole run): scroll it to the bottom in small steps to
    // let every tile lazy-load, collecting as we go. Cap the time per page so
    // a slow page can't stall the whole crawl.
    pageHarvestMs:   45000,
    scrollStepPx:    600,
    scrollPauseMs:   700,
    gridTimeoutMs:   30000,
    navTimeoutMs:    60000,
    // On a page, once we've reached the bottom and the count hasn't grown for
    // this many rounds, that page is fully read — move to the next.
    stableRounds:    5,
    // Don't save a run that got almost nothing (bot wall likely won) — keeps
    // a bad run from replacing good Sainsbury's data with a stub.
    minOk:           5
};


// Sainsbury's GOL product links look like /gol-ui/product/<slug>.
const PRODUCT_SELECTOR = "a[href*='/product/']";


// ---- The browser (identical approach to Morrisons) ------------

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


// ---- Cookie wall ----------------------------------------------

async function dismissCookies(page) {
    const selectors = [
        "#onetrust-accept-btn-handler",
        "button[data-testid='accept-all-cookies']",
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


// Best-effort: close any location / delivery / "choose a store" popup that
// sits over the results (Sainsbury's shows one on first load, like
// Morrisons' delivery box). Safe to call repeatedly.
async function dismissModal(page) {

    await page.keyboard.press("Escape").catch(() => {});

    const selectors = [
        "button[aria-label='Close']",
        "button[aria-label*='close' i]",
        "[data-testid*='close' i]",
        "[data-test*='close' i]",
        "[role='dialog'] button[aria-label*='close' i]",
        "[class*='modal'] button[aria-label*='close' i]",
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


// ---- Read one search page (scroll it to load every tile) ------

async function readPage(page, query, pageNo) {

    await page.goto(searchUrl(query, pageNo), {
        waitUntil: "domcontentloaded",
        timeout: TUNING.navTimeoutMs
    });

    if (pageNo === 1) await dismissCookies(page);
    await dismissModal(page);

    // Wait for the first product link to appear at all.
    await page.locator(PRODUCT_SELECTOR).first()
        .waitFor({ timeout: TUNING.gridTimeoutMs })
        .catch(() => {});

    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    // Scroll this page to the bottom in small steps so every tile lazy-loads,
    // collecting beers by link as they pass through.
    const collected = new Map();

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

    const deadline = Date.now() + TUNING.pageHarvestMs;
    let stable = 0;
    let last = 0;
    let reachedBottom = false;

    while (Date.now() < deadline) {

        await dismissModal(page);
        merge(await extractTiles(page));

        const atBottom = await page.evaluate((stepPx) => {
            const nearBottom =
                window.innerHeight + window.scrollY >= document.body.scrollHeight - 50;
            if (!nearBottom) window.scrollBy(0, stepPx);
            return nearBottom;
        }, TUNING.scrollStepPx);

        await page.waitForTimeout(TUNING.scrollPauseMs);
        merge(await extractTiles(page));

        const priced = pricedCount();
        if (atBottom) reachedBottom = true;

        if (priced === last) {
            stable++;
            if (reachedBottom && stable >= TUNING.stableRounds) break;
        } else {
            stable = 0;
        }
        last = priced;
    }

    if (pageNo === 1) {
        await page.screenshot({ path: SHOT_FILE, fullPage: true }).catch(() => {});
    }

    return [...collected.values()];
}


// Read every product tile on the page right now: text (name + price), link,
// image. Returns [] on any error. (Same shape as the Morrisons reader.)
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


// ---- Crawl every page -----------------------------------------

async function crawl(query = "craft beer") {

    const browser = await launchBrowser();
    const context = await makeContext(browser);
    const page = await context.newPage();

    const products = [];
    const seen = new Set();

    try {
        for (let pageNo = 1; pageNo <= TUNING.maxPages; pageNo++) {

            console.log(`\n--- Sainsbury's page ${pageNo} ---`);
            const tiles = await readPage(page, query, pageNo);

            let kept = 0;
            for (const tile of tiles) {
                const price = extractPrice(tile.text);
                if (priceValue(price) <= 0) continue;

                const link = absolute(BASE_URL, tile.href);
                if (!link || seen.has(link)) continue;
                seen.add(link);

                products.push({
                    supermarket: "Sainsbury's",
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
                `Page ${pageNo}: found ${tiles.length} tiles, kept ${kept} new priced ` +
                `(running total ${products.length}).`
            );

            // No new beers on this page → we've walked past the last one.
            if (kept === 0) {
                console.log(`  Page ${pageNo} added nothing new — reached the end.`);
                break;
            }
        }
    } catch (error) {
        console.log("Crawl error:", error.message);
    }

    // Leave the browser open — the caller owns it (same as Morrisons).
    return { products, browser };
}


// ---- Put the beers live ---------------------------------------

// Merge just the Sainsbury's beers into the catalogue (keeping Tesco's and
// Morrisons'). Refuses to save an almost-empty run so a bot-walled crawl
// can't replace good data with a stub. Returns true if it saved.
function mergeSainsburys(products) {

    if (products.length < TUNING.minOk) {
        console.log(
            `\nOnly ${products.length} beers — that looks like the cookie/bot wall won,\n` +
            `so NOT saving to the catalogue this time (keeping existing data).`
        );
        return false;
    }

    mergeCatalog(products, ["Sainsbury's"]);
    console.log(`\nMerged ${products.length} Sainsbury's beers into the catalogue:`);
    console.log(`  ${CATALOG_FILE}`);
    return true;
}


function publish(products) {
    if (mergeSainsburys(products)) {
        pushCatalog(`Update Sainsbury's beers in catalogue (${products.length})`);
    }
}


function printFound(products) {
    console.log(`\n==================== RESULT ====================`);
    console.log(`Found ${products.length} Sainsbury's beer products.\n`);
    products.slice(0, 40).forEach((p, i) => {
        console.log(`  ${String(i + 1).padStart(2)}. ${p.price.padEnd(7)} ${p.title}`);
    });
    if (products.length > 40) console.log(`  ...and ${products.length - 40} more.`);
    console.log(`\nScreenshot of page 1: ${SHOT_FILE}`);
}


// Reusable by the combined runner.
module.exports = {
    crawlSainsburys: crawl,
    mergeSainsburys,
    printFound,
    MIN_OK: TUNING.minOk
};


// ---- Run it standalone ('npm run sainsburys') -----------------

if (require.main === module) {
    (async () => {

        console.log('Sainsbury\'s scraper — opening a browser and searching "craft beer"...');

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
