const express = require("express");
const path = require("path");
const fs = require("fs");

const { searchAll, warmUp } = require("./scrapers");

const app = express();

const PORT = 3000;


app.use(
    express.static(
        path.join(__dirname, "public")
    )
);



async function runWithLimit(items, limit, task) {

    const results = [];

    let index = 0;


    async function worker() {

        while(index < items.length) {

            const current = index++;

            results[current] =
                await task(items[current]);

        }

    }



    const workers = [];


    for(let i = 0; i < limit; i++) {

        workers.push(worker());

    }


    await Promise.all(workers);


    return results;

}






app.get("/beers", (req,res)=>{

    try {

        const beers = JSON.parse(
            fs.readFileSync(
                "./data/beers.json",
                "utf8"
            )
        );

        res.json(beers);

    } catch(error) {

        console.error(error);

        res.status(500).json({
            error:"Could not load beers"
        });

    }

});




app.get("/recommend", async (req,res)=>{


    const hop = req.query.hop;



    if(!hop) {

        return res.status(400).json({

            error:"Please provide a hop"

        });

    }





    try {



        const beers = JSON.parse(

            fs.readFileSync(

                "./data/beers.json",

                "utf8"

            )

        );





        const matches = beers.filter(beer =>

            beer.hops.some(h =>

                h.toLowerCase()
                .includes(
                    hop.toLowerCase()
                )

            )

        );





        console.log(
            "BEERS FOUND:"
        );


        console.log(

            matches.map(
                beer => beer.name
            )

        );





        // For each matching beer, search every supermarket at once.
        const results = await runWithLimit(

            matches,

            3,

            async (beer)=>{

                const offers = await searchAll(beer.name, beer.brewery);

                return { beer, offers };

            }

        );




        // Keep beers that at least one supermarket actually stocks
        const validResults =
            results.filter(result =>
                result.offers.length > 0
            );




        console.log(
            "SENDING:",
            validResults.map(r => r.beer.name)
        );





        res.json(validResults);





    } catch(error) {


        console.error(error);


        res.status(500).json({

            error:"Something went wrong"

        });


    }



});





app.listen(PORT,()=>{


    console.log(

        `Beer Finder running at http://localhost:${PORT}`

    );


    // Pre-launch the browser so the first search isn't slow.
    warmUp();


});