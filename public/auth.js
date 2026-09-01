// ---------------------------------------------------------------
// User accounts (Supabase): sign in, "beers I like",
// recommendations and the leaderboard.
//
// The Supabase client is loaded from the CDN in index.html. The keys below
// are the PUBLIC (publishable) keys, safe to ship in the browser; the
// database is protected by Row Level Security so a signed-in user can only
// ever read/write their own beers.
// ---------------------------------------------------------------

const SB_URL = "https://xbjsmbnpcdtohutsofvg.supabase.co";
const SB_KEY = "sb_publishable_2aRwmfSIeXzkDggu5x09qw_i_j4rT4s";

let sb = null;
let authUser = null;        // the logged-in auth user (has .email)
let profile = null;         // { id, username }
let hadKeys = new Set();    // beer_key values this user has ticked

// A stable key for a beer, independent of catalogue rebuilds.
function beerKey(beer) {
    return ((beer.brewery || "") + " " + (beer.name || ""))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function initAuth() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
        console.warn("Supabase client not loaded, accounts disabled.");
        return;
    }
    sb = window.supabase.createClient(SB_URL, SB_KEY);

    sb.auth.onAuthStateChange((_event, session) => {
        authUser = session ? session.user : null;
        onAuthChanged();
    });
    sb.auth.getSession().then(({ data }) => {
        authUser = data && data.session ? data.session.user : null;
        onAuthChanged();
    });
}

async function onAuthChanged() {
    if (authUser) {
        await loadProfile();
        await loadHadBeers();
        if (!profile) openUsernameModal();      // first login → pick a username
    } else {
        profile = null;
        hadKeys = new Set();
    }
    updateAccountUI();
    refreshHadButtons();
    if (currentView() === "account") renderAccount();
    if (currentView() === "leaderboard") renderLeaderboard();
}

async function loadProfile() {
    const { data } = await sb.from("profiles")
        .select("id, username").eq("id", authUser.id).maybeSingle();
    profile = data || null;
}

async function loadHadBeers() {
    const { data } = await sb.from("beers_had")
        .select("beer_key").eq("user_id", authUser.id);
    hadKeys = new Set((data || []).map(r => r.beer_key));
}


// ---- Sign in / out --------------------------------------------

async function signInWithEmail() {
    const input = document.getElementById("auth-email");
    const email = (input ? input.value : "").trim();
    const msg = document.getElementById("auth-msg");
    if (!email) { if (msg) msg.textContent = "Enter your email first."; return; }
    if (!sb) return;
    const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + "/account" }
    });
    if (msg) msg.textContent = error
        ? ("Couldn't send the link: " + error.message)
        : "✅ Check your email for a login link (it may take a minute).";
}

async function signInWithGoogle() {
    if (!sb) return;
    await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + "/account" }
    });
}

async function signOut() {
    if (sb) await sb.auth.signOut();
}


// ---- Username --------------------------------------------------

function openUsernameModal() {
    const m = document.getElementById("username-modal");
    if (m) m.classList.remove("hidden");
}
function closeUsernameModal() {
    const m = document.getElementById("username-modal");
    if (m) m.classList.add("hidden");
}

async function saveUsername() {
    const input = document.getElementById("username-input");
    const msg = document.getElementById("username-msg");
    const name = (input ? input.value : "").trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) {
        if (msg) msg.textContent = "3–20 letters, numbers or underscores.";
        return;
    }
    const { error } = await sb.from("profiles")
        .insert({ id: authUser.id, username: name });
    if (error) {
        if (msg) msg.textContent = /duplicate|unique/i.test(error.message)
            ? "That username is taken, try another."
            : ("Couldn't save: " + error.message);
        return;
    }
    profile = { id: authUser.id, username: name };
    closeUsernameModal();
    updateAccountUI();
    if (currentView() === "account") renderAccount();
}


// ---- "I liked this" --------------------------------------------

function hasHad(beer) { return hadKeys.has(beerKey(beer)); }

