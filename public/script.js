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
let hopData = {};       // hop name -> { flavours:[], notes:"" }
let breweryData = {};   // lowercased brewery name -> "Town, Country"

async function loadBeerData() {

    try {
        const curated = await fetch("data/beers.json").then(r => r.json());

        hopData = await fetch("data/hops.json")
            .then(r => r.ok ? r.json() : {})
            .catch(() => ({}));

        // Brewery locations, keyed case-insensitively.
        const rawBreweries = await fetch("data/breweries.json")
            .then(r => r.ok ? r.json() : {})
            .catch(() => ({}));
        breweryData = {};
        Object.keys(rawBreweries).forEach(k => { breweryData[k.toLowerCase()] = rawBreweries[k]; });

        let catalog = await fetch("data/catalog.json")
            .then(r => r.ok ? r.json() : [])
            .catch(() => []);
        if (!catalog.length) {
            catalog = await fetch("data/tesco-catalog.json")
                .then(r => r.ok ? r.json() : [])
                .catch(() => []);
        }

        allBeers = buildCatalogBeers(catalog, curated);
        allBeers.forEach((b, i) => { b._id = i; });   // stable id for detail lookup

        initStoreFilters();
        renderTypeFilter();
        buildHopsList(allBeers);
        buildBreweryList(allBeers);
        renderFlavourChips();
        renderGifts();

        // Populate the homepage with every beer straight away, so the site
        // never looks empty before you've searched.
        showAllBeers();

    } catch (error) {
        console.error("Could not load beers:", error);
        const resultsDiv = document.getElementById("results");
        if (resultsDiv) {
            resultsDiv.innerHTML =
                "<p class='searching'>Couldn't load the beer list. Please refresh the page.</p>";
        }
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

    // Beer-type filter (multi-select checklist) — a beer passes if it matches
    // ANY of the ticked types.
    const types = checkedTypes();
    if (types.length) {
        beers = beers.filter(b => types.some(i => BEER_TYPES[i].match(b)));
    }

    // Sort
    const sort = (document.getElementById("sortBy") || {}).value || "relevance";
    const cheapest = b => Math.min(...b.offers.map(o => priceValue(o.price)));
    if (sort === "brewery") beers.sort((a, b) =>
        (a.brewery || "").localeCompare(b.brewery || "") || a.name.localeCompare(b.name));
    else if (sort === "price") beers.sort((a, b) => cheapest(a) - cheapest(b));
    else if (sort === "price-desc") beers.sort((a, b) => cheapest(b) - cheapest(a));
    else if (sort === "abv") beers.sort((a, b) => (b.abv || 0) - (a.abv || 0));
    else if (sort === "abv-asc") beers.sort((a, b) => (a.abv || 0) - (b.abv || 0));

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
        <div class="beer-card clickable" data-beer="${beer._id}">
            <img id="img-${index}" src="${opt.image || ""}" alt="${beer.name}">
            <h2>${beer.name}</h2>
            <p class="beer-style">
                ${beer.style || "Craft beer"}
                ${beer.abv ? beer.abv + "%" : ""}
            </p>
            ${(beer.hops && beer.hops.length)
                ? `<p class="beer-hops">🌿 ${beer.hops.join(", ")}</p>` : ""}
            <p class="card-more">ⓘ Tap for taste &amp; hops</p>
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
        return;
    }

    // Clicking the buy link should just buy — don't open the detail page.
    if (event.target.closest(".buy-btn")) return;

    // A click anywhere else on a card opens its detail page.
    const card = event.target.closest(".beer-card");
    if (card && card.dataset.beer != null) {
        openBeerDetail(Number(card.dataset.beer));
    }
});

// Enter key in the search box
document.getElementById("hopInput")
    .addEventListener("keydown", event => {
        if (event.key === "Enter") searchBeers();
    });


// ---------------------------------------------------------------
// Hop flavour profiles + beer detail page
// ---------------------------------------------------------------

// Which view is on screen now (so the detail Back button returns there).
function currentView() {
    const v = [...document.querySelectorAll(".view")].find(el => !el.classList.contains("hidden"));
    return v ? v.id.replace("-view", "") : "search";
}
let detailReturnView = "search";

function hopProfile(name) {
    return hopData[name] || null;
}

// Join words nicely: ["a","b","c"] -> "a, b and c".
function listWords(arr) {
    const a = arr.filter(Boolean);
    if (a.length <= 1) return a.join("");
    return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}

