# Shopping List App — Specification Sheet

## 1. Overview

A web app for creating and managing multiple shopping lists, with a built-in
grocery database, recipe support, and a dedicated "shopping mode" for use
in-store. V1 is local-only (browser storage, no login), but the data layer
should be structured so accounts/sync can be added later without a rewrite.

---

## 2. Storage & Architecture

**V1: local-only, account-ready.**

- All data (lists, recipes, custom items added to the database) is stored in
  the browser via `localStorage` (or `IndexedDB` if data volume warrants it —
  see note below).
- No login, no network calls, fully functional offline.
- **Structure for future accounts:** wrap all reads/writes behind a small
  data-access layer (e.g. `dataStore.getLists()`, `dataStore.saveList(list)`)
  rather than calling `localStorage` directly from components. This layer is
  the seam where a backend-synced implementation can be swapped in later
  without touching UI code. Each record (list, recipe, custom item) should
  have a stable `id` (UUID) and `updatedAt` timestamp now, even though
  nothing consumes them yet — this avoids a painful migration later when
  sync/conflict-resolution is added.
- Recommend `IndexedDB` over raw `localStorage` if the grocery database plus
  user lists/recipes is likely to be large or if you want structured queries
  (e.g. via a tiny wrapper like `idb`). `localStorage` is fine if the dataset
  stays small (a few hundred KB) — Claude Code can decide based on the size
  of the seeded grocery database.

---

## 3. Data Model

```
GroceryDBEntry {
  id: string
  name: string              // canonical display name, e.g. "Apple"
  matchTerms: string[]      // normalized forms for matching, e.g. ["apple", "apples"]
  category: string          // "produce" | "dairy" | "breakfast" | "meat" | "bakery" | "frozen" | "pantry" | ...
  emoji: string | null      // e.g. "🍎"
  isCustom: boolean         // true if user-added
}

ListItem {
  id: string
  dbEntryId: string | null  // reference into GroceryDBEntry, null if freeform/unmatched
  name: string              // display name (in case of freeform entry)
  quantity: number
  unit: Unit                // "count" | "cup" | "tbsp" | "tsp" | "oz" | "fl oz" | "lb" | "g" | "kg" | "pkg" | "other"
  checked: boolean          // used in shopping mode
  recipeId: string | null   // set if this item is nested under a recipe; null if standalone
}

RecipeInstance {
  id: string
  recipeDefId: string       // reference to the saved RecipeDefinition
  name: string
  items: ListItem[]         // ingredients, each with recipeId = this instance's id
}

RecipeDefinition {          // the reusable, saved recipe (library entry)
  id: string
  name: string
  ingredients: { dbEntryId: string | null, name: string, quantity: number, unit: Unit }[]
  createdAt: string
  updatedAt: string
}

ShoppingList {
  id: string
  name: string
  items: ListItem[]         // standalone items only
  recipes: RecipeInstance[]
  createdAt: string
  updatedAt: string
}
```

A list's full contents = `items` (standalone) + each `recipes[n].items`
(nested under that recipe). This separation keeps "flat merged view" (shopping
mode) and "structured view" (edit mode) both easy to derive from one model.

---

## 4. Core Features

### 4.1 Lists
- Create, rename, and delete lists from a home/lists screen.
- Each list is edited independently; switching lists is always available via
  a lists overview (name, item count, last-updated date).
- All edits autosave (no explicit "save" button) — write-through to storage
  on every change, debounced if needed for performance.

### 4.2 Grocery Database & Matching
- Ship a seed database of common grocery items (~150–300 entries is a
  reasonable v1 target) covering the listed categories: produce, dairy,
  breakfast, meat, bakery, frozen, pantry, etc.
- Each entry has a canonical name, a category, an emoji, and a `matchTerms`
  list including both singular and plural forms so "apple" and "apples"
  resolve to the same entry.
