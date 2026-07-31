async function searchBeers() {

    const hop = document
        .getElementById("hopInput")
        .value;


    const resultsDiv = document.getElementById("results");

    resultsDiv.innerHTML = "Searching Tesco... 🍺";


    const response = await fetch(
        `/recommend?hop=${hop}`
    );


    const beers = await response.json();


    resultsDiv.innerHTML = "";


    beers.forEach(result => {


        const beer = result.beer;
        const tesco = result.tesco;


        resultsDiv.innerHTML += `

            <div class="beer-card">

                <img src="${tesco.image || ''}">

                <h2>
                    ${beer.name}
                </h2>

                <p>
                    ${beer.style || "Beer"}
                    ${beer.abv || ""}
                </p>

                <p>
                    🌿 ${beer.hops.join(", ")}
                </p>


                <p>
                    💷 Tesco:
                    ${tesco.price}
                </p>


                <a href="${tesco.link}" target="_blank">
                    Buy at Tesco
                </a>

            </div>

        `;


    });

}