// SVG rendering and DOM manipulation for graphs.

function svgEl(name, attrs, parent) {
  var n = document.createElementNS('http://www.w3.org/2000/svg', name);
  if (attrs) for (var k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function layoutRing(ids, cx, cy, R) {
  var pos = Object.create(null);
  var n = ids.length;
  if (n === 0) return pos;
  if (n === 1) { pos[ids[0]] = { x: cx, y: cy }; return pos; }
  ids.forEach(function (id, i) {
    var ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
    pos[id] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  });
  return pos;
}

function pointToward(ox, oy, tx, ty, radius, gap) {
  var dx = tx - ox, dy = ty - oy;
  var len = Math.hypot(dx, dy) || 1;
  var r = radius + (gap || 0);
  return { x: ox + (dx / len) * r, y: oy + (dy / len) * r };
}

function curvedPath(x1, y1, x2, y2, bend) {
  if (!bend) return 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2;
  var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  var dx = x2 - x1, dy = y2 - y1;
  var len = Math.hypot(dx, dy) || 1;
  var ox = (-dy / len) * bend, oy = (dx / len) * bend;
  return 'M ' + x1 + ' ' + y1 + ' Q ' + (mx + ox) + ' ' + (my + oy) + ' ' + x2 + ' ' + y2;
}

function selfLoopPath(cx, cy, r) {
  var s = r * 0.75;
  return 'M ' + (cx + s) + ' ' + (cy - r * 0.25) + ' A ' + (r * 1.2) + ' ' + (r * 1.2) + ' 0 1 1 ' + (cx - s * 0.85) + ' ' + (cy - r * 0.15);
}

function svgTextLines(text, maxChars, sep) {
  var maxW = maxChars || 13;
  if (text.length <= maxW) return [text];
  var s = sep || (text.includes('_') ? '_' : ' ');
  var parts = text.split(s === '_' ? /_/ : /\s+/);
  if (parts.length >= 2) {
    var mid = Math.ceil(parts.length / 2);
    var line1 = parts.slice(0, mid).join(s);
    var line2 = parts.slice(mid).join(s);
    if (line1.length <= maxW + 2 && line2.length <= maxW + 2) return [line1, line2];
  }
  return [text.length > maxW ? text.slice(0, maxW - 1) + '…' : text];
}

function clearFsmPanel() {
  detachFsmKeyboardNav();
  fsmPlayback.events = [];
  fsmPlayback.rawEvents = [];
  fsmPlayback.nodeMap = null;
  fsmPlayback.edgePathMap = null;
  fsmPlayback.idx = -1;
  document.getElementById('fsmTopicLabel').textContent = 'select a sub agent →';
  document.getElementById('fsmTopicLabel').style.opacity = '.5';
  document.getElementById('fsmDiagramLabel').textContent = 'select a sub agent';
  document.getElementById('fsmWrap').innerHTML = '';
  document.getElementById('inspectorPlaybar').style.display = 'none';
  document.getElementById('fsmDetailSlot').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);font-size:13px">Select a sub agent from the list on the right to begin.</div>';
}

function renderTopicGraph(parsed) {
  vizParsed = parsed;
  var el = document.getElementById('topicGraph');
  el.innerHTML = '';
  var VB_W = 760, VB_H = 480;
  var cx = VB_W / 2, cy = VB_H / 2;
  var topics = parsed.topics;
  var orbitR = Math.min(VB_W, VB_H) * (0.3 + Math.min(0.06, topics.length * 0.004));
  var nodeR = Math.max(36, Math.min(44, Math.floor(340 / (topics.length + 2.5))));
  var pos = layoutRing(topics, cx, cy, topics.length === 1 ? 0 : orbitR);

  var svg = svgEl('svg', { class: 'svg-graph', viewBox: '0 0 ' + VB_W + ' ' + VB_H, preserveAspectRatio: 'xMidYMid meet' }, el);
  svg.setAttribute('overflow', 'visible');
  var defs = svgEl('defs', {}, svg);
  var m = svgEl('marker', { id: 'topicArrow', markerWidth: '12', markerHeight: '10', refX: '11', refY: '5', orient: 'auto', markerUnits: 'userSpaceOnUse' }, defs);
  svgEl('path', { d: 'M 0 0.5 L 0 9.5 L 11 5 z', fill: 'var(--text)', opacity: '0.7' }, m);

  var edgeGroup = svgEl('g', { class: 'edges' }, svg);
  var pairCount = Object.create(null);
  parsed.transitionEdges.forEach(function (e) {
    var pk = e.from < e.to ? e.from + '|' + e.to : e.to + '|' + e.from;
    pairCount[pk] = (pairCount[pk] || 0) + 1;
  });
  var pairIndex = Object.create(null);
  parsed.transitionEdges.forEach(function (e) {
    var p1 = pos[e.from], p2 = pos[e.to];
    if (!p1 || !p2) return;
    var pk = e.from < e.to ? e.from + '|' + e.to : e.to + '|' + e.from;
    var total = pairCount[pk] || 1;
    var idx = pairIndex[pk] || 0;
    pairIndex[pk] = idx + 1;
    var bend = 0;
    if (e.from === e.to) bend = 0;
    else if (total > 1) bend = (idx - (total - 1) / 2) * 20;
    var dpath, lx, ly;
    if (e.from === e.to) {
      dpath = selfLoopPath(p1.x, p1.y, nodeR);
      lx = p1.x + nodeR * 1.15; ly = p1.y - nodeR * 1.35;
    } else {
      var a = pointToward(p1.x, p1.y, p2.x, p2.y, nodeR, 2);
      var b = pointToward(p2.x, p2.y, p1.x, p1.y, nodeR, 4);
      dpath = curvedPath(a.x, a.y, b.x, b.y, bend);
      lx = (a.x + b.x) / 2; ly = (a.y + b.y) / 2;
      if (bend) {
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var dx = b.x - a.x, dy = b.y - a.y;
        var len = Math.hypot(dx, dy) || 1;
        lx = mx + (-dy / len) * bend * 0.45;
        ly = my + (dx / len) * bend * 0.45;
      }
    }
    var path = svgEl('path', { class: 'edge', d: dpath }, edgeGroup);
    path.setAttribute('marker-end', 'url(#topicArrow)');
    var label = e.count > 1 ? String(e.count) : '';
    if (label) {
      var t = svgEl('text', { class: 'edge-label', x: String(lx), y: String(ly + 4) }, edgeGroup);
      t.textContent = '×' + label;
    }
    var ti = svgEl('title', {}, path);
    ti.textContent = e.count + ' handoff(s)';
  });

  topics.forEach(function (id) {
    var p = pos[id];
    var g = svgEl('g', { class: 'topic-node' + (id === selectedTopicId ? ' selected' : ''), 'data-topic-id': id }, svg);
    g.style.cursor = 'pointer';
    svgEl('circle', { cx: String(p.x), cy: String(p.y), r: String(nodeR) }, g);
    var raw = parsed.displayNames[id];
    var pretty = raw || id.replace(/_/g, ' ');
    var maxChars = Math.max(8, Math.floor(nodeR / 4));
    var tLines = svgTextLines(pretty, maxChars);
    var lineH = 14;
    var totalH = tLines.length * lineH;
    var startY = p.y - totalH / 2 + lineH * 0.6;
    var fontSize = tLines.some(function (l) { return l.length > maxChars; }) ? 11 : 12;
    var textEl = svgEl('text', { x: String(p.x), y: String(startY), style: 'font-size:' + fontSize + 'px' }, g);
    tLines.forEach(function (line, li) {
      var tspan = svgEl('tspan', { x: String(p.x), dy: li === 0 ? '0' : String(lineH) }, textEl);
      tspan.textContent = line;
    });
    var title = svgEl('title', {}, g);
    title.textContent = pretty + ' (' + id + ')';
  });

  svg.addEventListener('click', function (ev) {
    if (!vizParsed) return;
    if (el._zoomPanState && el._zoomPanState.didDrag) return;
    var hit = ev.target.closest('.topic-node');
    if (hit && hit.dataset.topicId) selectTopic(hit.dataset.topicId);
  });

  setupSvgZoomPan(el);
  renderTopicPills(parsed);
}

function selectTopic(topicId, startAtEnd) {
  selectedTopicId = topicId;
  var svg = document.getElementById('topicGraph').querySelector('svg');
  if (svg) updateTopicSelection(svg);
  document.querySelectorAll('.topic-pill').forEach(function (p) { p.classList.toggle('active', p.dataset.topicId === topicId); });
  renderFsm(topicId, vizParsed, startAtEnd);
}

function renderTopicPills(parsed) {
  var list = document.getElementById('topicList');
  list.innerHTML = '';
  for (var i = 0; i < parsed.topics.length; i++) {
    var id = parsed.topics[i];
    var pill = document.createElement('button');
    pill.className = 'topic-pill';
    pill.dataset.topicId = id;
    pill.textContent = parsed.displayNames[id] || id.replace(/_/g, ' ');
    pill.addEventListener('click', (function (tid) { return function () { selectTopic(tid); }; })(id));
    list.appendChild(pill);
  }
}

function updateTopicSelection(svg) {
  svg.querySelectorAll('.topic-node').forEach(function (g) {
    g.classList.toggle('selected', g.dataset.topicId === selectedTopicId);
  });
}

function syncFsmPlaybar() {
  var prev = document.getElementById('fsmBtnPrev');
  var next = document.getElementById('fsmBtnNext');
  var n = fsmPlayback.events.length;
  var topicIdx = vizParsed ? vizParsed.topics.indexOf(selectedTopicId) : -1;
  var hasPrevTopic = topicIdx > 0;
  var hasNextTopic = vizParsed && topicIdx >= 0 && topicIdx < vizParsed.topics.length - 1;
  if (prev) prev.disabled = fsmPlayback.idx <= 0 && !hasPrevTopic;
  if (next) next.disabled = n === 0 || fsmPlayback.idx < 0 || (fsmPlayback.idx >= n - 1 && !hasNextTopic);
}

function getTransitionTarget(ev) {
  if (!ev || ev.kind !== 'transition' || ev.stepIndex == null) return null;
  var step = currentData && currentData.plan && currentData.plan[ev.stepIndex];
  var toAgent = step && step.data && step.data.to_agent;
  return toAgent ? agentKey(toAgent) : null;
}

function navigateToAdjacentTopic(offset) {
  if (!vizParsed || !selectedTopicId) return false;
  var idx = vizParsed.topics.indexOf(selectedTopicId);
  var target = idx + offset;
  if (target < 0 || target >= vizParsed.topics.length) return false;
  selectTopic(vizParsed.topics[target], offset < 0);
  return true;
}

function stepFsmPrev() {
  if (fsmPlayback.idx > 0) {
    setFsmPlaybackIndex(fsmPlayback.idx - 1);
  } else {
    navigateToAdjacentTopic(-1);
  }
}

function stepFsmNext() {
  var n = fsmPlayback.events.length;
  if (fsmPlayback.idx < n - 1) {
    var target = getTransitionTarget(fsmPlayback.events[fsmPlayback.idx + 1]);
    if (target) { selectTopic(target); return; }
    setFsmPlaybackIndex(fsmPlayback.idx + 1);
  } else if (n > 0) {
    var target2 = getTransitionTarget(fsmPlayback.events[fsmPlayback.idx]);
    if (target2) { selectTopic(target2); return; }
    navigateToAdjacentTopic(1);
  }
}

function setFsmHighlight(macro, prevMacro) {
  if (!fsmPlayback.nodeMap) return;
  for (var id of Object.keys(fsmPlayback.nodeMap)) {
    var g = fsmPlayback.nodeMap[id];
    if (!macro) { g.classList.remove('active', 'dim'); }
    else { g.classList.toggle('active', id === macro); g.classList.toggle('dim', id !== macro); }
  }
  var eMap = fsmPlayback.edgePathMap;
  if (!eMap) return;
  var activeKey = (prevMacro && macro) ? prevMacro + '\0' + macro : null;
  for (var ek of Object.keys(eMap)) {
    var pathEl = eMap[ek];
    if (!macro) { pathEl.classList.remove('active', 'dim'); }
    else { pathEl.classList.toggle('active', ek === activeKey); pathEl.classList.toggle('dim', ek !== activeKey); }
  }
}

function setFsmPlaybackIndex(i) {
  var n = fsmPlayback.events.length;
  if (n === 0) return;
  var idx = Math.max(0, Math.min(n - 1, i));
  fsmPlayback.idx = idx;
  var ev = fsmPlayback.events[idx];
  var prevMacro = idx > 0 ? fsmPlayback.events[idx - 1].macro : null;
  setFsmHighlight(ev.macro, prevMacro);

  var lbl = document.getElementById('fsmStepLabel');
  if (lbl) lbl.textContent = (idx + 1) + ' / ' + n;

  var detailSlot = document.getElementById('fsmDetailSlot');
  if (detailSlot) {
    var plan = currentData && currentData.plan;
    if (plan && ev.stepIndex != null) {
      detailSlot.innerHTML = buildFsmDetailHtml(ev, plan[ev.stepIndex]);
    } else {
      detailSlot.innerHTML = '';
    }
    detailSlot.scrollTop = 0;
  }

  syncFsmPlaybar();
}

function setupSvgZoomPan(container) {
  var svg = container.querySelector('svg');
  if (!svg) return;
  var vb = svg.getAttribute('viewBox');
  if (!vb) return;
  var parts = vb.split(/\s+/).map(Number);
  var orig = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  var state = { x: orig.x, y: orig.y, w: orig.w, h: orig.h, dragging: false, startX: 0, startY: 0, startVBX: 0, startVBY: 0 };
  var MIN_SCALE = 0.33, MAX_SCALE = 3.0;

  var controls = document.createElement('div');
  controls.className = 'fsm-zoom-controls';
  var btnIn = document.createElement('button');
  btnIn.className = 'fsm-zoom-btn'; btnIn.textContent = '+'; btnIn.title = 'Zoom in';
  var btnOut = document.createElement('button');
  btnOut.className = 'fsm-zoom-btn'; btnOut.textContent = '−'; btnOut.title = 'Zoom out';
  var btnReset = document.createElement('button');
  btnReset.className = 'fsm-zoom-btn'; btnReset.textContent = '↺'; btnReset.title = 'Reset zoom';
  var levelSpan = document.createElement('span');
  levelSpan.className = 'fsm-zoom-level';
  controls.appendChild(btnIn); controls.appendChild(btnOut); controls.appendChild(btnReset); controls.appendChild(levelSpan);
  container.appendChild(controls);

  function applyVB() {
    svg.setAttribute('viewBox', state.x + ' ' + state.y + ' ' + state.w + ' ' + state.h);
    levelSpan.textContent = Math.round((orig.w / state.w) * 100) + '%';
  }

  function zoom(factor, zcx, zcy) {
    var newW = Math.max(orig.w * MIN_SCALE, Math.min(orig.w / MIN_SCALE, state.w * factor));
    var newH = newW * (orig.h / orig.w);
    if (newW / orig.w > MAX_SCALE || orig.w / newW > MAX_SCALE) return;
    var rx = (zcx - state.x) / state.w;
    var ry = (zcy - state.y) / state.h;
    state.x = zcx - rx * newW; state.y = zcy - ry * newH;
    state.w = newW; state.h = newH;
    applyVB();
  }

  svg.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    state.dragging = true; state.didDrag = false;
    state.startX = e.clientX; state.startY = e.clientY;
    state.startVBX = state.x; state.startVBY = state.y;
    svg.classList.add('panning'); svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', function (e) {
    if (!state.dragging) return;
    var rect = svg.getBoundingClientRect();
    var dx = (e.clientX - state.startX) / rect.width * state.w;
    var dy = (e.clientY - state.startY) / rect.height * state.h;
    if (Math.abs(e.clientX - state.startX) > 3 || Math.abs(e.clientY - state.startY) > 3) state.didDrag = true;
    state.x = state.startVBX - dx; state.y = state.startVBY - dy;
    applyVB();
  });
  svg.addEventListener('pointerup', function () { state.dragging = false; svg.classList.remove('panning'); });
  container._zoomPanState = state;

  btnIn.addEventListener('click', function () { zoom(0.75, state.x + state.w / 2, state.y + state.h / 2); });
  btnOut.addEventListener('click', function () { zoom(1.33, state.x + state.w / 2, state.y + state.h / 2); });
  btnReset.addEventListener('click', function () { state.x = orig.x; state.y = orig.y; state.w = orig.w; state.h = orig.h; applyVB(); });
  applyVB();
}

