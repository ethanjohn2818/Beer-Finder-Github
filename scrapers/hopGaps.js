// ---------------------------------------------------------------
// Hop-gap worklist.
//
// After a crawl, this writes hop-gaps.txt: the beers now ON THE SITE that
// have NO hops yet AND are the kind of beer where hops are the story
// (IPAs, pale ales, lagers...). It deliberately leaves OUT the beers that
// legitimately have no hop profile — fruit beers, sours, stouts, porters,
// mixed/variety packs — so the list is a genuine "go read the can" worklist,
// not noise.
//
// Katie's workflow: run the scrapers, open hop-gaps.txt, grab the hop bills
// off the cans, and hand them to Claude to drop straight into
// public/data/beers.json.
//
// Run standalone:  npm run gaps
// Also runs automatically at the end of  npm run build.
// ---------------------------------------------------------------

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const OUT_FILE = path.join(__dirname, "../hop-gaps.txt");

// Words that mark a beer as NOT hop-driven — if any appears in the name or
// style, we skip it (its "no hops" state is correct, so don't ask for hops).
const NOT_HOPPY = [
    "sour", "kriek", "lambic", "framboise", "cherry", "strawberry", "raspberry",
    "berry", "fruit", "grapefruit", "peach", "passionfruit", "passion fruit",
    "guava", "mango", "pineapple", "lime", "lemon", "creamsicle", "cola",
    "iced tea", "ice tea", " tea", "honeycomb", "mint",
    "stout", "porter", "gose", "heather", "oyster",
    "coffee", "chocolate", "caramel", "vanilla", "biscuit", "honey",
    "mixed", " mix", "cube", "selection", "variety", "bundle"
];

function looksHoppy(beer) {
    const hay = `${beer.name || ""} ${beer.style || ""}`.toLowerCase();
    return !NOT_HOPPY.some(w => hay.includes(w));
}

// Build the site's beer list using the real browser logic, then write the gaps.
function writeHopGaps() {
    const code = fs.readFileSync(path.join(__dirname, "../public/beerlogic.js"), "utf8");
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(code, ctx);

    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/data/catalog.json"), "utf8"));
    const curated = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/data/beers.json"), "utf8"));

    const beers = ctx.buildCatalogBeers(catalog, curated);
    const missing = beers.filter(b => !(b.hops || []).length);
    const worklist = missing.filter(looksHoppy);
    const skipped = missing.length - worklist.length;

    // Group by brewery, biggest gaps first.
    const byBrewery = {};
    for (const b of worklist) {
        const k = b.brewery || "?";
        (byBrewery[k] = byBrewery[k] || []).push(b);
    }

    const lines = [];
    lines.push("HOP-GAP WORKLIST");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push(`${worklist.length} hop-forward beers on the site still need hops.`);
    lines.push(`(${skipped} other hop-less beers skipped — fruit beers, sours, stouts, mixed packs.)`);
    lines.push("");
    lines.push("Grab the hop bill off each can, then hand this list to Claude to");
    lines.push("drop them into public/data/beers.json. Fill the 'hops:' line:");
    lines.push("");

    for (const [brewery, list] of Object.entries(byBrewery).sort((a, b) => b[1].length - a[1].length)) {
        lines.push(`## ${brewery} (${list.length})`);
        list.sort((a, b) => a.name.localeCompare(b.name)).forEach(b => {
            const link = (b.offers && b.offers[0] && b.offers[0].link) || "";
            lines.push(`- ${b.name}  [${b.style || "?"}]`);
            lines.push(`    hops: `);
            if (link) lines.push(`    ${link}`);
        });
        lines.push("");
    }

    fs.writeFileSync(OUT_FILE, lines.join("\n"));
    console.log(`Hop-gap worklist: ${worklist.length} hop-forward beers still need hops ` +
        `(${skipped} non-hoppy skipped) -> hop-gaps.txt`);
    return worklist.length;
}

module.exports = { writeHopGaps };

if (require.main === module) {
    writeHopGaps();
}
