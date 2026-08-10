import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp, readExample } from './harness.js';

// Covers the trace-input parsing layer: parseTraceJson and its decodeHtmlEntities
// fallback. This is the behavior added in "Tolerate HTML-encoded JSON on web app
// trace input" — clean JSON parses untouched, HTML-encoded JSON parses via the
// decode fallback, and genuinely broken input still throws.
describe('parseTraceJson', () => {
  let win;
  beforeEach(() => {
    win = loadApp();
  });

  it('parses clean JSON unchanged', () => {
    const obj = win.parseTraceJson('{"a": 1, "b": [true, null]}');
    expect(obj).toEqual({ a: 1, b: [true, null] });
  });

  it('parses HTML-encoded JSON via the decode fallback', () => {
    const encoded = '{&quot;intent&quot;: &quot;Sales_Helpline_Case_Creation&quot;}';
    expect(win.parseTraceJson(encoded)).toEqual({
      intent: 'Sales_Helpline_Case_Creation',
    });
  });

  it('decodes &amp; and &#39; entities as well as &quot;', () => {
    const encoded = '{&quot;label&quot;: &quot;Tom &amp; Jerry&#39;s&quot;}';
    expect(win.parseTraceJson(encoded)).toEqual({ label: "Tom & Jerry's" });
  });

  it('does not alter entity-like text inside already-valid JSON strings', () => {
    // Clean JSON parses on the first try, so a literal &quot; in a value is kept.
    const clean = '{"note": "use &quot; for quotes"}';
    expect(win.parseTraceJson(clean)).toEqual({ note: 'use &quot; for quotes' });
  });

  it('throws on input that is invalid even after decoding', () => {
    expect(() => win.parseTraceJson('not json at all')).toThrow();
  });

  it('rethrows the original error when decoding changes nothing', () => {
    // No HTML entities present, so the decoded string equals the raw input and
    // the original parse error is rethrown rather than retried.
    const raw = '{ broken: }';
    expect(() => win.parseTraceJson(raw)).toThrow();
  });

  it('parses the HTML-encoded example fixture end to end', () => {
    const raw = readExample('trace_html_encoded.json');
    // Sanity check: the fixture really is encoded, so a raw parse must fail.
    expect(() => JSON.parse(raw)).toThrow();

    const obj = win.parseTraceJson(raw);
    expect(obj.id).toBe('cd51c61f-0da9-49a9-a558-e5ee57793df3');
    expect(obj.intent).toBe('Sales_Helpline_Case_Creation');
    expect(Array.isArray(obj.planSteps)).toBe(true);
    expect(obj.planSteps.length).toBeGreaterThan(0);
  });
});

describe('decodeHtmlEntities', () => {
  let win;
  beforeEach(() => {
    win = loadApp();
  });

  it('decodes the common entities emitted by a rendered page', () => {
    expect(win.decodeHtmlEntities('&quot;a&quot; &amp; &#39;b&#39;')).toBe('"a" & \'b\'');
  });

  it('leaves plain text untouched', () => {
    expect(win.decodeHtmlEntities('plain text 123')).toBe('plain text 123');
  });
});
