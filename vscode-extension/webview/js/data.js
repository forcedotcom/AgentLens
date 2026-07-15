// Data processing functions. Depends on esc() from bridge.js.

var MAX_INPUT_BYTES = 50 * 1024 * 1024;
var MAX_PLAN_STEPS = 10000;

var FSM_BUILTIN_MACRO_IDS = new Set(['Entry', 'Prep', 'LLM', 'Response', 'UserInput', 'Function']);
var FSM_MACRO_RING_ORDER = ['Entry', 'UserInput', 'Prep', 'LLM', 'Response', 'Function'];
var HANDOFF_PREFIX = 'Handoff→';

function handoffMacroId(toAgent) { return HANDOFF_PREFIX + String(toAgent).trim(); }
function isHandoffMacroId(id) { return typeof id === 'string' && id.startsWith(HANDOFF_PREFIX); }
function handoffTargetName(id) { return id.slice(HANDOFF_PREFIX.length); }

function extractToolInvocations(msg) {
  if (!msg) return [];
  var out = [];
  if (msg.tool_invocation && msg.tool_invocation.name) {
    out.push({ name: msg.tool_invocation.name, arguments: msg.tool_invocation.arguments });
  }
  var arr = msg.tool_invocations;
  if (Array.isArray(arr)) {
    for (var i = 0; i < arr.length; i++) {
      var fn = arr[i].function;
      if (fn && fn.name) out.push({ name: fn.name, arguments: fn.arguments });
    }
  }
  return out;
}

function agentKey(name) {
  if (!name) return 'none';
  return String(name).toLowerCase().replace(/\s+/g, '_');
}

function getAgentForStep(step, prevAgent) {
  var d = step.data || {};
  if (step.type === 'LLMStep' || step.type === 'EnabledToolsStep') return agentKey(d.agent_name);
  if (step.type === 'NodeEntryStateStep' || step.type === 'BeforeReasoningIterationStep' || step.type === 'AfterReasoningStep')
    return agentKey(d.agent_name);
  if (step.type === 'TransitionStep') return agentKey(d.from_agent);
  if (step.type === 'FunctionStep') return prevAgent;
  if (step.type === 'VariableUpdateStep') return prevAgent;
  return prevAgent || 'none';
}

function recordDisplay(map, id, raw) {
  if (!id || id === 'none' || !raw) return;
  var s = String(raw).trim();
  if (!s) return;
  if (!map[id] || s.length > map[id].length) map[id] = s;
}

function functionStepMacroId(step) {
  var fn = step.function;
  var raw = fn && fn.name != null ? String(fn.name).trim() : '';
  if (!raw) return 'Function';
  if (FSM_BUILTIN_MACRO_IDS.has(raw)) return raw + ' ·tool';
  return raw;
}

function stepToMacro(step) {
  var t = step.type;
  if (t === 'TransitionStep') {
    var toAgent = step.data && step.data.to_agent;
    if (toAgent) return handoffMacroId(toAgent);
    return null;
  }
  if (t === 'NodeEntryStateStep') return 'Entry';
  if (t === 'VariableUpdateStep' || t === 'BeforeReasoningIterationStep' || t === 'AfterReasoningStep' || t === 'EnabledToolsStep')
    return 'Prep';
  if (t === 'LLMStep') return 'LLM';
  if (t === 'FunctionStep') return functionStepMacroId(step);
  if (t === 'UserInputStep') return 'UserInput';
  if (t === 'PlannerResponseStep' || t === 'ReasoningStep') return 'Response';
  return null;
}

function emptyTopicDetails() {
  return {
    variableNames: new Set(),
    variableUpdates: [],
    enabledTools: new Set(),
    toolsSent: new Set(),
    toolsInvoked: new Set(),
    toolsExecuted: new Set(),
    toolInvocations: [],
    functionsExecuted: [],
    promptNames: new Set(),
    beforeReasoningActions: new Set(),
  };
}

function ensureTopicDetails(map, topic) {
  if (!topic || topic === 'none') return null;
  if (!map[topic]) map[topic] = emptyTopicDetails();
  return map[topic];
}

