#!/usr/bin/env node
// Finds the right Agentforce trace in a Salesforce DX project and opens it in
// the AgentLens web app. Zero dependencies; Node 18+.
//
// Where the Salesforce CLI writes traces (from @salesforce/agents utils.js):
//   <project>/.sfdx/agents/<agentId>/sessions/<sessionId>/
//     metadata.json      { sessionId, agentId, startTime, planIds }
//     turn-index.json    { turns: [{ turn, role, summary, traceFile, planId }] }
//     transcript.jsonl   conversation, one entry per line (NOT a trace)
//     traces/<planId>.json   one planner trace per agent reply  <- what AgentLens loads
//   `sf agent preview --output-dir <dir>` copies a session to
//     <dir>/<agentId>/session_<sessionId>/ (default dir: temp/agent-preview)
//   Older CLI versions wrote <project>/.sfdx/agents/<Agent>.agent/traces/<sessionId>-<planId>.json
//
// The page is the real AgentLens index.html with a loader appended that calls
// the app's own parseTraceJson + loadData, so parsing/validation is the app's.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir, platform } from 'node:os';
import { spawn } from 'node:child_process';

const APP_URL = 'https://raw.githubusercontent.com/forcedotcom/AgentLens/main/index.html';
const APP_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const LEGACY_TRACE_RE = new RegExp(`^(${UUID})-(${UUID})\\.json$`, 'i');

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { path: null, agent: null, session: null, turn: null, plan: null, list: false, open: true, app: null, out: null };
  const takesValue = { '--agent': 'agent', '--session': 'session', '--turn': 'turn', '--plan': 'plan', '--app': 'app', '--out': 'out' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (takesValue[a]) {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      opts[takesValue[a]] = v;
    } else if (a === '--list') opts.list = true;
    else if (a === '--no-open') opts.open = false;
    else if (a === '-h' || a === '--help') { opts.help = true; }
    else if (a.startsWith('-')) throw new UsageError(`Unknown option ${a}`);
    else if (opts.path) throw new UsageError(`Unexpected extra argument ${a}`);
    else opts.path = a;
  }
  if (opts.turn !== null) {
    if (opts.turn !== 'last' && !/^\d+$/.test(opts.turn)) throw new UsageError('--turn must be a positive number or "last"');
    if (opts.turn !== 'last') opts.turn = Number(opts.turn);
  }
  return opts;
}

const HELP = `Usage: open-agentlens.mjs [path] [options]

path      A trace .json file, a session directory (the "tracesPath" printed by
          \`sf agent preview end\`), or a DX project directory. Default: cwd.

--agent <name>     Agent API name (folder under .sfdx/agents). Case-insensitive.
--session <id>     Session ID or unique prefix.
--turn <n|last>    Which traced reply in the session (1 = first reply with a trace).
--plan <planId>    Pick the trace by plan ID.
--list             Print sessions and turns as JSON; open nothing.
--no-open          Build the page but do not launch a browser.
--app <file>       AgentLens index.html to use (else $AGENTLENS_HTML, a local
                   AgentLens checkout, or a cached copy from GitHub).
--out <file>       Where to write the generated page.`;

// ---------- reading CLI session data ----------

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
}

function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
function listDirs(p) { return isDir(p) ? readdirSync(p).filter(n => isDir(join(p, n))) : []; }

// Same shape test as normalizeTrace() in index.html — kept here only so we can
// skip empty traces (the CLI writes `{}` when the planner returned nothing)
// while choosing, instead of opening a page that just shows an error.
function traceStepCount(json) {
  if (!json || typeof json !== 'object') return 0;
  for (const key of ['plan', 'allPlanSteps', 'planSteps']) {
    if (Array.isArray(json[key]) && json[key].length) return json[key].length;
  }
  return 0;
}

function inspectTrace(file) {
  const json = readJson(file);
  return { steps: traceStepCount(json), topic: json?.topic ?? null };
}

// transcript.jsonl: agent entries carry the planId of their trace in raw[];
// the user message that triggered it is the closest preceding user entry.
function userMessagesByPlanId(file) {
  const map = new Map();
  if (!existsSync(file)) return map;
  let lastUser = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.role === 'user') { lastUser = e.text ?? null; continue; }
    for (const r of Array.isArray(e.raw) ? e.raw : []) if (r?.planId && !map.has(r.planId)) map.set(r.planId, lastUser);
  }
  return map;
}

