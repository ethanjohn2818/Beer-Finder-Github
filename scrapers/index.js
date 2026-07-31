// ---------------------------------------------------------------
// Scraper registry.
//
// To add a supermarket: create scrapers/<name>.js with createScraper,
// then add it to the list below. Everything else (server, warm-up
// script, front-end) picks it up automatically.
// ---------------------------------------------------------------

const { warmUp } = require("./lib");

const tesco = require("./tesco");


// Only Tesco is active for now. To add another supermarket later:
// create scrapers/<name>.js with createScraper, then add it here.
const scrapers = [
    tesco
];


// Search every ENABLED supermarket for a beer, in parallel.
// `brewery` is used to match products more accurately.
// Returns one result per store that actually has it.
async function searchAll(term, brewery = "") {

    const active = scrapers.filter(store => store.enabled);

    const results = await Promise.all(
        active.map(store =>
            store.search(term, brewery).catch(error => {
                console.log(store.name, "error:", error.message);
                return null;
            })
        )
    );

    return results.filter(result => result && result.available);
}


module.exports = {
    scrapers,
    searchAll,
    warmUp
};
