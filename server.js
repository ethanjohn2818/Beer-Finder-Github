const express = require("express");
const path = require("path");
const fs = require("fs");

const { searchTesco } = require("./scrapers/tesco");

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





function loadTescoCache() {

    try {

        return JSON.parse(

            fs.readFileSync(

                "./cache/tesco.json",

                "utf8"

            )

        );

    } catch {

        return {};

    }

}





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





        const cache = loadTescoCache();





        const results = await runWithLimit(

            matches,

            3,

            async (beer)=>{


                const cached =
                    cache[beer.name];



                if(

                    cached &&

                    cached.result &&

                    cached.result.available

                ) {


                    console.log(

                        "USING CACHE:",
                        beer.name

                    );


                    return {

                        beer,

                        tesco:
                        cached.result

                    };

                }





                console.log(

                    "SEARCHING:",
                    beer.name

                );





                const tesco =
                    await searchTesco(
                        beer.name
                    );





                return {

                    beer,

                    tesco

                };



            }

        );







        const validResults =
            results.filter(result =>

                result.tesco &&
                result.tesco.available

            );






        console.log(
            "SENDING:"
        );



        console.log(

            validResults.map(
                r=>r.beer.name
            )

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


});