function stepDurationMs(step) {
  var a = step.startExecutionTime;
  var b = step.endExecutionTime;
  if (a == null || b == null) return 0;
  var d = b - a;
  return d > 0 ? d : 0;
}

function withStepDuration(subtitle, step) {
  var d = stepDurationMs(step);
  if (!d) return subtitle || '';
  var bit = d + 'ms';
  if (!subtitle) return bit;
  return subtitle.includes(bit) ? subtitle : subtitle + ' · ' + bit;
}

function computePlanExecutionStats(plan) {
  var empty = { steps: 0, llm: 0, fn: 0, transition: 0, wall: 0 };
  if (!plan || !plan.length) return empty;
  var llm = 0, fn = 0, transition = 0;
  for (var i = 0; i < plan.length; i++) {
    if (plan[i].type === 'LLMStep') llm++;
    if (plan[i].type === 'FunctionStep') fn++;
    if (plan[i].type === 'TransitionStep') transition++;
  }
  var wall = plan.length > 1
    ? (plan[plan.length - 1].endExecutionTime || 0) - (plan[0].startExecutionTime || 0)
    : stepDurationMs(plan[0]) || 0;
  return { steps: plan.length, llm: llm, fn: fn, transition: transition, wall: wall };
}

function filterVariableUpdates(updates, prefs) {
  return updates.filter(function (u) {
    var n = String(u.variable_name || '');
    if (!prefs.showAgentScriptVars && n.startsWith('AgentScriptInternal_')) return false;
    return true;
  });
}

function countVisibleVarUpdates(step, prefs) {
  var updates = step.data?.variable_updates || [];
  if (!updates.length) return 0;
  return filterVariableUpdates(updates, prefs).length;
}

function timelineEventMatchesFilters(ev, plan, prefs) {
  var k = ev.kind;
  if (k === 'variable') {
    if (!prefs.varUpdates) return false;
    var step = plan[ev.stepIndex];
    var all = step.data?.variable_updates || [];
    if (!all.length) return true;
    return countVisibleVarUpdates(step, prefs) > 0;
  }
  if (k === 'action' || k === 'response') return !!prefs.reasoning;
  if (k === 'entry') return !!prefs.nodeEntry;
  if (k === 'enabled') return !!prefs.enabledTools;
  return true;
}

function applyTimelineFilters(plan, rawEvents, prefs) {
  return rawEvents.filter(function (ev) { return timelineEventMatchesFilters(ev, plan, prefs); });
}

function makeTimelineEvent(stepIndex, t, macro, kind, title, subtitle) {
  return { stepIndex: stepIndex, t: t, macro: macro, kind: kind, title: title, subtitle: subtitle };
}

function buildRawTopicTimeline(plan, topicId, stepTopicMap) {
  var events = [];
  if (!plan || !topicId) return events;
  for (var i = 0; i < plan.length; i++) {
    var topic = stepTopicMap ? stepTopicMap[i] : 'none';
    if (topic !== topicId) continue;
    var step = plan[i];
    var d = step.data || {};
    var t = step.startExecutionTime || 0;

    if (step.type === 'TransitionStep') {
      var toAgent = d.to_agent ? String(d.to_agent).trim() : '';
      events.push(makeTimelineEvent(i, t, toAgent ? handoffMacroId(toAgent) : null, 'transition',
        toAgent ? 'Handoff → ' + toAgent : 'Handoff (leaving sub agent)', withStepDuration('', step)));
      continue;
    }
    if (step.type === 'UserInputStep') {
      events.push(makeTimelineEvent(i, t, 'UserInput', 'user', 'User input', withStepDuration('', step)));
    }
    if (step.type === 'NodeEntryStateStep') {
      var sub = d.directive_context ? esc(String(d.directive_context)) : '';
      events.push(makeTimelineEvent(i, t, 'Entry', 'entry', 'Node entry', withStepDuration(sub, step)));
    }
    if (step.type === 'VariableUpdateStep') {
      events.push(makeTimelineEvent(i, t, 'Prep', 'variable', 'Variable update', withStepDuration('', step)));
    }
    if (step.type === 'BeforeReasoningIterationStep') {
      events.push(makeTimelineEvent(i, t, 'Prep', 'action', 'Prep · actions processed', withStepDuration('', step)));
    }
    if (step.type === 'EnabledToolsStep') {
      events.push(makeTimelineEvent(i, t, 'Prep', 'enabled', 'Tools enabled for agent', withStepDuration('', step)));
    }
    if (step.type === 'LLMStep') {
      var lat = d.execution_latency != null ? esc(String(d.execution_latency)) + ' ms' : '';
      var subParts = [d.agent_name && esc(String(d.agent_name)), d.prompt_name && esc(String(d.prompt_name)), lat].filter(Boolean);
      events.push(makeTimelineEvent(i, t, 'LLM', 'llm_sent', 'LLM call', withStepDuration(subParts.join(' · '), step)));
    }
    if (step.type === 'FunctionStep') {
      var fn = step.function || {};
      var macroId = functionStepMacroId(step);
      var latSub = step.executionLatency != null ? esc(String(step.executionLatency)) + ' ms' : '';
      events.push(makeTimelineEvent(i, t, macroId, 'execute', 'Tool executed', withStepDuration(latSub, step)));
    }
    if (step.type === 'PlannerResponseStep' || step.type === 'ReasoningStep') {
      events.push(makeTimelineEvent(i, t, 'Response', 'response',
        step.type === 'PlannerResponseStep' ? 'Planner response' : 'Reasoning', withStepDuration('', step)));
    }
  }
  return events;
}