// A session from the current layout (.sfdx/.../sessions/<id> or an --output-dir copy).
function readSession(dir, agentHint, source) {
  const meta = readJson(join(dir, 'metadata.json')) ?? {};
  const index = readJson(join(dir, 'turn-index.json'));
  const sessionId = meta.sessionId ?? index?.sessionId ?? basename(dir).replace(/^session_/, '');
  const agent = meta.agentId ?? index?.agentId ?? agentHint;
  const tracesDir = join(dir, 'traces');
  const turns = [];

  if (Array.isArray(index?.turns)) {
    // turn-index.json is the CLI's own turn -> trace mapping; the user message
    // is the closest preceding user turn.
    let lastUser = null;
    for (const t of index.turns) {
      if (t.role === 'user') { lastUser = t.summary ?? null; continue; }
      if (!t.traceFile) continue;
      const file = join(dir, t.traceFile);
      if (!existsSync(file)) continue;
      turns.push({ planId: t.planId, file, userMessage: lastUser, agentReply: t.summary ?? null, timestamp: t.timestamp ?? null });
    }
  } else if (isDir(tracesDir)) {
    // Older sessions have no turn index: order by metadata.planIds, then file
    // mtime, and recover each user message from the transcript.
    const order = Array.isArray(meta.planIds) ? meta.planIds : [];
    const userMessageFor = userMessagesByPlanId(join(dir, 'transcript.jsonl'));
    const files = readdirSync(tracesDir).filter(f => f.endsWith('.json'));
    files.sort((a, b) => {
      const ia = order.indexOf(basename(a, '.json')), ib = order.indexOf(basename(b, '.json'));
      if (ia !== -1 && ib !== -1) return ia - ib;
      return statSync(join(tracesDir, a)).mtimeMs - statSync(join(tracesDir, b)).mtimeMs;
    });
    for (const f of files) {
      const planId = basename(f, '.json');
      turns.push({ planId, file: join(tracesDir, f), userMessage: userMessageFor.get(planId) ?? null, agentReply: null, timestamp: null });
    }
  }

  const startTime = Date.parse(meta.startTime ?? index?.created ?? '') || statSync(dir).mtimeMs;
  return finishSession({ agent, sessionId, dir, source, startTime, turns });
}

function finishSession(s) {
  s.turns = s.turns.map((t, i) => ({ turn: i + 1, ...t, ...inspectTrace(t.file) }));
  return s;
}

// Older CLI layout: .sfdx/agents/<Agent>.agent/traces/<sessionId>-<planId>.json
function readLegacySessions(agentDir, agent) {
  const tracesDir = join(agentDir, 'traces');
  if (!isDir(tracesDir)) return [];
  const bySession = new Map();
  for (const f of readdirSync(tracesDir)) {
    const m = LEGACY_TRACE_RE.exec(f);
    if (!m) continue;
    const file = join(tracesDir, f);
    if (!bySession.has(m[1])) bySession.set(m[1], []);
    bySession.get(m[1]).push({ planId: m[2], file, userMessage: null, agentReply: null, timestamp: null, mtime: statSync(file).mtimeMs });
  }
  return [...bySession].map(([sessionId, turns]) => {
    turns.sort((a, b) => a.mtime - b.mtime);
    turns.forEach(t => delete t.mtime);
    return finishSession({ agent, sessionId, dir: tracesDir, source: 'legacy', startTime: statSync(join(tracesDir, basename(turns[0].file))).mtimeMs, turns });
  });
}

function findProjectRoot(start) {
  for (let d = resolve(start); ; d = dirname(d)) {
    if (existsSync(join(d, 'sfdx-project.json'))) return d;
    if (dirname(d) === d) return resolve(start);
  }
}

function collectSessions(root) {
  const sessions = [];
  const agentsDir = join(root, '.sfdx', 'agents');
  for (const name of listDirs(agentsDir)) {
    const agentDir = join(agentsDir, name);
    if (name.endsWith('.agent')) { sessions.push(...readLegacySessions(agentDir, name.slice(0, -'.agent'.length))); continue; }
    for (const sid of listDirs(join(agentDir, 'sessions'))) sessions.push(readSession(join(agentDir, 'sessions', sid), name, 'sfdx'));
  }
  // Saved copies from `sf agent preview --output-dir`. They duplicate .sfdx
  // sessions, so they only count when the .sfdx original is gone.
  const outDir = resolve(root, process.env.SF_AGENT_PREVIEW_OUTPUT_DIR || join('temp', 'agent-preview'));
  const seen = new Set(sessions.map(s => s.sessionId));
  for (const name of listDirs(outDir)) {
    for (const sd of listDirs(join(outDir, name)).filter(n => n.startsWith('session_'))) {
      const s = readSession(join(outDir, name, sd), name, 'output-dir');
      if (!seen.has(s.sessionId)) { sessions.push(s); seen.add(s.sessionId); }
    }
  }
  // "Most recent" means what the CLI's findMostRecentSessionId means: newest
  // metadata.startTime (mtime only when there is no metadata). File mtimes
  // alone are not trusted; copies and checkouts reset them.
  return sessions.sort((a, b) => b.startTime - a.startTime);
}

