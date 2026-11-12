import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { readExample } from './harness.js';

// Black-box tests for the open-agentlens skill script: build a fake DX project
// in the layouts the Salesforce CLI writes, run the script with --no-open, and
// check both which trace it picked and that the generated page renders it.
const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '..', 'agentlens-plugin', 'skills', 'open-agentlens', 'scripts', 'open-agentlens.mjs');

const TRACE = readExample('trace.json');
const TRACE_2 = readExample('trace_2.json');
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
}

// A session in the current CLI layout. turns: [{ user, trace }] where trace is
// the raw trace text; a turn with no trace models the greeting-only state.
function makeSession(root, agent, sid, startTime, turns, { turnIndex = true } = {}) {
  const dir = join(root, '.sfdx', 'agents', agent, 'sessions', sid);
  const planIds = [];
  const index = [{ turn: 1, role: 'agent', summary: 'Hi', traceFile: null, planId: null }];
  const transcript = [{ role: 'agent', text: 'Hi', raw: [{ type: 'Inform' }] }];
  turns.forEach((t, i) => {
    const planId = uuid(1000 + Number(sid.slice(-4)) * 10 + i);
    index.push({ turn: index.length + 1, role: 'user', summary: t.user, traceFile: null, planId: null });
    transcript.push({ role: 'user', text: t.user });
    if (t.trace !== undefined) {
      write(join(dir, 'traces', `${planId}.json`), t.trace);
      planIds.push(planId);
      index.push({ turn: index.length + 1, role: 'agent', summary: 'ok', traceFile: `traces/${planId}.json`, planId });
      transcript.push({ role: 'agent', text: 'ok', raw: [{ type: 'Inform', planId }] });
    }
  });
  write(join(dir, 'metadata.json'), { sessionId: sid, agentId: agent, startTime, planIds });
  if (turnIndex) write(join(dir, 'turn-index.json'), { version: '1.0', sessionId: sid, agentId: agent, turns: index });
  write(join(dir, 'transcript.jsonl'), transcript.map(e => JSON.stringify(e)).join('\n') + '\n');
  return { dir, planIds };
}

