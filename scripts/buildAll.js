// ---------------------------------------------------------------
// Build the whole catalogue in one go: Tesco, then Morrisons, then Sainsbury's.
//
// Run it with:   npm run build
//
// The shops need completely different scraping (Tesco uses the shared
// resource-light browser; Morrisons needs a full real-Chrome page with a
// slow single-page harvest; Sainsbury's uses the same real-Chrome tactic but
// paginated), so this runner does NOT change how any of them search — it just
// calls each in turn, merges them all into public/data/catalog.json, and
// pushes once at the end.
// ---------------------------------------------------------------

// Tesco blocks headless browsers with an "Access Denied" page, so the
// combined build ALWAYS runs visible. Ignore any leftover HEADLESS=true
// left in the shell from an earlier experiment — otherwise Tesco fails.
delete process.env.HEADLESS;

const {
    crawlCatalog,
    mergeCatalog,
    STORES
} = require("../scrapers/catalog");

const {
    crawlMorrisons,
    pushCatalog,
    printFound,
    SPONSORED_ONLY
} = require("../scrapers/morrisons");

const {
    crawlSainsburys,
    MIN_OK
} = require("../scrapers/sainsburys");

const { writeHopGaps } = require("../scrapers/hopGaps");


(async () => {

    let tescoCount = 0;
    let morrisonsCount = 0;
    let sainsburysCount = 0;

    // ---- 1. Tesco (and any other enabled STORES) -------------------
    // Unchanged Tesco search: crawlCatalog drives the shared lib browser.
    const enabled = STORES.filter(s => s.enabled !== false);

    console.log(`\n########## 1/3  TESCO ##########`);
    console.log(
        `Crawling ${enabled.map(s => s.name).join(", ")} ` +
        `(a browser window will open)...\n`
    );

    try {
        const tescoProducts = await crawlCatalog("craft beer");
        mergeCatalog(tescoProducts, enabled.map(s => s.name));
        tescoCount = tescoProducts.length;
        console.log(`Tesco: merged ${tescoCount} beers into the catalogue.`);
    } catch (error) {
        console.log(`Tesco crawl failed (${error.message}). Keeping existing Tesco data.`);
    }

    // ---- 2. Morrisons ---------------------------------------------
    // Unchanged Morrisons search: its own real-Chrome full-page harvest.
    console.log(`\n########## 2/3  MORRISONS ##########`);
    console.log(`Opening a browser and searching "craft beer" (this one takes a few minutes)...`);

    let morrisonsBrowser = null;
    try {
        const { products, browser } = await crawlMorrisons("craft beer");
        morrisonsBrowser = browser;
        printFound(products);

        if (products.length > SPONSORED_ONLY) {
            mergeCatalog(products, ["Morrisons"]);
            morrisonsCount = products.length;
            console.log(`Morrisons: merged ${morrisonsCount} beers into the catalogue.`);
        } else {
            console.log(
                `Morrisons: only ${products.length} beers (sponsored strip) — NOT saved, ` +
                `so Tesco's data and any previous Morrisons data are left intact.`
            );
        }
    } catch (error) {
        console.log(`Morrisons crawl failed (${error.message}). Keeping existing Morrisons data.`);
    }

    // ---- 3. Sainsbury's -------------------------------------------
    // Same real-Chrome tactic as Morrisons, but paginated.
    console.log(`\n########## 3/3  SAINSBURY'S ##########`);
    console.log(`Opening a browser and searching "craft beer" (walks the pages)...`);

    let sainsburysBrowser = null;
    try {
        const { products, browser } = await crawlSainsburys("craft beer");
        sainsburysBrowser = browser;

        if (products.length >= MIN_OK) {
            mergeCatalog(products, ["Sainsbury's"]);
            sainsburysCount = products.length;
            console.log(`Sainsbury's: merged ${sainsburysCount} beers into the catalogue.`);
        } else {
            console.log(
                `Sainsbury's: only ${products.length} beers (cookie/bot wall likely) — NOT saved, ` +
                `so existing data is left intact.`
            );
        }
    } catch (error) {
        console.log(`Sainsbury's crawl failed (${error.message}). Keeping existing Sainsbury's data.`);
    }

    // ---- 4. Refresh the hop-gap worklist --------------------------
    // Writes hop-gaps.txt: the hop-forward beers still missing hops, so we
    // know exactly which cans to read next to grow the hop database.
    try {
        writeHopGaps();
    } catch (error) {
        console.log(`Could not write hop-gaps.txt (${error.message}).`);
    }

    // ---- 5. Push once ---------------------------------------------
    console.log(`\n########## PUBLISH ##########`);
    if (tescoCount > 0 || morrisonsCount > 0 || sainsburysCount > 0) {
        const parts = [];
        if (tescoCount) parts.push(`Tesco ${tescoCount}`);
        if (morrisonsCount) parts.push(`Morrisons ${morrisonsCount}`);
        if (sainsburysCount) parts.push(`Sainsbury's ${sainsburysCount}`);
        pushCatalog(`Update catalogue (${parts.join(", ")})`);
    } else {
        console.log(`Nothing new crawled — nothing to push.`);
    }

    // Close the scraper browsers and exit (Tesco's shared browser too).
    if (morrisonsBrowser) await morrisonsBrowser.close().catch(() => {});
    if (sainsburysBrowser) await sainsburysBrowser.close().catch(() => {});
    console.log(`\nDone.`);
    process.exit(0);
})();
