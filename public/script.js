// A tidy on-brand placeholder for beers with no image (or a broken one), so a
// missing photo shows a little beer mug instead of the browser's broken-image
// icon. `var` (not const) so inline onerror handlers can see it as a global.
var NO_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>"
    + "<rect width='160' height='160' rx='18' fill='%23f8e4cc'/>"
    + "<rect x='54' y='50' width='42' height='62' rx='6' fill='%23f08c1b'/>"
    + "<rect x='54' y='50' width='42' height='18' rx='6' fill='%23f8cc9e'/>"
    + "<path d='M96 66h10a10 10 0 0 1 10 10v8a10 10 0 0 1-10 10h-10z' fill='none' stroke='%23f08c1b' stroke-width='6'/>"
    + "</svg>";


// ---------------------------------------------------------------
// Age gate (18+) — shown once, remembered in localStorage
// ---------------------------------------------------------------

function confirmAge() {
    try { localStorage.setItem("bf_age_ok", "1"); } catch (e) {}
    document.getElementById("age-gate").classList.add("hidden");
}


// ---------------------------------------------------------------
// Re-open the cookie/consent choices (Google's certified CMP)
// ---------------------------------------------------------------
// Google's consent tool (Funding Choices) reopens the consent choices via
// googlefc.showRevocationMessage(). We queue it through the CONSENT_API_READY
// callback so the click still works if the API hasn't finished loading yet.
function openCookieSettings() {
    window.googlefc = window.googlefc || {};
    window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
    window.googlefc.callbackQueue.push({
        CONSENT_API_READY: function () {
            if (typeof window.googlefc.showRevocationMessage === "function") {
                window.googlefc.showRevocationMessage();
            }
        }
    });
    // If the API is already live, fire it now too.
    try {
        if (window.googlefc && typeof window.googlefc.showRevocationMessage === "function") {
            window.googlefc.showRevocationMessage();
        }
    } catch (e) {}
}


// ---------------------------------------------------------------
// Dark / light theme toggle (persisted in localStorage)
// ---------------------------------------------------------------

function updateThemeIcon() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    // Show the mode you'll switch TO, in plain words.
    btn.textContent = dark ? "☀ Light mode" : "☾ Dark mode";
    btn.title = dark ? "Switch to light mode" : "Switch to dark mode";
}

function toggleTheme() {
    const el = document.documentElement;
    const dark = el.getAttribute("data-theme") === "dark";
    if (dark) {
        el.removeAttribute("data-theme");
        try { localStorage.setItem("bf_theme", "light"); } catch (e) {}
    } else {
        el.setAttribute("data-theme", "dark");
        try { localStorage.setItem("bf_theme", "dark"); } catch (e) {}
    }
    updateThemeIcon();
}

updateThemeIcon();

(function ageGate() {
    let ok = false;
    try { ok = localStorage.getItem("bf_age_ok") === "1"; } catch (e) {}
    if (!ok) document.getElementById("age-gate").classList.remove("hidden");
})();


// ---------------------------------------------------------------
// View switching (top nav)
// ---------------------------------------------------------------

// Top-level views that get their own real URL. (The beer "detail" view is a
// transient overlay — it keeps whatever URL you opened it from.)
const VIEW_PATHS = {
    search:  "/",
    find:    "/find",
    hops:    "/hops",
    brewery: "/brewery",
    partners: "/partners",
    gifts:   "/gifts",
    giftshop: "/gift-shop",
    about:   "/about",
    contact: "/contact",
    account: "/account",
    leaderboard: "/leaderboard"
};
const PATH_VIEWS = Object.fromEntries(
    Object.entries(VIEW_PATHS).map(([view, path]) => [path, view])
);