function parsePlan(plan) {
  var displayNames = Object.create(null);
  var topicSet = new Set();
  var edgeMap = new Map();
  var fsmSequences = Object.create(null);
  var topicDetails = Object.create(null);
  var stepTopicMap = new Array(plan.length);

  var prevAgent = 'none';
  for (var i = 0; i < plan.length; i++) {
    var step = plan[i];
    var d = step.data || {};

    if (step.type === 'TransitionStep') {
      recordDisplay(displayNames, agentKey(d.from_agent), d.from_agent);
      recordDisplay(displayNames, agentKey(d.to_agent), d.to_agent);
      var from = agentKey(d.from_agent);
      var to = agentKey(d.to_agent);
      if (from !== 'none' && d.current_state && typeof d.current_state === 'object') {
        var td = ensureTopicDetails(topicDetails, from);
        if (td) for (var k of Object.keys(d.current_state)) td.variableNames.add(k);
      }
      if (from !== 'none' && to !== 'none') {
        topicSet.add(from);
        topicSet.add(to);
        var key = from + '\0' + to;
        var dur = (step.endExecutionTime - step.startExecutionTime) || 0;
        if (!edgeMap.has(key)) edgeMap.set(key, { from: from, to: to, count: 0, weight: 0 });
        var e = edgeMap.get(key);
        e.count++;
        e.weight += dur;
      }
    }
    if (step.type === 'NodeEntryStateStep') {
      recordDisplay(displayNames, agentKey(d.agent_name), d.agent_name);
      var nk = agentKey(d.agent_name);
      if (nk !== 'none' && d.state_variables && typeof d.state_variables === 'object') {
        var td2 = ensureTopicDetails(topicDetails, nk);
        if (td2) for (var k2 of Object.keys(d.state_variables)) td2.variableNames.add(k2);
      }
    }
    if (step.type === 'LLMStep' || step.type === 'EnabledToolsStep') recordDisplay(displayNames, agentKey(d.agent_name), d.agent_name);

    var topic = getAgentForStep(step, prevAgent);
    stepTopicMap[i] = topic;

    if (step.type === 'VariableUpdateStep') {
      var td3 = ensureTopicDetails(topicDetails, topic);
      if (td3) {
        var updates = d.variable_updates || [];
        for (var ui = 0; ui < updates.length; ui++) {
          var u = updates[ui];
          if (u.variable_name) td3.variableNames.add(String(u.variable_name));
          td3.variableUpdates.push({
            stepIndex: i, name: u.variable_name, past: u.variable_past_value,
            new: u.variable_new_value, reason: u.variable_change_reason, directive: u.directive_context,
          });
        }
      }
    }

    if (step.type === 'BeforeReasoningIterationStep') {
      var td4 = ensureTopicDetails(topicDetails, topic);
      if (td4) for (var a of d.action_names || []) td4.beforeReasoningActions.add(String(a));
    }

    if (step.type === 'EnabledToolsStep') {
      var td5 = ensureTopicDetails(topicDetails, topic);
      if (td5) for (var x of d.enabled_tools || []) td5.enabledTools.add(String(x));
    }

    if (step.type === 'LLMStep') {
      var td6 = ensureTopicDetails(topicDetails, topic);
      if (td6) {
        if (d.prompt_name) td6.promptNames.add(String(d.prompt_name));
        for (var xi = 0; xi < (step.tools_sent || []).length; xi++) td6.toolsSent.add(String(step.tools_sent[xi]));
        for (var mi = 0; mi < (step.response_messages || []).length; mi++) {
          var invocations = extractToolInvocations(step.response_messages[mi]);
          for (var ii = 0; ii < invocations.length; ii++) {
            var nm = String(invocations[ii].name);
            td6.toolsInvoked.add(nm);
            td6.toolInvocations.push({ name: nm, arguments: invocations[ii].arguments, stepIndex: i });
          }
        }
      }
    }

    if (step.type === 'FunctionStep') {
      var fn = step.function;
      var td7 = ensureTopicDetails(topicDetails, topic);
      if (td7 && fn && fn.name) {
        var nm2 = String(fn.name);
        td7.toolsExecuted.add(nm2);
        td7.functionsExecuted.push({
          name: nm2, input: fn.input, output: fn.output,
          latency: step.executionLatency, start: step.startExecutionTime, stepIndex: i,
        });
      }
    }

    prevAgent = topic;
    if (topic !== 'none') topicSet.add(topic);

    var macro = stepToMacro(step);
    if (macro && topic !== 'none') {
      if (!fsmSequences[topic]) fsmSequences[topic] = [];
      fsmSequences[topic].push(macro);
    }
  }

  var fsmEdges = Object.create(null);
  for (var topicKey of Object.keys(fsmSequences)) {
    var seq = fsmSequences[topicKey];
    var trans = new Map();
    for (var j = 1; j < seq.length; j++) {
      var a2 = seq[j - 1];
      var b = seq[j];
      var k3 = a2 + '\0' + b;
      trans.set(k3, (trans.get(k3) || 0) + 1);
    }
    fsmEdges[topicKey] = trans;
  }

  topicSet.delete('none');

  return {
    displayNames: displayNames,
    topics: [...topicSet],
    transitionEdges: [...edgeMap.values()],
    fsmSequences: fsmSequences,
    fsmEdges: fsmEdges,
    topicDetails: topicDetails,
    stepTopicMap: stepTopicMap,
  };
}

