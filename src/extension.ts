import * as vscode from "vscode";
import { execFile } from "child_process";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection("python");

  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor.document, collection);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        updateDiagnostics(editor.document, collection);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document) {
        updateDiagnostics(event.document, collection);
      }
    })
  );
}

function runPythonScript(module: string) {
  const scriptPath = path.join(__dirname, "../src/python/script.py");

  execFile("python", [scriptPath, module], (error, stdout, stderr) => {
    if (error) {
      console.error(`Erreur d'exécution du script Python: ${error.message}`);
      vscode.window.showErrorMessage(
        `Erreur d'exécution du script Python: ${error.message}`
      );
      return;
    }
    if (stderr) {
      console.error(`Erreur dans le script Python: ${stderr}`);
      vscode.window.showErrorMessage(`Erreur dans le script Python: ${stderr}`);
      return;
    }

    // Affiche uniquement la sortie si elle n'est pas vide
    const message =
      stdout.trim() || "Aucun message de sortie du script Python.";
    vscode.window.showInformationMessage(message);
  });
}

function updateDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
): void {
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
      runPythonScript("pandas");
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
      runPythonScript("numpy");
    }
  });

  collection.set(document.uri, diagnostics);
}