// Per-view <title> + meta description, so each URL reads as its own page to
// Google (the main SEO payoff of having separate URLs).
const VIEW_META = {
    search:  ["MyBeerFinder — Find craft beer by hop, brewery & flavour | UK supermarkets",
              "Find craft beer by hop, brewery or flavour and see where to buy it at UK supermarkets."],
    find:    ["Find Your Flavour | MyBeerFinder",
              "Pick the flavours you like and discover craft beers that match, with where to buy them."],
    hops:    ["Hop flavour profiles | MyBeerFinder",
              "Explore the hops behind UK craft beer and what each one tastes like — citrus, pine, tropical and more."],
    brewery: ["Breweries & where they're based | MyBeerFinder",
              "Browse craft breweries stocked at UK supermarkets, where each is based, and the beers we found."],
    partners: ["Partner breweries | MyBeerFinder",
              "The independent breweries we partner with — coming soon to MyBeerFinder."],
    gifts:   ["Beer gifts & glassware | MyBeerFinder",
              "Craft beer gift ideas — glassware, merch and gift sets for beer lovers."],
    giftshop: ["Gift shop (coming soon) | MyBeerFinder",
              "Our beer gift shop — glassware, gift sets and merch — is coming soon."],
    about:   ["About MyBeerFinder — how it works",
              "How MyBeerFinder helps you discover craft beer and what it tastes like, right down to the hops."],
    contact: ["Contact | MyBeerFinder",
              "Get in touch with MyBeerFinder."],
    account: ["Your account | MyBeerFinder",
              "Track the beers you like, get recommendations and climb the leaderboard."],
    leaderboard: ["Leaderboard | MyBeerFinder",
              "See who's tried the most craft beers on MyBeerFinder."]
};

function applyViewMeta(name) {
    const m = VIEW_META[name];
    if (!m) return;
    document.title = m[0];
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", m[1]);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute("href", "https://mybeerfinder.co.uk" + (VIEW_PATHS[name] || "/"));
}

function showView(name) {

    document.querySelectorAll(".view").forEach(view => {
        view.classList.add("hidden");
    });

    const target = document.getElementById(name + "-view");
    if (target) target.classList.remove("hidden");

    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.view === name);
    });

    if (VIEW_PATHS[name]) applyViewMeta(name);   // only for real routes

    // Account / leaderboard content is built by auth.js (loaded after this).
    if (name === "account" && typeof renderAccount === "function") renderAccount();
    if (name === "leaderboard" && typeof renderLeaderboard === "function") renderLeaderboard();

    window.scrollTo(0, 0);
}

// Switch view AND update the URL (adds a browser history entry).
function navigate(name) {
    const path = VIEW_PATHS[name];
    if (path && location.pathname !== path) {
        history.pushState({ view: name }, "", path);
    }
    showView(name);
}

// Show whichever view matches the current URL (first load + back/forward).
function routeFromUrl() {
    showView(PATH_VIEWS[location.pathname] || "search");
}
window.addEventListener("popstate", routeFromUrl);

// Wire up anything with a data-view attribute (nav links, brand, footer,
// in-page buttons). Real routes update the URL; the rest just switch view.
document.querySelectorAll("[data-view]").forEach(el => {
    el.addEventListener("click", event => {
        // Let ctrl/cmd/middle-click open the link in a new tab as normal.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
        event.preventDefault();
        const name = el.dataset.view;
        if (VIEW_PATHS[name]) navigate(name);
        else showView(name);
    });
});