// ---------- choosing ----------

function matchAgent(sessions, wanted) {
  const agents = [...new Set(sessions.map(s => s.agent))];
  const w = wanted.toLowerCase().replace(/\.agent$/, '');
  let hits = agents.filter(a => a.toLowerCase() === w);
  if (!hits.length) hits = agents.filter(a => a.toLowerCase().includes(w));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new UsageError(`No traces for an agent named "${wanted}". Agents with traces here: ${agents.join(', ') || '(none)'}`);
  throw new UsageError(`"${wanted}" matches several agents: ${hits.join(', ')}. Pass the exact name with --agent.`);
}

function choose(sessions, opts) {
  const warnings = [];
  let pool = sessions;
  if (opts.agent) {
    const agent = matchAgent(sessions, opts.agent);
    pool = pool.filter(s => s.agent === agent);
  }
  if (opts.session) {
    pool = pool.filter(s => s.sessionId.startsWith(opts.session));
    if (pool.length > 1) throw new UsageError(`Session prefix "${opts.session}" is ambiguous: ${pool.map(s => s.sessionId).join(', ')}`);
  }
  if (opts.plan) pool = pool.filter(s => s.turns.some(t => t.planId === opts.plan));
  if (!pool.length) throw new UsageError('No session matches the given filters. Run with --list to see what is available.');

  const viewable = pool.filter(s => s.turns.some(t => t.steps > 0));
  if (!viewable.length) {
    throw new UsageError(`Session ${pool[0].sessionId} (${pool[0].agent}) has no viewable trace yet — the agent has not replied to a message, or every trace is empty.`);
  }
  const session = viewable[0];
  if (pool[0] !== session) warnings.push(`Newest session ${pool[0].sessionId} (${pool[0].agent}) has no viewable trace yet; opened the newest one that does.`);
  if (!opts.agent && !opts.session && !opts.plan) {
    const otherAgents = [...new Set(sessions.filter(s => s.agent !== session.agent && s.turns.some(t => t.steps > 0)).map(s => s.agent))];
    if (otherAgents.length) warnings.push(`No agent specified; picked the most recently active one. Other agents with traces: ${otherAgents.join(', ')}.`);
  }

  let turn;
  if (opts.plan) turn = session.turns.find(t => t.planId === opts.plan);
  else if (typeof opts.turn === 'number') {
    turn = session.turns.find(t => t.turn === opts.turn);
    if (!turn) throw new UsageError(`Session ${session.sessionId} has ${session.turns.length} traced turn(s); there is no turn ${opts.turn}.`);
  } else turn = [...session.turns].reverse().find(t => t.steps > 0);
  if (turn.steps === 0) throw new UsageError(`Turn ${turn.turn} of session ${session.sessionId} has an empty trace (${turn.file}).`);
  return { session, turn, warnings };
}

// ---------- the AgentLens page ----------

function findLocalCheckout() {
  // The plugin ships inside the AgentLens repo; use that index.html when present.
  for (let d = dirname(fileURLToPath(import.meta.url)); dirname(d) !== d; d = dirname(d)) {
    if (existsSync(join(d, 'index.html')) && existsSync(join(d, 'chrome-extension', 'manifest.json'))) return join(d, 'index.html');
  }
  return null;
}

async function resolveApp(opts, warnings) {
  const explicit = opts.app ?? process.env.AGENTLENS_HTML;
  if (explicit) {
    if (!existsSync(explicit)) throw new UsageError(`AgentLens app not found at ${explicit}`);
    return explicit;
  }
  const local = findLocalCheckout();
  if (local) return local;

  const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'agentlens', 'index.html');
  const fresh = existsSync(cache) && Date.now() - statSync(cache).mtimeMs < APP_CACHE_MAX_AGE_MS;
  if (fresh) return cache;
  try {
    const res = await fetch(APP_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!html.includes('function loadData(')) throw new Error('downloaded page is not the AgentLens app');
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, html);
    return cache;
  } catch (e) {
    if (existsSync(cache)) { warnings.push(`Could not refresh AgentLens (${e.message}); using cached copy from ${new Date(statSync(cache).mtimeMs).toISOString()}.`); return cache; }
    throw new Error(`Could not download AgentLens from ${APP_URL}: ${e.message}. Pass --app <path to index.html>.`);
  }
}

