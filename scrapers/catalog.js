// ---------------------------------------------------------------
// Tesco beer catalogue.
//
// One "craft beer" search doesn't surface Tesco's whole beer range, so
// we crawl a set of searches — "craft beer" plus "<brewery> beer" for
// every brewery in our list — and record every real beer product (name,
// price, image, link, pack size). The website then matches our hop list
// against this catalogue, so only genuine Tesco beer products can appear.
// ---------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const {
    scrapeSearchPage,
    extractPrice,
    priceValue,
    detectPackLabel,
    absolute
} = require("./lib");


const BASE = "https://www.tesco.com";

// Tesco returns count=24 per page. A page with clearly fewer than this is
// the last page of real results; pages after it are unrelated suggestions.
const FULL_PAGE = 24;

const CATALOG_FILE = path.join(__dirname, "../cache/tesco-catalog.json");


function searchUrl(query, page) {
    // Spaces as "+" to match Tesco's own search URLs.
    const q = encodeURIComponent(query).replace(/%20/g, "+");
    return `${BASE}/shop/en-GB/search?query=${q}&inputType=free+text&count=24&page=${page}`;
}


// Crawl the pages for one search query, adding new products to `products`.
async function crawlQuery(query, maxPages, products, seen, screenshotFirst) {

    for (let page = 1; page <= maxPages; page++) {

        const shot = (screenshotFirst && page === 1)
            ? path.join(__dirname, "../catalog-page-1.png")
            : undefined;

        const tiles = await scrapeSearchPage(searchUrl(query, page), shot);

        if (tiles.length === 0) break;

        let added = 0;

        for (const tile of tiles) {

            const price = extractPrice(tile.text);

            // Tesco never sells for £0.00 — skip junk / priceless tiles.
            if (priceValue(price) <= 0) continue;

            const link = absolute(BASE, tile.href);
            if (!link || seen.has(link)) continue;
            seen.add(link);

            products.push({
                title: (tile.text.split("\n")[0] || tile.text).trim(),
                text: tile.text,
                price,
                image: absolute(BASE, tile.image),
                link,
                pack: detectPackLabel(tile.text)
            });

            added++;
        }

        console.log(`    "${query}" page ${page}: +${added} (total ${products.length})`);

        // A short page = end of the real results; the rest are suggestions.
        if (tiles.length < FULL_PAGE) break;

        // Nothing new (all duplicates of earlier searches) -> done here.
        if (added === 0) break;
    }
}


// Crawl every query in `queries`, deduping products by link across them.
async function crawlQueries(queries, maxPagesPerQuery = 10) {

    const products = [];
    const seen = new Set();

    let first = true;

    for (const query of queries) {
        console.log(`\n${query}:`);
        await crawlQuery(query, maxPagesPerQuery, products, seen, first);
        first = false;
    }

    return products;
}


// Back-compat: crawl just the broad "craft beer" search.
async function crawlCatalog(maxPages = 25) {
    return crawlQueries(["craft beer"], maxPages);
}


function saveCatalog(products) {
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(products, null, 2));
}


function loadCatalog() {
    try {
        return JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
    } catch {
        return [];
    }
}


module.exports = {
    crawlQueries,
    crawlCatalog,
    saveCatalog,
    loadCatalog,
    CATALOG_FILE
};
