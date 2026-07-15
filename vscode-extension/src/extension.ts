import * as vscode from 'vscode';
import { AgentLensPanel } from './webviewPanel';
import { TraceEditorProvider } from './traceEditorProvider';
import { TraceCodeLensProvider, UntitledTraceCodeLensProvider } from './traceCodeLensProvider';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('agentlens.openTrace', () => {
      AgentLensPanel.createOrShow(context);
    }),
    vscode.commands.registerCommand('agentlens.openTraceFromFile', (uri?: vscode.Uri) => {
      if (!uri) {
        uri = vscode.window.activeTextEditor?.document.uri;
      }
      AgentLensPanel.createOrShow(context, uri);
    })
  );

  context.subscriptions.push(TraceEditorProvider.register(context));

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'json', scheme: 'file', pattern: '**/.sfdx/agents/**/traces/*.json' },
      new TraceCodeLensProvider()
    ),
    vscode.languages.registerCodeLensProvider(
      { language: 'json', scheme: 'untitled' },
      new UntitledTraceCodeLensProvider()
    )
  );
}

export function deactivate() {}
