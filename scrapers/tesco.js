const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

let browser = null;
let context = null;


const cachePath = path.join(
    __dirname,
    "../cache/tesco.json"
);



const FOUND_CACHE_TIME = 24 * 60 * 60 * 1000;
const NOT_FOUND_CACHE_TIME = 60 * 60 * 1000;
const ERROR_CACHE_TIME = 5 * 60 * 1000;




function loadCache() {

    try {

        return JSON.parse(
            fs.readFileSync(cachePath, "utf8")
        );

    } catch {

        fs.writeFileSync(cachePath, "{}");

        return {};

    }

}





function saveCache(cache) {

    fs.writeFileSync(

        cachePath,

        JSON.stringify(cache, null, 2)

    );

}





function cacheValid(entry) {


    if(
        !entry ||
        !entry.result ||
        !entry.time
    ) {

        return false;

    }



    let expiry;



    if(
        entry.result.available
    ) {

        expiry = FOUND_CACHE_TIME;

    }
    else if(
        entry.result.name === null
    ) {

        expiry = ERROR_CACHE_TIME;

    }
    else {

        expiry = NOT_FOUND_CACHE_TIME;

    }



    return (
        Date.now() - entry.time
        <
        expiry
    );

}






function matchesSearch(searchTerm,name) {


    if(!name) {

        return false;

    }



    const words = searchTerm
        .toLowerCase()
        .replace("&","")
        .split(" ")
        .filter(word => word.length > 2);



    const text = name.toLowerCase();



    return words.every(word =>

        text.includes(word)

    );

}




// Pull just the money value out of a messy price string.
// "£5.50 Clubcard Price" -> "£5.50", "Now £3 was £4" -> "£3"
function extractPrice(text) {

    if (!text) return null;

    const match = text.match(/£\s?\d+(?:\.\d{1,2})?/);

    return match
        ? match[0].replace(/\s/g, "")
        : null;

}




// Work out the pack size from a product name.
// "Beavertown Neck Oil 4 x 330ml" -> "4 × 330ml"
function detectPackLabel(text) {

    if (!text) return "Pack";

    const t = text.toLowerCase();

    // e.g. "4 x 330ml", "10x440ml", "12 × 330 ml"
    const multi = t.match(/(\d+)\s*[x×]\s*(\d+)\s*ml/);
    if (multi) {
        const count = Number(multi[1]);
        const vol = multi[2];
        if (count === 1) return `Single (${vol}ml)`;
        return `${count} × ${vol}ml`;
    }

    // "case" / "crate" wording
    if (/\b(case|crate)\b/.test(t)) return "Case";

    // "4 pack" / "4-pack"
    const pack = t.match(/(\d+)\s*-?\s*pack/);
    if (pack) return `${pack[1]} pack`;

    // A single volume, e.g. "440ml" or "568ml"
    const single = t.match(/(\d+)\s*ml/);
    if (single) return `Single (${single[1]}ml)`;

    return "Pack";

}




// Order options: singles first, then packs, then cases.
function packRank(label) {

    if (/single/i.test(label)) return 0;
    if (/case/i.test(label)) return 2;
    return 1;

}




// Make a Tesco link/image URL absolute.
function absoluteTescoUrl(url) {

    if (!url) return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return "https://www.tesco.com" + url;
    return url;

}





async function getBrowser() {


    if(
        browser &&
        browser.isConnected()
    ) {

        return context;

    }



    console.log(
        "Starting Tesco browser..."
    );




    browser = await chromium.launch({

        // Headless is faster and won't pop a window open.
        // Set HEADED=true if you want to watch the browser work.
        headless: process.env.HEADED !== "true",

        // Let the environment point at a specific Chromium if needed.
        executablePath: process.env.CHROMIUM_PATH || undefined,

        args:[
            "--disable-blink-features=AutomationControlled"
        ]

    });





    context = await browser.newContext({

        locale:"en-GB"

    });





    await context.route(
        "**/*",
        route => {


            const type =
                route.request()
                .resourceType();



            // Block heavy resources we don't need. We still read the
            // product image URL from the page's HTML, so we never need
            // the image bytes to actually download.
            if(

                type === "font" ||

                type === "media" ||

                type === "stylesheet" ||

                type === "image"

            ) {

                return route.abort();

            }



            route.continue();


        }

    );




    return context;

}