function buildSimpleDigraph(topics, transitionEdges) {
  var topicSet = new Set(topics);
  var adj = Object.create(null);
  var adjR = Object.create(null);
  for (var i = 0; i < topics.length; i++) {
    adj[topics[i]] = [];
    adjR[topics[i]] = [];
  }
  var edgeSet = new Set();
  for (var ei = 0; ei < transitionEdges.length; ei++) {
    var e = transitionEdges[ei];
    if (!topicSet.has(e.from) || !topicSet.has(e.to)) continue;
    var key = e.from + '->' + e.to;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      adj[e.from].push(e.to);
      adjR[e.to].push(e.from);
    }
  }
  return { adj: adj, adjR: adjR, mUnique: edgeSet.size };
}

function kosarajuSCC(topics, adj, adjR) {
  var visited = Object.create(null);
  var order = [];
  for (var si = 0; si < topics.length; si++) {
    var start = topics[si];
    if (visited[start]) continue;
    var stack = [{ v: start, i: 0 }];
    visited[start] = true;
    while (stack.length) {
      var frame = stack[stack.length - 1];
      var neighbors = adj[frame.v] || [];
      if (frame.i < neighbors.length) {
        var w = neighbors[frame.i++];
        if (!visited[w]) { visited[w] = true; stack.push({ v: w, i: 0 }); }
      } else { order.push(frame.v); stack.pop(); }
    }
  }

  var comp = Object.create(null);
  var cid = 0;
  for (var i = order.length - 1; i >= 0; i--) {
    var start2 = order[i];
    if (comp[start2] !== undefined) continue;
    var stack2 = [{ v: start2, i: 0 }];
    comp[start2] = cid;
    while (stack2.length) {
      var frame2 = stack2[stack2.length - 1];
      var neighbors2 = adjR[frame2.v] || [];
      if (frame2.i < neighbors2.length) {
        var w2 = neighbors2[frame2.i++];
        if (comp[w2] === undefined) { comp[w2] = cid; stack2.push({ v: w2, i: 0 }); }
      } else { stack2.pop(); }
    }
    cid++;
  }
  var groups = [];
  for (var gi = 0; gi < cid; gi++) groups.push([]);
  for (var vi = 0; vi < topics.length; vi++) groups[comp[topics[vi]]].push(topics[vi]);
  return { comp: comp, groups: groups, count: cid };
}

