// ---------------------------------------------------------------
// Warm the cache.
//
// Scrapes every beer in data/beers.json across every supermarket and
// saves the results to each store's cache file (cache/<store>.json).
// After running it, searches on the website read straight from the
// cache and appear almost instantly instead of scraping live.
//
// Run it with:   npm run warm    (or: node scripts/buildBeerDatabase.js)
// ---------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const { scrapers, searchAll } = require("../scrapers");


const beersPath = path.join(__dirname, "../data/beers.json");


(async () => {

    const beers = JSON.parse(fs.readFileSync(beersPath, "utf8"));

    console.log(
        `Warming cache for ${beers.length} beers ` +
        `across ${scrapers.length} supermarkets...\n`
    );

    let done = 0;

    // One beer at a time so each store's cache file isn't written by
    // two searches at once (the stores are still searched in parallel).
    for (const beer of beers) {

        const offers = await searchAll(beer.name, beer.brewery);

        done++;

        const found = offers.length
            ? offers.map(o => `${o.supermarket} ${o.price || ""}`.trim()).join(", ")
            : "not found anywhere";

        console.log(`[${done}/${beers.length}] ${beer.name} -> ${found}`);
    }

    // Report the total cache size on disk (sum of every cache file)
    const cacheDir = path.join(__dirname, "../cache");
    let bytes = 0;
    try {
        for (const file of fs.readdirSync(cacheDir)) {
            bytes += fs.statSync(path.join(cacheDir, file)).size;
        }
    } catch {}

    console.log(`\nDone. Total cache size: ${(bytes / 1024).toFixed(1)} KB.`);

    // The browser stays open to keep runs fast, so exit explicitly.
    process.exit(0);
})();
