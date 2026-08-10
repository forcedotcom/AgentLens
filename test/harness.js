import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const INDEX_HTML = join(repoRoot, 'index.html');
const EXAMPLE_DIR = join(repoRoot, 'example');

/**
 * Loads the real index.html into a fresh jsdom window and runs its inline
 * script, so tests exercise the app's actual functions rather than copies.
 * Returns the jsdom `window`, on which every top-level function in the app
 * (parseTraceJson, normalizeTrace, parsePlan, loadData, …) is a property.
 *
 * A new window per call keeps tests isolated — no shared DOM or app state.
 */
export function loadApp() {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    // pretendToBeVisual gives us requestAnimationFrame etc. if ever needed.
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  return dom.window;
}

/** Reads a fixture from the example/ directory as a raw string. */
export function readExample(name) {
  return readFileSync(join(EXAMPLE_DIR, name), 'utf8');
}
