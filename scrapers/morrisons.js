// ---------------------------------------------------------------
// Morrisons scraper — built fresh, from scratch.
//
// Why its own file (not the shared lib.js browser)?
//   The shared browser blocks CSS + images and drives bundled Chromium.
//   Morrisons is a React app that decides what to send based on how real
//   the browser looks. A stripped-down automated browser gets served ONLY
//   the ~7 sponsored tiles — the real search results are withheld. That's
//   exactly what we saw ("found 8 tiles, kept 7").
//
//   So this scraper does the opposite of a bot:
//     • drives REAL Chrome (channel: "chrome") when it's installed, which
//       carries none of Chromium's automation fingerprints;
//     • loads the FULL normal page — CSS, images, everything — like a
//       person browsing;
//     • uses a real desktop fingerprint (user-agent, viewport, locale);
//     • waits for the real product grid to actually appear before reading.
//
// The plan we agreed:
//   1. Prove it works: `npm run morrisons` opens a visible Chrome, loads
//      the craft-beer search, and lists the real beers it found.
//   2. Then make it faster (trim the waits in TUNING below) until it
//      breaks, and step back to the last setting that still worked.
//
// Run:
//   npm run morrisons              (visible Chrome — the proving run)
//   HEADLESS=true npm run morrisons (hidden — expect fewer/no results)
// ---------------------------------------------------------------

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const {
    extractPrice,
    priceValue,
    detectPackLabel,
    absolute
} = require("./lib");


// ---- Where the results go -------------------------------------

const OUT_FILE   = path.join(__dirname, "../public/data/morrisons-catalog.json");
const SHOT_FILE  = path.join(__dirname, "../catalog-morrisons-page1.png");
const BASE_URL   = "https://groceries.morrisons.com";

const searchUrl = (query, page) =>
    `${BASE_URL}/search?q=${encodeURIComponent(query).replace(/%20/g, "+")}&page=${page}`;


// ---- TUNING (the "make it faster until it breaks" knobs) ------
//
// Start generous so we can PROVE it works, then lower these one at a time.
// If a lower value stops finding the real beers, go back up one step.
const TUNING = {
    maxPages:        10,     // how many search pages to crawl at most
    settleMs:        4000,   // pause after prices populate, before reading
    scrollRounds:    12,     // how many times to scroll down (lazy loading)
    scrollPauseMs:   900,    // pause between scrolls
    gridTimeoutMs:   30000,  // how long to wait for the product grid to load
    navTimeoutMs:    60000,  // how long to allow the page navigation itself
    // The tiles can appear a beat before their price/name text loads in.
    // Poll for the tiles to actually FILL with prices, up to this long,
    // instead of reading them while they're still empty skeletons.
    priceWaitMs:     30000,  // max time to wait for tiles to fill with £ prices
    pricePollMs:     1000,   // how often to re-check while waiting
    priceTarget:     12,     // how many tiles-with-a-price counts as "loaded"
    // The real results page shows far more than the sponsored strip. If a
    // page comes back with this few tiles, treat it as "only sponsored
    // loaded" and wait/scroll for more rather than trusting it.
    sponsoredOnly:   9
};


// Morrisons product links look like /products/<slug>-<id>.
const PRODUCT_SELECTOR = "a[href*='/products/']";


// ---- The browser ----------------------------------------------
//
// Prefer real Chrome — it's the single biggest anti-detection win, because
// Morrisons can't tell it apart from a normal shopper. Fall back to the
// bundled Chromium only if Chrome isn't installed on this machine.
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

    // Try real Chrome first.
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

    // Make the automated browser look like a normal one: no webdriver flag,
    // a populated languages/plugins list, and a chrome object present.
    await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        Object.defineProperty(navigator, "languages", { get: () => ["en-GB", "en"] });
        Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
        window.chrome = window.chrome || { runtime: {} };
    });

    // NOTE: unlike the shared browser, we DON'T block CSS/images here. The
    // real grid only renders when the page loads normally, and the few
    // extra image downloads are a small price for actually getting beers.

    return context;
}


// ---- Cookie banner --------------------------------------------

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


// ---- Read one search page -------------------------------------