// ---------------------------------------------------------------
// Burger menu (open/close the nav dropdown)
// ---------------------------------------------------------------
(function setupMenu() {
    const toggle = document.getElementById("navToggle");
    const menu = document.getElementById("navMenu");
    if (!toggle || !menu) return;

    function setOpen(open) {
        toggle.classList.toggle("open", open);
        menu.classList.toggle("open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }

    toggle.addEventListener("click", event => {
        event.stopPropagation();
        setOpen(!menu.classList.contains("open"));
    });

    // Close after picking a menu item.
    menu.addEventListener("click", () => setOpen(false));

    // Close when clicking outside the menu, or pressing Escape.
    document.addEventListener("click", event => {
        if (menu.classList.contains("open") &&
            !menu.contains(event.target) && !toggle.contains(event.target)) {
            setOpen(false);
        }
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") setOpen(false);
    });
})();


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

        // When the scrapers last ran (shown on the Contact page).
        const meta = await fetch("data/meta.json")
            .then(r => r.ok ? r.json() : null)
            .catch(() => null);
        renderLastUpdated(meta);

        let catalog = await fetch("data/catalog.json")
            .then(r => r.ok ? r.json() : [])
            .catch(() => []);
        if (!catalog.length) {
            catalog = await fetch("data/tesco-catalog.json")
                .then(r => r.ok ? r.json() : [])
                .catch(() => []);
        }

        allBeers = buildCatalogBeers(catalog, curated, Object.keys(rawBreweries));
        allBeers.forEach((b, i) => { b._id = i; });   // stable id for detail lookup

        initStoreFilters();
        renderTypeFilter();
        buildHopsList(allBeers);
        buildBreweryList(allBeers);
        renderFlavourChips();
        renderGifts();

        // Don't preload the whole catalogue — show a prompt and let the user
        // choose what to load (search, Show All Beers, etc.).
        const results = document.getElementById("results");
        if (results) results.innerHTML = promptEmptyState();

        // Then show whichever view the URL asks for (so a deep link or a
        // refresh on /hops, /brewery, etc. opens that page, not the homepage).
        routeFromUrl();

        // A ?q= in the URL (a shared search link, or Google's search box) runs
        // the search straight away.
        const q = new URLSearchParams(location.search).get("q");
        if (q) {
            const input = document.getElementById("hopInput");
            if (input) input.value = q;
            navigate("search");
            searchBeers();
        }

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
    setActiveQuickAction(null);   // a typed search isn't one of the "modes"
    applyFiltersAndRender();
}

// Highlight whichever quick-action "mode" is currently showing (or none), and
// flip its label from "Show all…" to "Showing all…" while it's active.
function setActiveQuickAction(id) {
    document.querySelectorAll(".quick-actions .qa-btn").forEach(b => {
        const on = !!id && b.id === id;
        b.classList.toggle("active", on);
        if (b.dataset.labelOn && b.dataset.labelOff) {
            b.textContent = on ? b.dataset.labelOn : b.dataset.labelOff;
        }
    });
}

// Show every (full-strength) beer — deliberately EXCLUDES alcohol-free, which
// has its own button.
function showAllBeers() {
    document.getElementById("hopInput").value = "";
    currentResults = allBeers.filter(b => !isAlcoholFree(b));
    setActiveQuickAction("qa-all");
    applyFiltersAndRender();
}

// Independent / partner breweries. PARTNER_BREWERIES is empty for now — when a
// brewery joins the Partners page, add its name here (or to the brewery's
// "independent" flag) and its beers start showing up under this button.
const PARTNER_BREWERIES = new Set([
    // e.g. "hopvale brewing co"  (lower-case, matched against beer.brewery)
]);
function isIndependentBrewery(beer) {
    return PARTNER_BREWERIES.has(String(beer.brewery || "").trim().toLowerCase());
}
function showIndependent() {
    document.getElementById("hopInput").value = "";
    setActiveQuickAction("qa-independent");
    currentResults = allBeers.filter(isIndependentBrewery);
    if (!currentResults.length) {
        document.getElementById("results").innerHTML =
            "<p class='searching'>We're signing up our first independent breweries — " +
            "their beers will appear here soon. See who we're talking to on the " +
            "<button class='link-btn' data-view='partners'>Partners</button> page.</p>";
        document.getElementById("results-count").textContent = "";
        return;
    }
    applyFiltersAndRender();
}

// A beer counts as alcohol-free at 0.5% ABV or below, or if its name/style
// says so ("alcohol free", "AF", "0.0%"). The %-match is anchored so it only
// catches a real 0/0.0/0.5, NOT the "0%" that appears inside "4.0%".
function isAlcoholFree(beer) {
    if (typeof beer.abv === "number" && beer.abv > 0 && beer.abv <= 0.5) return true;
    const text = `${beer.name} ${beer.style || ""}`.toLowerCase();
    return /alcohol[\s-]?free|non[\s-]?alcoholic|\baf\b|(?:^|[^\d.])0(?:\.[05])?\s*%/.test(text);
}

function showAlcoholFree() {
    document.getElementById("hopInput").value = "";
    currentResults = allBeers.filter(isAlcoholFree);
    setActiveQuickAction("qa-af");
    applyFiltersAndRender();
}

// A beer counts as gluten-free only if it's actually labelled so — we never
// infer it (a wrong "gluten-free" claim is a real safety issue).
function isGlutenFree(beer) {
    const text = `${beer.name} ${beer.style || ""} ${beer.description || ""}`.toLowerCase();
    return /gluten[\s-]?free|\bgf\b/.test(text);
}

function showGlutenFree() {
    document.getElementById("hopInput").value = "";
    setActiveQuickAction("qa-gf");
    currentResults = allBeers.filter(isGlutenFree);
    if (!currentResults.length) {
        document.getElementById("results").innerHTML =
            "<p class='searching'>No gluten-free beers in the listings right now — " +
            "we only show ones the shop labels gluten-free. Check back as the catalogue grows.</p>";
        document.getElementById("results-count").textContent = "";
        return;
    }
    applyFiltersAndRender();
}

function clearSearch() {
    document.getElementById("hopInput").value = "";
    currentResults = [];
    setActiveQuickAction(null);
    document.getElementById("results").innerHTML = promptEmptyState();
    document.getElementById("results-count").textContent = "";
}

// The friendly "nothing shown yet" prompt used on load and after Clear.
function promptEmptyState() {
    return "<p class='searching'>Search for a beer, hop or brewery above — " +
        "or tap <strong>Show All Beers</strong> to browse everything.</p>";
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
            <img id="img-${index}" src="${opt.image || NO_IMG}" alt="${beer.name}" loading="lazy" decoding="async"
                onerror="this.onerror=null;this.src=NO_IMG">
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
            <label class="compare-check" onclick="event.stopPropagation()">
                <input type="checkbox" data-cmp="${beer._id}"
                    ${compareIds.includes(beer._id) ? "checked" : ""}
                    onchange="toggleCompare(${beer._id})">
                <span>Compare</span>
            </label>
        </div>`;
}

function refreshCard(index) {
    const offers = cardData[index];
    const state = cardState[index];
    const store = offers[state.storeIndex];
    const opt = store.options[state.optIndex] || store.options[0];

    const img = document.getElementById("img-" + index);
    if (img) {
        img.onerror = function () { this.onerror = null; this.src = NO_IMG; };
        img.src = opt.image || NO_IMG;
    }
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

    // The compare checkbox shouldn't open the detail page.
    if (event.target.closest(".compare-check")) return;

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
// Compare up to 4 beers
// ---------------------------------------------------------------

let compareIds = [];   // beer._id values, in the order picked (max 4)
const COMPARE_MAX = 4;

// The cheapest single buy across every shop and pack size for a beer.
function cheapestBuy(beer) {
    let best = null;
    (beer.offers || []).forEach(offer => {
        (offer.options || []).forEach(opt => {
            const v = priceValue(opt.price);
            if (v > 0 && (!best || v < best.value)) {
                best = { value: v, price: opt.price, label: opt.label, supermarket: offer.supermarket };
            }
        });
    });
    return best;
}

// The beer's flavour profile: the three main flavours of EACH of its hops
// (same as the Hops page), combined and de-duplicated so a shared flavour
// (e.g. two hops that are both "Tropical") only shows once.
function beerHopFlavours(beer) {
    const seen = new Set();
    const out = [];
    (beer.hops || []).forEach(hop => {
        const profile = hopProfile(hop);
        (profile && profile.flavours ? profile.flavours.slice(0, 3) : []).forEach(f => {
            const key = f.toLowerCase();
            if (!seen.has(key)) { seen.add(key); out.push(f); }
        });
    });
    return out;
}

function toggleCompare(id) {
    id = Number(id);
    const at = compareIds.indexOf(id);
    if (at >= 0) {
        compareIds.splice(at, 1);
    } else if (compareIds.length >= COMPARE_MAX) {
        alert(`You can compare up to ${COMPARE_MAX} beers at once. Remove one first.`);
        syncCompareChecks();
        return;
    } else {
        compareIds.push(id);
    }
    syncCompareChecks();
    renderCompareBar();

    const modal = document.getElementById("compare-modal");
    if (modal && !modal.classList.contains("hidden")) {
        if (compareIds.length >= 2) openCompare();
        else closeCompare();
    }
}

// Make every card checkbox reflect the current selection.
function syncCompareChecks() {
    document.querySelectorAll("input[data-cmp]").forEach(cb => {
        cb.checked = compareIds.includes(Number(cb.dataset.cmp));
    });
}

function renderCompareBar() {
    const bar = document.getElementById("compare-bar");
    if (!bar) return;
    const count = document.getElementById("compare-count");
    const openBtn = document.getElementById("compare-open-btn");
    if (compareIds.length === 0) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    count.textContent = compareIds.length === 1
        ? "1 beer selected"
        : `${compareIds.length} beers selected`;
    openBtn.disabled = compareIds.length < 2;
}

function clearCompare() {
    compareIds = [];
    syncCompareChecks();
    renderCompareBar();
    closeCompare();
}

function compareColumn(beer, isBest) {
    const buy = cheapestBuy(beer);
    const flavours = beerHopFlavours(beer);
    const img = (beer.offers && beer.offers[0] && beer.offers[0].image) || "";
    return `
        <div class="compare-col${isBest ? " best" : ""}">
            ${isBest ? `<span class="compare-best-badge">👑 Cheapest</span>` : ""}
            <button class="compare-remove" onclick="toggleCompare(${beer._id})" aria-label="Remove">✕</button>
            ${img
                ? `<img src="${img}" alt="${beer.name}" loading="lazy">`
                : `<div class="compare-noimg">🍺</div>`}
            <h3>${beer.name}</h3>
            <p class="compare-sub">${beer.brewery || ""}${beer.abv ? " · " + beer.abv + "%" : ""}</p>
            <p class="compare-style">${beer.style || "Craft beer"}</p>
            ${buy
                ? `<p class="compare-price">💷 <strong>${cleanPrice(buy.price)}</strong>
                     <span class="compare-price-sub">${buy.label} · at ${buy.supermarket}</span></p>`
                : `<p class="compare-price">Price unavailable</p>`}
            <div class="compare-section">
                <p class="compare-label">Hops</p>
                ${beer.hops && beer.hops.length
                    ? `<p class="compare-hops">🌿 ${beer.hops.join(", ")}</p>`
                    : `<p class="compare-none">Not known yet</p>`}
            </div>
            <div class="compare-section">
                <p class="compare-label">Flavour</p>
                ${flavours.length ? tagRow(flavours) : `<p class="compare-none">—</p>`}
            </div>
        </div>`;
}

function openCompare() {
    if (compareIds.length < 2) return;
    const beers = compareIds
        .map(id => allBeers.find(b => b._id === id))
        .filter(Boolean);

    // Cheapest price among the compared beers, so we can crown the best value.
    let min = Infinity;
    beers.forEach(b => { const c = cheapestBuy(b); if (c && c.value < min) min = c.value; });

    const grid = document.getElementById("compare-grid");
    grid.innerHTML = beers.map(b => {
        const c = cheapestBuy(b);
        const isBest = c && min !== Infinity && c.value === min;
        return compareColumn(b, isBest);
    }).join("");
    document.getElementById("compare-modal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

function closeCompare() {
    const modal = document.getElementById("compare-modal");
    if (modal) modal.classList.add("hidden");
    document.body.style.overflow = "";
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeCompare();
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
// Rules-based "possible allergens" — a GUIDE ONLY. We don't hold the packaging
// data, so we infer the allergens a beer of this style usually contains from
// its style + name (+ a brewery description if one has been scraped). Always
// defers to the can. Covers the cereals-containing-gluten + milk allergens that
// are realistically inferable for beer.
function allergenInfo(beer) {
    const text = `${beer.name || ""} ${beer.style || ""} ${beer.description || ""}`.toLowerCase();
    if (isGlutenFree(beer)) {
        return { glutenFree: true, contains: [],
            note: "Labelled gluten-free — but always check the can, especially if you're coeliac." };
    }
    const contains = ["Barley (gluten)"];   // nearly all beer is malted barley
    if (/\bwheat\b|weisse|weizen|witbier|blanche|\bhefe|white ipa|\bwit\b/.test(text)) contains.push("Wheat (gluten)");
    if (/\boat(s|meal)?\b/.test(text)) contains.push("Oats (gluten)");
    if (/milk stout|milkshake|lactose|pastry|flat white|\blatte\b|cappuccino|mocha|smoothie/.test(text)) contains.push("Milk (lactose)");
    return { glutenFree: false, contains,
        note: "Typical for this style — recipes vary, so always check the can." };
}

function allergenSectionHtml(beer) {
    const a = allergenInfo(beer);
    const body = a.glutenFree
        ? `<p class="allergen-ok">✅ Brewed gluten-free</p>`
        : `<div class="allergen-tags">${a.contains.map(x => `<span class="allergen-tag">${x}</span>`).join("")}</div>`;
    return `
        <details class="detail-section allergen-box">
            <summary class="allergen-summary">Possible allergens</summary>
            <div class="allergen-body">
                ${body}
                <p class="allergen-note">${a.note} This is a guide from the beer's style — it is <strong>not</strong> the official ingredient list.</p>
            </div>
        </details>`;
}

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
                ${img ? `<img src="${img}" alt="${beer.name}" onerror="this.onerror=null;this.src=NO_IMG">` : `<div class="detail-noimg">🍺</div>`}
            </div>
            <div class="detail-body">
                <h1>${beer.name}</h1>
                ${beer.brewery
                    ? `<p class="detail-brewery">${beer.brewery}${breweryLocation(beer.brewery) ? ` <span class="detail-loc">📍 ${breweryLocation(beer.brewery)}</span>` : ""}</p>`
                    : ""}
                <p class="detail-style">${beer.style || "Craft beer"}${beer.abv ? " • " + beer.abv + "% ABV" : ""}</p>
                <p class="detail-desc">${describeBeer(beer)}</p>

                <div class="detail-actions">
                    ${typeof hadButtonHtml === "function" ? hadButtonHtml(beer) : ""}
                    <label class="compare-check detail-compare">
                        <input type="checkbox" data-cmp="${beer._id}"
                            ${compareIds.includes(beer._id) ? "checked" : ""}
                            onchange="toggleCompare(${beer._id})">
                        <span>Add to compare</span>
                    </label>
                </div>

                <div class="detail-section">
                    <h2>What it tastes like</h2>
                    ${tagRow(beerTasteTags(beer)) || "<p class='muted'>Taste notes coming soon.</p>"}
                </div>

                <div class="detail-section">
                    <h2>Hops <span class="muted">— and what each brings</span></h2>
                    <div class="hop-profiles">${hopsHtml}</div>
                </div>

                ${allergenSectionHtml(beer)}

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
    const countEl = document.getElementById("hops-count");
    let hops = Object.keys(hopMap).sort((a, b) => a.localeCompare(b));

    if (!hops.length) {
        if (countEl) countEl.textContent = "";
        container.innerHTML =
            "<p class='searching'>No beers available yet — build the catalogue with <code>npm run build</code>.</p>";
        return;
    }

    const total = hops.length;

    // Search by hop name OR by any of its flavour notes (from hops.json).
    const q = ((document.getElementById("hopSearch") || {}).value || "")
        .trim().toLowerCase();
    if (q) {
        hops = hops.filter(hop => {
            if (hop.toLowerCase().includes(q)) return true;
            const p = hopProfile(hop);
            return p && (p.flavours || []).some(f => f.toLowerCase().includes(q));
        });
    }

    if (countEl) {
        if (q) countEl.textContent = hops.length
            ? `${hops.length} ${hops.length === 1 ? "hop" : "hops"} matching “${q}”`
            : "";
        else countEl.textContent = `${total} ${total === 1 ? "hop" : "hops"}`;
    }
    if (q && !hops.length) {
        container.innerHTML =
            `<p class="searching">No hops match “${q}”. Try a hop name or a flavour like “citrus” or “pine”.</p>`;
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
    const countEl = document.getElementById("brewery-count");
    let breweries = Object.keys(breweryMap);

    if (!breweries.length) {
        if (countEl) countEl.textContent = "";
        container.innerHTML =
            "<p class='searching'>No beers available yet — build the catalogue with <code>npm run build</code>.</p>";
        return;
    }

    const total = breweries.length;

    // Search by brewery name OR by town/city/country (from breweries.json).
    const q = ((document.getElementById("brewerySearch") || {}).value || "")
        .trim().toLowerCase();
    if (q) {
        breweries = breweries.filter(b =>
            b.toLowerCase().includes(q) ||
            breweryLocation(b).toLowerCase().includes(q)
        );
    }

    // Sort as chosen in the brewery-page control.
    const sort = (document.getElementById("brewerySort") || {}).value || "az";
    if (sort === "az") breweries.sort((a, b) => a.localeCompare(b));
    else if (sort === "za") breweries.sort((a, b) => b.localeCompare(a));
    else if (sort === "most") breweries.sort((a, b) => breweryMap[b].length - breweryMap[a].length || a.localeCompare(b));
    else if (sort === "fewest") breweries.sort((a, b) => breweryMap[a].length - breweryMap[b].length || a.localeCompare(b));

    // Result count / no-matches message.
    if (countEl) {
        if (q) countEl.textContent = breweries.length
            ? `${breweries.length} ${breweries.length === 1 ? "brewery" : "breweries"} matching “${q}”`
            : "";
        else countEl.textContent = `${total} ${total === 1 ? "brewery" : "breweries"}`;
    }
    if (q && !breweries.length) {
        container.innerHTML =
            `<p class="searching">No breweries match “${q}”. Try a brewery name or a town/city.</p>`;
        return;
    }

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

// Clear the hop search box and rebuild the full list.
function clearHopSearch() {
    const input = document.getElementById("hopSearch");
    if (input) input.value = "";
    buildHopsList(allBeers);
}

// Clear the brewery search box and rebuild the full list.
function clearBrewerySearch() {
    const input = document.getElementById("brewerySearch");
    if (input) input.value = "";
    buildBreweryList(allBeers);
}

// Jump to the search page showing just this brewery's beers.
function showBreweryBeers(brewery) {
    currentResults = allBeers.filter(b => (b.brewery || "") === brewery);
    document.getElementById("hopInput").value = "";
    navigate("search");            // land on the homepage URL, filtered
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
    { label: "Alcohol-free",    match: b => isAlcoholFree(b) },
    { label: "Gluten-free",     match: b => isGlutenFree(b) }
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
// Find your flavour — interactive flavour chips (tap to toggle)
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
    el.innerHTML = GIFTS.map((g, i) => `
        <div class="gift-card">
            <span class="gift-soon">Coming soon</span>
            <div class="gift-emoji">${g.emoji}</div>
            <h3>${g.title}</h3>
            <p>${g.desc}</p>
            <button class="buy-btn" onclick="openGiftShop(${i})">${g.cta}</button>
        </div>
    `).join("");
}

// A gift category was tapped — show the (coming-soon) gift shop, named for it.
function openGiftShop(index) {
    const g = GIFTS[index];
    const title = document.getElementById("giftshop-title");
    const copy = document.getElementById("giftshop-copy");
    if (g && title) title.textContent = g.title + " — coming soon";
    if (g && copy) {
        copy.innerHTML = `We're getting <strong>${g.title.toLowerCase()}</strong> ready for the shop.
            This part isn't quite live yet — check back soon and it'll be here.`;
    }
    navigate("giftshop");
}


// ---------------------------------------------------------------
// Contact form — opens the visitor's email app addressed to us
// ---------------------------------------------------------------

const CONTACT_EMAIL = "hello@mybeerfinder.co.uk";

// Show when the scrapers last ran, at the foot of the Contact page.
function renderLastUpdated(meta) {
    const el = document.getElementById("last-updated");
    if (!el) return;
    if (!meta || !meta.lastUpdated) { el.textContent = ""; return; }
    const when = new Date(meta.lastUpdated);
    const nice = when.toLocaleString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit"
    });
    const count = meta.total ? ` · ${meta.total} products` : "";
    el.textContent = `Beer list last updated: ${nice}${count}`;
}


function sendMessage(event) {
    event.preventDefault();

    const name = document.getElementById("c-name").value.trim();
    const email = document.getElementById("c-email").value.trim();
    const message = document.getElementById("c-message").value.trim();

    const subject = `MyBeerFinder enquiry from ${name || "a visitor"}`;
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
