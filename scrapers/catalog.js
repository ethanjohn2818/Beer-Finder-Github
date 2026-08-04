// ---------------------------------------------------------------
// Tesco craft-beer catalogue.
//
// Instead of guessing which of our beers Tesco stocks, we crawl Tesco's
// "craft beer" search results page by page and record every real beer
// product it sells (name, price, image, link, pack size). The website
// then matches our hop list against this catalogue, so only genuine
// Tesco beer products can ever show up.
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


function catalogUrl(page) {
    return `${BASE}/shop/en-GB/search?query=craft+beer&count=24&page=${page}`;
}


// Walk the craft-beer results pages and collect every priced product.
async function crawlCatalog(maxPages = 25) {

    const products = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages; page++) {

        // Screenshot the first page so an empty crawl can be diagnosed.
        const shot = page === 1
            ? path.join(__dirname, "../catalog-page-1.png")
            : undefined;

        const tiles = await scrapeSearchPage(catalogUrl(page), shot);

        console.log(`  page ${page}: found ${tiles.length} product tiles on the page`);

        // No products on this page -> we've reached the end (or were blocked).
        if (tiles.length === 0) {
            if (page === 1) {
                console.log(
                    "  Nothing on page 1 — check catalog-page-1.png to see what " +
                    "Tesco showed (cookie wall / access denied / different layout)."
                );
            }
            break;
        }

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

        console.log(`  page ${page}: +${added} products (total ${products.length})`);

        // A page much smaller than a full one (24 per page) means the real
        // search results have run out. Everything after that is unrelated
        // "suggestions" (cards, books, plants...), so stop here.
        if (tiles.length < FULL_PAGE) {
            console.log(
                `  page ${page} was short (${tiles.length} < ${FULL_PAGE}) — ` +
                `end of the craft beer results, stopping before the suggestions.`
            );
            break;
        }

        // If a page adds nothing new (all duplicates), we're also done.
        if (added === 0) break;
    }

    return products;
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
    crawlCatalog,
    saveCatalog,
    loadCatalog,
    CATALOG_FILE
};