async function toggleHad(beerId) {
    const beer = allBeers.find(b => b._id === Number(beerId));
    if (!beer) return;
    if (!authUser) { navigate("account"); return; }   // send them to sign in
    if (!profile) { openUsernameModal(); return; }

    const key = beerKey(beer);
    if (hadKeys.has(key)) {
        await sb.from("beers_had").delete()
            .eq("user_id", authUser.id).eq("beer_key", key);
        hadKeys.delete(key);
    } else {
        await sb.from("beers_had").insert({
            user_id: authUser.id, beer_key: key, beer_name: beer.name
        });
        hadKeys.add(key);
    }
    refreshHadButtons();
    if (currentView() === "account") renderAccount();
}

// Update every "I liked this" button currently on screen.
function refreshHadButtons() {
    document.querySelectorAll("[data-had]").forEach(btn => {
        const beer = allBeers.find(b => b._id === Number(btn.dataset.had));
        if (!beer) return;
        const had = hasHad(beer);
        btn.classList.toggle("on", had);
        btn.innerHTML = had ? "✅ You liked this" : "🍺 I liked this";
    });
}

// The button markup for the detail page.
function hadButtonHtml(beer) {
    const had = hasHad(beer);
    return `<button class="had-btn${had ? " on" : ""}" data-had="${beer._id}"
        onclick="toggleHad(${beer._id})">${had ? "✅ You liked this" : "🍺 I liked this"}</button>`;
}


// ---- Recommendations (from what you like) ----------------------

function myHadBeers() {
    return allBeers.filter(b => hadKeys.has(beerKey(b)));
}