- Matching approach: normalize input (lowercase, trim, strip trailing "s"/"es"
  as a simple heuristic) and check against `matchTerms`. This doesn't need to
  be a full NLP stemmer — a small hardcoded irregular-plural map (e.g.
  "tomato"/"tomatoes", "loaf"/"loaves") covering the seed data is sufficient
  for v1.

### 4.3 Adding Items to a List
- Search/autocomplete input: as the user types, show matching database
  entries (name + category + emoji) in a dropdown, ranked by
  starts-with match first, then contains-match.
- Selecting a result adds it to the list with a default quantity of 1 and a
  sensible default unit (e.g. "count" for produce/whole items, "oz" or other
  common unit where it makes more sense — a per-category or per-item default
  unit is worth including in the `GroceryDBEntry` seed data).
- Quantity and unit are editable inline immediately after adding (or at any
  time later).
- **Custom items:** if no database match exists, the user can add the typed
  text as a freeform item. On confirm, prompt for a category (quick picker,
  defaulting to "Other") and save it into the database as a new
  `GroceryDBEntry` with `isCustom: true`, so it's searchable/autocompletable
  on future lists.

### 4.4 Item Display
- Each item row shows: emoji (or a generic placeholder icon if none),
  name, quantity + unit, and category (visible in edit mode; used for
  grouping in shopping mode).
- Items are deletable individually via a delete icon/swipe action.

### 4.5 Units of Measure
Support: `count`, `cup`, `tbsp`, `tsp`, `oz`, `fl oz`, `lb`, `g`, `kg`, `pkg`,
`other` (with a free-text label when "other" is chosen).

---

## 5. Recipes

### 5.1 Adding a Recipe to a List
- From within a list, "Add Recipe" prompts for a recipe name and enters
  **recipe-building mode**: a nested sub-context where added items attach to
  this recipe instead of the list's top level.
- Nesting is one layer deep only — recipes cannot contain sub-recipes.
- Visually, this should feel like the planner app's task → subtask nesting:
  the recipe appears as a collapsible header/card, with its ingredients
  indented beneath it.

### 5.2 Ending a Recipe
- An explicit **"End Recipe"** button closes recipe-building mode and returns
  to the list's main level.
- On ending, prompt the user: "Add another item" or "Start another recipe" —
  a lightweight two-button choice rather than a full modal, to keep the flow
  fast for people building a long list.

### 5.3 Saving & Reusing Recipes
- Every recipe built on a list is saved as a `RecipeDefinition` in a
  personal recipe library (name + ingredient list), independent of which
  list it was created on.
- From "Add Recipe," users can either build a new one or **choose from
  saved recipes** — selecting a saved recipe instantly adds a
  `RecipeInstance` (a copy of its ingredients) to the current list, fully
  populated, no re-entry needed.
