// ---------------------------------------------------------------
// Age gate (18+) — shown once, remembered in localStorage
// ---------------------------------------------------------------

function confirmAge() {
    try { localStorage.setItem("bf_age_ok", "1"); } catch (e) {}
    document.getElementById("age-gate").classList.add("hidden");
}

(function ageGate() {
    let ok = false;
    try { ok = localStorage.getItem("bf_age_ok") === "1"; } catch (e) {}
    if (!ok) document.getElementById("age-gate").classList.remove("hidden");
})();


// ---------------------------------------------------------------
// View switching (top nav)
// ---------------------------------------------------------------

function showView(name) {

    document.querySelectorAll(".view").forEach(view => {
        view.classList.add("hidden");
    });

    const target = document.getElementById(name + "-view");
    if (target) target.classList.remove("hidden");

    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.view === name);
    });

    window.scrollTo(0, 0);
}

// Wire up anything with a data-view attribute (nav buttons + brand + footer)
document.querySelectorAll("[data-view]").forEach(el => {
    el.addEventListener("click", () => showView(el.dataset.view));
});


// ---------------------------------------------------------------
// Load the beer database once, then build every view
// ---------------------------------------------------------------

let allBeers = [];

async function loadBeerData() {

    try {
        const curated = await fetch("data/beers.json").then(r => r.json());

        let catalog = await fetch("data/catalog.json")
            .then(r => r.ok ? r.json() : [])
            .catch(() => []);
        if (!catalog.length) {
            catalog = await fetch("data/tesco-catalog.json")
                .then(r => r.ok ? r.json() : [])
                .catch(() => []);
        }

        allBeers = buildCatalogBeers(catalog, curated);

        initStoreFilters();
        buildHopsList(allBeers);
        buildBreweryList(allBeers);
        renderFinderDropdowns();
        renderGifts();

    } catch (error) {
        console.error("Could not load beers:", error);
    }
}


// ---------------------------------------------------------------
// Search + results toolbar (sort / store filter)
// ---------------------------------------------------------------

// The active result set (before store-filter + sort are applied).
let currentResults = [];

// Unique list of shops across all beers.
function allStores() {
    const set = new Set();
    allBeers.forEach(b => b.offers.forEach(o => set.add(o.supermarket)));
    return [...set].sort();
}

// Build the "Stores" checkboxes from the shops actually in the data.
function initStoreFilters() {
    const box = document.getElementById("storeFilters");
    if (!box) return;
    const stores = allStores();
    box.querySelectorAll(".store-check").forEach(el => el.remove());
    stores.forEach(store => {
        const label = document.createElement("label");
        label.className = "store-check";
        label.innerHTML =
            `<input type="checkbox" value="${store}" checked onchange="applyFiltersAndRender()"> ${store}`;
        box.appendChild(label);
    });
}

function checkedStores() {
    const boxes = document.querySelectorAll("#storeFilters input:checked");
    return new Set([...boxes].map(b => b.value));
}


// Search the in-browser beer list by hop / brewery / name / flavour.
function searchBeers() {
    const query = document.getElementById("hopInput").value.trim();
    if (!query) {
        currentResults = [];
        document.getElementById("results").innerHTML =
            "<p class='searching'>Type a hop, brewery or beer name to search 🍺</p>";
        document.getElementById("results-count").textContent = "";
        return;
    }
    currentResults = allBeers.filter(beer => beerMatchesQuery(beer, query));
    applyFiltersAndRender();
}

// Debug/browse helper: show every beer we have.
function showAllBeers() {
    document.getElementById("hopInput").value = "";
    currentResults = allBeers.slice();
    applyFiltersAndRender();
}

// A beer counts as alcohol-free at 0.5% ABV or below, or if its name/style
// says so ("alcohol free", "0.0%", "AF").
function isAlcoholFree(beer) {
    if (typeof beer.abv === "number" && beer.abv > 0 && beer.abv <= 0.5) return true;
    const text = `${beer.name} ${beer.style || ""}`.toLowerCase();
    return /alcohol[\s-]?free|\b0\.0\b|\b0%|\baf\b|non[\s-]?alcoholic/.test(text);
}

function showAlcoholFree() {
    document.getElementById("hopInput").value = "";
    currentResults = allBeers.filter(isAlcoholFree);
    applyFiltersAndRender();
}

