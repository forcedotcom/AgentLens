import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp, readExample } from './harness.js';

// End-to-end: drive each example fixture through the same path the UI uses
// (parseTraceJson -> loadData) and assert the app reaches its rendered state
// without error. Also asserts the parse/plan layer directly for richer checks.
const EXAMPLES = ['trace.json', 'trace_2.json', 'trace_html_encoded.json'];

describe('loading example fixtures', () => {
  let win;
  beforeEach(() => {
    win = loadApp();
  });

  it.each(EXAMPLES)('parses and builds a plan for %s', (name) => {
    const obj = win.parseTraceJson(readExample(name));
    const norm = win.normalizeTrace(obj);
    expect(norm).not.toBeNull();

    const parsed = win.parsePlan(norm.plan);
    expect(Array.isArray(parsed.topics)).toBe(true);
    expect(parsed.topics.length).toBeGreaterThan(0);

    // analyzeGraph must run over any valid parsed plan without throwing.
    const analysis = win.analyzeGraph(parsed);
    expect(analysis.n).toBe(parsed.topics.length);
  });

  it.each(EXAMPLES)('loadData renders the viz and hides the empty state for %s', (name) => {
    const doc = win.document;
    const mainViz = doc.getElementById('mainViz');
    const mainEmpty = doc.getElementById('mainEmpty');

    // Precondition: before loading, the empty state is shown.
    expect(mainEmpty.classList.contains('hidden')).toBe(false);

    win.loadData(win.parseTraceJson(readExample(name)));

    // After a successful load the viz is visible and the empty state hidden.
    expect(mainViz.classList.contains('hidden')).toBe(false);
    expect(mainEmpty.classList.contains('hidden')).toBe(true);
    expect(doc.body.classList.contains('app-viz')).toBe(true);
    // Header meta reflects the loaded trace (at least the sub-agent count chip).
    expect(doc.getElementById('headerMeta').innerHTML).toContain('Sub Agents');
  });

  it('loadData shows an error toast for an unrecognized format', () => {
    const doc = win.document;
    win.loadData({ nothing: 'useful' });
    const toast = doc.querySelector('.error-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toMatch(/Unrecognized format/);
    // Viz stays hidden on a rejected load.
    expect(doc.getElementById('mainViz').classList.contains('hidden')).toBe(true);
  });

  it('the HTML-encoded example loads through the full UI path', () => {
    const doc = win.document;
    win.loadData(win.parseTraceJson(readExample('trace_html_encoded.json')));
    expect(doc.getElementById('mainViz').classList.contains('hidden')).toBe(false);
    // Header meta renders the (truncated) plan id derived from the encoded trace.
    expect(doc.getElementById('headerMeta').innerHTML).toContain('cd51c61f-0da9-');
  });
});
