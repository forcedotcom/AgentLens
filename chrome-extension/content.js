// Content script — injects "Open in AgentLens" button on NGA builder pages.
(function () {
  'use strict';

  var BUTTON_ID = 'agentlens-open-btn';
  var POLL_INTERVAL = 2000;
  var MAX_ATTEMPTS = 30;

  var injected = false;
  var attempts = 0;

  function deepQueryAll(root, selector) {
    var results = Array.from(root.querySelectorAll(selector));
    root.querySelectorAll('*').forEach(function (el) {
      if (el.shadowRoot) {
        results = results.concat(deepQueryAll(el.shadowRoot, selector));
      }
    });
    return results;
  }

  function findAnchorElement() {
    var anchor = document.querySelector('.session-id-container');
    if (anchor) return anchor;

    var deepAnchors = deepQueryAll(document.body, '.session-id-container');
    if (deepAnchors.length) return deepAnchors[0];

    return null;
  }

  function createAgentLensButton() {
    var btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.textContent = 'Open in AgentLens';
    btn.title = 'Click "Copy Code" first, then click here to visualize the trace';
    btn.style.cssText = [
      'margin-left:8px',
      'padding:6px 14px',
      'font-size:13px',
      'font-weight:600',
      'border-radius:4px',
      'border:1px solid #4e8cff',
      'background:#4e8cff',
      'color:#fff',
      'cursor:pointer',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif'
    ].join(';');

    btn.addEventListener('mouseenter', function () { btn.style.background = '#3a7ae6'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = '#4e8cff'; });
    btn.addEventListener('click', handleAgentLensClick);
    return btn;
  }

  async function handleAgentLensClick() {
    try {
      var text = await navigator.clipboard.readText();

      if (!text || !text.trim()) {
        alert('AgentLens: Clipboard is empty. Click "Copy Code" first, then "Open in AgentLens".');
        return;
      }

      var json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        alert('AgentLens: Clipboard does not contain valid JSON. Click "Copy Code" first.');
        return;
      }

      if (!json.plan && !json.allPlanSteps && !json.planSteps) {
        alert('AgentLens: JSON does not look like an Agentforce trace. Make sure you copied the trace code.');
        return;
      }

      chrome.runtime.sendMessage({ type: 'openViewer', payload: text });
    } catch (err) {
      alert('AgentLens: Cannot read clipboard. Make sure you clicked "Copy Code" first and granted clipboard access.');
    }
  }

  function injectButton() {
    if (injected || document.getElementById(BUTTON_ID)) return true;

    var anchor = findAnchorElement();
    if (!anchor) return false;

    var agentLensBtn = createAgentLensButton();
    // Insert after the enclosing span so the button isn't nested inside it
    // (otherwise the original span's title tooltip would cover our button).
    var spanAnchor = (anchor.closest && anchor.closest('span')) || anchor;
    var parent = spanAnchor.parentElement;
    if (parent) {
      parent.insertBefore(agentLensBtn, spanAnchor.nextSibling);
      injected = true;
      return true;
    }
    return false;
  }

  function startObserving() {
    if (injectButton()) return;

    var observer = new MutationObserver(function () {
      if (!injected) {
        if (injectButton()) observer.disconnect();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    var pollTimer = setInterval(function () {
      attempts++;
      if (injected || attempts >= MAX_ATTEMPTS) {
        clearInterval(pollTimer);
        if (injected) observer.disconnect();
        return;
      }
      // Re-check in case button disappeared (SPA navigation)
      if (!document.getElementById(BUTTON_ID)) {
        injected = false;
      }
      injectButton();
    }, POLL_INTERVAL);
  }

  if (document.body) {
    startObserving();
  } else {
    document.addEventListener('DOMContentLoaded', startObserving);
  }
})();