function renderFsmMacroSvg(container, trans) {
  container.innerHTML = '';
  var nodeIdSet = new Set();
  for (var k of trans.keys()) { var p = k.split('\0'); nodeIdSet.add(p[0]); nodeIdSet.add(p[1]); }
  var allIds = [...nodeIdSet];
  if (!allIds.length) return {};

  var fixedOrder = ['UserInput', 'Entry', 'Prep', 'LLM', 'Response'];
  var handoffIds = allIds.filter(function (id) { return isHandoffMacroId(id); }).sort();
  var toolIds = allIds.filter(function (id) { return !fixedOrder.includes(id) && !isHandoffMacroId(id); }).sort();
  var presentFixed = fixedOrder.filter(function (id) { return nodeIdSet.has(id); });

  var layers = [];
  for (var fi = 0; fi < presentFixed.length; fi++) {
    var fid = presentFixed[fi];
    if (fid === 'LLM') {
      layers.push({ ids: [fid], cat: 'llm' });
      if (toolIds.length) layers.push({ ids: toolIds, cat: 'tools' });
    } else if (fid === 'Prep') {
      layers.push({ ids: [fid], cat: 'process' });
    } else {
      layers.push({ ids: [fid], cat: 'state' });
    }
  }
  if (handoffIds.length) layers.push({ ids: handoffIds, cat: 'handoff' });
  if (!layers.length) layers.push({ ids: allIds, cat: 'tools' });

  var NW = 170, NH = 54, TW = 160, TH = 52, PW = 210, PH = 56, HW = 200, HH = 56;
  var layerGap = 90, toolGap = 28, maxToolCols = 4, sideM = 110;

  var maxW = NW;
  for (var li = 0; li < layers.length; li++) {
    var l = layers[li];
    if (l.cat === 'tools') { var c = Math.min(l.ids.length, maxToolCols); maxW = Math.max(maxW, c * TW + (c - 1) * toolGap); }
    if (l.cat === 'handoff') { var ch = Math.min(l.ids.length, maxToolCols); maxW = Math.max(maxW, ch * HW + (ch - 1) * toolGap); }
  }
  var VBW = sideM * 2 + maxW + 60;
  var cxf = VBW / 2;

  var pos = {}, layerOf = {};
  var curY = 48;
  layers.forEach(function (l, liIdx) {
    var n = l.ids.length;
    if ((l.cat === 'tools' || l.cat === 'handoff') && n > 1) {
      var cellW = l.cat === 'handoff' ? HW : TW;
      var cellH = l.cat === 'handoff' ? HH : TH;
      var cols = Math.min(n, maxToolCols);
      var rows = Math.ceil(n / cols);
      for (var i = 0; i < n; i++) {
        var row = Math.floor(i / cols), col = i % cols;
        var rc = Math.min(cols, n - row * cols);
        var rw = rc * cellW + (rc - 1) * toolGap;
        var sx = cxf - rw / 2 + cellW / 2;
        pos[l.ids[i]] = { x: sx + col * (cellW + toolGap), y: curY + row * (cellH + 14) + cellH / 2, w: cellW, h: cellH };
        layerOf[l.ids[i]] = liIdx;
      }
      curY += rows * (cellH + 14) - 14 + layerGap;
    } else {
      var w = l.cat === 'process' ? PW : l.cat === 'tools' ? TW : l.cat === 'handoff' ? HW : NW;
      var h = l.cat === 'process' ? PH : l.cat === 'tools' ? TH : l.cat === 'handoff' ? HH : NH;
      if (n === 1) {
        pos[l.ids[0]] = { x: cxf, y: curY + h / 2, w: w, h: h };
        layerOf[l.ids[0]] = liIdx;
      } else {
        var rw2 = n * w + (n - 1) * 16;
        var sx2 = cxf - rw2 / 2 + w / 2;
        l.ids.forEach(function (id, i) {
          pos[id] = { x: sx2 + i * (w + 16), y: curY + h / 2, w: w, h: h };
          layerOf[id] = liIdx;
        });
      }
      curY += layerGap;
    }
  });
  var VBH = curY + 24;

  var svg = svgEl('svg', { class: 'svg-graph fsm', viewBox: '0 0 ' + VBW + ' ' + VBH, preserveAspectRatio: 'xMidYMid meet' }, container);
  svg.setAttribute('overflow', 'visible');
  var defs = svgEl('defs', {}, svg);
  [['fsmArr', 'var(--text)', '0.7'], ['fsmArrBack', 'var(--teal)', '0.8'], ['fsmArrHandoff', 'var(--orange)', '0.85']].forEach(function (spec) {
    var mk = svgEl('marker', { id: spec[0], markerWidth: '10', markerHeight: '8', refX: '9', refY: '4', orient: 'auto', markerUnits: 'userSpaceOnUse' }, defs);
    svgEl('path', { d: 'M 0 0.5 L 0 7.5 L 9 4 z', fill: spec[1], opacity: spec[2] }, mk);
  });

  var annoG = svgEl('g', {}, svg);
  var hasToolBack = [...trans.keys()].some(function (k) { var p = k.split('\0'); return toolIds.includes(p[0]) && (p[1] === 'Prep' || p[1] === 'LLM'); });
  var loopBoxRight = 0;
  if (hasToolBack && pos['LLM'] && toolIds.some(function (id) { return pos[id]; })) {
    var lp = pos['LLM'];
    var tps = toolIds.map(function (id) { return pos[id]; }).filter(Boolean);
    var bx1 = Math.min(lp.x - lp.w / 2, ...tps.map(function (p) { return p.x - p.w / 2; })) - 20;
    var bx2 = Math.max(lp.x + lp.w / 2, ...tps.map(function (p) { return p.x + p.w / 2; })) + 20;
    var by1 = lp.y - lp.h / 2 - 16;
    var by2 = Math.max(...tps.map(function (p) { return p.y + p.h / 2; })) + 16;
    loopBoxRight = bx2;
    svgEl('rect', { class: 'fsm-loop-box fsm-loop-box--tool', x: String(bx1), y: String(by1), width: String(bx2 - bx1), height: String(by2 - by1), rx: '12', ry: '12' }, annoG);
    svgEl('text', { class: 'fsm-loop-label-text', x: String(bx2 - 4), y: String(by1 - 5), 'text-anchor': 'end' }, annoG).textContent = 'LLM ↔ TOOL EXECUTION LOOP';
  }

  var eG = svgEl('g', { class: 'edges' }, svg);
  var edgePathMap = Object.create(null);
  var backOff = 0;
  var toolResultLabelPlaced = false;
  for (var entry of trans) {
    var k2 = entry[0], c2 = entry[1];
    var parts2 = k2.split('\0');
    var fromId = parts2[0], toId = parts2[1];
    var p1 = pos[fromId], p2 = pos[toId];
    if (!p1 || !p2) continue;
    var li1 = layerOf[fromId], li2 = layerOf[toId];
    var self = fromId === toId;
    var back = !self && li2 <= li1;
    var skip = !self && !back && li2 - li1 > 1;
    var edgeKey = fromId + '\0' + toId;
    var toHandoff = isHandoffMacroId(toId);
    var fwdMarker = toHandoff ? 'url(#fsmArrHandoff)' : 'url(#fsmArr)';

    if (self) {
      var r = 20;
      var sx = p1.x + p1.w / 2;
      var d = 'M ' + sx + ' ' + (p1.y - p1.h * 0.3) + ' C ' + (sx + r * 2.8) + ' ' + (p1.y - p1.h - r * 0.5) + ', ' + (sx + r * 2.8) + ' ' + (p1.y + p1.h + r * 0.5) + ', ' + sx + ' ' + (p1.y + p1.h * 0.3);
      var path = svgEl('path', { class: 'edge', d: d, 'marker-end': fwdMarker, 'data-from': fromId, 'data-to': toId }, eG);
      edgePathMap[edgeKey] = path;
      if (c2 > 1) svgEl('text', { class: 'edge-label', x: String(sx + r * 2.8 + 6), y: String(p1.y + 3) }, eG).textContent = '×' + c2;
      svgEl('title', {}, eG.lastChild || eG).textContent = fromId + ' → ' + toId + ' · ' + c2 + '×';
    } else if (back) {
      backOff++;
      var off = 22 + backOff * 22;
      var x1 = p1.x - p1.w / 2, y1 = p1.y;
      var x2 = p2.x - p2.w / 2, y2 = p2.y;
      var sxb = Math.min(x1, x2) - off;
      var db = 'M ' + x1 + ' ' + y1 + ' C ' + sxb + ' ' + y1 + ', ' + sxb + ' ' + y2 + ', ' + x2 + ' ' + y2;
      var pathB = svgEl('path', { class: 'edge edge-back', d: db, 'marker-end': 'url(#fsmArrBack)', 'data-from': fromId, 'data-to': toId }, eG);
      edgePathMap[edgeKey] = pathB;
      svgEl('title', {}, pathB).textContent = fromId + ' → ' + toId + ' · ' + c2 + '×';
      var my = (y1 + y2) / 2;
      var lbl = '';
      var isToolResult = toolIds.includes(fromId) && (toId === 'Prep' || toId === 'LLM');
      if (isToolResult && !toolResultLabelPlaced) { lbl = 'tool result'; toolResultLabelPlaced = true; }
      else if (fromId === 'Response' && toId === 'Prep') { lbl = 'next iteration'; }
      if (lbl || c2 > 1) svgEl('text', { class: 'edge-label fsm-back-label', x: String(sxb - 4), y: String(my + 3), 'text-anchor': 'end' }, eG).textContent = lbl + (c2 > 1 ? ' ×' + c2 : '');
    } else if (skip) {
      var rSide = Math.max(p1.x + p1.w / 2, p2.x + p2.w / 2, loopBoxRight) + 32;
      var y1s = p1.y, y2s = p2.y;
      var ds = 'M ' + (p1.x + p1.w / 2) + ' ' + y1s + ' C ' + rSide + ' ' + y1s + ', ' + rSide + ' ' + y2s + ', ' + (p2.x + p2.w / 2) + ' ' + y2s;
      var pathS = svgEl('path', { class: 'edge', d: ds, 'marker-end': fwdMarker, 'data-from': fromId, 'data-to': toId }, eG);
      edgePathMap[edgeKey] = pathS;
      svgEl('title', {}, pathS).textContent = fromId + ' → ' + toId + ' · ' + c2 + '×';
      var mx2 = rSide + 6, my2 = (y1s + y2s) / 2;
      if (fromId === 'LLM' && toId === 'Response') {
        svgEl('text', { class: 'edge-label', x: String(mx2), y: String(my2), 'text-anchor': 'start' }, eG).textContent = 'exit: no tool call';
      }
      if (c2 > 1) svgEl('text', { class: 'edge-label', x: String(mx2), y: String(my2 + 12), 'text-anchor': 'start' }, eG).textContent = '×' + c2;
    } else {
      var x1f = p1.x, y1f = p1.y + p1.h / 2;
      var x2f = p2.x, y2f = p2.y - p2.h / 2;
      var df;
      if (Math.abs(x1f - x2f) < 3) df = 'M ' + x1f + ' ' + y1f + ' L ' + x2f + ' ' + y2f;
      else { var myf = (y1f + y2f) / 2; df = 'M ' + x1f + ' ' + y1f + ' C ' + x1f + ' ' + myf + ', ' + x2f + ' ' + myf + ', ' + x2f + ' ' + y2f; }
      var pathF = svgEl('path', { class: 'edge', d: df, 'marker-end': fwdMarker, 'data-from': fromId, 'data-to': toId }, eG);
      edgePathMap[edgeKey] = pathF;
      svgEl('title', {}, pathF).textContent = fromId + ' → ' + toId + ' · ' + c2 + '×';
      if (c2 > 1) {
        var mxf = (x1f + x2f) / 2, myff = (y1f + y2f) / 2;
        svgEl('text', { class: 'edge-label', x: String(mxf + 10), y: String(myff + 3) }, eG).textContent = '×' + c2;
      }
    }
  }

  var nodeMap = Object.create(null);
  for (var ni = 0; ni < allIds.length; ni++) {
    var id = allIds[ni];
    var p = pos[id];
    if (!p) continue;
    var isTool = toolIds.includes(id);
    var isProc = id === 'Prep';
    var isHandoff = isHandoffMacroId(id);
    var cls = 'fsm-node';
    if (isTool) cls += ' fsm-node--tool';
    if (isProc) cls += ' fsm-node--process';
    if (id === 'LLM') cls += ' fsm-node--llm';
    if (id === 'Response') cls += ' fsm-node--response';
    if (id === 'UserInput') cls += ' fsm-node--user';
    if (isHandoff) cls += ' fsm-node--handoff';

    var g = svgEl('g', { class: cls, 'data-macro': id }, svg);
    svgEl('rect', {
      x: String(p.x - p.w / 2), y: String(p.y - p.h / 2),
      width: String(p.w), height: String(p.h),
      rx: isProc ? '4' : isHandoff ? '6' : '10', ry: isProc ? '4' : isHandoff ? '6' : '10',
    }, g);

    if (isProc) {
      svgEl('text', { x: String(p.x), y: String(p.y - 4), class: 'fsm-node-label', style: 'font-size:13px' }, g).textContent = 'Sub Agent Setup';
      svgEl('text', { x: String(p.x), y: String(p.y + 12), class: 'fsm-node-sublabel', style: 'font-size:10px' }, g).textContent = 'variables · prompt buffer';
    } else if (isHandoff) {
      var topicName = handoffTargetName(id);
      var lines = svgTextLines(topicName, 24, '_');
      var lh = 15, totalHh = (lines.length + 1) * lh;
      var sy = p.y - totalHh / 2 + lh * 0.7;
      svgEl('text', { x: String(p.x), y: String(sy), class: 'fsm-node-sublabel', style: 'font-size:10px;font-weight:700;letter-spacing:.5px' }, g).textContent = 'SUB AGENT HANDOFF';
      var tEl = svgEl('text', { x: String(p.x), y: String(sy + lh), class: 'fsm-node-label', style: 'font-size:13px' }, g);
      lines.forEach(function (line, li) {
        var sp = svgEl('tspan', { x: String(p.x), dy: li ? String(lh) : '0' }, tEl);
        sp.textContent = line;
      });
    } else {
      var lines2 = svgTextLines(id, 20, '_');
      var lh2 = 15, totalH2 = lines2.length * lh2;
      var sy2 = p.y - totalH2 / 2 + lh2 * 0.7;
      var tEl2 = svgEl('text', { x: String(p.x), y: String(sy2), class: 'fsm-node-label', style: 'font-size:13px' }, g);
      lines2.forEach(function (line, li) {
        var sp = svgEl('tspan', { x: String(p.x), dy: li ? String(lh2) : '0' }, tEl2);
        sp.textContent = line;
      });
    }

    svgEl('title', {}, g).textContent = isHandoff ? 'Sub agent handoff → ' + handoffTargetName(id) : isTool ? id + ' (tool execution)' : isProc ? 'Sub Agent Setup: variable updates, prompt buffer, tool enabling' : id + ' (state)';
    nodeMap[id] = g;
  }

  return { nodeMap: nodeMap, edgePathMap: edgePathMap };
}

