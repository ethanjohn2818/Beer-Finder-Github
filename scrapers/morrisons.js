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
    // Morrisons puts ALL its craft beers on one page, so we only need one.
    maxPages:        1,
    // The site is slow and the delivery popup keeps reappearing, so instead
    // of a fixed wait we HARVEST the single page for a few minutes: keep
    // scrolling, keep closing the popup, and let the beers trickle in.
    harvestMs:       180000, // 3 minutes on the page
    scrollPauseMs:   1200,   // pause after each scroll step
    settleMs:        4000,   // final settle before the last read
    gridTimeoutMs:   30000,  // how long to wait for the first product tile
    navTimeoutMs:    60000,  // how long to allow the page navigation itself
    // If harvesting reaches at least this many priced beers AND the count
    // stops growing for a while, we can stop early instead of waiting the
    // full 3 minutes. Set high so a slow page still gets its full time.
    enoughBeers:     40,
    stableRounds:    8,      // consecutive no-growth rounds that count as "done"
    // A page with only this few priced tiles is just the sponsored strip.
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


// Morrisons pops up a "can we deliver to you?" box (the ?showDDS=true
// delivery/store selector) over the search — a small modal with an X.
// Until it's closed the real product grid stays as empty skeletons, which
// is what we were reading. Close it: press Escape, then click any X /
// close / "no thanks" style control we can find. Best-effort and safe to
// call repeatedly (it may appear a beat after the page loads).
async function dismissDeliveryModal(page) {

    // Escape closes most modals outright.
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


// ---- Read one search page -------------------------------------

async function readPage(page, query, pageNo) {

    console.log(`\n--- Morrisons page ${pageNo} ---`);

    await page.goto(searchUrl(query, pageNo), {
        waitUntil: "domcontentloaded",
        timeout: TUNING.navTimeoutMs
    });

    if (pageNo === 1) await dismissCookies(page);

    // Close Morrisons' delivery/store popup — until it's gone the real grid
    // stays as empty skeletons.
    await dismissDeliveryModal(page);

    // Wait for the FIRST product link to appear at all.
    await page.locator(PRODUCT_SELECTOR).first()
        .waitFor({ timeout: TUNING.gridTimeoutMs })
        .catch(() => {});

    // Let the app settle before we start harvesting.
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    // HARVEST: the site is slow and the delivery popup keeps coming back, so
    // for up to ~3 minutes we keep scrolling the one page, keep closing the
    // popup, and keep counting how many tiles have actually filled with a
    // price. We stop early only if it's clearly finished (a good number of
    // priced beers and the count has stopped growing).
    const countPriced = (selector) => page.evaluate((sel) => {
        let n = 0;
        for (const a of document.querySelectorAll(sel)) {
            let node = a.parentElement;
            for (let i = 0; i < 8 && node; i++) {
                if ((node.innerText || "").includes("£")) { n++; break; }
                node = node.parentElement;
            }
        }
        return n;
    }, selector);

    const harvestDeadline = Date.now() + TUNING.harvestMs;
    let priced = 0;
    let lastPriced = 0;
    let stable = 0;
    let step = 0;

    while (Date.now() < harvestDeadline) {

        // Keep the delivery popup out of the way (it reappears).
        await dismissDeliveryModal(page);

        // Scroll down a screenful to trigger more lazy-loaded beers, then
        // occasionally jump to the very bottom to force the last ones in.
        step++;
        if (step % 4 === 0) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        } else {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        }
        await page.waitForTimeout(TUNING.scrollPauseMs);

        priced = await countPriced(PRODUCT_SELECTOR);

        const secsLeft = Math.max(0, Math.round((harvestDeadline - Date.now()) / 1000));
        process.stdout.write(
            `\r  harvesting page (slow site)... ${priced} priced beers so far, ${secsLeft}s left   `
        );

        // Early finish: enough beers and the count has held steady a while.
        if (priced === lastPriced) {
            stable++;
            if (priced >= TUNING.enoughBeers && stable >= TUNING.stableRounds) break;
        } else {
            stable = 0;
        }
        lastPriced = priced;
    }
    process.stdout.write("\n");

    // Scroll back to the top and let any last few tiles finish before we read.
    await page.evaluate(() => window.scrollTo(0, 0));
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

    // We deliberately DON'T close the browser in here — the caller keeps it
    // open so you can watch the page and confirm whether the real beers
    // load in given more time. Return the browser so the caller owns it.
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
    } catch (error) {
        console.log("Crawl error:", error.message);
    }

    // Leave everything open on purpose. Whoever called us decides when to
    // close (see the runner — it waits for you to press Ctrl+C).
    return { products, browser };
}


// ---- Run it ---------------------------------------------------

(async () => {

    console.log('Morrisons scraper — opening a browser and searching "craft beer"...');

    const { products, browser } = await crawl("craft beer");

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
            `\nStill only got the sponsored strip so far. The browser is LEFT OPEN on\n` +
            `purpose — watch the page: do the real beers fill in if you give it a\n` +
            `minute? If they do, it's a timing issue and we raise the waits. If they\n` +
            `never appear no matter how long you wait, it's not time — it's the page\n` +
            `holding them back (e.g. it wants a delivery postcode chosen).`
        );
    } else {
        console.log(
            `\nLooks like it worked — the browser is left open so you can check the\n` +
            `beers against the page. When you're happy, say the word and I'll wire\n` +
            `this into the main catalogue so Morrisons shows alongside Tesco.`
        );
    }

    // Keep the window open so you can watch it. Close it yourself, or press
    // Ctrl+C in this terminal when you're done.
    console.log(`\n>>> Browser left open. Press Ctrl+C here to close it when you're done. <<<`);

    process.on("SIGINT", async () => {
        console.log("\nClosing browser...");
        await browser.close().catch(() => {});
        process.exit(0);
    });

    // Hold the process open indefinitely (until Ctrl+C above).
    await new Promise(() => {});
})();
