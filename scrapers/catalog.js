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

const CATALOG_FILE = path.join(__dirname, "../cache/tesco-catalog.json");


function catalogUrl(page) {
    return `${BASE}/shop/en-GB/search?query=craft+beer&count=24&page=${page}`;
}


// Walk the craft-beer results pages and collect every priced product.
async function crawlCatalog(maxPages = 25) {

    const products = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages; page++) {

        const tiles = await scrapeSearchPage(catalogUrl(page));

        // No products on this page -> we've reached the end.
        if (tiles.length === 0) {
            console.log(`  page ${page}: no products — stopping.`);
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

        // If a page adds nothing new, we're past the real results.
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
