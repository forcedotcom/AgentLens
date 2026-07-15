import * as vscode from 'vscode';

// Matches .sfdx/agents/{AgentName}/sessions/{UUID}/traces/{UUID}.json
const TRACE_PATH_PATTERN =
  /[/\\]\.sfdx[/\\]agents[/\\][^/\\]+[/\\]sessions[/\\][^/\\]+[/\\]traces[/\\][^/\\]+\.json$/;

function agentLensCodeLens(uri: vscode.Uri): vscode.CodeLens[] {
  const topOfFile = new vscode.Range(0, 0, 0, 0);
  return [
    new vscode.CodeLens(topOfFile, {
      title: '$(beaker) Open in AgentLens',
      command: 'agentlens.openTraceFromFile',
      arguments: [uri],
    })
  ];
}

export class TraceCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!TRACE_PATH_PATTERN.test(document.uri.fsPath)) {
      return [];
    }
    return agentLensCodeLens(document.uri);
  }
}

export class UntitledTraceCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    try {
      const json = JSON.parse(document.getText());
      if (Array.isArray(json?.plan)) {
        return agentLensCodeLens(document.uri);
      }
    } catch {
      // not valid JSON
    }
    return [];
  }
}
