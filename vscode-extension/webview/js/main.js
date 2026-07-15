// DOM event wiring and initialization.

function openModal() {
  document.getElementById('uploadOverlay').classList.remove('hidden');
  document.getElementById('jsonInput').value = '';
}

document.getElementById('btnLoad').addEventListener('click', function () {
  postToHost('requestFile');
});

document.getElementById('btnPaste').addEventListener('click', openModal);

document.getElementById('btnCancel').addEventListener('click', function () {
  document.getElementById('uploadOverlay').classList.add('hidden');
});

document.getElementById('btnParse').addEventListener('click', function () {
  var v = document.getElementById('jsonInput').value.trim();
  if (!v) return postToHost('showError', 'Paste JSON first.');
  if (v.length > MAX_INPUT_BYTES) return postToHost('showError', 'Input too large. Maximum size is 50 MB.');
  try {
    loadData(JSON.parse(v));
    document.getElementById('uploadOverlay').classList.add('hidden');
  } catch (e) {
    postToHost('showError', 'Invalid JSON: ' + e.message);
  }
});

document.getElementById('btnClear').addEventListener('click', clearAll);

document.getElementById('fsmBtnPrev').addEventListener('click', stepFsmPrev);
document.getElementById('fsmBtnNext').addEventListener('click', stepFsmNext);

function readAndLoadJsonFile(f) {
  if (!f) return;
  if (f.size > MAX_INPUT_BYTES) { postToHost('showError', 'File too large. Maximum size is 50 MB.'); return; }
  var r = new FileReader();
  r.onload = function () {
    try { loadData(JSON.parse(r.result)); }
    catch (err) { postToHost('showError', 'Invalid JSON file.'); }
  };
  r.readAsText(f);
}

document.getElementById('fileInput').addEventListener('change', function (e) {
  readAndLoadJsonFile(e.target.files[0]);
  e.target.value = '';
});

var dz = document.getElementById('dropZone');
dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.style.borderColor = 'var(--blue)'; });
dz.addEventListener('dragleave', function () { dz.style.borderColor = ''; });
dz.addEventListener('drop', function (e) {
  e.preventDefault();
  dz.style.borderColor = '';
  readAndLoadJsonFile(e.dataTransfer.files[0]);
});

loadTimelineFilterPrefs();
syncFilterUiFromPrefs();
['chkVarUpdates', 'chkReasoning', 'chkNodeEntry', 'chkEnabledTools', 'chkAgentScriptVars'].forEach(function (id) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('change', refreshFsmTimelineAfterFilterChange);
});

document.getElementById('btnExpandGraph').addEventListener('click', function () {
  openGraphFullscreen('#topicGraph svg', 'Agent Graph');
});
document.getElementById('btnExpandFsm').addEventListener('click', function () {
  openGraphFullscreen('#fsmWrap svg', 'Finite State Machine');
});
