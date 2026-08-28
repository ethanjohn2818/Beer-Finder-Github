# Beer Finder — notes for Claude

Static site (mybeerfinder.co.uk) hosted on **Cloudflare Pages** — publish dir
`public/`, no build step. All logic is client-side. Cloudflare auto-deploys
from `main`.

## The scrapers (run on Katie's laptop only)

The scrapers need a **visible, real Chrome** window to get past the shops' bot
detection, so they only run locally (VS Code terminal), never in the cloud.

- `npm run build` — Tesco, Morrisons, Sainsbury's, then Asda; merges into
  `public/data/catalog.json`, writes `public/data/meta.json`, refreshes
  `hop-gaps.txt`, and pushes to `main`.
- Individual shops: `npm run catalog` (Tesco), `npm run morrisons`,
  `npm run sainsburys`, `npm run asda`.
- Morrisons puts every beer on one virtualised page (slow ~3-min harvest).
  Sainsbury's and Asda both paginate (`?pageNumber=` / `?page=`), so their
  scrapers walk the pages, slow-scrolling each. Asda reuses the Morrisons
  browser tactic (real Chrome, close the cookie + delivery popups) with
  Sainsbury's page-walking — `scrapers/asda.js`.
- If `git pull` is blocked by local `catalog.json` changes: `git stash` then pull.

## The hop database — how beers get their flavour info

`public/data/beers.json` is the curated **beer → hops** database. When the
scraper finds a supermarket beer with no hop list, the site cross-references
this file (see `buildCatalogBeers` / `matchesBeer` in `public/beerlogic.js`)
and fills the hops in. `public/data/hops.json` holds the flavour profile for
each individual hop; every hop named in `beers.json` must have an entry here or
its detail page won't render a profile.

### Growing the hop database (Katie's workflow — remember this)

After each scrape, the build writes **`hop-gaps.txt`** (gitignored, local
only). It lists the *hop-forward* beers still missing hops (IPAs, pale ales,
lagers) with their shop links, and deliberately **skips** beers that
legitimately have no hop story — fruit beers, sours, stouts, porters, mixed
packs. Regenerate anytime with `npm run gaps`.

The loop: run the scrapers → open `hop-gaps.txt` → read the hop bill off each
can → hand the list to Claude to drop into `beers.json`. **Only add hops from a
real source (brewery page / can), never guess** — a wrong hop list poisons the
fill-in feature.

## Data files (`public/data/`)

- `catalog.json` — scraped supermarket listings (committed; the live data).
- `beers.json` — curated hop database (**hand-maintained**).
- `hops.json` — per-hop flavour profiles (**hand-maintained**; every hop named
  in `beers.json` needs an entry here).
- `breweries.json` — brewery → "Town, Country".
- `meta.json` — last-updated timestamp + per-shop counts (shown on Contact).

The only two files Katie edits by hand are `beers.json` and `hops.json`. The
scrapers/build write everything else.

## Deduplication / grouping (why the same beer stacks across shops)

`buildCatalogBeers` in `public/beerlogic.js` runs in the browser every load and
groups raw listings by an **identity** = brewery + distinctive words, ignoring
pack sizes, style words (`STYLE_SUFFIX`), and marketing fluff. Same identity →
one card with a per-shop toggle. This is automatic, but **rule-based**: a new
shop wording can split the same beer into two cards until a rule covers it.

The knobs, all in `beerlogic.js`:
- `NAME_ALIASES` — regex fixes for shop wording quirks ("Brew Dog"→"BrewDog",
  drop Elvis Juice's optional "Grapefruit", "Mix"→"Mixed", etc.).
- `STYLE_SUFFIX` — words stripped from a beer's identity (styles, packaging,
  place/brand words like "southwold"/"abbey"). KEEP flavour/strength words
  (double, triple, tropical, guava…) — those mark a *different* beer.
- `cleanName` strips pack sizes and stray counts ("x4"); `nameTokens`
  normalises "alcohol free"/"non alcoholic"/"low alcohol" → `af`.
When Katie reports duplicate cards, add a targeted rule here (usually one line)
rather than editing data. Verify by grouping the real `catalog.json` in Node and
checking nothing distinct gets wrongly merged.

## The site (all client-side in `public/`)

- `index.html` — single page; sections are "views" toggled by `script.js`
  (Search, beer detail, Find-by-flavour, Hops, Brewery, Gifts, About, Contact,
  Account, Leaderboard). Burger menu on the right; Search Beer button top-left.
- `script.js` — search/filter/sort, beer cards (shop + pack-size toggles,
  cheapest highlight), the **compare** feature (up to 4 beers), History-API
  routing (`VIEW_PATHS`/`PATH_VIEWS`; `_redirects` rewrites the real URLs
  `/find`, `/hops`, etc. to `index.html`), the 18+ age gate.
- `beerlogic.js` — grouping + hop matching (above).
- `style.css` — all styling; theme-aware (light/dark via `data-theme`).
- Real static pages (NOT SPA views): `privacy/`, `terms/`, and the **blog**
  (`blog/index.html`, one folder per post, `blog/_TEMPLATE/` to copy). SPA
  routing was unreliable for direct hits, so these are genuine files.
- Cache-busting: bump the `?v=YYYYMMDD<letter>` query on CSS/JS in the HTML
  whenever you change `style.css`/`script.js`/`beerlogic.js`/`auth.js` (it
  appears in several HTML files — bump them all together).

## Accounts, recommendations & leaderboard (Supabase)

`public/auth.js` + Supabase project `vccbkemmnjqjxmzycooy`. Passwordless sign-in
(magic-link + Google OAuth), a chosen username, and an "I've had this" button on
each beer. Tables `profiles` and `beers_had` (RLS: a user only reads/writes
their own rows). The keys in `auth.js` are the PUBLIC publishable keys — safe in
the browser. Two `security definer` RPCs power the leaderboard: `leaderboard`
(top beer hunters) and `popular_beers` (most-ticked beers). Beers are matched to
ticks by a stable `beerKey(brewery+name)`, so a delisted beer drops off the
chart. Leaderboard shows top 10 of each; if the signed-in user is outside the
top 10 hunters, an 11th "your position" tile is appended.

Katie-side setup (not code): Supabase Auth Site URL `https://mybeerfinder.co.uk`
+ redirect `https://mybeerfinder.co.uk/**`; Google provider configured. The
Google consent screen shows the `…supabase.co` domain on the free tier (that's
the login server) — removing it needs Supabase Pro Custom Domains.

## Ads / consent

Google AdSense (`ca-pub-6022289335915022`) + Google's certified consent tool
(GDPR). `/privacy` documents cookies/accounts; footer "Cookie settings" reopens
the consent choices via `googlefc.showRevocationMessage`. `ads.txt` and
`sitemap.xml`/`robots.txt` are in `public/`.

## Working agreement / deploy flow

- Develop on a feature branch, commit, push, then fast-forward `main` and push
  (`main` auto-deploys to Cloudflare). Katie's scraper runs also push to `main`,
  so fetch/rebase before pushing if it has moved.
- Only add hops from a real source (brewery page / can), never guess.
