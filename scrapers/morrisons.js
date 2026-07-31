const path = require("path");
const { createScraper } = require("./lib");


// Morrisons groceries search.
//
// ⚠️ BEST-EFFORT: these selectors/URLs were written without access to
// the live site. If Morrisons returns no results, open the site in a
// browser, right-click a product and "Inspect" to check the real
// product-link path, then update productSelector / searchUrl below.
module.exports = createScraper({

    name: "Morrisons",

    cacheFile: path.join(__dirname, "../cache/morrisons.json"),

    baseUrl: "https://groceries.morrisons.com",

    productSelector: "a[href*='/products/']",

    imageHint: "morrisons",

    searchUrl: (term) =>
        `https://groceries.morrisons.com/search?entry=${encodeURIComponent(term)}`

});
