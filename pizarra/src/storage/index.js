// The storage interface.
//
// Components call getVocab() / saveVocab() and friends; nothing else in the
// app knows where the data actually lives. Two drivers implement that same
// interface, and which one is compiled in is a build-time choice:
//
//   default            a JSON file on disk, via /api  (npm run dev, npm start)
//   VITE_STORAGE=local the browser's localStorage     (npm run build:static)
//
// A shared backend later is a third driver, not a change to any view.

import * as apiDriver from './apiDriver.js';
import * as localDriver from './localDriver.js';

const driver = import.meta.env.VITE_STORAGE === 'local' ? localDriver : apiDriver;

export const USER_ID = driver.USER_ID;
export const DRIVER = import.meta.env.VITE_STORAGE === 'local' ? 'local' : 'api';

export const getVocab = (...args) => driver.getVocab(...args);
export const saveVocab = (...args) => driver.saveVocab(...args);
export const getGrammarScores = (...args) => driver.getGrammarScores(...args);
export const saveGrammarScores = (...args) => driver.saveGrammarScores(...args);
export const getAll = (...args) => driver.getAll(...args);
