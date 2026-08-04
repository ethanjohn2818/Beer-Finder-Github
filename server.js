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


// Find a beer's buy options in the Tesco catalogue: every catalogue
// product that matches this beer, one option per pack size.
function catalogOptions(beer, catalog) {

    const matches = catalog.filter(product =>
        matchesBeer(beer.name, beer.brewery, product.text || product.title)
    );

    const options = [];
    const usedLabels = new Set();

    for (const product of matches) {

        if (priceValue(product.price) <= 0) continue;

        const label = product.pack || "Buy";
        if (usedLabels.has(label)) continue;
        usedLabels.add(label);

        options.push({
            label,
            price: product.price,
            image: product.image,
            link: product.link
        });
    }

    options.sort((a, b) => packRank(a.label) - packRank(b.label));

    return options;
}




// Only the beers Tesco actually stocks (found in the catalogue).
// The Hops and Brewery pages are built from this, so they only list
// beers you can really search for and buy.
app.get("/beers", (req,res)=>{

    try {

        const beers = JSON.parse(
            fs.readFileSync("./data/beers.json", "utf8")
        );

        const catalog = loadCatalog();

        const available = beers.filter(beer =>
            catalogOptions(beer, catalog).length > 0
        );

        res.json(available);

    } catch(error) {

        console.error(error);

        res.status(500).json({
            error:"Could not load beers"
        });

    }

});




app.get("/recommend", (req,res)=>{


    // Accept a general query (?q=) — matches hop, brewery or beer name.
    // Falls back to the old ?hop= for backwards compatibility.
    const query = (req.query.q || req.query.hop || "").trim();



    if(!query) {

        return res.status(400).json({

            error:"Please provide something to search for"

        });

    }



    try {


        const beers = JSON.parse(
            fs.readFileSync("./data/beers.json", "utf8")
        );


        const catalog = loadCatalog();

        if (catalog.length === 0) {
            console.log(
                "Catalogue is empty — run `npm run catalog` to build it."
            );
        }


        // Beers matching the query by hop, brewery, name, style or flavour
        const matches = beers.filter(beer =>
            beerMatchesQuery(beer, query)
        );


        // Keep the ones Tesco actually stocks (found in the catalogue)
        const results = [];

        for (const beer of matches) {

            const options = catalogOptions(beer, catalog);
            if (options.length === 0) continue;

            const first = options[0];

            results.push({
                beer,
                offers: [{
                    supermarket: "Tesco",
                    available: true,
                    options,
                    price: first.price,
                    image: first.image,
                    link: first.link
                }]
            });
        }


        console.log(
            "SENDING:",
            results.map(r => r.beer.name)
        );


        res.json(results);


    } catch(error) {

        console.error(error);

        res.status(500).json({
            error:"Something went wrong"
        });

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
