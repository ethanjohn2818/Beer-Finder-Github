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
const { execSync } = require("child_process");
const path = require("path");

const {
    extractPrice,
    priceValue,
    detectPackLabel,
    absolute
} = require("./lib");

const { mergeCatalog, CATALOG_FILE } = require("./catalog");


// ---- Where the results go -------------------------------------

// Morrisons beers are merged straight into the live catalogue the site
// loads (public/data/catalog.json), alongside Tesco's — see mergeCatalog.
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
    harvestMs:       180000, // up to 3 minutes on the page
    scrollStepPx:    450,    // small steps so the grid doesn't drop beers
    scrollPauseMs:   900,    // pause after each small step (let tiles load)
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

    // HARVEST: Morrisons' grid virtualises — it only keeps the tiles near
    // the viewport in the page and drops the ones you've scrolled past. So a
    // single read (even the "best" one) only ever holds a slice of the
    // beers, which is why scrolling fast to the bottom missed most of them.
    //
    // The fix: scroll DOWN IN SMALL STEPS and COLLECT beers as they pass
    // through, accumulating them by their link into `collected`. It doesn't
    // matter that the page holds only ~20 at a time — we gather each one as
    // it goes by. This also survives the page's self-refresh: anything we've
    // already collected stays collected.
    const collected = new Map();   // href -> tile (prefer the priced version)

    const merge = (tiles) => {
        for (const t of tiles) {
            if (!t.href) continue;
            const existing = collected.get(t.href);
            const hasPrice = (t.text || "").includes("£");
            // Keep the first one we see, but upgrade a priceless skeleton to
            // its priced version once the price loads in.
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
    let bottoms = 0;   // how many times we've reached the bottom

    while (Date.now() < harvestDeadline) {

        // Keep the delivery popup out of the way (it reappears).
        await dismissDeliveryModal(page);

        // Collect what's on screen right now, then nudge down a small step.
        merge(await extractTiles(page));

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

        // Collect again after the step (catches tiles that just loaded).
        merge(await extractTiles(page));

        const priced = pricedCount();

        if (atBottom) bottoms++;

        const secsLeft = Math.max(0, Math.round((harvestDeadline - Date.now()) / 1000));
        process.stdout.write(
            `\r  harvesting (slow scroll)... ${priced} beers collected, ` +
            `pass ${bottoms + 1}, ${secsLeft}s left      `
        );

        // Early finish: we've made at least 2 full passes and no new beers
        // turned up on the last pass — we've got them all.
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

    if (pageNo === 1) {
        await page.screenshot({ path: SHOT_FILE, fullPage: true }).catch(() => {});
    }

    const result = [...collected.values()];
    console.log(`  Collected ${pricedCount()} priced beers over ${bottoms} full pass(es).`);
    return result;
}


// Read every product tile on the page right now: text (name + price),
// link and image. Returns [] on any error (e.g. mid-refresh).
async function extractTiles(page) {
    return page.evaluate((selector) => {

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
    }, PRODUCT_SELECTOR).catch(() => []);
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


// ---- Put the beers live ---------------------------------------

// Merge just the Morrisons beers into the catalogue the site loads (keeping
// Tesco's). Refuses to save a run that only got the sponsored strip, so a
// bad run can't wipe good data. Returns true if it saved.
function mergeMorrisons(products) {

    if (products.length <= TUNING.sponsoredOnly) {
        console.log(
            `\nOnly ${products.length} beers — that looks like the sponsored strip, not\n` +
            `the real range, so NOT saving to the catalogue this time.`
        );
        return false;
    }

    mergeCatalog(products, ["Morrisons"]);
    console.log(`\nMerged ${products.length} Morrisons beers into the catalogue:`);
    console.log(`  ${CATALOG_FILE}`);
    return true;
}


// Commit + push catalog.json so the live site updates — you shouldn't have
// to touch git. Set NOPUSH=1 to skip the push (saves the file only). Shared
// by the standalone run and the combined Tesco+Morrisons runner.
function pushCatalog(message) {

    const cwd = path.join(__dirname, "..");

    if (process.env.NOPUSH === "1") {
        console.log(`\nNOPUSH set — saved locally, not pushed. To put it live yourself:\n` +
            `  git add public/data/catalog.json && git commit -m "${message}" && git push`);
        return;
    }

    try {
        execSync(`git add "${CATALOG_FILE}"`, { cwd });

        // Only commit if the catalogue actually changed.
        let changed = true;
        try {
            execSync(`git diff --cached --quiet -- "${CATALOG_FILE}"`, { cwd });
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


// Standalone publish: merge + push (used when running this script on its own).
function publish(products) {
    if (mergeMorrisons(products)) {
        pushCatalog(`Update Morrisons beers in catalogue (${products.length})`);
    }
}


function printFound(products) {
    console.log(`\n==================== RESULT ====================`);
    console.log(`Found ${products.length} Morrisons beer products.\n`);
    products.slice(0, 40).forEach((p, i) => {
        console.log(`  ${String(i + 1).padStart(2)}. ${p.price.padEnd(7)} ${p.title}`);
    });
    if (products.length > 40) console.log(`  ...and ${products.length - 40} more.`);
    console.log(`\nScreenshot of page 1: ${SHOT_FILE}`);
}


// Reusable by the combined runner. `crawl` is exported as crawlMorrisons.
module.exports = {
    crawlMorrisons: crawl,
    mergeMorrisons,
    pushCatalog,
    printFound,
    SPONSORED_ONLY: TUNING.sponsoredOnly
};


// ---- Run it standalone ('npm run morrisons') ------------------
//
// Only when this file is run directly — when it's require()d by the combined
// runner, none of this executes (the runner drives the crawl itself).
if (require.main === module) {
    (async () => {

        console.log('Morrisons scraper — opening a browser and searching "craft beer"...');

        const { products, browser } = await crawl("craft beer");

        printFound(products);

        // Save to the live catalogue and push it up.
        publish(products);

        // Keep the window open so you can watch it. Close it yourself, or
        // press Ctrl+C in this terminal when you're done.
        console.log(`\n>>> Browser left open. Press Ctrl+C here to close it when you're done. <<<`);

        process.on("SIGINT", async () => {
            console.log("\nClosing browser...");
            await browser.close().catch(() => {});
            process.exit(0);
        });

        // Hold the process open indefinitely (until Ctrl+C above).
        await new Promise(() => {});
    })();
}
