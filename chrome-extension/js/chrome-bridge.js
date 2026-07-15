// Chrome extension bridge — replaces VS Code bridge.js with identical API surface.

var vscodeApi = {
  getState: function () {
    try { return JSON.parse(localStorage.getItem('agentlens_state') || 'null'); }
    catch (e) { return null; }
  },
  setState: function (newState) {
    try { localStorage.setItem('agentlens_state', JSON.stringify(newState)); }
    catch (e) {}
  },
  postMessage: function () {}
};

var _escDiv = document.createElement('div');
function esc(s) {
  if (s == null) return '';
  _escDiv.textContent = String(s);
  return _escDiv.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function postToHost(type, payload) {
  switch (type) {
    case 'showError':
      if (typeof showError === 'function') showError(payload);
      break;
    case 'copyMarkdown':
      navigator.clipboard.writeText(payload).catch(function () {});
      break;
    case 'requestFile':
      var fi = document.getElementById('fileInput');
      if (fi) fi.click();
      break;
  }
}

var _currentThemeKind = null;

function handleThemeChange(kind) {
  _currentThemeKind = kind;
  if (kind === 'light') {
    document.body.classList.add('light');
  } else {
    document.body.classList.remove('light');
  }
  var btn = document.getElementById('btnTheme');
  if (btn) btn.textContent = kind === 'light' ? 'Dark' : 'Light';
}

function initThemeFromSystem() {
  var mq = window.matchMedia('(prefers-color-scheme: light)');
  handleThemeChange(mq.matches ? 'light' : 'dark');
  mq.addEventListener('change', function (e) {
    handleThemeChange(e.matches ? 'light' : 'dark');
  });
}

// On page load, request trace data from service worker (pull model).
(function () {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'getTraceData' }, function (response) {
      if (response && response.payload) {
        setTimeout(function () {
          if (typeof handleLoadTrace === 'function') {
            handleLoadTrace(response.payload);
          }
        }, 100);
      }
    });
  }
})();
