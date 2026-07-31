const path = require("path");
const { createScraper } = require("./lib");


// Sainsbury's groceries search.
//
// ⚠️ BEST-EFFORT: selectors/URLs written without access to the live
// site. If it returns nothing, inspect a product link on the real site
// and update productSelector / searchUrl below.
module.exports = createScraper({

    name: "Sainsbury's",

    cacheFile: path.join(__dirname, "../cache/sainsburys.json"),

    baseUrl: "https://www.sainsburys.co.uk",

    productSelector: "a[href*='/gol-ui/product/']",

    imageHint: "sainsburys",

    searchUrl: (term) =>
        `https://www.sainsburys.co.uk/gol-ui/SearchResults/${encodeURIComponent(term)}`

});
