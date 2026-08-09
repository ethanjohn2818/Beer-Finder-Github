// ---------------------------------------------------------------
// Supermarket beer catalogue.
//
// Crawls each shop's "craft beer" search, page by page, and records
// every real beer product (shop, name, price, image, link, pack size)
// into public/data/catalog.json. The website matches our hop list
// against this, so only genuine supermarket beers appear.
//
// To add a shop: add an entry to STORES below with its search URL and
// the CSS selector for its product links.
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


const CATALOG_FILE = path.join(__dirname, "../public/data/catalog.json");


function enc(query) {
    return encodeURIComponent(query).replace(/%20/g, "+");
}


// Each shop: how to build its paginated search URL, and how to find
// product links on the results page.
//
// ⚠️ Tesco is verified. Morrisons is best-effort (written without live
// access) — if its crawl comes back empty, check the screenshot it saves
// (catalog-morrisons-page1.png) and we'll adjust the selector/URL.
const STORES = [
    {
        name: "Tesco",
        baseUrl: "https://www.tesco.com",
        productSelector: "a[href*='/products/']",
        imageHint: "digitalcontent",
        fullPage: 24,
        searchUrl: (query, page) =>
            `https://www.tesco.com/shop/en-GB/search?query=${enc(query)}&inputType=free+text&count=24&page=${page}`
    },
    {
        name: "Morrisons",
        baseUrl: "https://groceries.morrisons.com",
        productSelector: "a[href*='/products/']",
        imageHint: "",
        fullPage: 24,
        scroll: true,
        // Off for now: Morrisons only serves sponsored ads to a fresh
        // browser — its real range is gated behind choosing a delivery
        // store/postcode. Flip to true once that's handled.
        enabled: false,
        searchUrl: (query, page) =>
            `https://groceries.morrisons.com/search?q=${enc(query)}&page=${page}`
    }
];


// Crawl one shop's pages for a query, adding new products to `products`.
async function crawlStore(store, query, products) {

    const seen = new Set();

    for (let page = 1; page <= 25; page++) {

        const shot = page === 1
            ? path.join(__dirname, `../catalog-${store.name.toLowerCase().replace(/[^a-z]/g, "")}-page1.png`)
            : undefined;

        const tiles = await scrapeSearchPage(store.searchUrl(query, page), {
            productSelector: store.productSelector,
            imageHint: store.imageHint,
            scroll: store.scroll,
            screenshotPath: shot
        });

        if (tiles.length === 0) {
            console.log(`  ${store.name} page ${page}: 0 products — stopping` +
                (page === 1 ? ` (see catalog-${store.name.toLowerCase().replace(/[^a-z]/g, "")}-page1.png)` : ""));
            break;
        }

        let added = 0;

        for (const tile of tiles) {

            const price = extractPrice(tile.text);
            if (priceValue(price) <= 0) continue;

            const link = absolute(store.baseUrl, tile.href);
            if (!link || seen.has(link)) continue;
            seen.add(link);

            products.push({
                supermarket: store.name,
                title: (tile.text.split("\n")[0] || tile.text).trim(),
                text: tile.text,
                price,
                image: absolute(store.baseUrl, tile.image),
                link,
                pack: detectPackLabel(tile.text)
            });

            added++;
        }

        console.log(`  ${store.name} page ${page}: found ${tiles.length} product tiles, kept ${added} priced (total ${products.length})`);

        // A short page = end of the real results (rest are "suggestions").
        if (tiles.length < store.fullPage) break;
        if (added === 0) break;
    }
}


// Crawl every shop for the query and return the combined product list.
async function crawlCatalog(query = "craft beer") {

    const products = [];

    for (const store of STORES) {
        if (store.enabled === false) continue;   // skip shops turned off
        console.log(`\n=== ${store.name} ===`);
        await crawlStore(store, query, products);
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


// Update just the given shops' beers in the catalogue, leaving every other
// shop's beers untouched. This lets each shop be re-crawled on its own (the
// Tesco crawl and the separate Morrisons crawl) without wiping each other.
function mergeCatalog(newProducts, storeNames) {
    const drop = new Set(storeNames);
    const kept = loadCatalog().filter(p => !drop.has(p.supermarket));
    const merged = kept.concat(newProducts);
    saveCatalog(merged);
    return merged;
}


module.exports = {
    STORES,
    crawlCatalog,
    saveCatalog,
    loadCatalog,
    mergeCatalog,
    CATALOG_FILE
};