async function searchTesco(searchTerm) {


    const cache = loadCache();



    if(
        cacheValid(
            cache[searchTerm]
        )
    ) {


        console.log(
            "CACHE HIT:",
            searchTerm
        );


        return cache[searchTerm].result;

    }





    console.log(
        "Searching Tesco for",
        searchTerm
    );





    const context =
        await getBrowser();



    const page =
        await context.newPage();






    let result = {


        supermarket:"Tesco",

        name:null,

        price:null,

        image:null,

        link:null,

        available:false,

        // Different buy options (single / 4-pack / case) for this beer
        options:[]


    };





    let failed = false;





    try {



        await page.goto(

            `https://www.tesco.com/groceries/en-GB/search?query=${encodeURIComponent(searchTerm)}`,

            {

                waitUntil:"domcontentloaded",

                timeout:20000

            }

        );






        // Wait for at least one product link to show up
        await page
            .locator("a[href*='/products/']")
            .first()
            .waitFor({ timeout:7000 });




        // Pull several product tiles off the search page so we can
        // offer the different pack sizes (single, 4-pack, case...).
        const tiles = await page.evaluate(() => {

            const anchors = Array.from(
                document.querySelectorAll("a[href*='/products/']")
            );

            const seen = new Set();
            const out = [];

            for (const a of anchors) {

                const href = a.getAttribute("href");
                if (!href || seen.has(href)) continue;
                seen.add(href);

                const tile =
                    a.closest("li, article, [class*='tile'], [class*='product']")
                    || a.parentElement;

                const text = (tile.innerText || "").trim();

                let image = null;
                const img = tile.querySelector("img");
                if (img) {
                    const candidates = [
                        img.getAttribute("src"),
                        img.src,
                        img.currentSrc,
                        img.getAttribute("data-src")
                    ].filter(Boolean);

                    image =
                        candidates.find(s => s.includes("digitalcontent"))
                        || candidates[0]
                        || null;
                }

                out.push({ text, href, image });

                if (out.length >= 8) break;
            }

            return out;
        });




        // Keep only the tiles that actually match the beer we searched
        const matching = tiles.filter(tile =>
            matchesSearch(searchTerm, tile.text)
        );




        // Turn each matching tile into a buy option (one per pack size)
        const options = [];
        const usedLabels = new Set();

        for (const tile of matching) {

            const label = detectPackLabel(tile.text);

            if (usedLabels.has(label)) continue;
            usedLabels.add(label);

            options.push({
                label,
                price: extractPrice(tile.text),
                image: absoluteTescoUrl(tile.image),
                link: absoluteTescoUrl(tile.href),
                name: tile.text.split("\n")[0] || tile.text
            });
        }




        if (options.length > 0) {

            options.sort((a, b) =>
                packRank(a.label) - packRank(b.label)
            );

            result.options = options;
            result.available = true;

            // The first option fills the top-level fields (default view)
            const first = options[0];
            result.name = first.name;
            result.price = first.price;
            result.image = first.image;
            result.link = first.link;
        }



    } catch(error) {


        failed = true;


        console.log(
            "Tesco failed:",
            searchTerm,
            error.message
        );


    }





    await page.close()
    .catch(()=>{});





    if(failed) {

        result.name = null;

    }





    cache[searchTerm] = {

        time:Date.now(),

        result

    };





    saveCache(cache);





    return result;

}





// Launch the browser ahead of time so the first search is fast.
async function warmUp() {
    try {
        await getBrowser();
    } catch (error) {
        console.log("Browser warm-up skipped:", error.message);
    }
}


module.exports = {

    searchTesco,

    warmUp

};