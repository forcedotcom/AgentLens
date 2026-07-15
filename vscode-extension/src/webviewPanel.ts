import * as vscode from 'vscode';
import { watchTheme } from './themeWatcher';
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = globalThis.crypto.randomUUID();

  const webviewUri = (...segments: string[]) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', ...segments));

  const styleBase = webviewUri('styles', 'base.css');
  const styleTheme = webviewUri('styles', 'theme-bridge.css');
  const scriptBridge = webviewUri('js', 'bridge.js');
  const scriptData = webviewUri('js', 'data.js');
  const scriptDetail = webviewUri('js', 'detail.js');
  const scriptRender = webviewUri('js', 'render.js');
  const scriptState = webviewUri('js', 'state.js');
  const scriptMarkdown = webviewUri('js', 'markdown.js');
  const scriptMain = webviewUri('js', 'main.js');

  const cspSource = webview.cspSource;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; img-src data:; font-src ${cspSource}; form-action 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleBase}">
  <link rel="stylesheet" href="${styleTheme}">
  <title>AgentLens</title>
</head>
<body>

<div class="app-header">
  <h1>AgentLens</h1>
  <div class="header-meta" id="headerMeta"></div>
  <div class="header-actions">
    <button class="btn" id="btnLoad">Load File</button>
    <button class="btn hidden" id="btnClear">Clear</button>
  </div>
</div>
<div class="metrics-bar hidden" id="metricsCard"></div>

<div id="mainEmpty" class="empty-state">
  <h2>Visualize any Agentforce agent trace</h2>
  <p>Right-click a <strong>.json</strong> file in the Explorer, or paste/upload a trace below.</p>
  <button class="btn-large" id="btnPaste">Paste JSON</button>
  <label class="btn-large" style="display:inline-block;background:var(--surface2);color:var(--text);border-color:var(--border)">
    Upload <input type="file" accept=".json,application/json" id="fileInput" class="hidden">
  </label>
  <div class="drop-zone" id="dropZone"><strong>Drop JSON here</strong></div>
</div>

<div id="mainViz" class="hidden">
  <div class="layout">
    <div class="panel panel--inspector" id="inspectorPanel">
      <div class="panel-h"><span id="fsmTopicLabel" style="opacity:.5">select a sub agent →</span></div>
      <div class="viz-toolbar" id="vizToolbar">
        <span class="viz-toolbar-title">Show:</span>
        <label title="Variable assignment and mutation steps"><input type="checkbox" id="chkVarUpdates" checked /> Variable Updates</label>
        <label title="Planner reasoning, grounding checks, and prep actions"><input type="checkbox" id="chkReasoning" checked /> Reasoning</label>
        <label title="State captured when entering a node"><input type="checkbox" id="chkNodeEntry" checked /> Node Entry</label>
        <label title="Tools made available to the LLM at each step"><input type="checkbox" id="chkEnabledTools" checked /> Enabled Tools</label>
        <label title="AgentScriptInternal_* system variables (usually noisy)"><input type="checkbox" id="chkAgentScriptVars" /> Internal Vars</label>
      </div>
      <div class="fsm-playbar" id="inspectorPlaybar" style="display:none">
        <button type="button" class="btn-fsm" id="fsmBtnPrev" title="Previous event (← or K)">← Prev</button>
        <span id="fsmStepLabel" style="font-size:12px;font-family:var(--font-mono);color:var(--text-dim);white-space:nowrap">—</span>
        <button type="button" class="btn-fsm" id="fsmBtnNext" title="Next event (→ or J)">Next →</button>
        <span style="font-size:10px;color:var(--text-dim);margin-left:auto">← → keys</span>
      </div>
      <div class="fsm-single-card" id="fsmDetailSlot"></div>
    </div>
    <div class="panel panel--context" id="contextPanel">
      <div class="panel-h">Agent Graph <button type="button" class="graph-expand-btn" id="btnExpandGraph" title="Pop out graph (fullscreen)">&#x26F6;</button></div>
      <div class="graph-wrap" id="topicGraph"></div>
      <div class="topic-list" id="topicList"></div>
      <div class="panel-h" style="font-size:11px">Finite State Machine — <span id="fsmDiagramLabel" style="font-weight:400;color:var(--text-dim)">select a sub agent</span> <button type="button" class="graph-expand-btn" id="btnExpandFsm" title="Pop out FSM (fullscreen)" style="margin-left:auto">&#x26F6;</button></div>
      <div class="graph-wrap" id="fsmWrap"></div>
    </div>
  </div>