// Embeds a string as a JS literal inside <script>: escape "<" so the trace can
// never close the tag, and U+2028/2029 which are line breaks in old JS parsers.
function scriptLiteral(s) {
  return JSON.stringify(s).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function buildPage(appHtml, traceRaw, title) {
  if (!appHtml.includes('function loadData(') || !appHtml.includes('function parseTraceJson(')) {
    throw new Error('The AgentLens page does not expose loadData/parseTraceJson; it may be an incompatible version.');
  }
  const loader = `<script>
(function () {
  document.title = ${scriptLiteral(title)};
  try { loadData(parseTraceJson(${scriptLiteral(traceRaw)})); }
  catch (e) { showError('Could not load trace: ' + e.message); }
})();
</script>
`;
  const at = appHtml.lastIndexOf('</body>');
  if (at === -1) throw new Error('The AgentLens page has no </body> tag.');
  return appHtml.slice(0, at) + loader + appHtml.slice(at);
}

function openInBrowser(file) {
  const [cmd, args] = platform() === 'darwin' ? ['open', [file]]
    : platform() === 'win32' ? ['cmd', ['/c', 'start', '', file]]
    : ['xdg-open', [file]];
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', rej);
    p.on('spawn', () => { p.unref(); res(); });
  });
}

// ---------- main ----------

function summarizeSession(s) {
  return {
    agent: s.agent, sessionId: s.sessionId, source: s.source, dir: s.dir,
    started: new Date(s.startTime).toISOString(),
    turns: s.turns.map(t => ({ turn: t.turn, planId: t.planId, userMessage: t.userMessage, topic: t.topic, steps: t.steps, file: t.file })),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }
  const target = resolve(opts.path ?? '.');
  if (!existsSync(target)) throw new UsageError(`No such file or directory: ${target}`);

  let sessions;
  let fixed = null; // an explicitly named trace file
  if (statSync(target).isFile()) {
    fixed = target;
  } else if (existsSync(join(target, 'traces')) || existsSync(join(target, 'turn-index.json'))) {
    sessions = [readSession(target, basename(dirname(dirname(target))), 'path')];
  } else {
    const root = findProjectRoot(target);
    sessions = collectSessions(root);
    if (!sessions.length) {
      throw new UsageError(`No agent preview traces under ${root}. Run \`sf agent preview\` (or preview start/send/end) in this project first, or pass a trace file.`);
    }
  }

  if (opts.list) {
    if (fixed) throw new UsageError('--list needs a project or session directory, not a file.');
    console.log(JSON.stringify({ sessions: sessions.map(summarizeSession) }, null, 2));
    return;
  }

  let selection;
  const warnings = [];
  if (fixed) {
    selection = { agent: null, sessionId: null, turn: null, planId: basename(fixed, '.json'), userMessage: null, file: fixed, ...inspectTrace(fixed) };
  } else {
    const { session, turn, warnings: w } = choose(sessions, opts);
    warnings.push(...w);
    selection = { agent: session.agent, sessionId: session.sessionId, turn: turn.turn, of: session.turns.length, planId: turn.planId, userMessage: turn.userMessage, topic: turn.topic, steps: turn.steps, file: turn.file };
  }

  const app = await resolveApp(opts, warnings);
  const title = ['AgentLens', selection.agent, selection.turn && `turn ${selection.turn}`].filter(Boolean).join(' — ');
  const page = buildPage(readFileSync(app, 'utf8'), readFileSync(selection.file, 'utf8'), title);
  const slug = [selection.agent, selection.sessionId?.slice(0, 8), selection.turn ? `turn${selection.turn}` : selection.planId].filter(Boolean).join('-');
  const out = resolve(opts.out ?? join(tmpdir(), 'agentlens', `${slug.replace(/[^\w.-]/g, '_')}.html`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, page, { mode: 0o600 });
  let opened = false;
  if (opts.open) {
    // The page is already written; a missing/blocked browser launcher should
    // not hide that, so report it and let the caller give the user the path.
    try { await openInBrowser(out); opened = true; }
    catch (e) { warnings.push(`Could not launch a browser (${e.message}); open ${out} manually.`); }
  }

  console.log(JSON.stringify({ opened, page: out, app, selected: selection, warnings }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    console.error(`open-agentlens: ${e.message}`);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