function recommendBeers(limit) {
    limit = limit || 12;
    const had = myHadBeers();
    if (!had.length) return [];

    // Count how often each hop / flavour appears in beers you like.
    const weight = {};
    const bump = (arr) => (arr || []).forEach(x => {
        const k = x.toLowerCase(); weight[k] = (weight[k] || 0) + 1;
    });
    had.forEach(b => { bump(b.hops); bump(b.flavours); });

    // Score every beer you HAVEN'T had by shared hops/flavours.
    const scored = [];
    for (const b of allBeers) {
        if (hadKeys.has(beerKey(b))) continue;
        if (!(b.hops || []).length && !(b.flavours || []).length) continue;
        let score = 0;
        [...(b.hops || []), ...(b.flavours || [])].forEach(x => {
            score += weight[x.toLowerCase()] || 0;
        });
        if (score > 0) scored.push({ beer: b, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.beer);
}


// ---- Leaderboard ----------------------------------------------

async function fetchLeaderboard() {
    if (!sb) return [];
    const { data, error } = await sb.rpc("leaderboard", { lim: 100 });
    if (error) { console.warn("leaderboard error", error.message); return []; }
    return data || [];
}

async function fetchPopularBeers() {
    if (!sb) return [];
    const { data, error } = await sb.rpc("popular_beers", { lim: 40 });
    if (error) { console.warn("popular_beers error", error.message); return []; }
    return data || [];
}

async function fetchUserCount() {
    if (!sb) return null;
    const { count, error } = await sb.from("profiles")
        .select("id", { count: "exact", head: true });
    if (error) { console.warn("user count error", error.message); return null; }
    return count;
}

// Show the total number of signed-up users at the foot of the Contact page.
async function renderUserCount() {
    const el = document.getElementById("user-count-line");
    if (!el) return;
    const count = await fetchUserCount();
    el.textContent = count != null ? `${count} users signed up` : "";
}


// ---- Views / UI -----------------------------------------------

function updateAccountUI() {
    const label = document.getElementById("account-label");
    if (label) label.textContent = profile ? profile.username : "Account";
}

function renderAccount() {
    const el = document.getElementById("account-body");
    if (!el) return;

    if (!authUser) {
        el.innerHTML = `
            <div class="auth-card">
                <h2>Sign in / create an account</h2>
                <p class="muted">Track the beers you like, get recommendations, and climb the leaderboard.</p>
                <input id="auth-email" type="email" placeholder="you@email.com" autocomplete="email">
                <button class="primary-btn" onclick="signInWithEmail()">✉️ Email me a login link</button>
                <div class="auth-or"><span>or</span></div>
                <button class="google-btn" onclick="signInWithGoogle()">Continue with Google</button>
                <p id="auth-msg" class="auth-msg"></p>
                <p class="muted small">No password needed. We only use your email to log you in and (if you opt in later) to send occasional updates.</p>
            </div>`;
        return;
    }

    if (!profile) { openUsernameModal(); }

    const mine = myHadBeers().sort((a, b) => a.name.localeCompare(b.name));
    const recs = recommendBeers(12);

    el.innerHTML = `
        <div class="account-head">
            <div>
                <h2>Hi, ${profile ? profile.username : "there"} 👋</h2>
                <p class="muted">You've logged <strong>${mine.length}</strong> beer${mine.length === 1 ? "" : "s"}.</p>
            </div>
            <button class="ghost-btn" onclick="signOut()">Sign out</button>
        </div>

        <h3>Recommended for you</h3>
        ${recs.length
            ? `<div id="account-recs">${recs.map((b, i) => renderCard({ beer: b, offers: b.offers }, 90000 + i)).join("")}</div>`
            : `<p class="muted">Tick a few beers as "had" and we'll recommend more based on their hops and flavours.</p>`}

        <h3>Beers you like</h3>
        ${mine.length
            ? `<ul class="had-list">${mine.map(b => `<li>${b.name}${b.brewery ? ' <span class="muted">· ' + b.brewery + '</span>' : ""}</li>`).join("")}</ul>`
            : `<p class="muted">None yet. Open a beer and tap "I liked this".</p>`}`;
}

async function renderLeaderboard() {
    const el = document.getElementById("leaderboard-body");
    if (!el) return;
    el.innerHTML = `<p class="muted">Loading…</p>`;

    // Map every beer currently on the site by its stable key, so a beer that's
    // been delisted simply drops out of the chart and the rest move up.
    const byKey = {};
    (allBeers || []).forEach(b => { byKey[beerKey(b)] = b; });

    const [popularRaw, users] = await Promise.all([fetchPopularBeers(), fetchLeaderboard()]);
    const popular = popularRaw
        .map(r => ({ beer: byKey[r.beer_key], ticks: r.ticks }))
        .filter(x => x.beer)          // keep only beers still on the site
        .slice(0, 10);                // top 10

    const me = profile ? profile.username : null;

    // Order the hunters by beers tried (stable sort keeps the server's tie-break),
    // work out where I sit, then take the top 10.
    const ranked = (users || []).slice()
        .sort((a, b) => (b.beer_count || 0) - (a.beer_count || 0));
    const myRank = me ? (ranked.findIndex(r => r.username === me) + 1) : 0; // 0 = not ranked
    const topUsers = ranked.slice(0, 10);

    // A single hunter row.
    const userRow = (r, rank) => `
        <li class="${r.username === me ? "is-me" : ""}">
            <span class="lb-rank">${rank}</span>
            <span class="lb-name">${r.username}${r.username === me ? " (you)" : ""}</span>
            <span class="lb-count">${r.beer_count} 🍺</span>
        </li>`;

    // If I'm signed in but outside the top 10, add a divider + my own position.
    const myTile = (myRank > 10)
        ? `<li class="lb-divider" aria-hidden="true"><span>⋯</span></li>
           ${userRow(ranked[myRank - 1], myRank)}`
        : "";

    el.innerHTML = `
        <h2>🏆 Top beer hunters</h2>
        <p class="muted small">Who's tried the most beers.</p>
        ${topUsers.length
            ? `<ol class="leaderboard">
                ${topUsers.map((r, i) => userRow(r, i + 1)).join("")}
                ${myTile}
               </ol>`
            : `<p class="muted">No one's on the board yet, sign in and start ticking beers.</p>`}

        <h2 style="margin-top:32px">🍺 Most-loved beers</h2>
        <p class="muted small">The beers ticked "had" by the most people right now.</p>
        ${popular.length
            ? `<ol class="leaderboard">
                ${popular.map((x, i) => `
                    <li class="beer-lb" onclick="openBeerDetail(${x.beer._id})">
                        <span class="lb-rank">${i + 1}</span>
                        <span class="lb-name">${x.beer.name}<span class="muted">, ${x.beer.brewery || ""}</span></span>
                        <span class="lb-count">${x.ticks} 🍺</span>
                    </li>`).join("")}
               </ol>`
            : `<p class="muted">No beers ticked yet, be the first! Open a beer and tap "I liked this".</p>`}`;
}

// Boot once the page + Supabase client are ready.
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAuth);
} else {
    initAuth();
}
