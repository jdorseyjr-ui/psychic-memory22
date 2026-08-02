# Setting up shared lists

Three steps, about ten minutes, all free. At the end you and one other person
see the same list on two phones, with check-offs syncing live.

Until you do this, the app runs exactly as it did before: fully local, fully
offline, no share button anywhere.

---

## 1. Create a Supabase project

1. Sign up at [supabase.com](https://supabase.com) — the free tier is far more
   than two people need.
2. Create a new project. Pick a region near you; the database password is one
   you'll never need again, so let it generate one.
3. Wait for it to finish provisioning (a minute or two).

## 2. Run the schema

1. In your project, open **SQL Editor** → **New query**.
2. Paste the entire contents of [`db/schema.sql`](../db/schema.sql) and hit
   **Run**.
3. It should report success with no rows. Running it twice is safe.

This creates three tables and three functions, and locks the tables down —
see the security note below.

## 3. Paste two values into the app

1. In Supabase: **Project Settings** → **API**.
2. Copy the **Project URL** and the **anon public** key.
3. Put them in [`src/config.js`](../src/config.js):

```js
export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

Commit and push. That's it — every list now has a **Share** button.

---

## Using it

- **Share a list.** Open the list, tap the share icon, confirm. You get a link;
  it's copied to your clipboard automatically.
- **Join a list.** The other person opens the link on their phone. The list
  appears and stays in sync from then on.
- **Both shop at once.** Both open shopping mode. Check-offs appear on the
  other phone within a couple of seconds.

The badge under the list name tells you where you stand: *Shared · up to date*,
*Syncing…*, or *Offline — changes saved here*.

### Add it to your home screen

On iPhone: open the site in Safari → Share → **Add to Home Screen**. It then
opens full-screen like an app, which is what you want while pushing a cart.

---

## How it behaves when things go wrong

**No signal in the store.** Everything keeps working. Edits save locally and
upload when signal returns — the badge shows *Offline* meanwhile. This is the
normal case in a grocery store, and it's designed for, not patched around.

**You both edit at once.** Different items never conflict — they're separate
rows, and both edits survive. The same item edited on both phones resolves to
whichever edit happened later.

**You both check off the same thing.** It ends up checked. Either answer was
right.

**Someone deletes something.** The deletion wins, and stays won. Deleted
records are kept as invisible tombstones for 30 days so the other phone can't
push the item back; after that they're cleaned up.

**A link stops working.** Your local copy is never destroyed by a sync failure.
Worst case the list stops syncing and stays on your phone.

---

## Security, plainly

The anon key sits in the client where anyone can read it. That's how Supabase
is designed — but it means the key must not be what grants access, so it isn't:

- Row-level security is **on** for all three tables, with **no policies**.
  Direct table access is denied to everyone, including the anon key.
- All access goes through three `SECURITY DEFINER` functions, each of which
  requires the list's **share code**.
- A share code is 128 bits of randomness. Guessing one is not feasible.

So the share link is the credential. **Treat it like a house key**: anyone who
has it can read and edit that one list — and nothing else, not your other
lists, not anyone else's.

If a link leaks, there's no revoke button in v1. The workaround is to create a
new list and share that instead. Say the word if you want proper revocation.

---

## Developing without Supabase

There's a mock server implementing the same three functions in memory:

```bash
npm start           # app on :8080
npm run sync-server # mock backend on :8787
npm run test:sharing  # two-browser sharing walkthrough
```

The mock is what the automated sharing tests run against, so they need no
network and no account.

---

## What's deliberately not built

- **Revoking or rotating a share link.**
- **More than two people.** Nothing stops it — the design is n-way — but it's
  only been tested with two.
- **Sharing your recipe library.** Only shopping lists sync; saved recipes
  stay per-device. A recipe *added to a shared list* syncs fine, ingredients
  and all — it's the library itself that doesn't.
- **Sharing your custom grocery entries.** A custom item added to a shared
  list reaches the other phone with its name, quantity, and correct aisle, but
  it won't appear in their autocomplete for future lists.
- **Realtime push.** The app polls (every 2.5s in shopping mode, 12s
  otherwise). Supabase supports true realtime over websockets, which would cut
  latency to well under a second; it's a client-only change if the polling ever
  feels slow.
