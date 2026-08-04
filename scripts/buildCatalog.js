// ---------------------------------------------------------------
// Build the Tesco beer catalogue.
//
// Crawls Tesco for "craft beer" plus "<brewery> beer" for every brewery
// in our list, and saves every real beer product (name, price, image,
// link, pack size) to cache/tesco-catalog.json. Searching per brewery
// captures far more of Tesco's range than a single "craft beer" search.
//
// Run it with:   npm run catalog
// ---------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const { crawlQueries, saveCatalog, CATALOG_FILE } = require("../scrapers/catalog");


const beers = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../data/beers.json"), "utf8")
);

// Unique breweries from our list, plus a broad "craft beer" sweep.
const breweries = [...new Set(beers.map(b => b.brewery).filter(Boolean))];

const queries = ["craft beer", ...breweries.map(b => `${b} beer`)];


(async () => {

    console.log(
        `Crawling Tesco: "craft beer" + ${breweries.length} breweries ` +
        `(${queries.length} searches). A browser window will open...\n`
    );

    const products = await crawlQueries(queries, 10);

    saveCatalog(products);

    console.log(`\nDone. Saved ${products.length} beer products to`);
    console.log(`  ${CATALOG_FILE}`);

    process.exit(0);
})();
