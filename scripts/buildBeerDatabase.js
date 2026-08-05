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


// How many beers to scrape at the same time (in separate browser tabs).
const CONCURRENCY = 3;


// Run `task` over `items`, at most `limit` running at once.
async function runWithLimit(items, limit, task) {
    let index = 0;
    async function worker() {
        while (index < items.length) {
            const current = index++;
            await task(items[current]);
        }
    }
    await Promise.all(
        Array.from({ length: limit }, () => worker())
    );
}


(async () => {

    const beers = JSON.parse(fs.readFileSync(beersPath, "utf8"));

    // Start from a clean slate so stale/junk results (from earlier runs
    // that hit cookie walls etc.) can never survive a warm.
    const cacheDir = path.join(__dirname, "../cache");
    try {
        for (const file of fs.readdirSync(cacheDir)) {
            if (file.endsWith(".json")) {
                fs.unlinkSync(path.join(cacheDir, file));
            }
        }
        console.log("Cleared old cache.");
    } catch {}

    console.log(
        `Warming cache for ${beers.length} beers ` +
        `(${CONCURRENCY} at a time)...\n`
    );

    let done = 0;

    await runWithLimit(beers, CONCURRENCY, async (beer) => {

        // force = true: always re-scrape, ignoring any cached result,
        // so warming genuinely refreshes every beer.
        const offers = await searchAll(beer.name, beer.brewery, true);

        done++;

        const found = offers.length
            ? offers.map(o => `${o.supermarket} ${o.price || ""}`.trim()).join(", ")
            : "not found anywhere";

        console.log(`[${done}/${beers.length}] ${beer.name} -> ${found}`);
    });

    // Report the total cache size on disk (sum of every cache file)
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
