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

        headless:false,

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



            if(

                type === "font" ||

                type === "media" ||

                type === "stylesheet"

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

        available:false


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






        const product =
            page.locator(

                [

                ".O4snBtRqGukX0i4 > .online-components-product-tile-product-link__link",

                "a[href*='/products/']"

                ].join(",")

            )
            .first();





        await product.waitFor({

            timeout:7000

        });






        const name =
            await product
            .locator("xpath=../..")
            .innerText()
            .catch(()=>null);





        console.log(
            "PRODUCT:",
            name
        );





        if(
            matchesSearch(
                searchTerm,
                name
            )
        ) {



            result.name = name;

            result.available = true;




            result.link =
                await product
                .getAttribute("href");





            const images =
                await page
                .locator("img")
                .evaluateAll(imgs =>

                    imgs
                    .map(img=>img.src)
                    .filter(src =>
                        src &&
                        src.includes(
                            "digitalcontent.api.tesco.com"
                        )
                    )

                )
                .catch(()=>[]);





            result.image =
                images[0] || null;






            const prices =
                await page
                .locator("text=/£/")
                .evaluateAll(nodes =>

                    nodes.map(n =>
                        n.textContent.trim()
                    )

                )
                .catch(()=>[]);





            result.price =
                prices[0] || null;



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





module.exports = {

    searchTesco

};