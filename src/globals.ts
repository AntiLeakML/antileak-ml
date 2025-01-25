import * as vscode from "vscode";

export const globals = {
  sharedValue: "", // Une variable globale partagée
  decorations: [] as vscode.TextEditorDecorationType[],
  highlightedLines: new Set() as Set<string>,
};
