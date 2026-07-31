const path = require("path");
const { createScraper } = require("./lib");


// Marks & Spencer search.
//
// ⚠️ BEST-EFFORT AND UNCERTAIN: M&S doesn't sell everyday groceries for
// home delivery the way the others do (their food online is limited /
// partly via Ocado), so this scraper may legitimately find nothing.
// Selectors/URLs are guesses — verify against the live site if needed.
module.exports = createScraper({

    name: "M&S",

    // Set to false to switch this supermarket off (stops it being
    // searched and silences its errors).
    enabled: true,

    cacheFile: path.join(__dirname, "../cache/mands.json"),

    baseUrl: "https://www.marksandspencer.com",

    productSelector: "a[href*='/p/']",

    imageHint: "marksandspencer",

    searchUrl: (term) =>
        `https://www.marksandspencer.com/l/search?q=${encodeURIComponent(term)}`

});
