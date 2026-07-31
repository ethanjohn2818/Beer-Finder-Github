// ---------------------------------------------------------------
// Debug a single search.
//
// Shows exactly what the scraper sees on the supermarket page for one
// search term: every product on the page, and whether our matcher
// accepted it. Use this to work out why a beer that IS on the site
// comes back "not found".
//
// Run it with:   npm run debug "BrewDog Lost Lager"
// (Tip: set HEADED=true to also watch the browser: HEADED=true npm run debug "...")
// ---------------------------------------------------------------

process.env.DEBUG = "1";

const fs = require("fs");
const path = require("path");
const { scrapers } = require("../scrapers");

const term = process.argv.slice(2).join(" ").trim();

if (!term) {
    console.log('Please give a search term, e.g.  npm run debug "BrewDog Lost Lager"');
    process.exit(1);
}

// Look up the brewery from the database so matching behaves like a real search
let brewery = "";
try {
    const beers = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../data/beers.json"), "utf8")
    );
    const beer = beers.find(b => b.name.toLowerCase() === term.toLowerCase());
    if (beer) brewery = beer.brewery;
} catch {}

(async () => {

    for (const store of scrapers) {

        const result = await store.search(term, brewery);

        console.log(
            `==> ${store.name}: ` +
            (result.available
                ? `FOUND — ${result.options.length} option(s), e.g. ${result.price}`
                : (result.error ? "ERROR (page failed to load)" : "not found")
            )
        );
    }

    process.exit(0);
})();
