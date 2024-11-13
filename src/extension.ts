import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection("python");

  // Mise à jour des diagnostics pour le fichier actif lors de l'activation
  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor.document, collection);
  }

  // Mise à jour des diagnostics lors du changement de l'éditeur actif
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        updateDiagnostics(editor.document, collection);
      }
    })
  );

  // Mise à jour des diagnostics à chaque modification du document
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document) {
        updateDiagnostics(event.document, collection);
      }
    })
  );
}

function updateDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
): void {
  // Vérifier que le fichier est bien un fichier Python ou Jupyter Notebook
  if (document.languageId !== "python" && document.languageId !== "jupyter") {
    collection.clear();
    return;
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const text = document.getText();
  const lines = text.split("\n");

  lines.forEach((line, lineNumber) => {
    if (line.includes("pandas")) {
      const startPos = new vscode.Position(lineNumber, line.indexOf("pandas"));
      const endPos = startPos.translate(0, "pandas".length);
      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(startPos, endPos),
          'Utilisation de "pandas" détectée',
          vscode.DiagnosticSeverity.Information
        )
      );
    }

    if (line.includes("numpy")) {
      const startPos = new vscode.Position(lineNumber, line.indexOf("numpy"));
      const endPos = startPos.translate(0, "numpy".length);
      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(startPos, endPos),
          'Utilisation de "numpy" détectée',
          vscode.DiagnosticSeverity.Information
        )
      );
    }
  });

  collection.set(document.uri, diagnostics);
}
