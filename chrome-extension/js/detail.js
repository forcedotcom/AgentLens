function truncateJSON(obj, n) {
  try {
    var s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  } catch (e) {
    return String(obj).slice(0, n);
  }
}

function prettyJSON(obj, limit) {
  try {
    var s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    return s.length > (limit || 2000) ? s.slice(0, (limit || 2000) - 1) + '…' : s;
  } catch (e) { return String(obj); }
}

function parsePromptContentToMessages(str) {
  if (!str || typeof str !== 'string') return [];
  try {
    var arr = JSON.parse(str);
    if (!Array.isArray(arr)) return [];
    return arr.map(function (item) {
      var role = item.role || 'unknown';
      var content = '';
      if (item.blocks && Array.isArray(item.blocks)) {
        content = item.blocks.map(function (b) { return (b && b.text != null ? String(b.text) : ''); }).join('\n');
      } else if (typeof item.content === 'string') {
        content = item.content;
      }
      return { role: role, content: content };
    });
  } catch (e) {
    return [];
  }
}

function normalizeLlmMessages(step) {
  var d = step.data || {};
  var msgs = step.messages_sent;
  if (!msgs || !msgs.length) msgs = parsePromptContentToMessages(d.prompt_content);
  return Array.isArray(msgs) ? msgs : [];
}

function splitLlmMessages(msgs) {
  var system = [];
  var thread = [];
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    var role = (m && m.role) || 'unknown';
    var content = m.content == null ? '' : String(m.content);
    if (role === 'system') system.push({ role: role, content: content });
    else thread.push({ role: role, content: content });
  }
  return { system: system, thread: thread };
}

function fsmLlmMessageBubble(role, content) {
  var r = role === 'tool' ? 'tool' : role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system';
  var cls = 'fsm-msg-bubble fsm-msg-' + r;
  var trimmed = (content || '').trim();
  var body;
  if (trimmed) body = esc(content);
  else if (role === 'assistant')
    body = '<span style="opacity:.75;font-style:italic">(no text — likely tool call)</span>';
  else body = '<span style="opacity:.65">(empty)</span>';
  return '<div class="' + cls + '"><div class="fsm-msg-role">' + esc(role) + '</div><div class="fsm-msg-body">' + body + '</div></div>';
}

function renderToolChipsHtml(tools) {
  return tools.length > 0
    ? '<div class="fsm-chips">' + tools.map(function (x) { return '<span class="fsm-chip fsm-chip-sent">' + esc(String(x)) + '</span>'; }).join(' ') + '</div>'
    : '<div class="fsm-kv">—</div>';
}

function renderResponseMessagesHtml(resp, maxHeight, truncLen) {
  if (!resp.length) return '<div class="fsm-kv">—</div>';
  return resp.map(function (m) {
    var invocations = extractToolInvocations(m);
    if (invocations.length) {
      return invocations.map(function (inv) {
        return '<pre class="fsm-pre" style="max-height:' + maxHeight + 'px"><b>Tool call</b> ' + esc(String(inv.name)) + '(' + esc(truncateJSON(inv.arguments, truncLen)) + ')</pre>';
      }).join('');
    }
    if (truncLen < 400) {
      return '<pre class="fsm-pre" style="max-height:' + maxHeight + 'px">' + esc(truncateJSON(m.content, truncLen)) + '</pre>';
    }
    return fsmLlmMessageBubble('assistant', m.content || '');
  }).join('');
}

function formatFsmLlmStepBody(step) {
  var msgs = normalizeLlmMessages(step);
  var split = splitLlmMessages(msgs);
  var system = split.system;
  var thread = split.thread;
  var html = '';

  html += '<div class="fsm-llm-section"><div class="fsm-llm-h">Tools available to the model</div>';
  html += renderToolChipsHtml(step.tools_sent || []);
  html += '</div>';

  html += '<div class="fsm-llm-section"><div class="fsm-llm-h">System prompt</div>';
  if (!system.length) html += '<div class="fsm-kv">—</div>';
  else {
    system.forEach(function (m, i) {
      if (system.length > 1)
        html += '<div class="fsm-kv" style="margin-bottom:4px">Part ' + (i + 1) + ' of ' + system.length + '</div>';
      html += '<pre class="fsm-pre" style="max-height:160px">' + esc(m.content) + '</pre>';
    });
  }
  html += '</div>';

  html += '<div class="fsm-llm-section"><div class="fsm-llm-h">Messages sent to the model</div>';
  if (!thread.length) html += '<div class="fsm-kv">—</div>';
  else html += thread.map(function (m) { return fsmLlmMessageBubble(m.role, m.content); }).join('');
  html += '</div>';

  html += '<div class="fsm-llm-section"><div class="fsm-llm-h">Model output</div>';
  html += renderResponseMessagesHtml(step.response_messages || [], 100, 600);
  html += '</div>';

  return html;
}

