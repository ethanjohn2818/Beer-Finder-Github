# Beer Finder — notes for Claude

Static site (mybeerfinder.co.uk) hosted on **Cloudflare Pages** — publish dir
`public/`, no build step. All logic is client-side. Cloudflare auto-deploys
from `main`.

## The scrapers (run on Katie's laptop only)

The scrapers need a **visible, real Chrome** window to get past the shops' bot
detection, so they only run locally (VS Code terminal), never in the cloud.

- `npm run build` — Tesco, then Morrisons, then Sainsbury's; merges into
  `public/data/catalog.json`, writes `public/data/meta.json`, refreshes
  `hop-gaps.txt`, and pushes to `main`.
- Individual shops: `npm run catalog` (Tesco), `npm run morrisons`,
  `npm run sainsburys`.
- Morrisons puts every beer on one virtualised page (slow ~3-min harvest);
  Sainsbury's paginates (`?pageNumber=`), so its scraper walks the pages.
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
- `beers.json` — curated hop database.
- `hops.json` — per-hop flavour profiles.
- `breweries.json` — brewery → "Town, Country".
- `meta.json` — last-updated timestamp + per-shop counts (shown on Contact).
