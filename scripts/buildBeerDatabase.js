// ---------------------------------------------------------------
// Warm the cache.
//
// This scrapes every beer in data/beers.json once and saves the
// results to cache/tesco.json. After running it, searches on the
// website read straight from the cache and appear almost instantly,
// instead of scraping live while the user waits.
//
// Run it with:   node scripts/buildBeerDatabase.js
// (Or occasionally / on a schedule to refresh prices.)
// ---------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const { searchTesco } = require("../scrapers/tesco");


const beersPath = path.join(__dirname, "../data/beers.json");
const cachePath = path.join(__dirname, "../cache/tesco.json");


// Scrape a few beers at a time (gentle on Tesco, still much faster
// than one-at-a-time).
const CONCURRENCY = 3;


// Run `task` over `items`, at most `limit` at once.
async function runWithLimit(items, limit, task) {

    let index = 0;

    async function worker() {
        while (index < items.length) {
            const current = index++;
            await task(items[current], current);
        }
    }

    const workers = [];
    for (let i = 0; i < limit; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
}


function loadExistingCache() {
    try {
        return JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } catch {
        return {};
    }
}


(async () => {

    const beers = JSON.parse(fs.readFileSync(beersPath, "utf8"));

    console.log(`Warming cache for ${beers.length} beers...\n`);

    // Start from the existing cache so we keep anything already there,
    // then update each beer as we scrape it.
    const cache = loadExistingCache();

    let done = 0;
    let found = 0;

    await runWithLimit(beers, CONCURRENCY, async (beer) => {

        const result = await searchTesco(beer.name);

        cache[beer.name] = {
            time: Date.now(),
            result
        };

        done++;
        if (result.available) found++;

        const status = result.available
            ? result.price
            : "not found";

        console.log(`[${done}/${beers.length}] ${beer.name} -> ${status}`);
    });

    // Write the whole cache once, at the end.
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));

    const bytes = fs.statSync(cachePath).size;

    console.log(`\nDone. ${found}/${beers.length} beers found at Tesco.`);
    console.log(`Cache saved to cache/tesco.json (${(bytes / 1024).toFixed(1)} KB).`);

    // The browser stays open to keep things fast during a run, so
    // exit explicitly when the script has finished.
    process.exit(0);
})();
