var FILTER_CHECKBOX_MAP = {
  chkVarUpdates: 'varUpdates',
  chkReasoning: 'reasoning',
  chkNodeEntry: 'nodeEntry',
  chkEnabledTools: 'enabledTools',
  chkAgentScriptVars: 'showAgentScriptVars',
};

var currentData = null;
var analysis = null;
var vizParsed = null;
var selectedTopicId = null;
var fsmPlayback = { events: [], rawEvents: [], idx: -1, nodeMap: null, edgePathMap: null };
var fsmKeyNavHandler = null;

var timelineFilterPrefs = {
  varUpdates: true,
  reasoning: true,
  nodeEntry: true,
  enabledTools: true,
  showAgentScriptVars: false,
};

function detachFsmKeyboardNav() {
  if (fsmKeyNavHandler) {
    window.removeEventListener('keydown', fsmKeyNavHandler, true);
    fsmKeyNavHandler = null;
  }
}

function attachFsmKeyboardNav() {
  detachFsmKeyboardNav();
  fsmKeyNavHandler = function (ev) {
    if (!selectedTopicId || !fsmPlayback.events || fsmPlayback.events.length === 0) return;
    var tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ev.target.isContentEditable) return;
    if (ev.key === 'ArrowLeft' || ev.key === 'k' || ev.key === 'K') {
      ev.preventDefault(); stepFsmPrev();
    } else if (ev.key === 'ArrowRight' || ev.key === 'j' || ev.key === 'J') {
      ev.preventDefault(); stepFsmNext();
    }
  };
  window.addEventListener('keydown', fsmKeyNavHandler, true);
}

function loadTimelineFilterPrefs() {
  try {
    var saved = vscodeApi.getState();
    if (!saved || !saved.filterPrefs) return;
    var parsed = saved.filterPrefs;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    var allowed = Object.keys(timelineFilterPrefs);
    for (var i = 0; i < allowed.length; i++) {
      var key = allowed[i];
      if (Object.prototype.hasOwnProperty.call(parsed, key)) {
        timelineFilterPrefs[key] = !!parsed[key];
      }
    }
  } catch (e) {}
}

function saveTimelineFilterPrefs() {
  try {
    var prev = vscodeApi.getState() || {};
    vscodeApi.setState(Object.assign({}, prev, { filterPrefs: timelineFilterPrefs }));
  } catch (e) {}
}

function syncFilterUiFromPrefs() {
  for (var id of Object.keys(FILTER_CHECKBOX_MAP)) {
    var el = document.getElementById(id);
    if (el) el.checked = !!timelineFilterPrefs[FILTER_CHECKBOX_MAP[id]];
  }
}

function readFilterUiToPrefs() {
  for (var id of Object.keys(FILTER_CHECKBOX_MAP)) {
    var el = document.getElementById(id);
    if (el) timelineFilterPrefs[FILTER_CHECKBOX_MAP[id]] = !!el.checked;
  }
}

function showError(msg) {
  var t = document.createElement('div');
  t.className = 'error-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 4000);
}

function loadData(json) {
  if (!json || !Array.isArray(json.plan)) {
    showError('JSON must contain a "plan" array. Load a plan response from the Agentforce DX extension.');
    return;
  }
  if (json.plan.length > MAX_PLAN_STEPS) {
    showError('Plan exceeds maximum of ' + MAX_PLAN_STEPS + ' steps.');
    return;
  }
  currentData = json;
  selectedTopicId = null;
  var parsed = parsePlan(json.plan);
  analysis = analyzeGraph(parsed);

  document.getElementById('mainEmpty').classList.add('hidden');
  document.getElementById('mainViz').classList.remove('hidden');
  document.body.classList.add('app-viz');
  document.getElementById('btnClear').classList.remove('hidden');

  var meta = document.getElementById('headerMeta');
  meta.innerHTML = [
    json.planId ? '<span class="meta-chip"><strong>Plan</strong> ' + esc(String(json.planId).slice(0, 14)) + '…</span>' : '',
    json.sessionId ? '<span class="meta-chip"><strong>Session</strong> ' + esc(String(json.sessionId).slice(0, 14)) + '…</span>' : '',
    '<span class="meta-chip"><strong>Sub Agents</strong> ' + parsed.topics.length + '</span>',
  ].join('');

  renderMetrics(parsed, analysis);
  renderTopicGraph(parsed);

  if (parsed.topics.length > 0) {
    selectTopic(parsed.topics[0]);
  } else {
    clearFsmPanel();
  }
}

function clearAll() {
  detachFsmKeyboardNav();
  currentData = null;
  analysis = null;
  vizParsed = null;
  selectedTopicId = null;
  document.getElementById('topicGraph').innerHTML = '';
  document.getElementById('topicList').innerHTML = '';
  document.getElementById('fsmWrap').innerHTML = '';
  document.getElementById('mainViz').classList.add('hidden');
  document.getElementById('mainEmpty').classList.remove('hidden');
  document.body.classList.remove('app-viz');
  document.getElementById('btnClear').classList.add('hidden');
  document.getElementById('headerMeta').innerHTML = '';
  document.getElementById('metricsCard').classList.add('hidden');
  document.getElementById('metricsCard').innerHTML = '';
}

function handleLoadTrace(rawString) {
  if (!rawString) return;
  if (rawString.length > MAX_INPUT_BYTES) {
    postToHost('showError', 'Input too large. Maximum size is 50 MB.');
    return;
  }
  try {
    var json = JSON.parse(rawString);
    loadData(json);
  } catch (e) {
    postToHost('showError', 'Invalid JSON: ' + e.message);
  }
}

function rerenderIfLoaded() {
  // CSS custom properties handle most theme changes automatically.
  // Only SVG elements with inline color computations need re-rendering.
  // Currently, SVG node colors use CSS vars, so no re-render is needed.
}
