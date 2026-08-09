// ---------------------------------------------------------------
// Beer logic (runs in the browser).
//
// The live site is static: it loads two files — data/beers.json (our
// hop database) and data/tesco-catalog.json (the crawled Tesco beers) —
// and does all the matching / grouping here, so no server is needed.
// ---------------------------------------------------------------


// ---- Text helpers ---------------------------------------------

const GENERIC_WORDS = new Set([
    "ale", "ipa", "lager", "session", "stout", "porter", "bitter",
    "pale", "hazy", "double", "extra", "beer", "beers", "can", "cans",
    "brewery", "brewing", "brew", "blonde", "golden", "amber", "red",
    "helles", "pils", "pilsner", "keller", "sour", "new", "england",
    "west", "coast", "the", "and"
]);

const BEER_STYLE_WORDS = [
    "ale", "ipa", "lager", "stout", "porter", "bitter", "pilsner",
    "pils", "sour", "cider", "saison", "gose", "weisse", "hefeweizen",
    "witbier", "tripel", "dubbel", "helles", "kolsch", "bock", "dunkel",
    "pale", "session", "wheat beer", "abv"
];


function words(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter(word => word.length > 2);
}

function hasWord(text, word) {
    return new RegExp(`\\b${word}\\b`).test(text);
}


// ---- Prices ---------------------------------------------------

function extractPrice(text) {
    if (!text) return null;
    const match = String(text).match(/£\s?\d+(?:\.\d{1,2})?/);
    return match ? match[0].replace(/\s/g, "") : null;
}

