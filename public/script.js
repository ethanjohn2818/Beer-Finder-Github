// ---------------------------------------------------------------
// View switching (top nav)
// ---------------------------------------------------------------

function showView(name) {

    // Hide every view, then show the chosen one
    document.querySelectorAll(".view").forEach(view => {
        view.classList.add("hidden");
    });

    const target = document.getElementById(name + "-view");

    if (target) {
        target.classList.remove("hidden");
    }

    // Highlight the active nav button
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle(
            "active",
            btn.dataset.view === name
        );
    });

    window.scrollTo(0, 0);
}


// Wire up anything with a data-view attribute (nav buttons + brand)
document.querySelectorAll("[data-view]").forEach(el => {
    el.addEventListener("click", () => {
        showView(el.dataset.view);
    });
});


// ---------------------------------------------------------------
// Load the beer database once, then build the Hops & Brewery lists
// ---------------------------------------------------------------

async function loadBeerData() {

    try {

        const response = await fetch("/beers");
        const beers = await response.json();

        buildHopsList(beers);
        buildBreweryList(beers);

    } catch (error) {
        console.error("Could not load beers:", error);
    }
}


function buildHopsList(beers) {

    // Map each hop -> list of beer names that use it
    const hopMap = {};

    beers.forEach(beer => {
        (beer.hops || []).forEach(hop => {
            if (!hopMap[hop]) {
                hopMap[hop] = [];
            }
            hopMap[hop].push(beer.name);
        });
    });

    const hops = Object.keys(hopMap).sort();

    const container = document.getElementById("hops-list");
    container.innerHTML = "";

    hops.forEach(hop => {
        container.innerHTML += `
            <div class="list-card">
                <h3>${hop}</h3>
                <p class="count">${hopMap[hop].length} beer(s)</p>
                <ul>
                    ${hopMap[hop].map(name => `<li>${name}</li>`).join("")}
                </ul>
            </div>
        `;
    });
}


function buildBreweryList(beers) {

    // Map each brewery -> list of its beers
    const breweryMap = {};

    beers.forEach(beer => {
        const brewery = beer.brewery || "Unknown";
        if (!breweryMap[brewery]) {
            breweryMap[brewery] = [];
        }
        breweryMap[brewery].push(beer.name);
    });

    const breweries = Object.keys(breweryMap).sort();

    const container = document.getElementById("brewery-list");
    container.innerHTML = "";

    breweries.forEach(brewery => {
        container.innerHTML += `
            <div class="list-card">
                <h3>${brewery}</h3>
                <p class="count">${breweryMap[brewery].length} beer(s)</p>
                <ul>
                    ${breweryMap[brewery].map(name => `<li>${name}</li>`).join("")}
                </ul>
            </div>
        `;
    });
}


// ---------------------------------------------------------------
// Search (existing feature)
// ---------------------------------------------------------------

async function searchBeers() {

    const hop = document
        .getElementById("hopInput")
        .value;

    const resultsDiv = document.getElementById("results");

    resultsDiv.innerHTML = "<p class='searching'>Searching Tesco... 🍺</p>";

    try {

        const response = await fetch(
            `/recommend?hop=${encodeURIComponent(hop)}`
        );

        const beers = await response.json();

        resultsDiv.innerHTML = "";

        if (!Array.isArray(beers) || beers.length === 0) {
            resultsDiv.innerHTML =
                "<p class='searching'>No beers found for that hop 😔</p>";
            return;
        }

        beers.forEach(result => {

            const beer = result.beer;
            const tesco = result.tesco;

            resultsDiv.innerHTML += `

                <div class="beer-card">

                    <img src="${tesco.image || ''}" alt="${beer.name}">

                    <h2>${beer.name}</h2>

                    <p class="beer-style">
                        ${beer.style || "Beer"}
                        ${beer.abv ? beer.abv + "%" : ""}
                    </p>

                    <p class="beer-hops">
                        🌿 ${beer.hops.join(", ")}
                    </p>

                    <p class="beer-price">
                        💷 Tesco: ${tesco.price}
                    </p>

                    <a class="buy-btn" href="${tesco.link}" target="_blank">
                        Buy at Tesco
                    </a>

                </div>
            `;
        });

    } catch (error) {
        console.error(error);
        resultsDiv.innerHTML =
            "<p class='searching'>Something went wrong. Please try again.</p>";
    }
}


// Let people press Enter in the search box
document.getElementById("hopInput")
    .addEventListener("keydown", event => {
        if (event.key === "Enter") {
            searchBeers();
        }
    });


// ---------------------------------------------------------------
// Contact form (front-end only for now)
// ---------------------------------------------------------------

function sendMessage(event) {

    event.preventDefault();

    const status = document.getElementById("contact-status");

    status.textContent =
        "Thanks! Your message has been noted. 🍻";

    event.target.reset();
}


// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------

loadBeerData();