// A beer's taste tags = its own flavours plus every flavour its hops bring,
// de-duplicated. This is how we explain the taste, even with no description.
function beerTasteTags(beer) {
    const seen = new Set();
    const tags = [];
    const add = f => { const k = f.toLowerCase(); if (!seen.has(k)) { seen.add(k); tags.push(f); } };
    (beer.flavours || []).forEach(add);
    (beer.hops || []).forEach(h => {
        const p = hopProfile(h);
        if (p) (p.flavours || []).forEach(add);
    });
    return tags;
}

function describeBeer(beer) {
    if (beer.description) return beer.description;
    const parts = [];
    parts.push(`${beer.style || "A craft beer"}${beer.brewery ? " from " + beer.brewery : ""}.`);
    const taste = beerTasteTags(beer);
    if (taste.length) parts.push(`Expect ${listWords(taste.slice(0, 4)).toLowerCase()} flavours.`);
    if ((beer.hops || []).length) parts.push(`Brewed with ${listWords(beer.hops)}.`);
    return parts.join(" ");
}

function tagRow(tags) {
    if (!tags || !tags.length) return "";
    return `<div class="tag-row">${tags.map(t => `<span class="tag">${t}</span>`).join("")}</div>`;
}

// Build and show the detail page for a beer id (index into allBeers).
function openBeerDetail(id) {

    const beer = allBeers[id];
    if (!beer) return;
    detailReturnView = currentView();

    const img = (beer.offers[0] && beer.offers[0].image) || "";

    const hopsHtml = (beer.hops || []).length
        ? beer.hops.map(h => {
            const p = hopProfile(h);
            return `<div class="hop-profile">
                <h3>${h}</h3>
                ${p ? `<p>${p.notes}</p>${tagRow(p.flavours)}`
                    : `<p class="muted">Flavour profile coming soon.</p>`}
            </div>`;
        }).join("")
        : `<p class="muted">We don't have the hop details for this beer yet.</p>`;

    const buyHtml = beer.offers.map(offer => `
        <div class="detail-shop">
            <span class="detail-shop-name">${offer.supermarket}</span>
            <div class="detail-shop-opts">
                ${(offer.options || []).map(o =>
                    `<a class="opt-buy" href="${o.link || "#"}" target="_blank" rel="noopener">${o.label} — ${cleanPrice(o.price)}</a>`
                ).join("")}
            </div>
        </div>`).join("");

    document.getElementById("detail-view").innerHTML = `
        <button class="back-btn" onclick="showView('${detailReturnView}')">← Back</button>
        <div class="detail">
            <div class="detail-media">
                ${img ? `<img src="${img}" alt="${beer.name}">` : `<div class="detail-noimg">🍺</div>`}
            </div>
            <div class="detail-body">
                <h1>${beer.name}</h1>
                ${beer.brewery
                    ? `<p class="detail-brewery">${beer.brewery}${breweryLocation(beer.brewery) ? ` <span class="detail-loc">📍 ${breweryLocation(beer.brewery)}</span>` : ""}</p>`
                    : ""}
                <p class="detail-style">${beer.style || "Craft beer"}${beer.abv ? " • " + beer.abv + "% ABV" : ""}</p>
                <p class="detail-desc">${describeBeer(beer)}</p>

                <div class="detail-section">
                    <h2>What it tastes like</h2>
                    ${tagRow(beerTasteTags(beer)) || "<p class='muted'>Taste notes coming soon.</p>"}
                </div>

                <div class="detail-section">
                    <h2>Hops <span class="muted">— and what each brings</span></h2>
                    <div class="hop-profiles">${hopsHtml}</div>
                </div>

                <div class="detail-section">
                    <h2>Where to buy</h2>
                    ${buyHtml}
                </div>
            </div>
        </div>`;

    showView("detail");
}


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

    const container = document.getElementById("hops-list");
    const hops = Object.keys(hopMap).sort((a, b) => a.localeCompare(b));

    if (!hops.length) {
        container.innerHTML =
            "<p class='searching'>No beers available yet — build the catalogue with <code>npm run build</code>.</p>";
        return;
    }

    container.innerHTML = hops.map(hop => {
        const p = hopProfile(hop);
        const inline = p ? `<span class="acc-flavour">${(p.flavours || []).slice(0, 3).join(" · ")}</span>` : "";
        return `<details class="acc">
            <summary>
                <span class="acc-title">${hop}</span>
                ${inline}
                <span class="acc-count">${hopMap[hop].length}</span>
            </summary>
            <div class="acc-body">
                ${p ? `<p class="hop-notes">${p.notes}</p>${tagRow(p.flavours)}` : ""}
                <p class="hop-beers-label">Beers with this hop</p>
                <ul>${hopMap[hop].sort().map(n => `<li>${n}</li>`).join("")}</ul>
            </div>
        </details>`;
    }).join("");
}

// Where a brewery is based (case-insensitive lookup), or "" if unknown.
function breweryLocation(name) {
    return breweryData[String(name || "").toLowerCase()] || "";
}

function buildBreweryList(beers) {
    const breweryMap = {};
    beers.forEach(beer => {
        const brewery = beer.brewery || "Unknown";
        (breweryMap[brewery] = breweryMap[brewery] || []).push(beer.name);
    });

    const container = document.getElementById("brewery-list");
    let breweries = Object.keys(breweryMap);

    if (!breweries.length) {
        container.innerHTML =
            "<p class='searching'>No beers available yet — build the catalogue with <code>npm run build</code>.</p>";
        return;
    }

    // Sort as chosen in the brewery-page control.
    const sort = (document.getElementById("brewerySort") || {}).value || "az";
    if (sort === "az") breweries.sort((a, b) => a.localeCompare(b));
    else if (sort === "za") breweries.sort((a, b) => b.localeCompare(a));
    else if (sort === "most") breweries.sort((a, b) => breweryMap[b].length - breweryMap[a].length || a.localeCompare(b));
    else if (sort === "fewest") breweries.sort((a, b) => breweryMap[a].length - breweryMap[b].length || a.localeCompare(b));

    container.innerHTML = breweries.map(brewery => {
        const loc = breweryLocation(brewery);
        const inline = loc ? `<span class="acc-flavour">📍 ${loc}</span>` : "";
        const safe = brewery.replace(/"/g, "&quot;");
        return `<details class="acc">
            <summary>
                <span class="acc-title">${brewery}</span>
                ${inline}
                <span class="acc-count">${breweryMap[brewery].length}</span>
            </summary>
            <div class="acc-body">
                ${loc ? `<p class="hop-notes">📍 Based in ${loc}</p>` : ""}
                <button class="see-beers-btn" onclick="showBreweryBeers('${safe.replace(/'/g, "\\'")}')">🔎 See all ${breweryMap[brewery].length} beers</button>
                <p class="hop-beers-label">Beers we found</p>
                <ul>${breweryMap[brewery].sort().map(n => `<li>${n}</li>`).join("")}</ul>
            </div>
        </details>`;
    }).join("");
}

// Jump to the search page showing just this brewery's beers.
function showBreweryBeers(brewery) {
    currentResults = allBeers.filter(b => (b.brewery || "") === brewery);
    document.getElementById("hopInput").value = "";
    showView("search");
    applyFiltersAndRender();
}


// ---------------------------------------------------------------
// Beer TYPE filter (used by the search toolbar dropdown)
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

// A beer's type is worked out from its style AND its name — many beers
// (sours, stouts) aren't in our hop DB so have no style, but their name
// still says "Sour Beer", "Milk Stout", etc. Matching the name too is what
// makes Sour and Stout actually return results.
function typeText(beer) {
    return `${beer.style || ""} ${beer.name || ""}`.toLowerCase();
}

const BEER_TYPES = [
    { label: "IPA",             match: b => /\bipa\b|neipa|dipa/.test(typeText(b)) },
    { label: "Pale Ale",        match: b => /pale/.test(typeText(b)) },
    { label: "Lager & Pilsner", match: b => /lager|pilsner|\bpils\b|helles/.test(typeText(b)) },
    { label: "Stout & Porter",  match: b => /stout|porter/.test(typeText(b)) },
    { label: "Sour",            match: b => /\bsour\b|gose|berliner|kriek/.test(typeText(b)) },
    { label: "Bitter & Amber",  match: b => /bitter|amber|golden ale|brown ale|\bmild\b|red ale/.test(typeText(b)) },
    { label: "Wheat & Weisse",  match: b => /wheat|weisse|hefe|witbier/.test(typeText(b)) },
    { label: "Alcohol-free",    match: b => isAlcoholFree(b) }
];

// Beer type is a multi-select checklist: tick as many as you like.
function renderTypeFilter() {
    const box = document.getElementById("typeFilters");
    if (!box) return;
    box.querySelectorAll(".type-check").forEach(el => el.remove());
    BEER_TYPES.forEach((c, i) => {
        const label = document.createElement("label");
        label.className = "type-check";
        label.innerHTML =
            `<input type="checkbox" value="${i}" onchange="applyFiltersAndRender()"> ${c.label}`;
        box.appendChild(label);
    });
}

function checkedTypes() {
    const boxes = document.querySelectorAll("#typeFilters input:checked");
    return [...boxes].map(b => Number(b.value));
}


// ---------------------------------------------------------------
// Find your beer — interactive flavour chips (tap to toggle)
// ---------------------------------------------------------------

const FLAVOUR_CATEGORIES = [
    { label: "Fruity", emoji: "🍑", match: b => hasAny(b, ["tropical","mango","peach","berry","strawberry","guava","pineapple","passionfruit","orange","apricot","lychee","gooseberry"]) },
    { label: "Citrus", emoji: "🍋", match: b => hasAny(b, ["citrus","grapefruit","lemon","lime","orange","tangerine","zesty"]) },
    { label: "Tropical & juicy", emoji: "🥭", match: b => hasAny(b, ["tropical","mango","pineapple","passionfruit","guava","juicy","soft","creamy"]) },
    { label: "Hoppy", emoji: "🌿", match: b => styleIs(b, ["ipa","pale ale"]) || (b.hops || []).length >= 3 },
    { label: "Extra hoppy", emoji: "🔥", match: b => styleIs(b, ["double ipa","imperial","new england"]) || (b.abv >= 6 && styleIs(b, ["ipa"])) || (b.hops || []).length >= 5 },
    { label: "Sour", emoji: "😝", match: b => /\bsour\b|gose|berliner/.test(typeText(b)) || hasAny(b, ["tart","sour"]) },
    { label: "Dark & roasty", emoji: "☕", match: b => /stout|porter/.test(typeText(b)) || hasAny(b, ["coffee","chocolate","roasted","roast"]) },
    { label: "Malty & sweet", emoji: "🍯", match: b => hasAny(b, ["caramel","toffee","biscuit","bready","marshmallow","vanilla","sweet","honey"]) },
    { label: "Piney & resinous", emoji: "🌲", match: b => hasAny(b, ["pine","resin","herbal","floral"]) },
    { label: "Crisp & refreshing", emoji: "🍺", match: b => styleIs(b, ["lager","pilsner","pils","helles"]) || hasAny(b, ["crisp"]) },
    { label: "Light & sessionable", emoji: "🪶", match: b => (b.abv && b.abv <= 4.3) || styleIs(b, ["session"]) }
];

const selectedFlavours = new Set();

function renderFlavourChips() {
    const container = document.getElementById("flavour-chips");
    if (!container) return;
    container.innerHTML = FLAVOUR_CATEGORIES.map((cat, i) => `
        <button class="flavour-chip" data-flavour="${i}">
            <span>${cat.emoji}</span> ${cat.label}
        </button>`).join("");
}

// Toggle chips (delegated so it survives re-renders)
document.addEventListener("click", event => {
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
    document.querySelectorAll(".flavour-chip").forEach(chip => chip.classList.remove("active"));
    document.getElementById("find-results").innerHTML = "";
    document.getElementById("find-count").textContent = "";
}

function findByFlavour() {

    const resultsDiv = document.getElementById("find-results");
    const countEl = document.getElementById("find-count");

    if (selectedFlavours.size === 0) {
        resultsDiv.innerHTML = "<p class='searching'>Pick at least one flavour above 🍺</p>";
        countEl.textContent = "";
        return;
    }

    const chosen = [...selectedFlavours].map(i => FLAVOUR_CATEGORIES[i]);
    const matches = allBeers.filter(beer => chosen.every(cat => cat.match(beer)));

    if (matches.length === 0) {
        resultsDiv.innerHTML = "<p class='searching'>No beers match all those flavours — try fewer 😔</p>";
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
// Contact form — opens the visitor's email app addressed to us
// ---------------------------------------------------------------

const CONTACT_EMAIL = "hello@mybeerfinder.co.uk";

function sendMessage(event) {
    event.preventDefault();

    const name = document.getElementById("c-name").value.trim();
    const email = document.getElementById("c-email").value.trim();
    const message = document.getElementById("c-message").value.trim();

    const subject = `Beer Finder enquiry from ${name || "a visitor"}`;
    const body =
        `${message}\n\n— ${name}${email ? " (" + email + ")" : ""}`;

    // Static site (no server), so hand off to the visitor's email client,
    // pre-addressed to us with their message filled in.
    window.location.href =
        `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    document.getElementById("contact-status").textContent =
        `Opening your email app to send to ${CONTACT_EMAIL}… 🍻`;
}


// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------

loadBeerData();
