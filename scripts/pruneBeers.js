// ---------------------------------------------------------------
// Prune the beer database down to beers Tesco actually stocks.
//
// After a warm run (npm run warm), the Tesco cache knows which beers
// were found and which weren't. This script removes the beers that
// were searched and NOT found, so the site only shows beers you can
// actually buy — and searches stay fast (no re-scraping dead ends).
//
// The full list is backed up to data/beers.full.json first, so nothing
// is lost. To restore it later, copy that file back over beers.json.
//
// Run it with:   npm run prune
// ---------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const beersPath = path.join(__dirname, "../data/beers.json");
const csvPath = path.join(__dirname, "../data/beers.csv");
const cachePath = path.join(__dirname, "../cache/tesco.json");
const backupPath = path.join(__dirname, "../data/beers.full.json");


function load(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}


const beers = load(beersPath, []);
const cache = load(cachePath, {});


// Warn if some beers have never been searched (no cache entry). Those
// are KEPT (we only remove beers Tesco was actually asked about and
// didn't have), so run `npm run warm` first for a complete result.
const unchecked = beers.filter(b => !cache[b.name]);

if (unchecked.length > 0) {
    console.log(
        `⚠️  ${unchecked.length} of ${beers.length} beers haven't been ` +
        `searched on Tesco yet.`
    );
    console.log("   Run `npm run warm` first so every beer is checked.");
    console.log("   (These beers will be kept for now, not removed.)\n");
}


// Remove a beer only if Tesco was searched for it and it was NOT found.
function foundOnTesco(beer) {
    const entry = cache[beer.name];
    if (!entry || !entry.result) return true;   // never checked -> keep
    return entry.result.available === true;      // checked -> keep if found
}


const kept = beers.filter(foundOnTesco);
const removed = beers.filter(b => !foundOnTesco(b));


// Back up the full list once, so the original is always recoverable.
if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, JSON.stringify(beers, null, 2));
    console.log(`Backed up full list to data/beers.full.json (${beers.length} beers).`);
}


// Save the trimmed list...
fs.writeFileSync(beersPath, JSON.stringify(kept, null, 2));

// ...and keep the CSV in sync so importBeerCsv can't undo the prune.
writeCsv(csvPath, kept);


console.log(`\nKept ${kept.length} beers found on Tesco.`);
console.log(`Removed ${removed.length} beers not found.`);

if (removed.length) {
    console.log("\nRemoved:");
    removed.forEach(b => console.log("  - " + b.name));
}


// --- helpers ---------------------------------------------------

function csvField(value) {
    value = String(value);
    return /[",]/.test(value)
        ? '"' + value.replace(/"/g, '""') + '"'
        : value;
}

function writeCsv(file, list) {
    const headers = ["name", "brewery", "style", "abv", "hops", "malts", "flavours"];
    const rows = [headers.join(",")];
    for (const b of list) {
        rows.push([
            csvField(b.name),
            csvField(b.brewery),
            csvField(b.style),
            b.abv,
            csvField((b.hops || []).join(";")),
            csvField((b.malts || []).join(";")),
            csvField((b.flavours || []).join(";"))
        ].join(","));
    }
    fs.writeFileSync(file, rows.join("\n") + "\n");
}
