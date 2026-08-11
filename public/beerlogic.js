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

// Pull the SELLING price out of a messy product tile. Avoids two traps:
// unit rates like "£7.61/litre" (never the price), and Morrisons listing
// the real price after the word "Price" (so the first £ on the tile is the
// per-litre rate). Prefer an explicit "Price £X" label, else strip per-unit
// rates and take the first remaining £.
function extractPrice(text) {
    if (!text) return null;
    const s = String(text);

    const labelled = s.match(/\bPrice\b\s*£\s?(\d+(?:\.\d{1,2})?)/i);
    if (labelled) return "£" + labelled[1];

    const cleaned = s.replace(
        /£\s?\d+(?:\.\d{1,2})?\s*(?:\/|per\b)\s*(?:litre|liter|l\b|100\s?ml|100g|cl|ml|kg|g\b|each)/gi,
        " "
    );
    const match = cleaned.match(/£\s?\d+(?:\.\d{1,2})?/);
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

// Brewery "suffix" words the shops often drop ("Camden Town" -> "Camden",
// "Brooklyn Brewery" -> "Brooklyn"). Ignore them when checking a brewery is
// present, so a shortened shop name still matches.
const BREWERY_SUFFIX = new Set([
    "brewery", "brewing", "brew", "beer", "beers", "company", "co",
    "ltd", "town", "ales", "the", "and"
]);

function breweryTokens(brewery) {
    return words(brewery).filter(w => !BREWERY_SUFFIX.has(w));
}

function looksLikeDrink(text, brewery) {
    const core = breweryTokens(brewery);
    if (core.length && core.every(w => hasWord(text, w))) {
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
        const core = breweryTokens(brewery);
        const breweryPresent = core.length > 0 && core.every(w => hasWord(text, w));
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


// Style / packaging / descriptor words that shops add or drop inconsistently
// ("New England IPA" vs "IPA" vs nothing; "Session IPA"; "Beer Can"). We strip
// these when building a beer's IDENTITY, so the same beer matches across shops.
// We deliberately KEEP strength and flavour words (double, triple, imperial,
// tropical, guava...) because those mark a DIFFERENT beer, not the same one.
const STYLE_SUFFIX = new Set([
    "ipa", "neipa", "dipa", "apa", "xpa", "ale", "lager", "pilsner", "pils",
    "stout", "porter", "bitter", "saison", "gose",
    "beer", "beers", "keg", "cask", "can", "cans",
    "new", "england", "west", "coast", "american", "cornish", "welsh",
    "scottish", "london", "yorkshire",
    "session", "hazy", "pale", "unfiltered", "craft", "premium", "original",
    "classic", "infused", "style", "vol", "abv", "gluten", "vegan", "edition",
    "limited", "special",
    // Generic "brewery" words some shops append and others don't
    // ("Vocation Brewery ..." vs "Vocation ...").
    "brewery", "brewing", "brewers", "brewco", "company", "ltd", "town", "ales",
    // Process / marketing descriptors that don't change the beer's identity
    // ("Emerald Daze Terpene Infused Hazy IPA" == "Emerald Daze Hazy IPA").
    "terpene", "ddh", "tdh", "ndh", "dry", "hopped", "cold",
    // Filler words some shops add ("Brooklyn The Stonewall Inn" vs
    // "Brooklyn Brewery Stonewall Inn").
    "the", "and", "of", "with", "an", "for"
]);

// Words of 2+ chars, lowercased, punctuation stripped (keeps "af"). We also
// normalise "alcohol free" / "non alcoholic" to the single token "af" so the
// two ways shops write it ("Punk AF" vs "Punk Alcohol Free") merge into one.
function nameTokens(name) {
    return new Set(
        String(name || "")
            .toLowerCase()
            .replace(/alcohol[\s-]?free/g, " af ")
            .replace(/non[\s-]?alcoholic/g, " af ")
            .replace(/[^a-z0-9 ]/g, " ")
            .split(/\s+/)
            .filter(w => w.length >= 2)
    );
}

// A beer's IDENTITY words: its name words, minus the brewery's words, minus
// the style/packaging words above. Two products are the SAME beer only if
// these match exactly. Falls back to the un-stripped words if stripping
// leaves nothing (e.g. a beer literally called "Pale Ale").
function identityWords(clean, brewery) {
    const words = nameTokens(clean);
    for (const bw of nameTokens(brewery)) words.delete(bw);
    const identity = new Set([...words].filter(w => !STYLE_SUFFIX.has(w)));
    return identity.size ? identity : words;
}

// Does this beer read as alcohol-free? (name says AF / alcohol-free / 0.0 / 0.5)
function looksAlcoholFree(name) {
    return /\baf\b|alcohol[\s-]?free|non[\s-]?alcoholic|\b0\.0\b|\b0\.5\b/i.test(String(name || ""));
}


// Turn the raw catalogue + hop database into the list of beers to show.
//
// Products are grouped by their IDENTITY (brewery + identity words). This
// merges the SAME beer sold at different shops even when they word the style
// differently — Morrisons "BrewDog Triple Hazy IPA" and Tesco "BrewDog Triple
// Hazy New England IPA" both reduce to {triple} — while keeping genuinely
// different beers apart: "Hazy Jane" {jane}, "Hazy Jane Tropical" {jane,
// tropical}, "Double Hazy Jane" {double, jane} and "Hazy Jane Guava" {jane,
// guava} stay as separate cards.
//
// Each beer keeps the LONGEST (most detailed) name, takes hop data from
// whichever listing our hop DB recognised, and carries one "offer" per shop
// (shop toggle) with that shop's pack sizes (buy-option toggle).
function buildCatalogBeers(catalog, curated) {

    const breweries = [...new Set(curated.map(c => c.brewery).filter(Boolean))];

    function findCurated(text) {
        return curated.find(c => matchesBeer(c.name, c.brewery, text)) || null;
    }

    const groups = new Map();

    for (const product of catalog) {

        if (priceValue(product.price) <= 0) continue;

        const clean = cleanName(product.title);
        if (!clean) continue;

        const text = product.text || product.title;
        const match = findCurated(text);
        const brewery = match ? match.brewery : deriveBrewery(clean, breweries);

        const identity = identityWords(clean, brewery);
        const sig = `${(brewery || "").toLowerCase()}||${[...identity].sort().join(" ")}`;

        if (!groups.has(sig)) {
            groups.set(sig, { brewery, names: [], match: null, stores: new Map() });
        }

        const g = groups.get(sig);
        g.names.push(clean);
        if (match && !g.match) g.match = match;

        const store = product.supermarket || "Tesco";
        if (!g.stores.has(store)) g.stores.set(store, []);
        const options = g.stores.get(store);

        const label = product.pack || "Buy";
        if (!options.some(o => o.label === label)) {
            options.push({ label, price: product.price, image: product.image, link: product.link });
        }
    }

    // ---- Build the beer list --------------------------------------
    const beers = [];

    for (const g of groups.values()) {

        const offers = [];
        for (const [store, options] of g.stores) {
            if (options.length === 0) continue;
            options.sort((a, b) => packRank(a.label) - packRank(b.label));
            const first = options[0];
            offers.push({ supermarket: store, options, price: first.price, image: first.image, link: first.link });
        }
        if (offers.length === 0) continue;

        // Cheapest shop first (card defaults to the best price).
        offers.sort((a, b) => priceValue(a.price) - priceValue(b.price));

        // Keep the LONGEST name — the most detailed one (your rule).
        const name = g.names.slice().sort((a, b) => b.length - a.length)[0];
        const match = g.match;

        // Alcohol-free beers must never inherit a full-strength ABV from a
        // matched regular beer (e.g. Punk AF matching Punk IPA at 5.4%).
        let abv = match ? match.abv : null;
        let style = match ? match.style : "";
        if (looksAlcoholFree(name)) {
            abv = 0.5;
            if (!/alcohol[\s-]?free|\baf\b/i.test(style)) {
                style = (style ? style + " · " : "") + "Alcohol-free";
            }
        }

        beers.push({
            name,
            brewery: match ? match.brewery : (g.brewery || deriveBrewery(name, breweries)),
            style,
            abv,
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
