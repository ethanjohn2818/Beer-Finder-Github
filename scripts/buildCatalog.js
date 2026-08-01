// ---------------------------------------------------------------
// Build the Tesco craft-beer catalogue.
//
// Crawls Tesco's "craft beer" search results page by page and saves
// every real beer product (name, price, image, link, pack size) to
// cache/tesco-catalog.json. The website matches our hop list against
// this, so only genuine Tesco beers ever appear.
//
// Run it with:   npm run catalog
// ---------------------------------------------------------------

const { crawlCatalog, saveCatalog, CATALOG_FILE } = require("../scrapers/catalog");


(async () => {

    console.log("Crawling Tesco's craft beer catalogue (a browser window will open)...\n");

    const products = await crawlCatalog(25);

    saveCatalog(products);

    console.log(`\nDone. Saved ${products.length} beer products to`);
    console.log(`  ${CATALOG_FILE}`);

    // The browser stays open to keep the crawl fast, so exit explicitly.
    process.exit(0);
})();
