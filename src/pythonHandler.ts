import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import Docker from "dockerode";
import * as cheerio from "cheerio";
import {
  globals,
  getOrCreateDecorationType,
  StoredDecoration,
  isThemeLight,
} from "./globals";

const decorationMap = new Map<string, StoredDecoration[]>();
const highlightDecorationType = getOrCreateDecorationType({
  backgroundColor: isThemeLight()
    ? "rgba(173, 216, 230, 0.3)"
    : "rgba(135, 206, 250, 0.3)",
});

export async function handlePythonFile(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection("docker");

  if (vscode.window.activeTextEditor) {
    let document = vscode.window.activeTextEditor.document;
    if (document && document.languageId === "python") {
      // Show a confirmation dialog
      const confirmAnalysis = await vscode.window.showInformationMessage(
        "Do you want to analyze your code for leakage ?",
        { modal: true },
        "Yes",
        "No"
      );

      // Proceed only if the user confirms
      if (confirmAnalysis === "Yes") {
        // Update diagnostics for the saved document
        updateDiagnostics(document, collection);
      }
    }
  }

  // Listen for visible text editors (including notebook cells)
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((visibleEditors) => {
      for (const textEditor of visibleEditors) {
        const cellUri = textEditor.document.uri.toString();
        const decorations = decorationMap.get(cellUri) || [];

        // Reapply ALL stored decorations for this text editor
        decorations.forEach(({ range, decorationType }) => {
          textEditor.setDecorations(decorationType, [range]);
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "antileak-ml.highlightLine",
      (line1: number, line2: number) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }

        const range1 = new vscode.Range(
          new vscode.Position(line1 - 1, 0),
          new vscode.Position(line1 - 1, Number.MAX_SAFE_INTEGER)
        );

        const range2 = new vscode.Range(
          new vscode.Position(line2 - 1, 0),
          new vscode.Position(line2 - 1, Number.MAX_SAFE_INTEGER)
        );

        // Clés pour identifier les lignes
        const key1 = `${line1}:${editor.document.uri.toString()}`;
        const key2 = `${line2}:${editor.document.uri.toString()}`;

        // Vérifie si les lignes sont déjà surlignées
        if (
          globals.highlightedLines.has(key1) &&
          globals.highlightedLines.has(key2)
        ) {
          // Si les lignes sont déjà surlignées, retirer le surlignage
          globals.highlightedLines.delete(key1);
          globals.highlightedLines.delete(key2);
          editor.setDecorations(highlightDecorationType, []);
        } else {
          // Sinon, appliquer le surlignage
          globals.highlightedLines.add(key1);
          globals.highlightedLines.add(key2);
          editor.setDecorations(highlightDecorationType, [range1, range2]);
        }
      }
    )
  );

  async function runDockerContainer(
    filePath: string,
    collection: vscode.DiagnosticCollection
  ) {
    const docker = new Docker();
    const inputDir = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const imageName = "nat2194/leakage-analysis:1.0";
    const extension = path.extname(filePath);
    const newExtension = ".html";

    const htmlOutputPath = path.join(
      inputDir,
      path.basename(filePath, extension) + newExtension
    );

    vscode.window.showInformationMessage(`Running analysis on ${fileName}`);

    try {
      await docker.pull(imageName);

      const container = await docker.createContainer({
        Image: imageName,
        Cmd: [`/app/leakage-analysis/test/${fileName}`, "-o"],
        Tty: true,
        HostConfig: {
          Binds: [`${inputDir}:/app/leakage-analysis/test:rw`],
        },
      });

      // Wait for the container to start
      await container.start();

      // Wait for the container to stop
      await container.wait();

      // Stop and remove the container
      try {
        await container.stop();
      } catch (stopErr) {
        const stopErrorMessage =
          stopErr instanceof Error ? stopErr.message : String(stopErr);
        console.error(`Failed to stop container: ${stopErrorMessage}`);
      }

      try {
        await container.remove();
      } catch (removeErr) {
        const removeErrorMessage =
          removeErr instanceof Error ? removeErr.message : String(removeErr);
        console.error(`Failed to remove container: ${removeErrorMessage}`);
      }

      parseHtmlForDiagnostics(htmlOutputPath, filePath, collection);

      // Call cleanup to remove the HTML output file
      cleanup(htmlOutputPath);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Check if the error is due to Docker not running
      if (
        errorMessage.includes("//./pipe/docker_engine") ||
        errorMessage.includes("Cannot connect to the Docker daemon")
      ) {
        vscode.window.showErrorMessage(
          "Docker is not running. Please start Docker and try again."
        );
      } else {
        vscode.window.showErrorMessage(`Error: ${errorMessage}`);
      }
    }
  }

  function parseHtmlForDiagnostics(
    htmlPath: string,
    filePath: string,
    collection: vscode.DiagnosticCollection
  ) {
    const htmlContent = fs.readFileSync(htmlPath, "utf8");
    const $ = cheerio.load(htmlContent);

    const diagnostics: vscode.Diagnostic[] = [];

    // Appelle parseSumTable pour analyser la table .sum
    parseSumTable($, diagnostics);
    // Recherche la table de classe "sum"
    const sumTable = $("table.sum").html();

    if (sumTable) {
      // Générer le code HTML pour l'inclure dans le WebView
      const fullHtmlContent = `
          <html>
            <body>
              <h2>Sum Table</h2>
              <table border="1">
                ${sumTable}
              </table>
            </body>
          </html>
        `;

      // Parcours de tous les boutons
      $("button").each((index, element) => {
        const buttonText = $(element).text().trim(); // Texte du bouton
        const onclickValue = $(element).attr("onclick"); // Valeur de l'attribut onclick

        // Cherche le span avec un attribut id qui contient le numéro de ligne
        const lineNumberSpan = $(element).prevAll("span[id]").first();
        const lineNumber = parseInt(lineNumberSpan.attr("id") || "0", 10);

        // Si un numéro de ligne valide est trouvé
        if (lineNumber > 0) {
          const range = new vscode.Range(
            new vscode.Position(lineNumber - 1, 0), // Convertit le numéro de ligne en position 0-based
            new vscode.Position(lineNumber - 1, 100) // Largeur arbitraire pour l'intervalle
          );

          // Vérifie la couleur de fond du bouton
          const backgroundColor = $(element).css("background-color");

          // Appelle les fonctions de détection
          detectLeakage(buttonText, backgroundColor, range, diagnostics);
          highlightTrainTestSites(buttonText, onclickValue, range, diagnostics);
        }
      });

      // Ajoute les diagnostics à la collection
      const fileUri = vscode.Uri.file(filePath);
      collection.set(fileUri, diagnostics);

      // Define a key for the global boolean variable
      const SHOW_RESULTS_TABLE_KEY = "antileak-ml.showResultsTable";

      // Retrieve the boolean value from global state (default to false if not set)
      let showResultsTable = context.globalState.get(SHOW_RESULTS_TABLE_KEY);

      // Afficher la table dans un WebView
      if (showResultsTable) {
        showHtmlInWebView(fullHtmlContent);
      }
    }
  }

  function detectLeakage(
    buttonText: string,
    backgroundColor: string | undefined,
    range: vscode.Range,
    diagnostics: vscode.Diagnostic[]
  ) {
    if (backgroundColor === "red") {
      const diagnosticSeverity = vscode.DiagnosticSeverity.Error;
      const diagnosticMessage = buttonText;

      const decorationProperties: vscode.DecorationRenderOptions = {
        after: {
          contentText: buttonText,
          backgroundColor: "red",
          color: "white",
          margin: "0 10px 0 10px",
        },
        borderRadius: "5px",
        cursor: "pointer",
      };

      const decorationType = getOrCreateDecorationType(decorationProperties);
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        applyDecorationToFile(editor.document.uri, range, decorationType);
      }

      const diagnostic = new vscode.Diagnostic(
        range,
        diagnosticMessage,
        diagnosticSeverity
      );
      diagnostics.push(diagnostic);
    }
  }

  function highlightTrainTestSites(
    buttonText: string,
    onclickValue: string | undefined,
    range: vscode.Range,
    diagnostics: vscode.Diagnostic[]
  ) {
    if (buttonText === "train" || buttonText === "test") {
      const diagnosticMessage = `${buttonText} data`;
      const diagnostic = new vscode.Diagnostic(
        range,
        diagnosticMessage,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostics.push(diagnostic);
    }

    if (buttonText === "highlight train/test sites" && onclickValue) {
      const match = onclickValue.match(/highlight_lines\(\[(\d+),\s*(\d+)\]\)/);
      if (match) {
        const [_, line1, line2] = match.map(Number);

        const decorationProperties: vscode.DecorationRenderOptions = {
          after: {
            contentText: "highlight train/test sites",
            backgroundColor: isThemeLight()
              ? "rgba(173, 216, 230, 0.3)"
              : "rgba(135, 206, 250, 0.3)",
            margin: "0 10px 0 10px",
          },
          borderRadius: "5px",
          cursor: "pointer",
        };

        const decorationType = getOrCreateDecorationType(decorationProperties);
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          applyDecorationToFile(editor.document.uri, range, decorationType);
        }

        vscode.languages.registerHoverProvider("*", {
          provideHover(document, position) {
            if (range.contains(position) && document === editor?.document) {
              const hoverMessage = new vscode.MarkdownString(
                `[Click to highlight train/test data](command:antileak-ml.highlightLine?${encodeURIComponent(
                  JSON.stringify([line1, line2])
                )})`
              );
              hoverMessage.isTrusted = true;
              return new vscode.Hover(hoverMessage);
            }
          },
        });
      }
    }
  }

  function parseSumTable(
    $: cheerio.CheerioAPI,
    diagnostics: vscode.Diagnostic[]
  ) {
    const tableRows = $("table.sum tbody tr");

    tableRows.each((index, row) => {
      const cells = $(row).find("td");

      // Skip the header row (index 0)
      if (index === 0) {
        return;
      }

      const leakageType = $(cells[0]).text().trim();
      const detectedCount = $(cells[1]).text().trim();
      const locations = $(cells[2]).text().trim();

      // Créer un message de diagnostic
      const diagnosticMessage = `Leakage: ${leakageType}, Detected: ${detectedCount}, Locations: ${locations}`;

      vscode.window.showInformationMessage(diagnosticMessage);

      // Définir la ligne de diagnostic
      const range = new vscode.Range(
        new vscode.Position(index - 1, 0),
        new vscode.Position(index - 1, 100)
      );

      // Ajouter un diagnostic d'information
      const diagnostic = new vscode.Diagnostic(
        range,
        diagnosticMessage,
        vscode.DiagnosticSeverity.Information
      );

      diagnostics.push(diagnostic);
    });
  }

  function showHtmlInWebView(htmlContent: string) {
    // Créer un panel de WebView
    const panel = vscode.window.createWebviewPanel(
      "LeakageReport", // Identifiant unique pour le WebView
      "Leakage Report", // Titre du panneau
      vscode.ViewColumn.Two, // Position du WebView (dans la deuxième colonne de l'éditeur)
      {
        enableScripts: true, // Permet l'utilisation de scripts dans le WebView (facultatif)
      }
    );

    // Injecter le contenu HTML dans le WebView
    panel.webview.html = htmlContent;
  }

  function updateDiagnostics(
    document: vscode.TextDocument | null,
    collection: vscode.DiagnosticCollection
  ): void {
    if (document && document.languageId === "python") {
      collection.clear();
      runDockerContainer(document.uri.fsPath, collection);
    } else {
      return;
    }
  }

  // Fonction pour créer un type de décoration basé sur le thème actuel
  function isThemeLight(): boolean {
    return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light;
  }

  function cleanup(filePath: string) {
    const dirPath = path.dirname(filePath);

    try {
      // Supprimer le fichier HTML
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`File ${filePath} has been deleted.`);
      }

      // Supprimer les dossiers finissant par -fact
      const factDirs = fs
        .readdirSync(dirPath)
        .filter(
          (item) =>
            item.endsWith("-fact") &&
            fs.statSync(path.join(dirPath, item)).isDirectory()
        );
      for (const dir of factDirs) {
        deleteFolderRecursive(path.join(dirPath, dir));
      }

      // Supprimer les dossiers finissant par ip-fact
      const ipFactDirs = fs
        .readdirSync(dirPath)
        .filter(
          (item) =>
            item.endsWith("ip-fact") &&
            fs.statSync(path.join(dirPath, item)).isDirectory()
        );
      for (const dir of ipFactDirs) {
        deleteFolderRecursive(path.join(dirPath, dir));
      }

      // Supprimer les fichiers finissant par .ir.py
      const irPyFiles = fs
        .readdirSync(dirPath)
        .filter((item) => item.endsWith(".ir.py"));
      for (const file of irPyFiles) {
        fs.unlinkSync(path.join(dirPath, file));
        console.log(`File ${file} has been deleted.`);
      }

      // Supprimer les fichiers finissant par .py.json
      const pyJsonFiles = fs
        .readdirSync(dirPath)
        .filter((item) => item.endsWith(".py.json"));
      for (const file of pyJsonFiles) {
        fs.unlinkSync(path.join(dirPath, file));
        console.log(`File ${file} has been deleted.`);
      }

      // Supprimer les fichiers finissant par .ipynb.json
      const ipynbJsonFiles = fs
        .readdirSync(dirPath)
        .filter((item) => item.endsWith(".ipynb.json"));
      for (const file of ipynbJsonFiles) {
        fs.unlinkSync(path.join(dirPath, file));
        console.log(`File ${file} has been deleted.`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Failed to clean up files or directories: ${errorMessage}`);
    }
  }

  // Fonction récursive pour supprimer un dossier et son contenu
  function deleteFolderRecursive(folderPath: string) {
    if (fs.existsSync(folderPath)) {
      fs.readdirSync(folderPath).forEach((file) => {
        const curPath = path.join(folderPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          // Récursement pour les sous-dossiers
          deleteFolderRecursive(curPath);
        } else {
          // Supprimer les fichiers
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(folderPath);
      console.log(`Directory ${folderPath} has been deleted.`);
    }
  }

  function applyDecorationToFile(
    fileUri: vscode.Uri,
    range: vscode.Range,
    decorationType: vscode.TextEditorDecorationType
  ) {
    const uriString = fileUri.toString();
    let fileDecorations = decorationMap.get(uriString) || [];

    const existingDecorationIndex = fileDecorations.findIndex(
      (d) =>
        d.range.isEqual(range) && d.decorationType.key === decorationType.key
    );

    if (existingDecorationIndex === -1) {
      fileDecorations.push({ range, decorationType });
    } else {
      fileDecorations[existingDecorationIndex] = { range, decorationType };
    }

    decorationMap.set(uriString, fileDecorations);

    const visibleEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === uriString
    );

    if (visibleEditor) {
      const decorationsByType = new Map<
        vscode.TextEditorDecorationType,
        vscode.Range[]
      >();

      fileDecorations.forEach((decoration) => {
        const ranges = decorationsByType.get(decoration.decorationType) || [];
        ranges.push(decoration.range);
        decorationsByType.set(decoration.decorationType, ranges);
      });

      decorationsByType.forEach((ranges, decType) => {
        visibleEditor.setDecorations(decType, ranges);
      });
    }
  }
}

export function pythonHandlerDeactivate() {
  // Clean up decorations
  for (const decorations of decorationMap.values()) {
    decorations.forEach(({ decorationType }) => {
      decorationType.dispose(); // Dispose of each decoration type
    });
  }
  decorationMap.clear(); // Clear the decoration map

  // Clean up hover providers
  for (const providerInfo of globals.registeredHoverProviders.values()) {
    providerInfo.provider.dispose(); // Dispose of each hover provider
  }
  globals.registeredHoverProviders.clear(); // Clear the hover providers map

  // Clear highlighted lines
  globals.highlightedLines.clear();

  // Optionally, log a message indicating that the Python handler has been deactivated
  console.log("Python handler has been deactivated.");
}
