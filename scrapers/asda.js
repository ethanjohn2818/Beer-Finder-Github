// ---------------------------------------------------------------
// Asda scraper — same real-Chrome tactic as Morrisons, paginated like
// Sainsbury's.
//
// Asda's groceries site is a React app that, like Morrisons and Sainsbury's,
// only serves the real product grid to a browser that looks like a real
// shopper, and throws a cookie wall (and sometimes a delivery/postcode prompt)
// in front of the results. So this scraper:
//     • drives REAL Chrome (channel: "chrome") when installed — no automation
//       fingerprint;
//     • loads the FULL normal page (CSS, images, everything);
//     • closes the cookie + delivery popups that hide the grid;
//     • SLOW-SCROLLS each page in small steps so every tile lazy-loads,
//       collecting beers by link as they pass through.
//
// THE DIFFERENCE FROM MORRISONS: Asda PAGINATES (?page=1, 2, 3 ...) rather
// than putting every beer on one endless page. So — exactly like Sainsbury's —
// we walk the pages one by one, slow-scrolling each, and stop when a page adds
// no new beers (past the end of the real results).
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

// Asda uses a path-based search with a ?page=N query for pagination:
//   https://www.asda.com/groceries/search/craft%20beer?page=2
const searchUrl = (query, page) =>
    `${BASE_URL}/groceries/search/${encodeURIComponent(query)}?page=${page}`;


// ---- TUNING ---------------------------------------------------
const TUNING = {
    // Craft beer spans a handful of pages — plenty of headroom; we stop early
    // when a page stops adding new beers.
    maxPages:        20,
    // Per PAGE (not the whole run): slow-scroll it to the bottom in small steps
    // so every tile lazy-loads, collecting as we go. Cap the time per page so a
    // slow page can't stall the whole crawl.
    pageHarvestMs:   60000,  // up to 1 min per page (very slow, as asked)
    scrollStepPx:    450,    // small steps so the grid doesn't drop beers
    scrollPauseMs:   1000,   // generous pause after each step (very slow scroll)
    gridTimeoutMs:   30000,  // how long to wait for the first product tile
    navTimeoutMs:    60000,  // how long to allow the page navigation itself
    // On a page, once we've reached the bottom and the count hasn't grown for
    // this many rounds, that page is fully read — move to the next.
    stableRounds:    6,
    // Don't save a run that got almost nothing (bot wall likely won).
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


// Best-effort: close any delivery / postcode / "shop groceries" chooser that
// sits over the results. Safe to call repeatedly.
async function dismissModal(page) {

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


// ---- Read one search page (slow-scroll it to load every tile) --

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

    // Slow-scroll this page to the bottom in small steps so every tile
    // lazy-loads, collecting beers by link as they pass through.
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

        const secsLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        process.stdout.write(
            `\r  page ${pageNo}: slow-scrolling... ${priced} beers, ${secsLeft}s left    `
        );

        if (priced === last) {
            stable++;
            if (reachedBottom && stable >= TUNING.stableRounds) break;
        } else {
            stable = 0;
        }
        last = priced;
    }
    process.stdout.write("\n");

    if (pageNo === 1) {
        await page.screenshot({ path: SHOT_FILE, fullPage: true }).catch(() => {});
    }

    return [...collected.values()];
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


// ---- Crawl every page -----------------------------------------

async function crawl(query = "craft beer") {

    const browser = await launchBrowser();
    const context = await makeContext(browser);
    const page = await context.newPage();

    const products = [];
    const seen = new Set();

    try {
        for (let pageNo = 1; pageNo <= TUNING.maxPages; pageNo++) {

            console.log(`\n--- Asda page ${pageNo} ---`);
            const tiles = await readPage(page, query, pageNo);

            let kept = 0;
            for (const tile of tiles) {
                if (!looksLikeBeer(tile.text)) continue;   // drop non-beers

                const price = extractPrice(tile.text);
                if (priceValue(price) <= 0) continue;

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

    // Leave the browser open — the caller owns closing it (same as Morrisons).
    return { products, browser };
}


// ---- Put the beers live ---------------------------------------

// Merge just the Asda beers into the catalogue (keeping every other shop's).
// Refuses to save a run below MIN_OK, so a bad run can't wipe good data.
function mergeAsda(products) {

    if (products.length < MIN_OK) {
        console.log(
            `\nOnly ${products.length} beers — that looks like the cookie/bot wall won,\n` +
            `so NOT saving to the catalogue this time (keeping existing data).`
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
    console.log(`\nScreenshot of page 1: ${SHOT_FILE}`);
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
