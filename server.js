// ---------------------------------------------------------------
// Local preview server.
//
// The live site is fully static (see public/) and is hosted on Cloudflare Pages.
// This little server is only for previewing it on your own machine:
//
//     npm start   ->   http://localhost:3000
//
// It just serves the public/ folder. All the app logic runs in the
// browser (public/beerlogic.js) from the data files in public/data/.
// ---------------------------------------------------------------

const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
    console.log(`Beer Finder preview running at http://localhost:${PORT}`);
});
