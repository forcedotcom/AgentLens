import * as vscode from 'vscode';
import { getWebviewHtml, handleWebviewMessage, MAX_INPUT_BYTES } from './webviewPanel';
import { watchTheme } from './themeWatcher';

export class TraceEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'agentlens.traceViewer';

  constructor(private readonly context: vscode.ExtensionContext) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new TraceEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      TraceEditorProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    );
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'webview')
      ]
    };

    webviewPanel.webview.html = getWebviewHtml(
      webviewPanel.webview, this.context.extensionUri
    );

    const disposables: vscode.Disposable[] = [];
    watchTheme(webviewPanel, disposables);

    const text = document.getText();
    if (text.length > MAX_INPUT_BYTES) {
      vscode.window.showErrorMessage('Trace file too large. Maximum size is 50 MB.');
      return;
    }

    webviewPanel.webview.postMessage({
      type: 'loadTrace',
      payload: text
    });

    webviewPanel.webview.onDidReceiveMessage(
      handleWebviewMessage,
      null,
      disposables
    );

    webviewPanel.onDidDispose(() => {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    });
  }
}
