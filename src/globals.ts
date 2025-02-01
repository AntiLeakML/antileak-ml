import * as vscode from "vscode";

export const globals = {
  decorationPropertiesMap: new Map<string, vscode.TextEditorDecorationType>(),
  registeredHoverProviders: new Map<
    string,
    {
      cell: vscode.TextEditor;
      range: vscode.Range;
      provider: vscode.Disposable;
    }
  >(),
  highlightedLines: new Set() as Set<string>,
};

// Define a type for stored decoration info
export interface StoredDecoration {
  range: vscode.Range;
  decorationType: vscode.TextEditorDecorationType;
}

// Helper function to create a unique key for a range
export function getRangeKey(range: vscode.Range): string {
  return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

export function getDecorationKey(
  properties: vscode.DecorationRenderOptions
): string {
  return JSON.stringify(properties);
}

export function getOrCreateDecorationType(
  properties: vscode.DecorationRenderOptions
): vscode.TextEditorDecorationType {
  const key = getDecorationKey(properties);

  // Vérifier si une décoration avec les mêmes propriétés existe déjà
  if (globals.decorationPropertiesMap.has(key)) {
    return globals.decorationPropertiesMap.get(key)!;
  }

  // Créer une nouvelle décoration
  const decorationType =
    vscode.window.createTextEditorDecorationType(properties);

  // Stocker la décoration dans le Map
  globals.decorationPropertiesMap.set(key, decorationType);

  return decorationType;
}

export function getCompositeRangeKey(
  uri: vscode.Uri,
  range: vscode.Range
): string {
  const rangeKey = getRangeKey(range);
  return `${uri.toString()}#${rangeKey}`;
}

/**
 * Parses a composite range key back into its URI and range components
 * @param compositeKey The composite key to parse
 * @returns An object containing the URI and range, or null if invalid
 */
export function parseCompositeRangeKey(
  compositeKey: string
): { uri: vscode.Uri; range: vscode.Range } | null {
  try {
    const [uriString, rangeString] = compositeKey.split("#");

    if (!uriString || !rangeString) {
      return null;
    }

    const [startPart, endPart] = rangeString.split("-");
    const [startLine, startChar] = startPart.split(":").map(Number);
    const [endLine, endChar] = endPart.split(":").map(Number);

    if (
      isNaN(startLine) ||
      isNaN(startChar) ||
      isNaN(endLine) ||
      isNaN(endChar)
    ) {
      return null;
    }

    return {
      uri: vscode.Uri.parse(uriString),
      range: new vscode.Range(startLine, startChar, endLine, endChar),
    };
  } catch (error) {
    return null;
  }
}

// Fonction pour créer un type de décoration basé sur le thème actuel
export function isThemeLight(): boolean {
  return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light;
}