- Editing a recipe's ingredients *within a specific list* only affects that
  list's instance, not the saved definition — avoids surprising the user by
  silently changing their library recipe. (A "save changes back to recipe"
  action can be a nice-to-have but isn't required for v1.)
- Recipe library is manageable from its own screen: view, rename, delete,
  or edit a saved recipe's ingredient list directly.

### 5.4 Deleting Recipes from a List
- A recipe (with all its nested items) can be deleted from a list as a
  single action, same as a standalone item. This removes the
  `RecipeInstance` from the list but never touches the saved
  `RecipeDefinition` in the library.

---

## 6. Shopping Mode

- A toggle (e.g. a prominent "Start Shopping" button) switches a list from
  **edit mode** to **shopping mode**.
- **Checking off items:** each item gets a tap/checkbox target; checked
  items are visually deprioritized (strikethrough, dimmed, or moved to a
  "checked" section at the bottom — recommend dimming + strikethrough in
  place so the store-layout grouping doesn't jump around as you shop).
- **Aisle/category grouping:** in shopping mode, items are grouped and
  sectioned by category (Produce, Dairy, Bakery, etc.) rather than shown in
  add-order or recipe structure. This is a shopping-mode-only view — edit
  mode keeps the list/recipe structure intact underneath.
- **Duplicate merging:** in shopping mode, items with the same
  `dbEntryId`/name and unit are merged into a single line with combined
  quantity, regardless of whether they came from standalone entries or
  different recipes (e.g. 1 standalone dozen eggs + 2 eggs from a recipe
  → "14 eggs" — note: this requires unit-aware merging or unit conversion
  for mismatched units like "2 eggs" vs "1 dozen eggs"; simplest v1 approach
  is to only auto-merge when units already match exactly, and show
  same-item-different-unit entries as adjacent but separate lines).
  Checking off a merged line checks off all its underlying items.
- Exiting shopping mode returns to the normal structured edit view, with
  checked state preserved (so re-entering shopping mode later resumes where
  you left off — useful for multi-trip or partially-completed lists).

---

## 7. Style Direction

**Mood:** clean, fast, tactile — this is a tool used one-handed in a store
aisle, so legibility and big tap targets matter more than density.

- **Layout:** minimal HTML/CSS-first, no heavy component framework required.
  Single-column, mobile-first layout (this app's primary use case is on a
  phone, in a store) that scales gracefully to desktop as a centered column.
- **Typography:** a clean system/sans stack for maximum legibility at a
  glance — e.g. `Inter` or `system-ui` for UI text and numbers. Slightly
  larger base font size than typical web apps (item names and quantities
  need to be readable at arm's length while pushing a cart).
- **Color palette:** warm, grocery-adjacent but not cartoonish —
  - Background: off-white / warm paper (`#FAF7F2`)
  - Primary accent: fresh green (`#3F7A5C` or similar) for actions,
    progress, and "add" affordances
  - Category color-coding (subtle, used as small left-border tags or section
    headers in shopping mode, not full-row backgrounds): produce = green,
    dairy = light blue, bakery = tan/amber, meat = red-brown, frozen = cool
    blue, pantry = mustard, breakfast = orange — muted/desaturated versions
    so it stays calm rather than rainbow-loud.
  - Checked items: desaturate to gray, strike through.
- **Iconography:** emoji for item images (v1), simple line icons (checkbox,
  trash, chevron for expand/collapse) for controls.
- **Motion:** minimal — a quick fade/slide when checking off items or
  expanding a recipe is enough; avoid anything that slows down rapid list
  editing.

---

## 8. Key Screens / Flows

1. **Lists Overview** — list of all shopping lists (name, item count, last
   edited), create-new button.
2. **List Edit View** — the main working view: standalone items + recipe
   cards (collapsible, nested ingredients), add-item search bar, add-recipe
   button, "Start Shopping" button.
3. **Recipe-Building Sub-view** — entered via "Add Recipe": name field,
   item search/add (same component as list-level), "End Recipe" button.
4. **Recipe Library** — saved recipes list, tap to view/edit ingredients or
   delete; "choose from saved" is reachable from here or inline from
   "Add Recipe."
5. **Shopping Mode View** — category-grouped, checkable, merged-quantity
   view of the current list; "Exit Shopping Mode" to return to edit view.

---

## 9. Explicitly Out of Scope for V1

- User accounts, login, multi-device sync (structured for, not built).
- Recipe quantity scaling (servings multiplier).
- Barcode scanning or receipt import.
- Sharing lists with other users/collaborative editing.
- Price tracking or store-specific aisle numbers (category grouping only,
  not a specific store's literal layout).

---

## 10. Notes for Claude Code

- Favor a small number of reusable components: `ItemRow`, `RecipeCard`,
  `AddItemSearch`, `ListCard` — the same `ItemRow` and `AddItemSearch`
  should work in both list-level and recipe-building contexts.
- Keep the grocery-database matching logic (normalization, plural handling,
  custom-item insertion) in one isolated module so it's easy to extend later
  (e.g. swapping in a real stemming library) without touching UI code.
- Seed data (grocery database + a few example categories) can start as a
  static JSON file bundled with the app, then get merged with any
  user-added custom entries in storage at runtime.
