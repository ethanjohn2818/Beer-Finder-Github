// ---------------------------------------------------------------
// Build the whole catalogue in one go: Tesco, then Morrisons.
//
// Run it with:   npm run build
//
// The two shops need completely different scraping (Tesco uses the shared
// resource-light browser; Morrisons needs a full real-Chrome page with a
// slow harvest and its delivery-popup handling), so this runner does NOT
// change how either one searches — it just calls each in turn, merges both
// into public/data/catalog.json, and pushes once at the end.
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

const { writeHopGaps } = require("../scrapers/hopGaps");


(async () => {

    let tescoCount = 0;
    let morrisonsCount = 0;

    // ---- 1. Tesco (and any other enabled STORES) -------------------
    // Unchanged Tesco search: crawlCatalog drives the shared lib browser.
    const enabled = STORES.filter(s => s.enabled !== false);

    console.log(`\n########## 1/2  TESCO ##########`);
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
    console.log(`\n########## 2/2  MORRISONS ##########`);
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

    // ---- 3. Refresh the hop-gap worklist --------------------------
    // Writes hop-gaps.txt: the hop-forward beers still missing hops, so we
    // know exactly which cans to read next to grow the hop database.
    try {
        writeHopGaps();
    } catch (error) {
        console.log(`Could not write hop-gaps.txt (${error.message}).`);
    }

    // ---- 4. Push once ---------------------------------------------
    console.log(`\n########## PUBLISH ##########`);
    if (tescoCount > 0 || morrisonsCount > 0) {
        const parts = [];
        if (tescoCount) parts.push(`Tesco ${tescoCount}`);
        if (morrisonsCount) parts.push(`Morrisons ${morrisonsCount}`);
        pushCatalog(`Update catalogue (${parts.join(", ")})`);
    } else {
        console.log(`Nothing new crawled — nothing to push.`);
    }

    // Close Morrisons' browser and exit (this also tears down Tesco's).
    if (morrisonsBrowser) await morrisonsBrowser.close().catch(() => {});
    console.log(`\nDone.`);
    process.exit(0);
})();
