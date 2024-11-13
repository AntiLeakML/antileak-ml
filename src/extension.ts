import * as vscode from "vscode";

// Fonction appelée lors de l'activation de l'extension
export function activate(context: vscode.ExtensionContext) {
  console.log("L’extension 'decorator sample' est activée!");

  let timeout: NodeJS.Timeout | undefined = undefined;

  // Définir un style de décoration pour "pandas"
  const pandasDecorationType = vscode.window.createTextEditorDecorationType({
    color: "green",
    fontWeight: "bold",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "darkgreen",
  });

  // Définir un style de décoration pour "numpy"
  const numpyDecorationType = vscode.window.createTextEditorDecorationType({
    color: "purple",
    fontWeight: "bold",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "darkpurple",
  });

  let activeEditor = vscode.window.activeTextEditor;

  // Fonction pour mettre à jour les décorations dans le document actif
  function updateDecorations() {
    if (!activeEditor) {
      return;
    }

    // Vérifier si le fichier est de type Python ou Jupyter Notebook
    const fileExtension = activeEditor.document.fileName.split(".").pop();
    if (fileExtension !== "py" && fileExtension !== "ipynb") {
      return;
    }

    const text = activeEditor.document.getText();
    const pandasMatches: vscode.DecorationOptions[] = [];
    const numpyMatches: vscode.DecorationOptions[] = [];

    // Rechercher les occurrences de "pandas"
    const pandasRegex = /\bpandas\b/gi;
    let match;
    while ((match = pandasRegex.exec(text)) !== null) {
      const startPos = activeEditor.document.positionAt(match.index);
      const endPos = activeEditor.document.positionAt(
        match.index + match[0].length
      );
      const decoration = {
        range: new vscode.Range(startPos, endPos),
        hoverMessage: "Librairie **pandas** détectée.",
      };
      pandasMatches.push(decoration);
    }

    // Rechercher les occurrences de "numpy"
    const numpyRegex = /\bnumpy\b/gi;
    while ((match = numpyRegex.exec(text)) !== null) {
      const startPos = activeEditor.document.positionAt(match.index);
      const endPos = activeEditor.document.positionAt(
        match.index + match[0].length
      );
      const decoration = {
        range: new vscode.Range(startPos, endPos),
        hoverMessage: "Librairie **numpy** détectée.",
      };
      numpyMatches.push(decoration);
    }

    // Appliquer les décorations pour "pandas" et "numpy"
    activeEditor.setDecorations(pandasDecorationType, pandasMatches);
    activeEditor.setDecorations(numpyDecorationType, numpyMatches);
  }

  // Fonction pour déclencher les mises à jour des décorations avec un délai
  function triggerUpdateDecorations(throttle = false) {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    if (throttle) {
      timeout = setTimeout(updateDecorations, 500);
    } else {
      updateDecorations();
    }
  }

  // Appliquer les décorations lors de l'activation de l'éditeur de texte
  if (activeEditor) {
    triggerUpdateDecorations();
  }

  // Mettre à jour les décorations lorsque l'éditeur actif change
  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      activeEditor = editor;
      if (editor) {
        triggerUpdateDecorations();
      }
    },
    null,
    context.subscriptions
  );

  // Mettre à jour les décorations lorsque le document est modifié
  vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (activeEditor && event.document === activeEditor.document) {
        triggerUpdateDecorations(true);
      }
    },
    null,
    context.subscriptions
  );
}