function priceValue(price) {
    if (!price) return 0;
    const n = Number(String(price).replace(/[£,\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
}


// ---- Pack sizes -----------------------------------------------

function detectPackLabel(text) {
    if (!text) return "Pack";
    const t = text.toLowerCase();
    const multi = t.match(/(\d+)\s*[x×]\s*(\d+)\s*ml/);
    if (multi) {
        const count = Number(multi[1]);
        const vol = multi[2];
        if (count === 1) return `Single (${vol}ml)`;
        return `${count} × ${vol}ml`;
    }
    if (/\b(case|crate)\b/.test(t)) return "Case";
    const pack = t.match(/(\d+)\s*-?\s*pack/);
    if (pack) return `${pack[1]} pack`;
    const single = t.match(/(\d+)\s*ml/);
    if (single) return `Single (${single[1]}ml)`;
    return "Pack";
}

function packRank(label) {
    if (/single/i.test(label)) return 0;
    if (/case/i.test(label)) return 2;
    return 1;
}


// ---- Matching a beer to a Tesco product -----------------------

function looksLikeDrink(text, brewery) {
    const breweryWords = words(brewery);
    if (breweryWords.length && breweryWords.every(w => hasWord(text, w))) {
        return true;
    }
    const hasStyle = BEER_STYLE_WORDS.some(style => hasWord(text, style));
    const hasVolume = /\d\s?(ml|cl|litre|litres|pint|pints)\b/.test(text);
    return hasStyle && hasVolume;
}

function matchesBeer(name, brewery, productText) {
    if (!productText) return false;
    const text = productText.toLowerCase();
    const nameWords = words(name);
    const breweryWords = new Set(words(brewery));
    const productWords = nameWords.filter(
        w => !breweryWords.has(w) && !GENERIC_WORDS.has(w)
    );

    let wordsMatch;
    if (productWords.length > 0) {
        wordsMatch = productWords.every(w => hasWord(text, w));
    } else {
        const styleWords = nameWords.filter(w => !breweryWords.has(w));
        const breweryPresent = [...breweryWords].every(w => hasWord(text, w));
        wordsMatch = breweryPresent && styleWords.every(w => hasWord(text, w));
    }

    return wordsMatch && looksLikeDrink(text, brewery);
}


// ---- Building the site's beer list from the catalogue ---------

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

function cleanName(title) {
    return String(title || "")
        .replace(/\d+\s*[x×]\s*\d+\s*ml/gi, " ")
        .replace(/\d+\s*(ml|cl|l|litre|litres|pint|pints)\b/gi, " ")
        .replace(/\b(case|crate|pack|cans?|bottles?|multipack)\b/gi, " ")
        .replace(/\s+/g, " ")
        .replace(/[-–,]\s*$/, "")
        .trim();
}

function deriveBrewery(name, breweries) {
    const lower = name.toLowerCase();
    const hit = breweries
        .filter(b => lower.startsWith(b.toLowerCase() + " ") || lower === b.toLowerCase())
        .sort((a, b) => b.length - a.length)[0];
    return hit || name.split(" ")[0];
}


// Turn the raw catalogue + hop database into the list of beers to show.
//
// The important bit: we group products by WHICH CURATED BEER THEY MATCH,
// not by their shop's wording of the title. That single decision gives us
// all three things at once:
//   • the same beer sold at Tesco AND Morrisons stacks into one card
//     (one "offer" per shop, with a shop toggle);
//   • the same beer sold in several pack sizes at one shop stacks into
//     that shop's buy options (single / 4-pack / case);
//   • the hops live on the beer, so if Tesco's copy matched our hop data
//     and Morrisons' copy didn't, Morrisons still shows the same hops —
//     they're the same beer, so they share one set.
// A product that matches no curated beer falls back to grouping by its
// cleaned-up title and simply shows without hop data.
function buildCatalogBeers(catalog, curated) {

    const breweries = [...new Set(curated.map(c => c.brewery).filter(Boolean))];

    function findCurated(text) {
        return curated.find(c => matchesBeer(c.name, c.brewery, text)) || null;
    }

    const groups = new Map();

    for (const product of catalog) {

        if (priceValue(product.price) <= 0) continue;

        const text = product.text || product.title;
        const match = findCurated(text);

        // Group key: the matched beer's identity (so every shop and every
        // pack size of that beer share a group), or the cleaned title.
        const key = match
            ? `curated::${match.name.toLowerCase()}::${(match.brewery || "").toLowerCase()}`
            : `raw::${baseKey(product.title)}`;

        if (key === "raw::") continue;   // title was empty/unusable

        if (!groups.has(key)) {
            groups.set(key, {
                name: match ? match.name : cleanName(product.title),
                match,
                stores: new Map()   // supermarket -> [ options ]
            });
        }

        const group = groups.get(key);
        if (match && !group.match) group.match = match;

        const store = product.supermarket || "Tesco";
        if (!group.stores.has(store)) group.stores.set(store, []);
        const options = group.stores.get(store);

        // One buy option per distinct pack size, per shop.
        const label = product.pack || "Buy";
        if (options.some(o => o.label === label)) continue;

        options.push({
            label,
            price: product.price,
            image: product.image,
            link: product.link
        });
    }

    const beers = [];

    for (const group of groups.values()) {

        // One offer per shop, carrying that shop's pack sizes.
        const offers = [];
        for (const [store, options] of group.stores) {
            if (options.length === 0) continue;
            options.sort((a, b) => packRank(a.label) - packRank(b.label));
            const first = options[0];
            offers.push({
                supermarket: store,
                options,
                price: first.price,
                image: first.image,
                link: first.link
            });
        }

        if (offers.length === 0) continue;

        // Cheapest shop first (so the card defaults to the best price).
        offers.sort((a, b) => priceValue(a.price) - priceValue(b.price));

        const match = group.match;

        beers.push({
            name: match ? match.name : group.name,
            brewery: match ? match.brewery : deriveBrewery(group.name, breweries),
            style: match ? match.style : "",
            abv: match ? match.abv : null,
            hops: match ? (match.hops || []) : [],
            flavours: match ? (match.flavours || []) : [],
            offers
        });
    }

    beers.sort((a, b) => a.name.localeCompare(b.name));

    return beers;
}


// Free-text search across name, brewery, style, hop and flavour.
function beerMatchesQuery(beer, query) {
    const q = query.toLowerCase();
    if ((beer.name || "").toLowerCase().includes(q)) return true;
    if ((beer.brewery || "").toLowerCase().includes(q)) return true;
    if ((beer.style || "").toLowerCase().includes(q)) return true;
    if ((beer.hops || []).some(h => h.toLowerCase().includes(q))) return true;
    if ((beer.flavours || []).some(f => f.toLowerCase().includes(q))) return true;
    return false;
}