function run(args, cwd) {
  try {
    const out = execFileSync('node', [SCRIPT, '--no-open', '--out', join(cwd, 'out.html'), ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, json: JSON.parse(out) };
  } catch (e) {
    return { code: e.status, stderr: e.stderr };
  }
}

function renderPage(file) {
  const dom = new JSDOM(readFileSync(file, 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  return dom.window.document;
}

describe('open-agentlens skill script', () => {
  let root;
  let older, orders;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'agentlens-skill-'));
    write(join(root, 'sfdx-project.json'), { packageDirectories: [{ path: 'force-app', default: true }] });
    // Service: an older two-turn session, then a newer greeting-only session.
    older = makeSession(root, 'Service', uuid(1), '2026-01-01T10:00:00Z', [
      { user: 'where is my order', trace: TRACE },
      { user: 'cancel it', trace: TRACE_2 },
    ]);
    makeSession(root, 'Service', uuid(2), '2026-01-02T10:00:00Z', [{ user: 'hello?' }]);
    // Orders: most recent overall; its last trace is empty ({}), as the CLI
    // writes when the planner returns nothing. Older layout without turn-index.
    orders = makeSession(root, 'Orders', uuid(3), '2026-01-03T10:00:00Z', [
      { user: 'look up order 42', trace: TRACE },
      { user: 'and now?', trace: '{}' },
    ], { turnIndex: false });
    // Legacy layout: .sfdx/agents/<Agent>.agent/traces/<sessionId>-<planId>.json
    const legacy = join(root, '.sfdx', 'agents', 'Legacy.agent', 'traces', `${uuid(4)}-${uuid(5)}.json`);
    write(legacy, TRACE);
    utimesSync(legacy, new Date('2025-06-01'), new Date('2025-06-01'));
    // Recency comes from metadata.startTime, as in the CLI: give the older
    // Service session far-future file mtimes (as a copy or checkout might) and
    // Orders must still win.
    const future = new Date('2030-01-01T00:00:00Z');
    for (const p of older.planIds) utimesSync(join(older.dir, 'traces', `${p}.json`), future, future);
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('defaults to the most recent agent and skips its empty last trace', () => {
    const { code, json } = run([], root);
    expect(code).toBe(0);
    expect(json.selected.agent).toBe('Orders');
    expect(json.selected.turn).toBe(1);
    expect(json.selected.userMessage).toBe('look up order 42'); // recovered from transcript.jsonl
    expect(json.warnings.join(' ')).toMatch(/No agent specified/);
  });

  it('works from a subdirectory of the project', () => {
    const sub = join(root, 'force-app');
    mkdirSync(sub, { recursive: true });
    expect(run([], sub).json.selected.agent).toBe('Orders');
  });

  it('skips a newer session that has no trace yet and says so', () => {
    const { json } = run(['--agent', 'service'], root);
    expect(json.selected.sessionId).toBe(uuid(1));
    expect(json.selected.turn).toBe(2);
    expect(json.selected.of).toBe(2);
    expect(json.selected.userMessage).toBe('cancel it');
    expect(json.warnings.join(' ')).toMatch(/has no viewable trace yet/);
  });

  it('picks a specific turn, plan, or session', () => {
    expect(run(['--agent', 'Service', '--turn', '1'], root).json.selected.userMessage).toBe('where is my order');
    expect(run(['--plan', older.planIds[0]], root).json.selected.turn).toBe(1);
    expect(run(['--session', uuid(1)], root).json.selected.agent).toBe('Service');
    expect(run(['--session', uuid(1).slice(0, 30)], root).stderr).toMatch(/ambiguous/);
  });

  it('accepts a session directory (the tracesPath from `sf agent preview end`)', () => {
    const { json } = run([older.dir], root);
    expect(json.selected.sessionId).toBe(uuid(1));
    expect(json.selected.turn).toBe(2);
  });

  it('reads the legacy <Agent>.agent/traces layout', () => {
    const { json } = run(['--agent', 'Legacy'], root);
    expect(json.selected.sessionId).toBe(uuid(4));
    expect(json.selected.planId).toBe(uuid(5));
  });

  it('fails loud on unknown agents, empty turns, and out-of-range turns', () => {
    const unknown = run(['--agent', 'Nope'], root);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toMatch(/Agents with traces here: .*Service/);
    expect(run(['--agent', 'Orders', '--turn', '2'], root).stderr).toMatch(/empty trace/);
    expect(run(['--agent', 'Service', '--turn', '9'], root).stderr).toMatch(/no turn 9/);
  });

  it('runs when invoked through a symlinked skill folder (as `npx skills` installs it)', () => {
    const link = join(root, 'linked-skill');
    symlinkSync(dirname(SCRIPT), link);
    const out = execFileSync('node', [join(link, 'open-agentlens.mjs'), '--list'], { cwd: root, encoding: 'utf8' });
    expect(JSON.parse(out).sessions.length).toBeGreaterThan(0);
  });

  it('lists sessions with their user messages', () => {
    const out = execFileSync('node', [SCRIPT, '--list'], { cwd: root, encoding: 'utf8' });
    const { sessions } = JSON.parse(out);
    expect(sessions.map(s => s.agent)).toEqual(expect.arrayContaining(['Service', 'Orders', 'Legacy']));
    const svc = sessions.find(s => s.sessionId === uuid(1));
    expect(svc.turns.map(t => t.userMessage)).toEqual(['where is my order', 'cancel it']);
  });

  it('produces an AgentLens page that renders the chosen trace', () => {
    const { json } = run(['--agent', 'Service'], root);
    const doc = renderPage(json.page);
    expect(doc.getElementById('mainViz').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('mainEmpty').classList.contains('hidden')).toBe(true);
    expect(doc.title).toBe('AgentLens — Service — turn 2');
  });

  it('cannot be broken out of by a trace containing </script>', () => {
    const evil = JSON.parse(TRACE);
    evil.plan[0].evil = '</script><script>window.__pwned = 1</script>';
    const file = join(root, 'evil.json');
    write(file, evil);
    const { json } = run([file], root);
    const dom = new JSDOM(readFileSync(json.page, 'utf8'), { runScripts: 'dangerously', url: 'http://localhost/' });
    expect(dom.window.__pwned).toBeUndefined();
    expect(dom.window.document.getElementById('mainViz').classList.contains('hidden')).toBe(false);
  });
});