function buildUndirectedAdj(topics, adj) {
  var und = Object.create(null);
  for (var i = 0; i < topics.length; i++) und[topics[i]] = [];
  var seen = Object.create(null);
  for (var ui = 0; ui < topics.length; ui++) {
    var u = topics[ui];
    for (var vi = 0; vi < (adj[u] || []).length; vi++) {
      var v = adj[u][vi];
      var fwd = u + '\0' + v;
      var rev = v + '\0' + u;
      if (!seen[fwd]) { seen[fwd] = true; und[u].push(v); }
      if (!seen[rev]) { seen[rev] = true; und[v].push(u); }
    }
  }
  return und;
}

function weaklyConnectedComponents(topics, und) {
  var seen = Object.create(null);
  var comps = [];
  for (var si = 0; si < topics.length; si++) {
    var start = topics[si];
    if (seen[start]) continue;
    var stack = [start];
    var cur = [];
    seen[start] = true;
    while (stack.length) {
      var u = stack.pop();
      cur.push(u);
      for (var vi = 0; vi < (und[u] || []).length; vi++) {
        var v = und[u][vi];
        if (!seen[v]) { seen[v] = true; stack.push(v); }
      }
    }
    comps.push(cur);
  }
  return comps;
}

function bfsDistancesUndirected(start, und) {
  var dist = Object.create(null);
  var q = [start];
  dist[start] = 0;
  for (var qi = 0; qi < q.length; qi++) {
    var u = q[qi];
    for (var vi = 0; vi < (und[u] || []).length; vi++) {
      var v = und[u][vi];
      if (dist[v] === undefined) {
        dist[v] = dist[u] + 1;
        q.push(v);
      }
    }
  }
  return dist;
}

function undirectedDiameter(topics, und) {
  if (topics.length <= 1) return 0;
  var diam = 0;
  for (var si = 0; si < topics.length; si++) {
    var d = bfsDistancesUndirected(topics[si], und);
    for (var ti = 0; ti < topics.length; ti++) {
      if (d[topics[ti]] !== undefined && d[topics[ti]] > diam) diam = d[topics[ti]];
    }
  }
  return diam;
}

function brandesBetweennessUndirected(topics, und) {
  var C = Object.create(null);
  for (var i = 0; i < topics.length; i++) C[topics[i]] = 0;

  for (var si = 0; si < topics.length; si++) {
    var s = topics[si];
    var S = [];
    var P = Object.create(null);
    var sigma = Object.create(null);
    var d = Object.create(null);
    for (var j = 0; j < topics.length; j++) {
      P[topics[j]] = [];
      sigma[topics[j]] = 0;
      d[topics[j]] = -1;
    }
    sigma[s] = 1;
    d[s] = 0;
    var Q = [s];
    for (var qi = 0; qi < Q.length; qi++) {
      var v = Q[qi];
      S.push(v);
      for (var wi = 0; wi < und[v].length; wi++) {
        var w = und[v][wi];
        if (d[w] < 0) { Q.push(w); d[w] = d[v] + 1; }
        if (d[w] === d[v] + 1) { P[w].push(v); sigma[w] += sigma[v]; }
      }
    }
    var delta = Object.create(null);
    for (var di = 0; di < topics.length; di++) delta[topics[di]] = 0;
    while (S.length) {
      var w2 = S.pop();
      for (var pi = 0; pi < P[w2].length; pi++) {
        var v2 = P[w2][pi];
        delta[v2] += sigma[v2] / sigma[w2] * (1 + delta[w2]);
      }
      if (w2 !== s) C[w2] += delta[w2];
    }
  }
  for (var ci = 0; ci < topics.length; ci++) C[topics[ci]] /= 2;
  return C;
}

