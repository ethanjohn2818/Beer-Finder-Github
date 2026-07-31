const fs = require("fs");
const path = require("path");


const csvPath = path.join(
    __dirname,
    "../data/beers.csv"
);


const outputPath = path.join(
    __dirname,
    "../data/beers.json"
);


// Read CSV file
const csv = fs.readFileSync(
    csvPath,
    "utf8"
);


// Split into rows
const rows = csv
    .trim()
    .split("\n");


// Get headers
const headers = rows[0]
    .split(",")
    .map(header => header.trim());


// Convert rows into objects
const beers = rows
    .slice(1)
    .map(row => {

        const values = [];
        let current = "";
        let insideQuotes = false;


        for (let char of row) {

            if (char === '"') {
                insideQuotes = !insideQuotes;
            }

            else if (char === "," && !insideQuotes) {
                values.push(current);
                current = "";
            }

            else {
                current += char;
            }

        }


        values.push(current);


        const beer = {};


        headers.forEach((header, index) => {

            beer[header] = values[index];

        });


        // Convert numbers
        beer.abv = Number(beer.abv);


        // Convert lists
        beer.hops = beer.hops
            .split(";")
            .map(item => item.trim());


        beer.malts = beer.malts
            .split(";")
            .map(item => item.trim());


        beer.flavours = beer.flavours
            .split(";")
            .map(item => item.trim());


        return beer;

    });


// Remove duplicates
const uniqueBeers = beers.filter(
    (beer, index, self) =>
        index === self.findIndex(
            b => b.name === beer.name
        )
);


// Sort alphabetically
uniqueBeers.sort(
    (a, b) =>
        a.name.localeCompare(b.name)
);


// Save JSON
fs.writeFileSync(
    outputPath,
    JSON.stringify(uniqueBeers, null, 2)
);


console.log(
    `Created beers.json with ${uniqueBeers.length} beers`
);