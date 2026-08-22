# La Pizarra

A Spanish learning app: flashcards with spaced repetition, a vocabulary list
you can grow by hand or by paste-import, grammar points with quizzes, and a
progress view — all organised along the CEFR ladder from A1 to C2.

Single user, local. Data lives in a JSON file on disk, not in the browser.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

For the built app:

```bash
npm run build
npm start            # serves dist/ plus the same /api on :5173
```

## Tests

```bash
npm test             # 18 unit tests: the scheduler and the storage layer
npm run test:e2e     # 20-step browser walkthrough, needs a server running
npm run lint
```

`test:e2e` drives a real browser against a real data file and resets the store
before it starts, so it's repeatable. It passes against both `npm run dev` and
`npm start`.

## How it's put together

```
src/App.jsx           the app — views, styling, CEFR levels
src/lib/sm2.js        the SM-2 scheduler
src/storage/index.js  the storage interface the app calls
server/api.js         /api, mounted into Vite in dev and server/index.js in prod
server/jsonStore.js   atomic reads and writes of data/pizarra.json
```

### Storage

Components never read or write files. They call `getVocab()`, `saveVocab()`,
`getGrammarScores()`, `saveGrammarScores()`, and `getAll()`, and that's the
whole surface. A browser can't touch the filesystem, so those calls go over
`/api` to a small node layer that owns the file.

Every record carries a `userId`, hardcoded to `"default"`. There's no
multi-user support and none is implied — the field is there so that pointing
this at a shared backend later means rewriting the storage layer and the
server, not the views.

Writes go to a temp file and are renamed into place, so an interrupted save
can't truncate the database. A file that fails to parse is moved aside rather
than overwritten. The store notices when `data/pizarra.json` changes underneath
it, so you can hand-edit your own data while the app is running.

`data/pizarra.json` is gitignored. On first run the seed word list is written
out, and from then on it's yours to edit.

### Spaced repetition

Each word carries a schedule: an ease factor, an interval in days, a repetition
count, and a next-review date. Answers grade through SM-2 — the interval ladder
runs 1 day, 6 days, then `interval x ease`, and a wrong answer sends the word
back to the start of the ladder and drops its ease.

The flashcard view orders its queue due-first, most overdue leading; words that
have never been reviewed are due by construction, so new and lapsed words come
up together. The queue is built when you switch levels or change the word list,
then held steady — re-sorting after every answer would shuffle the deck as you
work through it.

Both practice modes feed that one schedule. In *reconocer* you flip the card
and self-rate; in *recordar* you type the Spanish and it's marked right or
wrong. A word has one schedule no matter which way you drilled it.

"Mastered" is no longer a flag you toggle — a word counts as mastered once it
has earned an interval of 21 days or more, which is what the progress bars and
the filled dots in the list reflect.

### Fonts

Fraunces, IBM Plex Sans, IBM Plex Mono, and Caveat are self-hosted through
`@fontsource` and imported in `src/main.jsx`, at only the weights the app
renders: Fraunces 500/600, both Plex faces 400/500, Caveat 600. Nothing is
fetched from Google Fonts at runtime.

### Audio

Pronunciation uses the browser's Web Speech API with `lang = "es-ES"`, entirely
client-side. Where a browser doesn't support it, the audio buttons don't render.