function analyzeGraph(parsed) {
  var topics = parsed.topics;
  var transitionEdges = parsed.transitionEdges;
  var n = topics.length;
  var mMulti = transitionEdges.reduce(function (s, e) { return s + e.count; }, 0);
  var dg = buildSimpleDigraph(topics, transitionEdges);
  var adj = dg.adj, adjR = dg.adjR, mUnique = dg.mUnique;
  var density = n > 1 ? mUnique / (n * (n - 1)) : 0;

  var indeg = Object.create(null);
  var outdeg = Object.create(null);
  for (var i = 0; i < topics.length; i++) {
    indeg[topics[i]] = 0;
    outdeg[topics[i]] = adj[topics[i]].length;
  }
  for (var ui = 0; ui < topics.length; ui++) {
    for (var vi = 0; vi < adj[topics[ui]].length; vi++) {
      indeg[adj[topics[ui]][vi]]++;
    }
  }

  var scc = kosarajuSCC(topics, adj, adjR);
  var und = buildUndirectedAdj(topics, adj);
  var wcc = weaklyConnectedComponents(topics, und);
  var nontrivialScc = scc.groups.filter(function (g) { return g.length > 1; });
  var selfLoops = transitionEdges.filter(function (e) { return e.from === e.to && e.count > 0; });

  var diam = n > 0 ? undirectedDiameter(topics, und) : 0;
  var between = n > 0 && n <= 40 ? brandesBetweennessUndirected(topics, und) : null;

  var maxBt = null;
  var maxBtVal = -1;
  if (between) {
    for (var bi = 0; bi < topics.length; bi++) {
      if (between[topics[bi]] > maxBtVal) {
        maxBtVal = between[topics[bi]];
        maxBt = topics[bi];
      }
    }
  }

  var treeLower = wcc.length === 1 && n > 0 ? n - 1 : null;
  var redundancy = mMulti - mUnique;

  var prose = [];
  if (wcc.length > 1) {
    prose.push('This trace spans <strong>' + wcc.length + '</strong> weakly connected sub agent islands — handoffs do not connect all sub agents in one component.');
  } else if (n > 0) {
    prose.push('All sub agents sit in one weakly connected component.');
  }
  if (nontrivialScc.length > 0) {
    prose.push('Strongly connected components with 2+ sub agents: <strong>' + nontrivialScc.length + '</strong> — routing may form directed cycles (revisit sub agents).');
  } else if (n > 0 && mUnique > 0) {
    prose.push('Sub agent digraph is acyclic at the simple-edge level (DAG-like); flow is easier to follow.');
  }
  if (treeLower != null && mUnique > treeLower) {
    prose.push('Unique transition arcs (<strong>' + mUnique + '</strong>) exceed the tree lower bound (<strong>' + treeLower + '</strong>) for a connected graph — extra paths or repeated topology.');
  }
  if (redundancy > 0) {
    prose.push('<strong>' + redundancy + '</strong> repeated handoff(s) on the same arc (multiplicity &gt; 1).');
  }
  if (maxBt && maxBtVal > 0) {
    prose.push('Highest betweenness (undirected): <strong>' + esc(parsed.displayNames[maxBt] || maxBt) + '</strong> — potential orchestration bottleneck.');
  }

  return {
    n: n, mMulti: mMulti, mUnique: mUnique, density: density,
    indeg: indeg, outdeg: outdeg, scc: scc, wcc: wcc,
    nontrivialScc: nontrivialScc, selfLoops: selfLoops,
    diam: diam, between: between, maxBt: maxBt, maxBtVal: maxBtVal,
    treeLower: treeLower, redundancy: redundancy, prose: prose,
  };
}