function buildFsmDetailHtml(ev, step) {
  if (!ev || !step) return '';
  var d = step.data || {};

  switch (ev.kind) {
    case 'variable': {
      var updates = d.variable_updates || [];
      if (!updates.length) return '<div class="fsm-detail-h">Sub Agent Setup <span class="fsm-detail-badge badge-purple">Variable Update</span></div><div class="fsm-kv">(empty)</div>';
      var html = '<div class="fsm-detail-h">Sub Agent Setup <span class="fsm-detail-badge badge-purple">Variable Update</span></div>';
      var promptVar = 'AgentScriptInternal_agent_instructions';
      var promptUpdates = updates.filter(function (u) { return String(u.variable_name || '') === promptVar; });
      var otherUpdates = updates.filter(function (u) { return String(u.variable_name || '') !== promptVar; });
      if (promptUpdates.length) {
        html += '<div class="fsm-detail-section"><div class="fsm-detail-section-h">Prompt Buffer</div>';
        for (var pi = 0; pi < promptUpdates.length; pi++) {
          var u = promptUpdates[pi];
          var newVal = u.variable_new_value != null ? String(u.variable_new_value) : '';
          html += '<div class="fsm-detail-prompt-buf">' + esc(newVal || '(empty)') + '</div>';
          if (u.variable_change_reason) html += '<div class="fsm-kv" style="margin-top:4px;opacity:.75">' + esc(String(u.variable_change_reason)) + '</div>';
        }
        html += '</div>';
      }
      if (otherUpdates.length) {
        html += '<div class="fsm-detail-section"><div class="fsm-detail-section-h">Variables Changed</div>';
        for (var oi = 0; oi < otherUpdates.length; oi++) {
          var ou = otherUpdates[oi];
          var name = String(ou.variable_name || '');
          html += '<div class="fsm-detail-var">';
          html += '<div class="fsm-detail-var-name">' + esc(name) + '</div>';
          html += '<div class="fsm-detail-var-val old">' + esc(truncateJSON(ou.variable_past_value, 200)) + '</div>';
          html += '<div class="fsm-detail-var-val">→ ' + esc(truncateJSON(ou.variable_new_value, 200)) + '</div>';
          if (ou.variable_change_reason) html += '<div class="fsm-kv" style="margin-top:3px;opacity:.75">' + esc(String(ou.variable_change_reason)) + '</div>';
          html += '</div>';
        }
        html += '</div>';
      }
      return html;
    }
    case 'action': {
      var html2 = '<div class="fsm-detail-h">Sub Agent Setup <span class="fsm-detail-badge badge-purple">Actions Processed</span></div>';
      var names = d.action_names || [];
      if (names.length) {
        html2 += '<div class="fsm-detail-section"><div class="fsm-detail-section-h">Actions</div>';
        html2 += names.map(function (n) { return '<div class="fsm-kv">' + esc(String(n)) + '</div>'; }).join('');
        html2 += '</div>';
      } else html2 += '<div class="fsm-kv">—</div>';
      return html2;
    }
    case 'enabled': {
      var html3 = '<div class="fsm-detail-h">Sub Agent Setup <span class="fsm-detail-badge badge-purple">Enabled Tools</span></div>';
      var tools = d.enabled_tools || [];
      html3 += '<div class="fsm-chips" style="margin-top:6px">' + (tools.map(function (x) { return '<span class="fsm-chip">' + esc(String(x)) + '</span>'; }).join(' ') || '—') + '</div>';
      return html3;
    }
    case 'entry': {
      var html4 = '<div class="fsm-detail-h">Sub Agent Setup <span class="fsm-detail-badge badge-blue">Node Entry</span></div>';
      var sv = d.state_variables;
      if (sv && typeof sv === 'object') {
        var keys = Object.keys(sv);
        html4 += '<div class="fsm-detail-section"><div class="fsm-detail-section-h">' + keys.length + ' State Variables on Entry</div>';
        var promptVal = sv['AgentScriptInternal_agent_instructions'];
        if (promptVal != null && String(promptVal).trim()) {
          html4 += '<div class="fsm-detail-section-h" style="margin-top:8px">Current Prompt Buffer</div>';
          html4 += '<div class="fsm-detail-prompt-buf">' + esc(String(promptVal)) + '</div>';
        }
        var display = keys.filter(function (k) { return !k.startsWith('__') && !k.startsWith('AgentScriptInternal_'); }).slice(0, 20);
        if (display.length) {
          html4 += '<div class="fsm-detail-section-h" style="margin-top:8px">Key Variables</div>';
          for (var di = 0; di < display.length; di++) {
            html4 += '<div class="fsm-detail-var"><div class="fsm-detail-var-name">' + esc(display[di]) + '</div><div class="fsm-detail-var-val">' + esc(truncateJSON(sv[display[di]], 200)) + '</div></div>';
          }
        }
        html4 += '</div>';
      } else html4 += '<div class="fsm-kv">(no state variables)</div>';
      return html4;
    }
    case 'llm_sent': {
      var lat = d.execution_latency != null ? esc(String(d.execution_latency)) + ' ms' : '';
      var parts = [d.agent_name && esc(String(d.agent_name)), d.prompt_name && esc(String(d.prompt_name)), lat].filter(Boolean);
      var html5 = '<div class="fsm-detail-h">LLM Request <span class="fsm-detail-badge badge-blue">LLM</span></div>';
      if (parts.length) html5 += '<div class="fsm-detail-meta">' + parts.join(' · ') + '</div>';
      html5 += formatFsmLlmStepBody(step);
      return html5;
    }
    case 'execute': {
      var fn = step.function || {};
      var fnName = fn.name != null ? String(fn.name) : 'Function';
      var lat2 = step.executionLatency != null ? step.executionLatency + ' ms' : '';
      var html6 = '<div class="fsm-detail-h">Tool Execution <span class="fsm-detail-badge badge-teal">' + esc(fnName) + '</span>' + (lat2 ? ' <span class="fsm-detail-badge">' + esc(lat2) + '</span>' : '') + '</div>';
      html6 += '<div class="fsm-detail-exec">';
      html6 += '<div class="fsm-detail-section-h">Input</div>';
      html6 += '<pre>' + esc(prettyJSON(fn.input, 1500)) + '</pre>';
      html6 += '<div class="fsm-detail-section-h" style="margin-top:8px">Output</div>';
      html6 += '<pre>' + esc(prettyJSON(fn.output, 2000)) + '</pre>';
      html6 += '</div>';
      return html6;
    }
    case 'response': {
      if (step.type === 'PlannerResponseStep') {
        var msg = step.message || '';
        var rType = step.responseType || '';
        var safe = step.isContentSafe;
        var html7 = '<div class="fsm-detail-h">Agent Response <span class="fsm-detail-badge badge-green">Response</span>';
        if (rType) html7 += ' <span class="fsm-detail-badge">' + esc(rType) + '</span>';
        if (safe != null) html7 += ' <span class="fsm-detail-badge ' + (safe ? 'badge-green' : 'badge-orange') + '">' + (safe ? 'Safe' : 'Unsafe') + '</span>';
        html7 += '</div>';
        html7 += '<div class="fsm-detail-response">' + esc(msg) + '</div>';
        return html7;
      }
      if (step.type === 'ReasoningStep') {
        var cat = step.category || '';
        var reason = step.reason || '';
        var html8 = '<div class="fsm-detail-h">Grounding Check <span class="fsm-detail-badge badge-orange">Reasoning</span>';
        if (cat) html8 += ' <span class="fsm-detail-badge">' + esc(cat) + '</span>';
        html8 += '</div>';
        html8 += '<div class="fsm-detail-reason">' + esc(reason) + '</div>';
        return html8;
      }
      return '<div class="fsm-detail-h">Response</div><div class="fsm-kv">' + esc(truncateJSON(d, 300)) + '</div>';
    }
    case 'user': {
      var html9 = '<div class="fsm-detail-h">User Input <span class="fsm-detail-badge badge-yellow">User</span></div>';
      html9 += '<div class="fsm-detail-response" style="border-color:rgba(251,191,36,.35);background:rgba(251,191,36,.08)">' + esc(step.message || '') + '</div>';
      return html9;
    }
    case 'transition': {
      var html10 = '<div class="fsm-detail-h">Sub Agent Handoff <span class="fsm-detail-badge badge-orange">Transition</span></div>';
      html10 += '<div class="fsm-kv">To: <strong>' + esc(String(d.to_agent || '')) + '</strong></div>';
      html10 += '<div class="fsm-kv">' + esc(String(d.transition_type || '')) + ' · ' + esc(String(d.transition_mode || '')) + '</div>';
      if (d.from_agent) html10 += '<div class="fsm-kv">From: ' + esc(String(d.from_agent)) + '</div>';
      return html10;
    }
    default:
      return '';
  }
}
