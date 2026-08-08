## What this changes

<!-- One or two sentences in plain terms: what will look or behave differently. -->

## Why

<!-- The problem being solved. Link an issue if there is one. -->

## How it was verified

<!-- Which suites were run, and anything checked by hand.
     npm test               core logic
     npm run test:e2e       solo browser walkthrough
     npm run test:sharing   two-device sharing (needs npm run sync-server)
     npm run test:dropdown  mobile autocomplete positioning
     npm run test:sync-errors  failure messaging
-->

## Risk to the live app

<!-- Merging deploys straight to both phones. Note anything that could disrupt
     a shop in progress: data-model changes, anything touching sync, or a
     schema change that needs db/schema.sql re-run in Supabase. -->

- [ ] Needs `db/schema.sql` re-run in Supabase
- [ ] Changes the stored data shape (old data must still load)
- [ ] Touches sync
