// ---------------------------------------------------------------
// Match report.
//
// Compares our beer list against the crawled Tesco catalogue and shows:
//   - which of our beers WERE found in Tesco's catalogue
//   - which of our beers were NOT found
//   - which Tesco products matched none of our beers (so we can spot
//     beers Tesco has that we should add, or names our matcher misses)
//
// Needs a catalogue first:  npm run catalog
// Run it with:              npm run report
// ---------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const { matchesBeer } = require("../scrapers/lib");
const { loadCatalog } = require("../scrapers/catalog");


const beers = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../data/beers.json"), "utf8")
);

const catalog = loadCatalog();


if (catalog.length === 0) {
    console.log("No catalogue found. Run `npm run catalog` first.");
    process.exit(1);
}

console.log(
    `Tesco catalogue: ${catalog.length} products. ` +
    `Our list: ${beers.length} beers.\n`
);


const matched = [];
const unmatched = [];
const matchedLinks = new Set();

for (const beer of beers) {
    const hits = catalog.filter(p =>
        matchesBeer(beer.name, beer.brewery, p.text || p.title)
    );
    if (hits.length) {
        matched.push(beer.name);
        hits.forEach(h => matchedLinks.add(h.link));
    } else {
        unmatched.push(beer.name);
    }
}


console.log(`✅ FOUND on Tesco (${matched.length}):`);
matched.forEach(n => console.log("   " + n));

console.log(`\n❌ NOT found on Tesco (${unmatched.length}):`);
unmatched.forEach(n => console.log("   " + n));


// Tesco products that matched none of our beers — deduped by a rough
// "base name" (title without the pack size) so variants collapse.
function baseName(title) {
    return title
        .toLowerCase()
        .replace(/\d+\s*[x×]\s*\d+\s*ml/g, "")
        .replace(/\d+\s*ml/g, "")
        .replace(/[^a-z ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const leftovers = new Map();
for (const p of catalog) {
    if (matchedLinks.has(p.link)) continue;
    const key = baseName(p.title);
    if (!leftovers.has(key)) leftovers.set(key, p.title);
}

console.log(`\n🔎 Tesco products that matched NONE of our beers (${leftovers.size}):`);
console.log("   (beers here that ARE in our list = a name-matching gap; the rest are beers we could add)\n");
for (const title of leftovers.values()) {
    console.log("   " + title);
}