async function readPage(page, query, pageNo) {

    console.log(`\n--- Morrisons page ${pageNo} ---`);

    await page.goto(searchUrl(query, pageNo), {
        waitUntil: "domcontentloaded",
        timeout: TUNING.navTimeoutMs
    });

    if (pageNo === 1) await dismissCookies(page);

    // Wait for the FIRST product link to appear at all.
    await page.locator(PRODUCT_SELECTOR).first()
        .waitFor({ timeout: TUNING.gridTimeoutMs })
        .catch(() => {});

    // Let the app settle, then scroll to trigger the lazy-loaded grid.
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    // Keep scrolling until the number of product tiles stops growing — that
    // means we've pulled in the whole real grid, not just the sponsored
    // strip. This is the key to getting past "only 7 sponsored".
    let lastCount = 0;
    for (let round = 0; round < TUNING.scrollRounds; round++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(TUNING.scrollPauseMs);
        const count = await page.locator(PRODUCT_SELECTOR).count();
        if (count === lastCount && count > TUNING.sponsoredOnly) break;
        lastCount = count;
    }
    await page.evaluate(() => window.scrollTo(0, 0));

    // The tiles can render a beat before their price/name text loads in
    // (you saw this: tiles present, data hadn't followed yet). So don't
    // read while they're empty skeletons — poll until enough tiles actually
    // contain a £ price, and only then read. This is the real fix.
    const deadline = Date.now() + TUNING.priceWaitMs;
    let priced = 0;
    while (Date.now() < deadline) {
        priced = await page.evaluate((selector) => {
            let n = 0;
            for (const a of document.querySelectorAll(selector)) {
                let node = a.parentElement;
                for (let i = 0; i < 8 && node; i++) {
                    if ((node.innerText || "").includes("£")) { n++; break; }
                    node = node.parentElement;
                }
            }
            return n;
        }, PRODUCT_SELECTOR);

        if (priced >= TUNING.priceTarget) break;
        process.stdout.write(`\r  waiting for prices to load in... ${priced} priced so far`);
        await page.waitForTimeout(TUNING.pricePollMs);
    }
    if (priced > 0) process.stdout.write("\n");

    // A final settle so any last few tiles finish filling before we read.
    await page.waitForTimeout(TUNING.settleMs);

    if (pageNo === 1) {
        await page.screenshot({ path: SHOT_FILE, fullPage: true }).catch(() => {});
    }

    // Pull each product tile: its text (name + price), link and image.
    const tiles = await page.evaluate((selector) => {

        const anchors = Array.from(document.querySelectorAll(selector));
        const seen = new Set();
        const out = [];

        for (const a of anchors) {
            const href = a.getAttribute("href");
            if (!href || seen.has(href)) continue;
            seen.add(href);

            // Climb to the smallest ancestor that shows a price, so name and
            // £ price are captured together.
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
    }, PRODUCT_SELECTOR);

    return tiles;
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

            const tiles = await readPage(page, query, pageNo);

            let kept = 0;
            for (const tile of tiles) {
                const price = extractPrice(tile.text);
                if (priceValue(price) <= 0) continue;        // no real price → skip

                const link = absolute(BASE_URL, tile.href);
                if (!link || seen.has(link)) continue;
                seen.add(link);

                products.push({
                    supermarket: "Morrisons",
                    title: (tile.text.split("\n")[0] || tile.text).trim(),
                    text: tile.text,
                    price,
                    image: absolute(BASE_URL, tile.image),
                    link,
                    pack: detectPackLabel(tile.text)
                });
                kept++;
            }

            console.log(
                `Page ${pageNo}: found ${tiles.length} tiles, kept ${kept} priced ` +
                `(running total ${products.length}).`
            );

            if (tiles.length <= TUNING.sponsoredOnly) {
                console.log(
                    `  ⚠  Only ${tiles.length} tiles — that's the sponsored strip, the ` +
                    `real grid didn't load. Bot detection likely still winning here.`
                );
            }

            // Stop when a page adds nothing new (end of real results).
            if (kept === 0) break;
        }
    } finally {
        await browser.close().catch(() => {});
    }

    return products;
}


// ---- Run it ---------------------------------------------------

(async () => {

    console.log('Morrisons scraper — opening a browser and searching "craft beer"...');

    const products = await crawl("craft beer");

    fs.writeFileSync(OUT_FILE, JSON.stringify(products, null, 2));

    console.log(`\n==================== RESULT ====================`);
    console.log(`Found ${products.length} Morrisons beer products.\n`);

    products.slice(0, 40).forEach((p, i) => {
        console.log(`  ${String(i + 1).padStart(2)}. ${p.price.padEnd(7)} ${p.title}`);
    });
    if (products.length > 40) console.log(`  ...and ${products.length - 40} more.`);

    console.log(`\nSaved to: ${OUT_FILE}`);
    console.log(`Screenshot of page 1: ${SHOT_FILE}`);

    if (products.length <= TUNING.sponsoredOnly) {
        console.log(
            `\nStill only got the sponsored strip. Next things to try (tell me which):\n` +
            `  • make sure real Chrome is installed (this script prefers it);\n` +
            `  • raise TUNING.settleMs / gridTimeoutMs in scrapers/morrisons.js;\n` +
            `  • run it non-headless so you can watch what the page actually does.`
        );
    } else {
        console.log(
            `\nLooks like it worked. When you're happy, say the word and I'll wire this\n` +
            `into the main catalogue so Morrisons beers show on the site alongside Tesco.`
        );
    }

    process.exit(0);
})();
