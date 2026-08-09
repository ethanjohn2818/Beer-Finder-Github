// ---------------------------------------------------------------
// List the beers currently ON THE SITE that have no hop data yet.
//
// This is our worklist for growing public/data/beers.json — the hop
// database the scraper cross-references. Run it after a crawl to see what
// still needs hops (grouped by brewery, biggest gaps first).
//
//   npm run hops
// ---------------------------------------------------------------

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const code = fs.readFileSync(path.join(__dirname, "../public/beerlogic.js"), "utf8");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/data/catalog.json"), "utf8"));
const curated = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/data/beers.json"), "utf8"));

const beers = ctx.buildCatalogBeers(catalog, curated);
const withHops = beers.filter(b => (b.hops || []).length);
const missing = beers.filter(b => !(b.hops || []).length);

console.log(`Hop coverage: ${withHops.length}/${beers.length} beers have hops ` +
    `(${missing.length} still missing).\n`);

const byBrewery = {};
for (const b of missing) {
    const k = b.brewery || "?";
    (byBrewery[k] = byBrewery[k] || []).push(b.name);
}

for (const [brewery, names] of Object.entries(byBrewery).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${brewery} (${names.length})`);
    names.sort().forEach(n => console.log(`   - ${n}`));
}
