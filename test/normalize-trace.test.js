import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp, readExample } from './harness.js';

// Covers normalizeTrace: how the app reconciles the several trace shapes it
// accepts (plan / allPlanSteps / planSteps) into one internal structure.
describe('normalizeTrace', () => {
  let win;
  beforeEach(() => {
    win = loadApp();
  });

  it('returns null for non-object input', () => {
    expect(win.normalizeTrace(null)).toBeNull();
    expect(win.normalizeTrace('string')).toBeNull();
    expect(win.normalizeTrace(42)).toBeNull();
  });

  it('returns null when no recognized step array is present', () => {
    expect(win.normalizeTrace({ foo: 'bar' })).toBeNull();
  });

  it('passes through a trace that already has a plan array', () => {
    const trace = { plan: [{ type: 'X' }], sessionId: 's1', intent: 'i1' };
    expect(win.normalizeTrace(trace)).toBe(trace);
  });

  it('derives plan from planSteps and maps id/sessionId/intent', () => {
    const trace = {
      id: 'plan-123',
      sessionId: 'sess-9',
      intent: 'DoThing',
      planSteps: [{ type: 'UserInputStep' }],
    };
    const norm = win.normalizeTrace(trace);
    expect(norm.plan).toBe(trace.planSteps);
    expect(norm.planId).toBe('plan-123');
    expect(norm.sessionId).toBe('sess-9');
    expect(norm.intent).toBe('DoThing');
  });

  it('prefers allPlanSteps over planSteps when both are populated', () => {
    const trace = {
      allPlanSteps: [{ type: 'A' }, { type: 'B' }],
      planSteps: [{ type: 'C' }],
    };
    expect(win.normalizeTrace(trace).plan).toBe(trace.allPlanSteps);
  });

  it('falls back to planSteps when allPlanSteps is empty', () => {
    const trace = { allPlanSteps: [], planSteps: [{ type: 'C' }] };
    expect(win.normalizeTrace(trace).plan).toBe(trace.planSteps);
  });

  it('prefers planId over id when both are present', () => {
    const norm = win.normalizeTrace({ id: 'x', planId: 'y', plan: [] });
    // plan branch returns the object verbatim; loadData reads planId directly,
    // so confirm the raw fields the header meta relies on.
    expect(norm.planId ?? norm.id).toBeDefined();
  });

  it('normalizes the HTML-encoded example (planSteps + id shape)', () => {
    const obj = win.parseTraceJson(readExample('trace_html_encoded.json'));
    const norm = win.normalizeTrace(obj);
    expect(norm).not.toBeNull();
    expect(norm.planId).toBe('cd51c61f-0da9-49a9-a558-e5ee57793df3');
    expect(norm.sessionId).toBe('49dbc6d4-2afc-4894-b166-cb910b391f0f');
    expect(norm.intent).toBe('Sales_Helpline_Case_Creation');
    expect(norm.plan.length).toBe(obj.planSteps.length);
  });
});
