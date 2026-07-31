const path = require("path");
const { createScraper } = require("./lib");


// Tesco groceries search. These selectors are verified against the
// live Tesco site.
module.exports = createScraper({

    name: "Tesco",

    cacheFile: path.join(__dirname, "../cache/tesco.json"),

    baseUrl: "https://www.tesco.com",

    productSelector: "a[href*='/products/']",

    imageHint: "digitalcontent",

    searchUrl: (term) =>
        `https://www.tesco.com/groceries/en-GB/search?query=${encodeURIComponent(term)}`

});
