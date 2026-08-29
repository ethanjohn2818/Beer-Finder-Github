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
    "west", "coast", "the", "and", "india", "abv",
    // Always-noise words: units, brewery-suffix and marketing words that are
    // never a distinctive beer name. Without these, an entry like "Leffe Blonde
    // 0% Alcohol Free Beer" would key on "alcohol free" and match every AF beer,
    // or "Harbour Brewing Company …" would key on "brewing company".
    "vol", "alcohol", "free", "original", "brewing", "company",
    "proper", "premium", "unfiltered"
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

    const cleaned = s
        .replace(
            /£\s?\d+(?:\.\d{1,2})?\s*(?:\/|per\b)\s*(?:litre|liter|l\b|100\s?ml|100g|cl|ml|kg|g\b|each)/gi,
            " "
        )
        .replace(/\bfor\s*£\s?\d+(?:\.\d{1,2})?/gi, " ");
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
    "ltd", "town", "ales", "the", "and", "craft"
]);

// Some shops (Asda in particular) sneak Cyrillic look-alike letters into
// product names — e.g. "Proper Јоb" uses a Cyrillic Ј and о — which stops the
// beer matching its real spelling. Map the common homoglyphs back to Latin.
const HOMOGLYPHS = {
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
    "ѕ": "s", "і": "i", "ј": "j", "А": "A", "Е": "E", "О": "O", "Р": "P",
    "С": "C", "У": "Y", "Х": "X", "Ј": "J", "В": "B", "К": "K", "М": "M",
    "Н": "H", "Т": "T"
};
const HG_RE = new RegExp("[" + Object.keys(HOMOGLYPHS).join("") + "]", "g");
function deHomoglyph(s) {
    return String(s || "").replace(HG_RE, ch => HOMOGLYPHS[ch] || ch);
}

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

    // If 2+ distinctive name words all matched, that's already a strong,
    // specific hit — accept it even when the shop's title carries no style
    // word or brewery name (e.g. "Old Speckled Hen Cans", brewery Greene King
    // never printed). The looksLikeDrink guard still covers weaker 0-1 word
    // cases.
    if (wordsMatch && productWords.length >= 2) return true;
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

// Known shop spelling quirks for the SAME beer — one shop writes it one way,
// another slightly differently. Normalising these lets the same beer stack
// instead of splitting into look-alike cards.
const NAME_ALIASES = [
    // Brewery spelling: some shops write "Brew Dog" (with a space), which leaks
    // the words "brew" + "dog" into the beer's identity and splits every BrewDog
    // beer in two. Normalise to the one-word brand so they stack.
    [/\bbrew\s+dog\b/gi, "BrewDog"],
    [/innis\s*&\s*gun\b/gi, "Innis & Gunn"],   // shop typo: missing final "n"
    [/\bpin ball\b/gi, "Pinball"],             // BrewDog Pinball
    [/\bdouble dry[\s-]?hopped\b/gi, "DDH"],   // process descriptor, not strength
    [/\btiger'?s? blood\b/gi, "Tigerblood"],   // Tiny Rebel Tigerblood
    [/\bclwb tropical\b/gi, "Clwb Tropica"],   // Tiny Rebel Clwb Tropica misspelt
    [/\blil tropical\b/gi, "Lil Tropic"],      // Vault City Lil Tropic misspelt
    [/\btropica tropical\b/gi, "Tropica"],     // drop the redundant descriptor
    // BrewDog Elvis Juice IS the grapefruit IPA, but only some shops print
    // "Grapefruit". Drop that descriptor so all the regular Elvis listings
    // reduce to {elvis, juice} and stack (the AF "Elvis" stays separate).
    [/\belvis juice grapefruit\b/gi, "Elvis Juice"],
    [/\belvis juice citrus\b/gi, "Elvis Juice"],   // Asda's wording for the same beer
    // Asda descriptor quirks for beers other shops name more plainly.
    [/\bfar out cosmic\b/gi, "Far Out"],           // Northern Monk Far Out
    [/\bjudicious juicy\b/gi, "Judicious"],         // Kirkstall Judicious
    // BrewDog Double Hazy Jane: two shops shorten it to just "Double Hazy".
    // Only rewrite when "Double Hazy" is the WHOLE tail of the name (the
    // standalone product), so we don't touch "Double Hazy <something> IPA"
    // like Northern Monk's "Double Hazy Even More Faith IPA".
    [/\bdouble hazy\s*$/i, "Double Hazy Jane"],
    // Mixed packs: one shop writes "Mix", another "Mixed". Normalise to "Mixed".
    [/\bmix\b(?!ed)/gi, "Mixed"],
    // Vault City Jumbo Jungle Juice: shops write it "Jumbo Jungle Juice",
    // plain "Jungle Juice", and with a redundant trailing "Tropical".
    // Normalise all of them to the real name so they stack as one card.
    [/\bjumbo jungle juice\b/gi, "Jungle Juice"],
    [/\bjungle juice tropical\b/gi, "Jungle Juice"],
    [/\bjungle juice\b/gi, "Jumbo Jungle Juice"]
];

function applyAliases(s) {
    for (const [re, to] of NAME_ALIASES) s = s.replace(re, to);
    return s;
}

function cleanName(title) {
    const s = deHomoglyph(String(title || ""))
        .replace(/\d+\s*[x×]\s*\d+\s*ml/gi, " ")
        .replace(/\d+\s*(ml|cl|l|litre|litres|pint|pints)\b/gi, " ")
        // Standalone pack counts a shop tacks on ("... x4", "4 x", "x 6"),
        // once the "NxNml" form above has already gone. Otherwise "x4" leaks
        // into a beer's identity and splits it from the same beer without it.
        .replace(/\b\d+\s*[x×]\b/gi, " ")
        .replace(/\b[x×]\s*\d+\b/gi, " ")
        .replace(/\b(case|crate|pack|cans?|bottles?|multipack)\b/gi, " ")
        // Collapse an accidentally doubled word ("BrewDog BrewDog Hazy Jane",
        // "Hobgoblin Gold Gold Ale") that a shop's title sometimes carries.
        .replace(/\b([A-Za-z]{2,})\s+\1\b/gi, "$1")
        .replace(/\s+/g, " ")
        .replace(/[-–,]\s*$/, "")
        .trim();
    return applyAliases(s);
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
    "beer", "beers", "keg", "cask", "can", "cans", "single",
    "new", "world", "england", "west", "coast", "american", "cornish", "welsh",
    "scottish", "london", "yorkshire",
    "session", "hazy", "pale", "unfiltered", "craft", "premium", "original",
    "classic", "infused", "style", "vol", "abv", "gluten", "vegan", "edition",
    "limited", "special",
    // "India Pale Ale" == "IPA"; and BrewDog's "Post Modern Classic" tagline
    // (plus shops' "Modern Pale Ale" wording) doesn't change a beer's identity.
    "india", "post", "modern",
    // More style / format / marketing words shops add inconsistently:
    // "amber" (amber ale), "sour"/"ice"/"cream"/"lolly" (Vault City's ice-cream
    // sours), "cut" (Jubel "beer cut with peach"), "bold" (Northern Monk),
    // "opulent" (NM Oath), "cooler" (Fierce). Strength/flavour words are still
    // KEPT elsewhere on purpose.
    "amber", "sour", "ice", "cream", "lolly", "cut", "bold", "opulent", "cooler",
    // Descriptors Asda's wording adds that others don't: "english"/"indian"
    // (India Pale Ale), "pint" (packaging), "everyday" (marketing).
    "english", "indian", "pint", "everyday", "craft",
    // Generic "brewery" words some shops append and others don't
    // ("Vocation Brewery ..." vs "Vocation ...").
    "brewery", "brewing", "brewers", "brewco", "company", "ltd", "town", "ales",
    // Process / marketing descriptors that don't change the beer's identity
    // ("Emerald Daze Terpene Infused Hazy IPA" == "Emerald Daze Hazy IPA").
    "terpene", "ddh", "tdh", "ndh", "dry", "hopped", "cold",
    // Filler words some shops add ("Brooklyn The Stonewall Inn" vs
    // "Brooklyn Brewery Stonewall Inn").
    "the", "and", "of", "with", "an", "for",
    // Place / brand descriptors some shops append and others don't
    // ("Adnams Southwold Ghost Ship" == "Adnams Ghost Ship"), and the
    // "Abbey" style word on Belgian abbey ales ("Leffe Blonde Abbey Beer"
    // == "Leffe Blonde").
    "southwold", "abbey"
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
            .replace(/low[\s-]?alcohol/g, " af ")
            .replace(/[^a-z0-9 ]/g, " ")
            .split(/\s+/)
            .filter(w => w.length >= 2)
    );
}