function clearSearch() {
    document.getElementById("hopInput").value = "";
    currentResults = [];
    document.getElementById("results").innerHTML = "";
    document.getElementById("results-count").textContent = "";
}


// Apply the store filter + chosen sort to currentResults, then render.
function applyFiltersAndRender() {

    const resultsDiv = document.getElementById("results");
    const countEl = document.getElementById("results-count");
    const stores = checkedStores();

    // Keep only offers at the checked stores; drop beers left with none.
    let beers = currentResults
        .map(beer => {
            const offers = beer.offers.filter(o => stores.has(o.supermarket));
            return offers.length ? { ...beer, offers } : null;
        })
        .filter(Boolean);

    // Sort
    const sort = (document.getElementById("sortBy") || {}).value || "relevance";
    const cheapest = b => Math.min(...b.offers.map(o => priceValue(o.price)));
    if (sort === "name") beers.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "brewery") beers.sort((a, b) =>
        (a.brewery || "").localeCompare(b.brewery || "") || a.name.localeCompare(b.name));
    else if (sort === "price") beers.sort((a, b) => cheapest(a) - cheapest(b));
    else if (sort === "abv") beers.sort((a, b) => (b.abv || 0) - (a.abv || 0));

    if (beers.length === 0) {
        resultsDiv.innerHTML = "<p class='searching'>No beers match 😔</p>";
        countEl.textContent = "";
        return;
    }

    countEl.textContent = `${beers.length} beer${beers.length === 1 ? "" : "s"}`;
    renderBeerCards(beers, resultsDiv);
}


// Render a list of catalogue beers as cards into a container.
function renderBeerCards(beers, container) {
    cardData = [];
    cardState = [];
    container.innerHTML = beers
        .map((beer, index) => renderCard({ beer, offers: beer.offers }, index))
        .join("");
}


// Per-card data and current selection.
let cardData = [];
let cardState = [];


function cleanPrice(text) {
    const match = String(text || "").match(/£\s?\d+(?:\.\d{1,2})?/);
    return match ? match[0].replace(/\s/g, "") : "—";
}

function normalizeOffer(offer) {
    const options = (offer.options && offer.options.length)
        ? offer.options
        : [{ label: "Buy", price: offer.price, image: offer.image, link: offer.link }];
    return { supermarket: offer.supermarket, options };
}

function renderStoreButtons(index) {
    const offers = cardData[index];
    const state = cardState[index];
    if (offers.length <= 1) return "";
    return `<div class="store-row">
        ${offers.map((offer, i) => `
            <button class="store-btn ${i === state.storeIndex ? "active" : ""}"
                data-card="${index}" data-store="${i}">
                ${offer.supermarket}
            </button>`).join("")}
    </div>`;
}

