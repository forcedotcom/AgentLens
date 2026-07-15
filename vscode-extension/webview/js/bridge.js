var vscodeApi = acquireVsCodeApi();

var _escDiv = document.createElement('div');
function esc(s) {
  if (s == null) return '';
  _escDiv.textContent = String(s);
  return _escDiv.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function postToHost(type, payload) {
  vscodeApi.postMessage({ type: type, payload: payload });
}

var _currentThemeKind = null;

window.addEventListener('message', function (event) {
  var msg = event.data;
  switch (msg.type) {
    case 'loadTrace':
      if (typeof handleLoadTrace === 'function') handleLoadTrace(msg.payload);
      break;
    case 'themeChanged':
      if (msg.payload !== _currentThemeKind) handleThemeChange(msg.payload);
      break;
  }
});

function handleThemeChange(kind) {
  _currentThemeKind = kind;
  if (kind === 'light') {
    document.body.classList.add('light');
  } else {
    document.body.classList.remove('light');
  }
}
