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

    if (hops.length === 0) {
        container.innerHTML =
            "<p class='searching'>No beers available yet — build the Tesco catalogue with <code>npm run catalog</code>.</p>";
        return;
    }

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

    if (breweries.length === 0) {
        container.innerHTML =
            "<p class='searching'>No beers available yet — build the Tesco catalogue with <code>npm run catalog</code>.</p>";
        return;
    }

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

    resultsDiv.innerHTML = "<p class='searching'>Searching supermarkets... 🍺</p>";

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

        // Reset the per-card state, then render every beer
        cardData = [];
        cardState = [];

        const html = beers
            .map((result, index) => renderCard(result, index))
            .join("");

        resultsDiv.innerHTML = html;

    } catch (error) {
        console.error(error);
        resultsDiv.innerHTML =
            "<p class='searching'>Something went wrong. Please try again.</p>";
    }
}


// Per-card data and current selection.
//   cardData[i]  = [ { supermarket, options:[...] }, ... ]   (one per store)
//   cardState[i] = { storeIndex, optIndex }
let cardData = [];
let cardState = [];


// Show just the money value, whatever mess the price string is in
function cleanPrice(text) {
    const match = String(text || "").match(/£\s?\d+(?:\.\d{1,2})?/);
    return match ? match[0].replace(/\s/g, "") : "—";
}


// Normalise a store's offer into { supermarket, options[] }.
// Older cached results have no options array, so make a single one.
function normalizeOffer(offer) {

    const options = (offer.options && offer.options.length)
        ? offer.options
        : [{
            label: "Buy",
            price: offer.price,
            image: offer.image,
            link: offer.link
        }];

    return { supermarket: offer.supermarket, options };
}


// Supermarket selector buttons (only when more than one store has it)
function renderStoreButtons(index) {

    const offers = cardData[index];
    const state = cardState[index];

    if (offers.length <= 1) return "";

    return `<div class="store-row">
        ${offers.map((offer, i) => `
            <button
                class="store-btn ${i === state.storeIndex ? "active" : ""}"
                data-card="${index}"
                data-store="${i}">
                ${offer.supermarket}
            </button>
        `).join("")}
    </div>`;
}


// Pack-size buttons for the currently selected store
function renderOptButtons(index) {

    const offers = cardData[index];
    const state = cardState[index];
    const options = offers[state.storeIndex].options;

    if (options.length <= 1) return "";

    return options.map((opt, i) => `
        <button
            class="opt-btn ${i === state.optIndex ? "active" : ""}"
            data-card="${index}"
            data-opt="${i}">
            ${opt.label}
        </button>
    `).join("");
}


// Build one beer card: supermarket selector + pack-size toggle
function renderCard(result, index) {

    const beer = result.beer;
    const offers = (result.offers || []).map(normalizeOffer);

    cardData[index] = offers;
    cardState[index] = { storeIndex: 0, optIndex: 0 };

    if (!offers.length) return "";

    const store = offers[0];
    const opt = store.options[0];

    return `
        <div class="beer-card">

            <img id="img-${index}" src="${opt.image || ""}" alt="${beer.name}">

            <h2>${beer.name}</h2>

            <p class="beer-style">
                ${beer.style || "Beer"}
                ${beer.abv ? beer.abv + "%" : ""}
            </p>

            <p class="beer-hops">
                🌿 ${beer.hops.join(", ")}
            </p>

            ${renderStoreButtons(index)}

            <div class="opt-row" id="opts-${index}">${renderOptButtons(index)}</div>

            <p class="beer-price">
                💷 <span id="store-${index}">${store.supermarket}</span>:
                <span id="price-${index}">${cleanPrice(opt.price)}</span>
            </p>

            <a id="buy-${index}" class="buy-btn" href="${opt.link || "#"}" target="_blank">
                Buy at <span id="buylabel-${index}">${store.supermarket}</span>
            </a>

        </div>
    `;
}


// Update a card's image / price / store label / buy link to the
// currently selected store + pack size.
function refreshCard(index) {

    const offers = cardData[index];
    const state = cardState[index];
    const store = offers[state.storeIndex];
    const opt = store.options[state.optIndex] || store.options[0];

    const img = document.getElementById("img-" + index);
    if (img) img.src = opt.image || "";

    const price = document.getElementById("price-" + index);
    if (price) price.textContent = cleanPrice(opt.price);

    const storeLabel = document.getElementById("store-" + index);
    if (storeLabel) storeLabel.textContent = store.supermarket;

    const buy = document.getElementById("buy-" + index);
    if (buy) buy.href = opt.link || "#";

    const buyLabel = document.getElementById("buylabel-" + index);
    if (buyLabel) buyLabel.textContent = store.supermarket;
}


// Switch supermarket: reset to its first pack size and rebuild toggle
function setStore(index, storeIndex) {

    cardState[index].storeIndex = storeIndex;
    cardState[index].optIndex = 0;

    const optsEl = document.getElementById("opts-" + index);
    if (optsEl) optsEl.innerHTML = renderOptButtons(index);

    document
        .querySelectorAll(`.store-btn[data-card="${index}"]`)
        .forEach((btn, i) => btn.classList.toggle("active", i === storeIndex));

    refreshCard(index);
}


// Switch pack size within the current supermarket
function setOption(index, optIndex) {

    cardState[index].optIndex = optIndex;

    document
        .querySelectorAll(`.opt-btn[data-card="${index}"]`)
        .forEach((btn, i) => btn.classList.toggle("active", i === optIndex));

    refreshCard(index);
}


// One listener handles clicks for store buttons and pack-size buttons
document.getElementById("results")
    .addEventListener("click", event => {

        const storeBtn = event.target.closest(".store-btn");
        if (storeBtn) {
            setStore(
                Number(storeBtn.dataset.card),
                Number(storeBtn.dataset.store)
            );
            return;
        }

        const optBtn = event.target.closest(".opt-btn");
        if (optBtn) {
            setOption(
                Number(optBtn.dataset.card),
                Number(optBtn.dataset.opt)
            );
        }
    });


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