function renderMetrics(parsed, a) {
  var plan = currentData && currentData.plan;
  var st = computePlanExecutionStats(plan || []);
  var el = document.getElementById('metricsCard');
  el.classList.remove('hidden');
  el.innerHTML = '<span class="exec-stats-strip">' +
    '<span><b>' + st.steps + '</b> steps</span>' +
    '<span><b>' + st.llm + '</b> LLM</span>' +
    '<span><b>' + st.fn + '</b> functions</span>' +
    '<span><b>' + st.transition + '</b> transitions</span>' +
    '<span>Wall <b>' + st.wall + 'ms</b></span>' +
    '<span><b>' + a.n + '</b> sub agents</span>' +
    '<span>Density <b>' + a.density.toFixed(3) + '</b></span>' +
    '</span><button class="btn" id="btnGraphAnalysis" style="margin-left:auto;font-size:11px;padding:4px 10px">Copy Analysis as Markdown</button>';
  document.getElementById('btnGraphAnalysis').addEventListener('click', function () { copyAnalysisMarkdown(); });
}

function renderFsm(topicId, parsed, startAtEnd) {
  readFilterUiToPrefs();
  var plan = (currentData && currentData.plan) || [];
  fsmPlayback.rawEvents = buildRawTopicTimeline(plan, topicId, vizParsed && vizParsed.stepTopicMap);
  fsmPlayback.events = applyTimelineFilters(plan, fsmPlayback.rawEvents, timelineFilterPrefs);
  fsmPlayback.idx = -1;
  fsmPlayback.nodeMap = null;
  fsmPlayback.edgePathMap = null;

  var fsmTitle = parsed.displayNames[topicId] || topicId.replace(/_/g, ' ');
  document.getElementById('fsmTopicLabel').textContent = fsmTitle;
  document.getElementById('fsmTopicLabel').style.opacity = '1';
  document.getElementById('fsmDiagramLabel').textContent = fsmTitle;

  var trans = parsed.fsmEdges[topicId];
  var el = document.getElementById('fsmWrap');
  el.innerHTML = '';

  var macroSlot = document.createElement('div');
  macroSlot.className = 'fsm-macro-slot';

  if (trans && trans.size > 0) {
    var result = renderFsmMacroSvg(macroSlot, trans);
    fsmPlayback.nodeMap = result.nodeMap;
    fsmPlayback.edgePathMap = result.edgePathMap;
    setupSvgZoomPan(macroSlot);
  } else {
    macroSlot.innerHTML = '<div style="padding:22px;font-size:12px;color:var(--text-dim);text-align:center;line-height:1.55">No Finite State Machine edges for this sub agent.</div>';
  }

  el.appendChild(macroSlot);

  var playbar = document.getElementById('inspectorPlaybar');
  playbar.style.display = '';

  var detailSlot = document.getElementById('fsmDetailSlot');
  detailSlot.innerHTML = '';

  var n = fsmPlayback.events.length;
  if (n === 0) {
    detailSlot.innerHTML = fsmPlayback.rawEvents.length === 0
      ? '<div style="padding:18px;font-size:13px;color:var(--text-dim);line-height:1.5">No plan steps attributed to this sub agent.</div>'
      : '<div style="padding:18px;font-size:13px;color:var(--text-dim);line-height:1.5">No events match the current filters.</div>';
    document.getElementById('fsmStepLabel').textContent = '0 / 0';
    setFsmHighlight(null, null);
    syncFsmPlaybar();
    attachFsmKeyboardNav();
    return;
  }

  setFsmPlaybackIndex(startAtEnd ? fsmPlayback.events.length - 1 : 0);
  attachFsmKeyboardNav();
}

