const express = require("express");
const path = require("path");
const fs = require("fs");

const { loadCatalog } = require("./scrapers/catalog");
const { matchesBeer, priceValue, packRank } = require("./scrapers/lib");

const app = express();

const PORT = 3000;


app.use(
    express.static(
        path.join(__dirname, "public")
    )
);




// ---- Build the site's beer list FROM the Tesco catalogue -------
//
// The catalogue is the source of truth for WHAT beers exist (only real
// Tesco craft beers). We group each product's pack sizes together and
// enrich with hop/style data from our own list where a beer matches.


function loadCurated() {
    try {
        return JSON.parse(fs.readFileSync("./data/beers.json", "utf8"));
    } catch {
        return [];
    }
}


// A product's beer identity: its title minus the pack size / volume,
// so "Punk IPA 4 x 330ml" and "Punk IPA 660ml" group together.
function baseKey(title) {
    return String(title || "")
        .toLowerCase()
        .replace(/\d+\s*[x×]\s*\d+\s*ml/g, " ")
        .replace(/\d+\s*(ml|cl|l|litre|litres|pint|pints)\b/g, " ")
        .replace(/\b(case|crate|pack|cans?|bottles?|multipack)\b/g, " ")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


// A tidy display name: the title with the pack size trimmed off.
function cleanName(title) {
    return String(title || "")
        .replace(/\d+\s*[x×]\s*\d+\s*ml/gi, " ")
        .replace(/\d+\s*(ml|cl|l|litre|litres|pint|pints)\b/gi, " ")
        .replace(/\b(case|crate|pack|cans?|bottles?|multipack)\b/gi, " ")
        .replace(/\s+/g, " ")
        .replace(/[-–,]\s*$/, "")
        .trim();
}


// Best-effort brewery for a Tesco beer we don't have in our list:
// a known brewery whose name the title starts with, else the first word.
function deriveBrewery(name, breweries) {
    const lower = name.toLowerCase();
    const hit = breweries
        .filter(b => lower.startsWith(b.toLowerCase() + " ") || lower === b.toLowerCase())
        .sort((a, b) => b.length - a.length)[0];
    return hit || name.split(" ")[0];
}


// Turn the raw catalogue into a list of beers, each with its pack-size
// options and (where we can match it) hop/style data.
function getCatalogBeers() {

    const catalog = loadCatalog();
    const curated = loadCurated();
    const breweries = [...new Set(curated.map(c => c.brewery).filter(Boolean))];

    const groups = new Map();

    for (const product of catalog) {

        if (priceValue(product.price) <= 0) continue;

        const key = baseKey(product.title);
        if (!key) continue;

        if (!groups.has(key)) {
            groups.set(key, {
                name: cleanName(product.title),
                text: product.text || product.title,
                options: []
            });
        }

        const group = groups.get(key);

        const label = product.pack || "Buy";
        if (group.options.some(o => o.label === label)) continue;

        group.options.push({
            label,
            price: product.price,
            image: product.image,
            link: product.link
        });
    }

    const beers = [];

    for (const group of groups.values()) {

        if (group.options.length === 0) continue;

        group.options.sort((a, b) => packRank(a.label) - packRank(b.label));

        // Try to match this Tesco beer to one in our list, for hop data
        const match = curated.find(c =>
            matchesBeer(c.name, c.brewery, group.text)
        );

        const first = group.options[0];

        beers.push({
            name: match ? match.name : group.name,
            brewery: match ? match.brewery : deriveBrewery(group.name, breweries),
            style: match ? match.style : "",
            abv: match ? match.abv : null,
            hops: match ? (match.hops || []) : [],
            flavours: match ? (match.flavours || []) : [],
            options: group.options,
            price: first.price,
            image: first.image,
            link: first.link
        });
    }

    // Alphabetical, for stable list pages
    beers.sort((a, b) => a.name.localeCompare(b.name));

    return beers;
}


// Does a beer match a free-text search? Matches on hop, brewery, name,
// style or flavour (case-insensitive substring).
function beerMatchesQuery(beer, query) {

    const q = query.toLowerCase();

    if ((beer.name || "").toLowerCase().includes(q)) return true;
    if ((beer.brewery || "").toLowerCase().includes(q)) return true;
    if ((beer.style || "").toLowerCase().includes(q)) return true;

    if ((beer.hops || []).some(h => h.toLowerCase().includes(q))) return true;
    if ((beer.flavours || []).some(f => f.toLowerCase().includes(q))) return true;

    return false;
}




// Every beer on Tesco's craft beer page. The Hops and Brewery pages are
// built from this.
app.get("/beers", (req,res)=>{

    try {
        res.json(getCatalogBeers());
    } catch(error) {
        console.error(error);
        res.status(500).json({ error:"Could not load beers" });
    }

});




app.get("/recommend", (req,res)=>{


    // Free-text query: matches hop, brewery, beer name, style or flavour.
    // (?hop= still works for backwards compatibility.)
    const query = (req.query.q || req.query.hop || "").trim();


    if(!query) {
        return res.status(400).json({
            error:"Please provide something to search for"
        });
    }


    try {

        const catalogBeers = getCatalogBeers();

        if (catalogBeers.length === 0) {
            console.log("Catalogue is empty — run `npm run catalog` to build it.");
        }

        const results = catalogBeers
            .filter(beer => beerMatchesQuery(beer, query))
            .map(beer => {

                const first = beer.options[0];

                return {
                    beer,
                    offers: [{
                        supermarket: "Tesco",
                        available: true,
                        options: beer.options,
                        price: first.price,
                        image: first.image,
                        link: first.link
                    }]
                };
            });

        console.log("SENDING:", results.map(r => r.beer.name));

        res.json(results);


    } catch(error) {
        console.error(error);
        res.status(500).json({ error:"Something went wrong" });
    }

});




app.listen(PORT,()=>{

    console.log(
        `Beer Finder running at http://localhost:${PORT}`
    );

    if (loadCatalog().length === 0) {
        console.log(
            "Catalogue is empty — run `npm run catalog` first to fetch Tesco's beers."
        );
    }

});
