import * as vscode from 'vscode';

function getThemeKind(): 'dark' | 'light' {
  const kind = vscode.window.activeColorTheme.kind;
  if (kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight) {
    return 'light';
  }
  return 'dark';
}

export function watchTheme(
  panel: vscode.WebviewPanel,
  disposables: vscode.Disposable[]
): void {
  panel.webview.postMessage({ type: 'themeChanged', payload: getThemeKind() });

  vscode.window.onDidChangeActiveColorTheme(() => {
    panel.webview.postMessage({ type: 'themeChanged', payload: getThemeKind() });
  }, null, disposables);
}