function refreshFsmTimelineAfterFilterChange() {
  if (!selectedTopicId || !vizParsed || !currentData) return;
  readFilterUiToPrefs();
  saveTimelineFilterPrefs();
  var plan = currentData.plan;
  if (!fsmPlayback.rawEvents || fsmPlayback.rawEvents.length === 0) {
    fsmPlayback.rawEvents = buildRawTopicTimeline(plan, selectedTopicId, vizParsed && vizParsed.stepTopicMap);
  }
  fsmPlayback.events = applyTimelineFilters(plan, fsmPlayback.rawEvents, timelineFilterPrefs);
  var n = fsmPlayback.events.length;
  if (n === 0) {
    fsmPlayback.idx = -1;
    document.getElementById('fsmStepLabel').textContent = '0 / 0';
    setFsmHighlight(null, null);
    var ds = document.getElementById('fsmDetailSlot');
    if (ds) ds.innerHTML = '<div style="padding:18px;font-size:13px;color:var(--text-dim)">No events match the current filters.</div>';
    syncFsmPlaybar();
    return;
  }
  var idx = Math.min(Math.max(0, fsmPlayback.idx), n - 1);
  setFsmPlaybackIndex(idx);
}

function openGraphFullscreen(svgSelector, title) {
  var srcSvg = document.querySelector(svgSelector);
  if (!srcSvg || !srcSvg.getAttribute('viewBox')) return;

  var overlay = document.createElement('div');
  overlay.className = 'graph-fullscreen-overlay';
  var header = document.createElement('div');
  header.className = 'gf-header';
  var h2 = document.createElement('h2');
  h2.textContent = title;
  header.appendChild(h2);
  var closeBtn = document.createElement('button');
  closeBtn.className = 'gf-close';
  closeBtn.textContent = 'Close  Esc';
  header.appendChild(closeBtn);
  overlay.appendChild(header);
  var body = document.createElement('div');
  body.className = 'gf-body';
  var clone = srcSvg.cloneNode(true);
  clone.removeAttribute('style');
  body.appendChild(clone);
  overlay.appendChild(body);
  document.body.appendChild(overlay);

  var cleanup = function () { overlay.remove(); document.removeEventListener('keydown', onKey); };
  closeBtn.addEventListener('click', cleanup);
  var onKey = function (e) { if (e.key === 'Escape') cleanup(); };
  document.addEventListener('keydown', onKey);

  var fsParts = clone.getAttribute('viewBox').split(/\s+/).map(Number);
  var vx = fsParts[0], vy = fsParts[1], vw = fsParts[2], vh = fsParts[3];

  clone.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = clone.getBoundingClientRect();
    var mx = (e.clientX - rect.left) / rect.width;
    var my = (e.clientY - rect.top) / rect.height;
    var factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    var nw = vw * factor, nh = vh * factor;
    vx += (vw - nw) * mx; vy += (vh - nh) * my;
    vw = nw; vh = nh;
    clone.setAttribute('viewBox', vx + ' ' + vy + ' ' + vw + ' ' + vh);
  }, { passive: false });

  var dragging = false, sx, sy;
  var endDrag = function () { dragging = false; clone.classList.remove('panning'); };
  clone.addEventListener('pointerdown', function (e) {
    dragging = true; sx = e.clientX; sy = e.clientY;
    clone.classList.add('panning'); clone.setPointerCapture(e.pointerId);
  });
  clone.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var rect = clone.getBoundingClientRect();
    var dx = (e.clientX - sx) * (vw / rect.width);
    var dy = (e.clientY - sy) * (vh / rect.height);
    vx -= dx; vy -= dy; sx = e.clientX; sy = e.clientY;
    clone.setAttribute('viewBox', vx + ' ' + vy + ' ' + vw + ' ' + vh);
  });
  clone.addEventListener('pointerup', endDrag);
  clone.addEventListener('pointercancel', endDrag);
}