// A beer's IDENTITY words: its name words, minus the brewery's words, minus
// the style/packaging words above. Two products are the SAME beer only if
// these match exactly. Falls back to the un-stripped words if stripping
// leaves nothing (e.g. a beer literally called "Pale Ale").
// Pure "noise" words — packaging, "beer", brewery-suffix, stray label bits —
// that carry no identity. Used only in the fallback below, when a name has
// nothing BUT these plus style words.
const IDENTITY_NOISE = new Set([
    "brewery", "brewing", "brewers", "brewco", "company", "co", "ltd", "town",
    "ales", "the", "and", "of", "with",
    "beer", "beers", "can", "cans", "bottle", "bottles", "keg", "cask",
    "pack", "multipack", "case", "crate", "cooler", "abv", "vol"
]);

function identityWords(clean, brewery) {
    const words = nameTokens(clean);
    for (const bw of nameTokens(brewery)) words.delete(bw);
    let identity = new Set([...words].filter(w => !STYLE_SUFFIX.has(w)));
    if (!identity.size) {
        // Nothing left after stripping style words — the name is only brewery +
        // style/packaging (e.g. "Camden Pale Ale", "Innis & Gunn Lager Beer").
        // Fall back to those words but drop pure noise, so one shop's "Lager
        // Beer (Abv 4.6%)" and another's "Lager Beer 10x330ml" both reduce to
        // {lager}.
        identity = new Set([...words].filter(w => !IDENTITY_NOISE.has(w)));
    }
    // An alcohol-free / low-alcohol version is its own beer. A bare "0.5%" /
    // "0.0%" doesn't create an "af" token by itself, so tag it here to keep it
    // a separate card from the full-strength one.
    if (looksAlcoholFree(clean)) identity.add("af");
    return identity;
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
function buildCatalogBeers(catalog, curated, knownBreweries = []) {

    // Breweries we can recognise by name-prefix when a beer isn't in the hop
    // DB: the curated brewers, plus every brewery in breweries.json. This lets
    // a listing like "Mad Squirrel Foggy Pale" resolve to "Mad Squirrel"
    // instead of the first word "Mad".
    const breweries = [...new Set([
        ...curated.map(c => c.brewery).filter(Boolean),
        ...knownBreweries.filter(Boolean)
    ])];

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
        // Key the brewery by its core words only, so "Fierce" and "Fierce Beer"
        // (or "Camden" and "Camden Town Brewery") group as the same brewer.
        const breweryKey = breweryTokens(brewery).sort().join(" ") || (brewery || "").toLowerCase();
        const sig = `${breweryKey}||${[...identity].sort().join(" ")}`;

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
