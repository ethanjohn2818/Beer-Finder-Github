const path = require("path");
const { createScraper } = require("./lib");


// Waitrose groceries search.
//
// ⚠️ BEST-EFFORT: selectors/URLs written without access to the live
// site. If it returns nothing, inspect a product link on the real site
// and update productSelector / searchUrl below.
module.exports = createScraper({

    name: "Waitrose",

    // Set to false to switch this supermarket off (stops it being
    // searched and silences its errors).
    enabled: true,

    cacheFile: path.join(__dirname, "../cache/waitrose.json"),

    baseUrl: "https://www.waitrose.com",

    productSelector: "a[href*='/ecom/products/']",

    imageHint: "waitrose",

    searchUrl: (term) =>
        `https://www.waitrose.com/ecom/shop/search?&searchTerm=${encodeURIComponent(term)}`

});
