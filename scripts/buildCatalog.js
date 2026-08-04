// ---------------------------------------------------------------
// Build the Tesco beer catalogue.
//
// Crawls Tesco's "craft beer" search from page 1 to the end and saves
// every real beer product (name, price, image, link, pack size) to
// cache/tesco-catalog.json. The website matches our hop list against
// this, so only genuine Tesco beers appear.
//
// We use the single "craft beer" search on purpose: it's Tesco's real,
// curated craft selection. (Searching per brewery pulled in ~1000
// results because Tesco pads searches for beers it doesn't stock with
// unrelated "suggestions".)
//
// Run it with:   npm run catalog
// ---------------------------------------------------------------

const { crawlQueries, saveCatalog, CATALOG_FILE } = require("../scrapers/catalog");


(async () => {

    console.log("Crawling Tesco's craft beer pages (a browser window will open)...\n");

    const products = await crawlQueries(["craft beer"], 30);

    saveCatalog(products);

    console.log(`\nDone. Saved ${products.length} beer products to`);
    console.log(`  ${CATALOG_FILE}`);

    process.exit(0);
})();
