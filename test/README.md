# Web app test bed

Tests for the AgentLens web app (`index.html`). The app is a single
self-contained HTML file with all logic in one inline `<script>` and no build
step, so the tests load that real file into a [jsdom](https://github.com/jsdom/jsdom)
window and exercise its actual functions — nothing is copied or re-implemented,
so tests can't drift from the shipped code.

## Running

```bash
npm install      # first time only
npm test         # run once
npm run test:watch
```

Uses [Vitest](https://vitest.dev). Requires Node 18+.

## Layout

- `harness.js` — `loadApp()` returns a fresh jsdom `window` with the app's
  inline script executed; every top-level app function (`parseTraceJson`,
  `normalizeTrace`, `parsePlan`, `loadData`, `analyzeGraph`, …) is a property on
  it. `readExample(name)` reads a fixture from `../example/`. A new window per
  call keeps tests isolated.
- `parse-input.test.js` — trace-input parsing: `parseTraceJson` and its
  `decodeHtmlEntities` HTML-entity fallback.
- `normalize-trace.test.js` — `normalizeTrace` reconciling the `plan` /
  `allPlanSteps` / `planSteps` trace shapes.
- `load-examples.test.js` — end-to-end: drives each fixture in `../example/`
  through `loadData` and asserts the rendered DOM state.

## Fixtures

Fixtures live in `../example/`:

- `trace.json`, `trace_2.json` — plain traces using the `plan` key.
- `trace_html_encoded.json` — a trace whose quotes are HTML-encoded
  (`&quot;`), as produced when copying a trace from a rendered page. It also
  uses the `planSteps` + `id` shape, so it covers both the HTML-decode fallback
  and that normalization branch.

## Adding a test

Drop a new `*.test.js` file in this directory:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp, readExample } from './harness.js';

describe('my feature', () => {
  let win;
  beforeEach(() => { win = loadApp(); });

  it('does the thing', () => {
    const obj = win.parseTraceJson(readExample('trace.json'));
    expect(win.normalizeTrace(obj)).not.toBeNull();
  });
});
```

To cover a new trace shape, add a fixture to `../example/` and reference it
with `readExample('your-file.json')`.
