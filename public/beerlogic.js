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


// Name tokens for comparing two listings: lowercase words of 2+ chars
// (keeps short but meaningful bits like "af"), punctuation stripped.
function nameTokens(name) {
    return new Set(
        String(name || "")
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, " ")
            .split(/\s+/)
            .filter(w => w.length >= 2)
    );
}

function isSubset(small, big) {
    for (const w of small) if (!big.has(w)) return false;
    return true;
}

// A set of words is only worth merging on if it carries at least one
// distinctive (non-generic) word — so we never merge two different beers
// just because they share "ipa" or "lager".
function hasDistinctiveWord(set) {
    for (const w of set) if (!GENERIC_WORDS.has(w)) return true;
    return false;
}


// Turn the raw catalogue + hop database into the list of beers to show.
//
// Grouping happens in two passes so the same beer always ends up as ONE
// card, even when shops word its name differently:
//
//   Pass 1 — bucket products by (brewery + exact name words). This stacks a
//     beer's pack sizes and any shop that spells it identically.
//
//   Pass 2 — merge buckets of the SAME BREWERY when one's name words are a
//     subset of another's (e.g. Morrisons "BrewDog Triple Hazy IPA" ⊂ Tesco
//     "BrewDog Triple Hazy New England IPA"). The MERGED beer keeps the
//     LONGEST name (the most detailed one), and takes hop data from whichever
//     listing had it — so if only Tesco's copy is in our hop database, the
//     Morrisons copy shows the same hops.
//
// Each beer then carries one "offer" per shop (shop toggle), and each offer
// its pack sizes (buy-option toggle).
function buildCatalogBeers(catalog, curated) {

    const breweries = [...new Set(curated.map(c => c.brewery).filter(Boolean))];

    function findCurated(text) {
        return curated.find(c => matchesBeer(c.name, c.brewery, text)) || null;
    }

    // ---- Pass 1: bucket by brewery + exact name words -------------
    const buckets = new Map();

    for (const product of catalog) {

        if (priceValue(product.price) <= 0) continue;

        const clean = cleanName(product.title);
        if (!clean) continue;

        const text = product.text || product.title;
        const match = findCurated(text);
        const brewery = match ? match.brewery : deriveBrewery(clean, breweries);

        // Name words that identify the beer = its words minus the brewery's.
        const nameSet = nameTokens(clean);
        for (const bw of nameTokens(brewery)) nameSet.delete(bw);

        const sig = `${(brewery || "").toLowerCase()}||${[...nameSet].sort().join(" ")}`;

        if (!buckets.has(sig)) {
            buckets.set(sig, {
                brewery,
                nameSet,
                names: [],
                match: null,
                stores: new Map()   // supermarket -> [ options ]
            });
        }

        const bucket = buckets.get(sig);
        bucket.names.push(clean);
        if (match && !bucket.match) bucket.match = match;

        const store = product.supermarket || "Tesco";
        if (!bucket.stores.has(store)) bucket.stores.set(store, []);
        const options = bucket.stores.get(store);

        const label = product.pack || "Buy";
        if (!options.some(o => o.label === label)) {
            options.push({ label, price: product.price, image: product.image, link: product.link });
        }
    }

    // ---- Pass 2: merge same-brewery buckets by name subset --------
    const list = [...buckets.values()];
    const parent = list.map((_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { parent[find(a)] = find(b); };

    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            if ((a.brewery || "").toLowerCase() !== (b.brewery || "").toLowerCase()) continue;
            const small = a.nameSet.size <= b.nameSet.size ? a.nameSet : b.nameSet;
            const big = a.nameSet.size <= b.nameSet.size ? b.nameSet : a.nameSet;
            if (small.size > 0 && isSubset(small, big) && hasDistinctiveWord(small)) {
                union(i, j);
            }
        }
    }

    // Combine unioned buckets into final groups.
    const groups = new Map();
    for (let i = 0; i < list.length; i++) {
        const root = find(i);
        if (!groups.has(root)) {
            groups.set(root, { brewery: list[root].brewery, names: [], match: null, stores: new Map() });
        }
        const g = groups.get(root);
        const b = list[i];
        g.names.push(...b.names);
        if (b.match && !g.match) g.match = b.match;
        if (!g.brewery && b.brewery) g.brewery = b.brewery;
        for (const [store, options] of b.stores) {
            if (!g.stores.has(store)) g.stores.set(store, []);
            const dst = g.stores.get(store);
            for (const o of options) if (!dst.some(x => x.label === o.label)) dst.push(o);
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

        beers.push({
            name,
            brewery: match ? match.brewery : (g.brewery || deriveBrewery(name, breweries)),
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
