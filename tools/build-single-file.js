/**
 * Bundles the app into one self-contained HTML file at `dist/shopping-list.html`.
 *
 *   node tools/build-single-file.js
 *
 * The app itself needs no build step — this exists for hosts that can't serve
 * a directory of ES modules (a strict CSP, an email attachment, a single-file
 * upload). Because every module is concatenated into one scope, top-level
 * names across `src/` must stay unique.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Dependency order: a module may only reference ones already listed above it. */
const MODULES = [
  'src/config.js',
  'src/core/text.js',
  'src/core/categories.js',
  'src/core/units.js',
  'src/core/id.js',
  'src/data/groceryData.js',
  'src/core/groceryDb.js',
  'src/core/model.js',
  'src/core/dataStore.js',
  'src/core/sync/merge.js',
  'src/core/sync/transport.js',
  'src/core/sync/syncEngine.js',
  'src/ui/dom.js',
  'src/ui/icons.js',
  'src/ui/state.js',
  'src/ui/modal.js',
  'src/ui/actions.js',
  'src/ui/router.js',
  'src/ui/sharing.js',
  'src/ui/components/addItemSearch.js',
  'src/ui/components/itemRow.js',
  'src/ui/components/recipeCard.js',
  'src/ui/components/listCard.js',
  'src/ui/screens/listsScreen.js',
  'src/ui/screens/listEditScreen.js',
  'src/ui/screens/shoppingScreen.js',
  'src/ui/screens/recipeLibraryScreen.js',
  'src/app.js',
];

/**
 * Namespace imports (`import * as dataStore from …`) survive flattening only
 * if we rebuild the namespace object by hand.
 */
const NAMESPACES = {
  dataStore: [
    'init', 'isEphemeral', 'getLists', 'getList', 'getRecipes', 'getRecipe',
    'getCustomEntries', 'snapshot', 'saveList', 'deleteList', 'saveRecipe',
    'deleteRecipe', 'saveCustomEntry', 'deleteCustomEntry', 'clearAll',
    'subscribe', 'flushNow', 'getSetting', 'setSetting',
  ],
  transport: [
    'createSharedList', 'pullList', 'pushList', 'generateShareCode',
    'pullHousehold', 'pushHousehold',
  ],
  actions: [
    'addList', 'adoptSharedList', 'setListShareCode', 'renameList', 'removeList', 'addItem', 'updateItem', 'removeItem',
    'setItemsChecked', 'setAllChecked', 'startRecipe', 'addSavedRecipe',
    'renameRecipeInstance', 'removeRecipeInstance', 'saveRecipeToLibrary',
    'renameRecipeDefinition', 'removeRecipeDefinition', 'updateRecipeIngredients',
    'addIngredientToDefinition', 'addCustomEntry', 'removeCustomEntry',
  ],
};

/** Strip `import …;` statements (single- or multi-line) and `export ` keywords. */
function flatten(source) {
  return source
    .replace(/^import\b[\s\S]*?;$/gm, '')
    .replace(/^export (?=(?:async )?function |const |let |class )/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Guard the one invariant flattening introduces: no duplicate top-level names. */
function assertUniqueTopLevelNames(chunks) {
  const seen = new Map();
  const declaration = /^(?:async function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

  for (const { file, code } of chunks) {
    for (const [, name] of code.matchAll(declaration)) {
      if (seen.has(name)) {
        throw new Error(
          `Top-level name "${name}" is declared in both ${seen.get(name)} and ${file}. ` +
            'Rename one — the single-file build puts every module in one scope.',
        );
      }
      seen.set(name, file);
    }
  }

  for (const members of Object.values(NAMESPACES)) {
    for (const member of members) {
      if (!seen.has(member)) throw new Error(`Namespace member "${member}" no longer exists.`);
    }
  }
}

const chunks = MODULES.map((file) => ({
  file,
  code: flatten(readFileSync(join(ROOT, file), 'utf8')),
}));

assertUniqueTopLevelNames(chunks);

const namespaceDefs = Object.entries(NAMESPACES)
  .map(([name, members]) => `const ${name} = { ${members.join(', ')} };`)
  .join('\n');

// `app.js` calls start() on load, so the namespace objects must be defined
// before it runs — they're spliced in ahead of the final chunk.
const appChunk = chunks.pop();
const script = [
  ...chunks.map(({ file, code }) => `// ${'='.repeat(8)} ${file} ${'='.repeat(8)}\n${code}`),
  `// ${'='.repeat(8)} namespace objects (rebuilt for the flattened bundle) ${'='.repeat(8)}\n${namespaceDefs}`,
  `// ${'='.repeat(8)} ${appChunk.file} ${'='.repeat(8)}\n${appChunk.code}`,
].join('\n\n');

const css = readFileSync(join(ROOT, 'styles.css'), 'utf8').trim();

/**
 * Escape every non-ASCII code unit in the script (emoji, curly quotes, ×, —).
 * A single file gets opened from disk, emailed, and dropped onto hosts that
 * don't send `charset=utf-8`; escaping makes the payload immune to whatever
 * encoding the document is decoded as, rather than trusting a `<meta>` tag.
 * Verified safe: no source regex literal contains a non-ASCII character.
 */
function escapeNonAscii(source) {
  let out = '';
  // Indexed, not `for…of`: iterating by code point would split an astral
  // emoji's surrogate pair and drop the low half.
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    out += code > 127 ? `\\u${code.toString(16).padStart(4, '0')}` : source[i];
  }
  return out;
}

const html = `<meta charset="utf-8" />
<title>Shopping List</title>
<meta name="description" content="Shopping lists with a built-in grocery database, recipes, and an in-store shopping mode." />
<style>
${css}
</style>

<div id="app" class="app"></div>
<div id="modal-root"></div>

<script type="module">
${escapeNonAscii(script)}
</script>
`;

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const out = join(ROOT, 'dist/shopping-list.html');
writeFileSync(out, html);

console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB, ${MODULES.length} modules inlined)`);
