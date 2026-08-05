// ---------------------------------------------------------------
// Scraper registry.
//
// To add a supermarket: create scrapers/<name>.js with createScraper,
// then add it to the list below. Everything else (server, warm-up
// script, front-end) picks it up automatically.
// ---------------------------------------------------------------

const { warmUp, priceValue } = require("./lib");

const tesco = require("./tesco");


// Only Tesco is active for now. To add another supermarket later:
// create scrapers/<name>.js with createScraper, then add it here.
const scrapers = [
    tesco
];


// Search every ENABLED supermarket for a beer, in parallel.
// `brewery` is used to match products more accurately.
// Returns one result per store that actually has it.
async function searchAll(term, brewery = "", force = false) {

    const active = scrapers.filter(store => store.enabled);

    const results = await Promise.all(
        active.map(store =>
            store.search(term, brewery, force).catch(error => {
                console.log(store.name, "error:", error.message);
                return null;
            })
        )
    );

    // Safety net: drop any option without a real positive price (Tesco
    // never sells for £0.00) and any store left with no valid options.
    // This cleans stale/junk cache entries even before a re-warm.
    return results
        .filter(result => result && result.available)
        .map(result => {
            let options = (result.options || [])
                .filter(opt => priceValue(opt.price) > 0);

            // Old cached results have no options array; fall back to the
            // top-level fields as one option, if it has a real price.
            if (options.length === 0 && priceValue(result.price) > 0) {
                options = [{
                    label: "Buy",
                    price: result.price,
                    image: result.image,
                    link: result.link
                }];
            }

            return { ...result, options };
        })
        .filter(result => result.options.length > 0)
        .map(result => {
            // Re-point the top-level fields at the first valid option
            const first = result.options[0];
            return {
                ...result,
                price: first.price,
                image: first.image,
                link: first.link
            };
        });
}


module.exports = {
    scrapers,
    searchAll,
    warmUp
};
