// ---------------------------------------------------------------
// Scraper registry.
//
// To add a supermarket: create scrapers/<name>.js with createScraper,
// then add it to the list below. Everything else (server, warm-up
// script, front-end) picks it up automatically.
// ---------------------------------------------------------------

const { warmUp } = require("./lib");

const tesco = require("./tesco");
const morrisons = require("./morrisons");
const sainsburys = require("./sainsburys");
const waitrose = require("./waitrose");
const mands = require("./mands");


const scrapers = [
    tesco,
    morrisons,
    sainsburys,
    waitrose,
    mands
];


// Search every supermarket for a beer, in parallel.
// Returns one result per store that actually has it.
async function searchAll(term) {

    const results = await Promise.all(
        scrapers.map(store =>
            store.search(term).catch(error => {
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