</div>

<div class="upload-overlay hidden" id="uploadOverlay">
  <div class="upload-modal">
    <h2 style="font-size:15px;margin-bottom:10px;color:var(--text-bright)">Paste Plan JSON</h2>
    <textarea id="jsonInput" placeholder="Paste the plan response JSON from Agentforce DX here…"></textarea>
    <div class="btn-row">
      <button class="btn" id="btnCancel">Cancel</button>
      <button class="btn-primary" id="btnParse">Visualize</button>
    </div>
  </div>
</div>

<script nonce="${nonce}" src="${scriptBridge}"></script>
<script nonce="${nonce}" src="${scriptData}"></script>
<script nonce="${nonce}" src="${scriptDetail}"></script>
<script nonce="${nonce}" src="${scriptRender}"></script>
<script nonce="${nonce}" src="${scriptState}"></script>
<script nonce="${nonce}" src="${scriptMarkdown}"></script>
<script nonce="${nonce}" src="${scriptMain}"></script>
</body>
</html>`;
}

export async function handleWebviewMessage(message: { type: string; payload?: string }): Promise<void> {
  switch (message.type) {
    case 'copyMarkdown':
      if (message.payload) {
        await vscode.env.clipboard.writeText(message.payload);
        vscode.window.showInformationMessage('Analysis copied to clipboard.');
      }
      break;
    case 'showError':
      if (message.payload) {
        vscode.window.showErrorMessage(message.payload);
      }
      break;
  }
}

export class AgentLensPanel {
  public static currentPanel: AgentLensPanel | undefined;
  private static readonly viewType = 'agentlens.traceView';

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;

    this._panel.webview.html = getWebviewHtml(panel.webview, extensionUri);

    watchTheme(this._panel, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static createOrShow(context: vscode.ExtensionContext, fileUri?: vscode.Uri) {
    if (AgentLensPanel.currentPanel) {
      AgentLensPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      if (fileUri) {
        AgentLensPanel.currentPanel._readFileAndSend(fileUri);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AgentLensPanel.viewType,
      'AgentLens',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'webview')
        ]
      }
    );

    AgentLensPanel.currentPanel = new AgentLensPanel(panel, context.extensionUri);

    if (fileUri) {
      AgentLensPanel.currentPanel._readFileAndSend(fileUri);
    }
  }

  private async _readFileAndSend(uri: vscode.Uri) {
    try {
      let text: string;
      if (uri.scheme === 'file') {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_INPUT_BYTES) {
          vscode.window.showErrorMessage('File too large. Maximum size is 50 MB.');
          return;
        }
        const raw = await vscode.workspace.fs.readFile(uri);
        text = new TextDecoder().decode(raw);
      } else {
        const doc = await vscode.workspace.openTextDocument(uri);
        text = doc.getText();
      }
      this._panel.webview.postMessage({ type: 'loadTrace', payload: text });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to read file: ${msg}`);
    }
  }

  private async _handleMessage(message: { type: string; payload?: string }) {
    await handleWebviewMessage(message);
    if (message.type === 'requestFile') {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'JSON Files': ['json'] }
      });
      if (uris && uris[0]) {
        this._readFileAndSend(uris[0]);
      }
    }
  }

  public dispose() {
    if (AgentLensPanel.currentPanel !== this) return;
    AgentLensPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) d.dispose();
    this._disposables.length = 0;
  }
}
