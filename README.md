# Shopping List

A web app for building and managing multiple shopping lists, with a built-in
grocery database, reusable recipes, and a dedicated shopping mode for use
in-store. All data lives in the browser — no login, no network calls, works
offline.

Built to the spec in `docs/spec.md`.

## Running it

There is no build step and no dependencies. It's ES modules, so it needs to be
served over HTTP rather than opened as a `file://` URL:

```bash
npm start          # python3 -m http.server 8080
# then open http://localhost:8080
```

Any static server works (`npx http-server`, `php -S`, nginx, GitHub Pages…).

```bash
npm test           # 65 tests over the DOM-free core, via node:test — no dependencies

npm start             # then, with the server up and Playwright installed:
npm run test:e2e      # 13-step browser walkthrough of the main flows

npm run sync-server   # mock backend on :8787, then:
npm run test:sharing  # 9-step two-browser sharing walkthrough
```

The sharing tests run two independent browser contexts — separate storage, so
genuinely two "phones" — against a mock backend that implements the same
last-write-wins rules as `db/schema.sql`. No Supabase account needed.

### Single-file build

For hosts that can't serve a directory of ES modules (a strict CSP, an email
attachment, a single-file upload):

```bash
npm run build      # → dist/shopping-list.html, everything inlined
```

The output is one ~125 KB file with no external requests. Because it puts every
module in one scope, the build fails loudly if two modules declare the same
top-level name. Its script payload is `\uXXXX`-escaped, so emoji and symbols
survive hosts that don't send `charset=utf-8`.

`npm run test:e2e` can be pointed at the bundle to confirm it behaves
identically:

```bash
APP_URL=http://localhost:8080/dist/shopping-list.html npm run test:e2e
```

## What it does

**Lists** — create, rename, and delete lists. Every edit autosaves; there's no
save button. The overview shows item counts, last-edited dates, and partial
shopping progress for lists you're midway through.

**Grocery database** — 322 seeded items across 12 aisles, each with an emoji, a
category, and a sensible default unit (ground beef defaults to `lb`, apples to
`count`). Autocomplete ranks starts-with matches above contains-matches, and
resolves plurals and synonyms: `apples` → Apple, `scallions` → Green Onion,
`garbanzo beans` → Chickpeas.

**Custom items** — type something the database doesn't know, pick an aisle, and
it's saved as a database entry of your own. It autocompletes on every future
list.

**Recipes** — "Add recipe" opens a nested building mode where items attach to
the recipe instead of the list top level; the recipe shows as a collapsible
card with its ingredients indented beneath. Ending a recipe saves it to a
personal library, so you can drop the whole ingredient list onto any future
list in one tap. Editing a recipe on a list only changes that list's copy — the
library definition is left alone, and vice versa.

**Shared lists** — optional, off until configured. Share a list by link and
two phones stay in sync, including check-offs while you're both in the store.
Local-first: every edit saves instantly and uploads in the background, so bad
signal in a store never blocks you. Set it up in about ten minutes —
see [docs/sharing-setup.md](docs/sharing-setup.md).

**Shopping mode** — regroups the list by aisle instead of by recipe, merges
duplicates across recipes and standalone items into single lines (1 dozen eggs
+ 2 eggs from a recipe → 14 eggs), and gives every line a big tap target.
Checking a merged line checks off everything behind it. Checked state survives
leaving and re-entering, so a multi-trip list picks up where you left off.

## Architecture

```
index.html          shell
styles.css          all styles (mobile-first, ~600 lines)
src/
  app.js            entry point: storage → state → render
  config.js         Supabase URL + key; blank means local-only
  core/             DOM-free logic, unit-tested
    dataStore.js      data-access layer — the only module that touches localStorage
    sync/
      merge.js        conflict resolution — per record, last write wins
      syncEngine.js   pull → merge → push, with backoff and offline handling
      transport.js    the only module that touches the network
    groceryDb.js      matching, ranking, custom-entry creation
    model.js          record factories + the shopping-mode merge/grouping view
    text.js           normalization, singular/plural handling
    categories.js     aisles, colours, aisle walk order
    units.js          units of measure and quantity formatting
    id.js             UUIDs + timestamps
  data/
    groceryData.js    the 322-item seed database
  ui/
    actions.js        every mutation the UI can perform
    state.js          transient UI state + render scheduling
    router.js         hash routing
    dom.js            element helper + focus preservation
    modal.js          promise-based sheets (prompt/confirm/choose/pick-category)
    sharing.js        share + join flows, sync status badge
    components/       ItemRow, RecipeCard, AddItemSearch, ListCard
    screens/          lists, list edit, shopping, recipe library
db/schema.sql       Supabase tables, RPCs, and lockdown
tests/              core, merge, and sync-engine tests
tools/              single-file build, mock sync server, browser walkthroughs
```

Two conventions matter:

**Nothing outside `core/dataStore.js` touches `localStorage`.** Components call
`actions.*`, which call `dataStore.*`. The store's API is async and its records
already carry `id` and `updatedAt`, so swapping in a backend-synced
implementation later is a change to one file — no UI code moves, and there's no
migration to write when conflict resolution arrives.

**Matching logic is isolated in `core/text.js` + `core/groceryDb.js`.** The
plural handling is a rules-plus-irregulars heuristic, not a real stemmer;
replacing it with a proper stemming or fuzzy-search library means editing those
two files and nothing else.

Rendering is a full re-render of the current screen on every state change,
which keeps the data flow trivial to follow. `dom.js` captures and restores
focus and caret position around each render, so typing in a search box or
quantity field is unaffected.

### Storage choice

`localStorage`, not IndexedDB. The seed database ships as a bundled JS module
and is never written to storage — only your lists, recipes, and custom items
are persisted, which is a few KB for realistic use. If that changes (photos,
long history, structured queries), `dataStore.js` is the one file that has to
change.

### How sync stays correct

Three decisions carry most of the weight:

**Records merge individually, not whole lists.** Each item is its own row with
its own timestamp, so two people checking off different things is not a
conflict — both survive. Merging whole lists would force one of you to lose.

**Deletes leave tombstones.** A deleted record is kept, invisible, for 30 days.
Without that, the other phone's stale copy pushes the item straight back — the
classic sync bug, and the one `tests/sync.test.js` guards hardest.

**A record the server has never seen is an addition, not a deletion.** Getting
that backwards silently eats anything added while offline.

Merging is order-independent: whoever syncs first, both devices converge on the
same state. There's a test for exactly that.

## Deviations from the spec

Two fields were added to the documented model:

- `GroceryDBEntry.defaultUnit` — §4.3 asks for per-item/per-category default
  units, but the §3 model listing doesn't include a field for them.
- `ListItem.unitLabel` — §4.5 requires a free-text label when the unit is
  `other`; there was nowhere to store it.

Categories were extended past the listed set with `seafood`, `beverages`,
`snacks`, `household`, and `other` (§4.2 ends its list with "etc.").

## Scope changes since v1

§9 of the spec deferred list sharing and multi-device sync. Both are now built
(opt-in, off by default) at the user's request — the `dataStore` seam from §2 is
what made it a contained change rather than a rewrite.

Still out of scope: user accounts, recipe quantity scaling, barcode scanning,
price tracking, and store-specific aisle numbers.
