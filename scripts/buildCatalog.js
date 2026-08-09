// ---------------------------------------------------------------
// Build the supermarket beer catalogue.
//
// Crawls every shop's "craft beer" search and saves the combined list of
// real beer products to public/data/catalog.json. Shops are configured
// in scrapers/catalog.js (STORES).
//
// Run it with:   npm run catalog
// ---------------------------------------------------------------

const { crawlCatalog, mergeCatalog, CATALOG_FILE, STORES } = require("../scrapers/catalog");


(async () => {

    const enabled = STORES.filter(s => s.enabled !== false);

    console.log(
        `Crawling ${enabled.length} shop(s): ${enabled.map(s => s.name).join(", ")} ` +
        `(a browser window will open)...\n` +
        `(Morrisons is crawled separately with 'npm run morrisons'.)\n`
    );

    const products = await crawlCatalog("craft beer");

    // Merge in just the shops we crawled, so Morrisons' beers (added by the
    // separate 'npm run morrisons' crawl) are left untouched.
    mergeCatalog(products, enabled.map(s => s.name));

    // Per-shop totals
    const byStore = {};
    for (const p of products) byStore[p.supermarket] = (byStore[p.supermarket] || 0) + 1;

    console.log(`\nDone. Saved ${products.length} beer products:`);
    for (const [store, n] of Object.entries(byStore)) {
        console.log(`  ${store}: ${n}`);
    }
    console.log(`  -> ${CATALOG_FILE}`);

    process.exit(0);
})();
