import * as vscode from 'vscode';
import { startMonitoring } from './monitor';

export function activate(context: vscode.ExtensionContext) {
  startMonitoring(context);
}

export function deactivate() {
}
