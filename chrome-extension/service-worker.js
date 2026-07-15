// Background service worker for AgentLens Chrome Extension (MV3).

let pendingTraceData = null;

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === 'openViewer') {
    pendingTraceData = message.payload;
    chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
    return true;
  }

  if (message.type === 'getTraceData') {
    sendResponse({ payload: pendingTraceData });
    pendingTraceData = null;
    return true;
  }
});