function renderOptButtons(index) {
    const offers = cardData[index];
    const state = cardState[index];
    const options = offers[state.storeIndex].options;
    if (options.length <= 1) return "";
    return options.map((opt, i) => `
        <button class="opt-btn ${i === state.optIndex ? "active" : ""}"
            data-card="${index}" data-opt="${i}">
            ${opt.label}
        </button>`).join("");
}

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
                ? `<p class="beer-hops">🌿 ${beer.hops.join(", ")}</p>` : ""}
            ${renderStoreButtons(index)}
            <div class="opt-row" id="opts-${index}">${renderOptButtons(index)}</div>
            <p class="beer-price">
                💷 <span id="store-${index}">${store.supermarket}</span>:
                <span id="price-${index}">${cleanPrice(opt.price)}</span>
            </p>
            <a id="buy-${index}" class="buy-btn" href="${opt.link || "#"}" target="_blank">
                Buy at <span id="buylabel-${index}">${store.supermarket}</span>
            </a>
        </div>`;
}

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

function setStore(index, storeIndex) {
    cardState[index].storeIndex = storeIndex;
    cardState[index].optIndex = 0;
    const optsEl = document.getElementById("opts-" + index);
    if (optsEl) optsEl.innerHTML = renderOptButtons(index);
    document.querySelectorAll(`.store-btn[data-card="${index}"]`)
        .forEach((btn, i) => btn.classList.toggle("active", i === storeIndex));
    refreshCard(index);
}

function setOption(index, optIndex) {
    cardState[index].optIndex = optIndex;
    document.querySelectorAll(`.opt-btn[data-card="${index}"]`)
        .forEach((btn, i) => btn.classList.toggle("active", i === optIndex));
    refreshCard(index);
}

// One listener handles store + pack-size button clicks anywhere on the page.
document.addEventListener("click", event => {
    const storeBtn = event.target.closest(".store-btn");
    if (storeBtn) {
        setStore(Number(storeBtn.dataset.card), Number(storeBtn.dataset.store));
        return;
    }
    const optBtn = event.target.closest(".opt-btn");
    if (optBtn) {
        setOption(Number(optBtn.dataset.card), Number(optBtn.dataset.opt));
    }
});

// Enter key in the search box
document.getElementById("hopInput")
    .addEventListener("keydown", event => {
        if (event.key === "Enter") searchBeers();
    });


// ---------------------------------------------------------------
// Hops & Brewery lists — compact, expandable accordions
// ---------------------------------------------------------------

function renderAccordion(container, map) {
    const keys = Object.keys(map).sort((a, b) => a.localeCompare(b));
    if (keys.length === 0) {
        container.innerHTML =
            "<p class='searching'>No beers available yet — build the catalogue with <code>npm run build</code>.</p>";
        return;
    }
    container.innerHTML = keys.map(key => `
        <details class="acc">
            <summary>
                <span class="acc-title">${key}</span>
                <span class="acc-count">${map[key].length}</span>
            </summary>
            <ul>${map[key].sort().map(name => `<li>${name}</li>`).join("")}</ul>
        </details>
    `).join("");
}

function buildHopsList(beers) {
    const hopMap = {};
    beers.forEach(beer => (beer.hops || []).forEach(hop => {
        (hopMap[hop] = hopMap[hop] || []).push(beer.name);
    }));
    renderAccordion(document.getElementById("hops-list"), hopMap);
}

function buildBreweryList(beers) {
    const breweryMap = {};
    beers.forEach(beer => {
        const brewery = beer.brewery || "Unknown";
        (breweryMap[brewery] = breweryMap[brewery] || []).push(beer.name);
    });
    renderAccordion(document.getElementById("brewery-list"), breweryMap);
}


// ---------------------------------------------------------------
// Find your beer — a Flavour dropdown and a Beer-type dropdown
// ---------------------------------------------------------------

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

// Flavour options (each knows how to test a beer).
const FLAVOUR_CATEGORIES = [
    { label: "Fruity", match: b => hasAny(b, ["tropical","mango","peach","berry","strawberry","guava","pineapple","passionfruit","orange","apricot","lychee","gooseberry"]) },
    { label: "Citrus", match: b => hasAny(b, ["citrus","grapefruit","lemon","lime","orange","tangerine","zesty"]) },
    { label: "Tropical & juicy", match: b => hasAny(b, ["tropical","mango","pineapple","passionfruit","guava","juicy","soft","creamy"]) },
    { label: "Hoppy", match: b => styleIs(b, ["ipa","pale ale"]) || (b.hops || []).length >= 3 },
    { label: "Extra hoppy", match: b => styleIs(b, ["double ipa","imperial","new england"]) || (b.abv >= 6 && styleIs(b, ["ipa"])) || (b.hops || []).length >= 5 },
    { label: "Sour", match: b => styleIs(b, ["sour","gose","berliner"]) || hasAny(b, ["tart","sour"]) },
    { label: "Dark & roasty", match: b => styleIs(b, ["stout","porter"]) || hasAny(b, ["coffee","chocolate","roasted","roast"]) },
    { label: "Malty & sweet", match: b => hasAny(b, ["caramel","toffee","biscuit","bready","marshmallow","vanilla","sweet","honey"]) },
    { label: "Piney & resinous", match: b => hasAny(b, ["pine","resin","herbal","floral"]) },
    { label: "Crisp & refreshing", match: b => styleIs(b, ["lager","pilsner","pils","helles"]) || hasAny(b, ["crisp"]) },
    { label: "Light & sessionable", match: b => (b.abv && b.abv <= 4.3) || styleIs(b, ["session"]) }
];

// Beer-type options (matched against the beer's style).
const BEER_TYPES = [
    { label: "IPA", match: b => styleIs(b, ["ipa"]) },
    { label: "Pale Ale", match: b => styleIs(b, ["pale"]) },
    { label: "Lager", match: b => styleIs(b, ["lager","pilsner","pils","helles"]) },
    { label: "Stout & Porter", match: b => styleIs(b, ["stout","porter"]) },
    { label: "Sour", match: b => styleIs(b, ["sour","gose"]) },
    { label: "Bitter & Ale", match: b => styleIs(b, ["bitter","red ale","amber","golden ale","brown"]) },
    { label: "Double / Imperial", match: b => styleIs(b, ["double","imperial","dipa"]) },
    { label: "Alcohol-free", match: b => isAlcoholFree(b) }
];

function renderFinderDropdowns() {
    const fSel = document.getElementById("flavourSelect");
    const tSel = document.getElementById("typeSelect");
    if (fSel) fSel.innerHTML =
        `<option value="">Any flavour</option>` +
        FLAVOUR_CATEGORIES.map((c, i) => `<option value="${i}">${c.label}</option>`).join("");
    if (tSel) tSel.innerHTML =
        `<option value="">Any type</option>` +
        BEER_TYPES.map((c, i) => `<option value="${i}">${c.label}</option>`).join("");
}

function clearFlavours() {
    const fSel = document.getElementById("flavourSelect");
    const tSel = document.getElementById("typeSelect");
    if (fSel) fSel.value = "";
    if (tSel) tSel.value = "";
    document.getElementById("find-results").innerHTML = "";
    document.getElementById("find-count").textContent = "";
}

function findByFlavour() {

    const resultsDiv = document.getElementById("find-results");
    const countEl = document.getElementById("find-count");

    const fVal = document.getElementById("flavourSelect").value;
    const tVal = document.getElementById("typeSelect").value;

    if (fVal === "" && tVal === "") {
        resultsDiv.innerHTML = "<p class='searching'>Pick a flavour or a beer type above 🍺</p>";
        countEl.textContent = "";
        return;
    }

    const tests = [];
    if (fVal !== "") tests.push(FLAVOUR_CATEGORIES[Number(fVal)].match);
    if (tVal !== "") tests.push(BEER_TYPES[Number(tVal)].match);

    const matches = allBeers.filter(beer => tests.every(t => t(beer)));

    if (matches.length === 0) {
        resultsDiv.innerHTML = "<p class='searching'>No beers match those choices — try fewer 😔</p>";
        countEl.textContent = "";
        return;
    }

    countEl.textContent = `${matches.length} beer${matches.length === 1 ? "" : "s"}`;
    renderBeerCards(matches, resultsDiv);
}


// ---------------------------------------------------------------
// Gifts — beer glassware, gift baskets & merch
// (Placeholder items — swap the links for real products / affiliate URLs.)
// ---------------------------------------------------------------

const GIFTS = [
    { emoji: "🍺", title: "Craft Beer Glass Set", desc: "A set of tulip & pint glasses to serve your finds properly.", cta: "Browse glassware" },
    { emoji: "🎁", title: "Craft Beer Gift Basket", desc: "A hamper of mixed craft cans — a great gift for any beer lover.", cta: "See gift baskets" },
    { emoji: "👕", title: "Beer Lover T-Shirts", desc: "Hoppy slogans and brewery-style tees for the beer obsessed.", cta: "Shop merch" },
    { emoji: "🧴", title: "Beer Making Kit", desc: "Everything to brew your own craft beer at home.", cta: "View home-brew kits" },
    { emoji: "📖", title: "Craft Beer Books", desc: "Guides to hops, styles and the world's best breweries.", cta: "Browse books" },
    { emoji: "🍻", title: "Personalised Tankards", desc: "Engraved pint tankards — a keepsake gift.", cta: "See tankards" }
];

function renderGifts() {
    const el = document.getElementById("gifts-list");
    if (!el) return;
    el.innerHTML = GIFTS.map(g => `
        <div class="gift-card">
            <div class="gift-emoji">${g.emoji}</div>
            <h3>${g.title}</h3>
            <p>${g.desc}</p>
            <a class="buy-btn" href="${g.link || "#"}" target="_blank" rel="noopener">${g.cta}</a>
        </div>
    `).join("");
}


// ---------------------------------------------------------------
// Contact form (front-end only for now)
// ---------------------------------------------------------------

function sendMessage(event) {
    event.preventDefault();
    document.getElementById("contact-status").textContent =
        "Thanks! Your message has been noted. 🍻";
    event.target.reset();
}


// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------

loadBeerData();
