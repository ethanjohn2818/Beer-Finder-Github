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

// All catalogue beers, kept so the "Find your beer" page can filter them
let allBeers = [];

async function loadBeerData() {

    try {

        const response = await fetch("/beers");
        allBeers = await response.json();

        buildHopsList(allBeers);
        buildBreweryList(allBeers);
        renderFlavourChips();

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

    const query = document
        .getElementById("hopInput")
        .value
        .trim();

    const resultsDiv = document.getElementById("results");

    if (!query) {
        resultsDiv.innerHTML =
            "<p class='searching'>Type a hop, brewery or beer name to search 🍺</p>";
        return;
    }

    resultsDiv.innerHTML = "<p class='searching'>Searching... 🍺</p>";

    try {

        const response = await fetch(
            `/recommend?q=${encodeURIComponent(query)}`
        );

        const beers = await response.json();

        resultsDiv.innerHTML = "";

        if (!Array.isArray(beers) || beers.length === 0) {
            resultsDiv.innerHTML =
                "<p class='searching'>No beers found for that search 😔</p>";
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
                ${beer.style || "Craft beer"}
                ${beer.abv ? beer.abv + "%" : ""}
            </p>

            ${(beer.hops && beer.hops.length)
                ? `<p class="beer-hops">🌿 ${beer.hops.join(", ")}</p>`
                : ""}

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


// One listener handles clicks for store buttons and pack-size buttons,
// anywhere on the page (search results and "Find your beer" results).
document.addEventListener("click", event => {

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
// Find your beer (pick flavours -> matching beers)
// ---------------------------------------------------------------

// Each option knows how to decide if a beer fits it, using the beer's
// flavours, style, hops and ABV.
function flavours(beer) {
    return (beer.flavours || []).map(f => f.toLowerCase());
}
function hasAny(beer, words) {
    const f = flavours(beer);
    return words.some(w => f.some(x => x.includes(w)));
}
function styleIs(beer, words) {
    const s = (beer.style || "").toLowerCase();
    return words.some(w => s.includes(w));
}

const FLAVOUR_CATEGORIES = [
    { label: "Fruity", emoji: "🍑",
      match: b => hasAny(b, ["tropical","mango","peach","berry","strawberry","guava","pineapple","passionfruit","orange","apricot","lychee","gooseberry"]) },
    { label: "Citrus", emoji: "🍋",
      match: b => hasAny(b, ["citrus","grapefruit","lemon","lime","orange","tangerine","zesty"]) },
    { label: "Tropical & Juicy", emoji: "🥭",
      match: b => hasAny(b, ["tropical","mango","pineapple","passionfruit","guava","juicy","soft","creamy"]) },
    { label: "Hoppy", emoji: "🌿",
      match: b => styleIs(b, ["ipa","pale ale"]) || (b.hops || []).length >= 3 },
    { label: "Extra Hoppy", emoji: "🔥",
      match: b => styleIs(b, ["double ipa","imperial","new england"]) || (b.abv >= 6 && styleIs(b, ["ipa"])) || (b.hops || []).length >= 5 },
    { label: "Sour", emoji: "😝",
      match: b => styleIs(b, ["sour","gose","berliner"]) || hasAny(b, ["tart","sour"]) },
    { label: "Dark & Roasty", emoji: "☕",
      match: b => styleIs(b, ["stout","porter"]) || hasAny(b, ["coffee","chocolate","roasted","roast"]) },
    { label: "Malty & Sweet", emoji: "🍯",
      match: b => hasAny(b, ["caramel","toffee","biscuit","bready","marshmallow","vanilla","sweet","honey"]) },
    { label: "Piney & Resinous", emoji: "🌲",
      match: b => hasAny(b, ["pine","resin","herbal","floral"]) },
    { label: "Crisp Lager", emoji: "🍺",
      match: b => styleIs(b, ["lager","pilsner","pils","helles"]) || hasAny(b, ["crisp"]) },
    { label: "Light & Sessionable", emoji: "🪶",
      match: b => (b.abv && b.abv <= 4.3) || styleIs(b, ["session"]) }
];

const selectedFlavours = new Set();


function renderFlavourChips() {

    const container = document.getElementById("flavour-chips");
    if (!container) return;

    container.innerHTML = FLAVOUR_CATEGORIES.map((cat, i) => `
        <button class="flavour-chip" data-flavour="${i}">
            <span>${cat.emoji}</span> ${cat.label}
        </button>
    `).join("");
}


// Toggle a flavour chip on/off
document.getElementById("flavour-chips")
    .addEventListener("click", event => {
        const chip = event.target.closest(".flavour-chip");
        if (!chip) return;
        const i = Number(chip.dataset.flavour);
        if (selectedFlavours.has(i)) {
            selectedFlavours.delete(i);
            chip.classList.remove("active");
        } else {
            selectedFlavours.add(i);
            chip.classList.add("active");
        }
    });


function clearFlavours() {
    selectedFlavours.clear();
    document.querySelectorAll(".flavour-chip")
        .forEach(chip => chip.classList.remove("active"));
    document.getElementById("find-results").innerHTML = "";
}


// Show beers matching ALL selected flavours
function findByFlavour() {

    const resultsDiv = document.getElementById("find-results");

    if (selectedFlavours.size === 0) {
        resultsDiv.innerHTML =
            "<p class='searching'>Pick at least one flavour above 🍺</p>";
        return;
    }

    const chosen = [...selectedFlavours].map(i => FLAVOUR_CATEGORIES[i]);

    const matches = allBeers.filter(beer =>
        chosen.every(cat => cat.match(beer))
    );

    if (matches.length === 0) {
        resultsDiv.innerHTML =
            "<p class='searching'>No beers match all those flavours — try fewer 😔</p>";
        return;
    }

    // Wrap each beer as a result so we can reuse the beer-card renderer
    cardData = [];
    cardState = [];

    const html = matches
        .map((beer, index) => renderCard({
            beer,
            offers: [{
                supermarket: "Tesco",
                options: beer.options,
                price: beer.price,
                image: beer.image,
                link: beer.link
            }]
        }, index))
        .join("");

    resultsDiv.innerHTML = html;
}


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
