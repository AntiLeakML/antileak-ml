import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import Docker from "dockerode";
import * as cheerio from "cheerio";
import {
  globals,
  getOrCreateDecorationType,
  getRangeKey,
  getDecorationKey,
  getCompositeRangeKey,
  isThemeLight,
} from "./globals";
import * as jupyterNotebookParser from "./components/jupyterNotebookParser";
import { isUndefined } from "util";

// Define a type for stored decoration info
interface StoredDecoration {
  range: vscode.Range;
  decorationType: vscode.TextEditorDecorationType;
}

const decorationMap = new Map<string, StoredDecoration[]>();

const decorationTypes: vscode.TextEditorDecorationType[] = [];

const buttonsHTML = new Map<
  string,
  Array<{
    mapping: jupyterNotebookParser.NotebookLineMapping;
    buttonText: string;
    backgroundColor: string | undefined;
    onclickValue: string | undefined;
  }>
>();

const diagnostics: vscode.Diagnostic[] = [];

let lineMappings: jupyterNotebookParser.NotebookLineMapping[] | undefined;

export async function handleJupyterFile(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection("docker");
  decorationMap.clear();
  buttonsHTML.clear();
  // Initialize highlightDecorationType and store it in globals
  globals.highlightDecorationType = getOrCreateDecorationType({
    backgroundColor: isThemeLight()
      ? "rgba(173, 216, 230, 0.3)"
      : "rgba(135, 206, 250, 0.3)",
  });
  console.log(
    `highlightdecorationtype : ${globals.highlightDecorationType === undefined}`
  );
  // Show a confirmation dialog
  const confirmAnalysis = await vscode.window.showInformationMessage(
    "Do you want to analyze your code for leakage ?",
    { modal: true },
    "Yes",
    "No"
  );

  // Listen for visible text editors (including notebook cells)
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((visibleEditors) => {
      for (const textEditor of visibleEditors) {
        if (textEditor.document.uri.scheme === "vscode-notebook-cell") {
          updateDecorations(diagnostics);
          const cellUri = textEditor.document.uri.toString();
          const decorations = decorationMap.get(cellUri) || [];

          // Group decorations by their decoration type
          const decorationsByType = new Map<
            vscode.TextEditorDecorationType,
            vscode.Range[]
          >();

          decorations.forEach(({ range, decorationType }) => {
            const existingRanges = decorationsByType.get(decorationType) || [];
            decorationsByType.set(decorationType, [...existingRanges, range]);
          });

          // Reapply ALL stored decorations for this cell, preserving existing ranges for each type
          decorationsByType.forEach((ranges, decorationType) => {
            textEditor.setDecorations(decorationType, ranges);
          });
        }
      }
    })
  );

  // Proceed only if the user confirms
  if (confirmAnalysis === "Yes") {
    // Update diagnostics for the saved document
    updateDiagnostics(collection);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "antileak-ml.highlightLine",
      (line1: number, line2: number) => {
        console.log("command called");

        vscode.window.showInformationMessage(
          `line 1 : ${line1}, line 2 : ${line2}`
        );
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }

        // Convert the given lines to cell URIs and line numbers within the cells
        const mapping1 = lineMappings?.find(
          (map: jupyterNotebookParser.NotebookLineMapping) =>
            map.htmlRowNumber === line1
        );
        const mapping2 = lineMappings?.find(
          (map: jupyterNotebookParser.NotebookLineMapping) =>
            map.htmlRowNumber === line2
        );

        if (!mapping1 || !mapping2) {
          vscode.window.showErrorMessage(
            "Could not find line mappings for the given lines."
          );
          return;
        }

        const cell1 = vscode.window.activeNotebookEditor?.notebook.cellAt(
          mapping1.notebookCellNumber
        );
        const cell2 = vscode.window.activeNotebookEditor?.notebook.cellAt(
          mapping2.notebookCellNumber
        );

        vscode.window.showErrorMessage(
          `cells : ${mapping1.notebookCellNumber}, ${mapping2.notebookCellNumber}`
        );

        if (!cell1 || !cell2) {
          vscode.window.showErrorMessage(
            "Could not find the corresponding cells."
          );
          return;
        }

        const cellUri1 = cell1.document.uri.toString();
        const cellUri2 = cell2.document.uri.toString();

        const range1 = new vscode.Range(
          new vscode.Position(mapping1.lineNumberInCell - 1, 0), // Convert line number to 0-based position
          new vscode.Position(
            mapping1.lineNumberInCell - 1,
            Number.MAX_SAFE_INTEGER
          )
        );

        const range2 = new vscode.Range(
          new vscode.Position(mapping2.lineNumberInCell - 1, 0), // Convert line number to 0-based position
          new vscode.Position(
            mapping2.lineNumberInCell - 1,
            Number.MAX_SAFE_INTEGER
          )
        );

        // Keys to identify the lines
        const key1 = `${mapping1.htmlRowNumber}:${cellUri1}`;
        const key2 = `${mapping2.htmlRowNumber}:${cellUri2}`;
        console.log(`key 1 : ${key1}`);
        console.log(`key 2 : ${key2}`);

        // Check if the lines are already highlighted
        if (
          globals.highlightedLines.has(key1) &&
          globals.highlightedLines.has(key2)
        ) {
          // If the lines are already highlighted, remove the highlighting
          globals.highlightedLines.delete(key1);
          globals.highlightedLines.delete(key2);
          editor.setDecorations(globals.highlightDecorationType, []); // Clear decorations
        } else {
          // Otherwise, apply the highlighting
          globals.highlightedLines.add(key1);
          globals.highlightedLines.add(key2);

          // Apply decorations to the correct cells
          const cellTextEditor1 = vscode.window.visibleTextEditors.find(
            (editor) => editor.document.uri.toString() === cellUri1
          );
          const cellTextEditor2 = vscode.window.visibleTextEditors.find(
            (editor) => editor.document.uri.toString() === cellUri2
          );

          // Particular case because setDecorations resets other decorations of this decoration type
          if (cellTextEditor1 && cellTextEditor1 === cellTextEditor2) {
            cellTextEditor1.setDecorations(globals.highlightDecorationType, [
              range1,
              range2,
            ]);
          } else if (cellTextEditor1) {
            console.log("test1");
            vscode.window.showInformationMessage("test1");
            cellTextEditor1.setDecorations(globals.highlightDecorationType, [
              range1,
            ]);
          } else if (cellTextEditor2) {
            console.log("test2");
            vscode.window.showInformationMessage("test2");
            cellTextEditor2.setDecorations(globals.highlightDecorationType, [
              range2,
            ]);
          }
        }
      }
    )
  );

  function logHoverProviders() {
    console.log(
      "Current Hover Providers: ",
      globals.registeredHoverProviders.size
    );
    for (const [key, hoverProvider] of globals.registeredHoverProviders) {
      console.log(
        `Key: ${key}, Cell: ${hoverProvider.cell}, Range: ${hoverProvider.range}, Provider: ${hoverProvider.provider}`
      );
    }
  }

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
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
          // Reload the window
          //await vscode.commands.executeCommand("workbench.action.reloadWindow");

          // Update diagnostics for the saved document
          updateDiagnostics(collection);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveNotebookDocument(async (notebook) => {
      if (notebook && notebook.notebookType === "jupyter-notebook") {
        // Show a confirmation dialog
        const confirmAnalysis = await vscode.window.showInformationMessage(
          "Do you want to analyze your code for leakage ?",
          { modal: true },
          "Yes",
          "No"
        );

        // Proceed only if the user confirms
        if (confirmAnalysis === "Yes") {
          // Reload the window
          //await vscode.commands.executeCommand("workbench.action.reloadWindow");

          // Update diagnostics for the saved document
          updateDiagnostics(collection);
        }
      }
    })
  );

  function updateDecorations(diagnostics: vscode.Diagnostic[]) {
    buttonsHTML.forEach((buttons, key) => {
      // Track the key for each buttons array
      // Create a copy of the buttons array to avoid modifying it while iterating
      const buttonsCopy = [...buttons];

      buttonsCopy.forEach((button) => {
        if (lineMappings) {
          const mapping = lineMappings.find(
            (map: jupyterNotebookParser.NotebookLineMapping) =>
              map.htmlRowNumber === button.mapping.htmlRowNumber
          );
          if (mapping) {
            const cell = vscode.window.activeNotebookEditor?.notebook.cellAt(
              mapping.notebookCellNumber
            );
            // Find the TextEditor for this cell's document (imperfect because we can only iterate through the visible ones)
            const cellTextEditor = vscode.window.visibleTextEditors.find(
              (editor) =>
                editor.document.uri.toString() === cell?.document.uri.toString()
            );
            if (cellTextEditor) {
              const range = new vscode.Range(
                new vscode.Position(mapping.lineNumberInCell - 1, 0), // Convert line number to 0-based position
                new vscode.Position(mapping.lineNumberInCell - 1, 100) // Arbitrary width for the range
              );

              console.log(
                "onclick in updateDecorations: ",
                button.onclickValue
              );

              // Call detection functions
              detectLeakage(
                button.buttonText,
                button.backgroundColor,
                cellTextEditor,
                range,
                diagnostics
              );
              highlightTrainTestSites(
                button.buttonText,
                button.onclickValue,
                cellTextEditor,
                range,
                diagnostics
              );
              // Delete the button from the original buttons array
              const index = buttons.indexOf(button);
              if (index !== -1) {
                buttons.splice(index, 1);
              }
            }
          }
        }
        // Log the current hover providers
        logHoverProviders();
      });

      // If all buttons in the array have been processed, delete the array from the map
      if (buttons.length === 0) {
        buttonsHTML.delete(key);
      }
    });
  }

  // Function to generate a composite key
  function getCompositeKey(
    htmlRowNumber: number,
    buttonText: string,
    backgroundColor: string | undefined
  ): string {
    return `${htmlRowNumber}-${buttonText}-${backgroundColor}`;
  }

  async function parseHtmlForDiagnostics(
    htmlPath: string,
    filePath: string,
    collection: vscode.DiagnosticCollection
  ) {
    const htmlContent = fs.readFileSync(htmlPath, "utf8");
    const $ = cheerio.load(htmlContent);

    lineMappings = await jupyterNotebookParser.mapNotebookHTML(htmlPath);

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
        // Vérifie la couleur de fond du bouton
        const backgroundColor = $(element).css("background-color");

        // Cherche le span avec un attribut id qui contient le numéro de ligne
        const lineNumberSpan = $(element).prevAll("span[id]").first();
        const lineNumber = parseInt(lineNumberSpan.attr("id") || "0", 10);

        if (lineMappings) {
          const mapping = lineMappings.find(
            (map: jupyterNotebookParser.NotebookLineMapping) =>
              map.htmlRowNumber === lineNumber
          );
          if (mapping) {
            const cell = vscode.window.activeNotebookEditor?.notebook.cellAt(
              mapping.notebookCellNumber
            );
            // Find the TextEditor for this cell's document (imperfect because we can only iterate through the visible ones)
            const cellTextEditor = vscode.window.visibleTextEditors.find(
              (editor) =>
                editor.document.uri.toString() === cell?.document.uri.toString()
            );
            if (cellTextEditor) {
              console.log("onclick in parseHTML: ", onclickValue);
              const range = new vscode.Range(
                new vscode.Position(mapping.lineNumberInCell - 1, 0), // Convertit le numéro de ligne en position 0-based
                new vscode.Position(mapping.lineNumberInCell - 1, 100) // Largeur arbitraire pour l'intervalle
              );

              // Appelle les fonctions de détection
              detectLeakage(
                buttonText,
                backgroundColor,
                cellTextEditor,
                range,
                diagnostics
              );
              highlightTrainTestSites(
                buttonText,
                onclickValue,
                cellTextEditor,
                range,
                diagnostics
              );
            } else {
              const existing =
                buttonsHTML.get(
                  getCompositeKey(
                    mapping.htmlRowNumber,
                    buttonText,
                    backgroundColor
                  )
                ) || [];

              if (!existing.length) {
                existing.push({
                  mapping,
                  buttonText,
                  backgroundColor,
                  onclickValue,
                });
                buttonsHTML.set(
                  getCompositeKey(
                    mapping.htmlRowNumber,
                    buttonText,
                    backgroundColor
                  ),
                  existing
                );
              }
            }
          }
        } else {
          console.log("pas de lineMapping");
          vscode.window.showErrorMessage("Line Mappings undefined");
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
    cellTextEditor: vscode.TextEditor | undefined,
    range: vscode.Range,
    diagnostics: vscode.Diagnostic[]
  ) {
    if (backgroundColor === "red") {
      const diagnosticSeverity = vscode.DiagnosticSeverity.Error; // Niveau de gravité pour les erreurs
      const diagnosticMessage = buttonText;

      // Définir les propriétés de la décoration
      const decorationProperties: vscode.DecorationRenderOptions = {
        after: {
          contentText: buttonText, // Texte du bouton
          backgroundColor: "red", // Couleur de fond rouge
          color: "white", // Couleur du texte
          margin: "0 10px 0 10px", // Espacement
        },
        borderRadius: "5px", // Arrondi des coins
        cursor: "pointer", // Apparence du curseur
      };

      // Obtenir ou créer le decorationType
      const decorationType = getOrCreateDecorationType(decorationProperties);
      // Ajoute la décoration
      if (cellTextEditor) {
        applyDecorationToCell(
          cellTextEditor.document.uri,
          range,
          decorationType
        );
      }

      // Ajoute le diagnostic
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
    cellTextEditor: vscode.TextEditor | undefined,
    range: vscode.Range,
    diagnostics: vscode.Diagnostic[]
  ) {
    if (buttonText === "train" || buttonText === "test") {
      // Add informative diagnostic
      const diagnosticMessage = `${buttonText} data`;
      const diagnostic = new vscode.Diagnostic(
        range,
        diagnosticMessage,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostics.push(diagnostic);
    }

    if (buttonText === "highlight train/test sites" && onclickValue) {
      console.log("onclick in highlight: ", onclickValue);
      const match = onclickValue.match(/highlight_lines\(\[(\d+),\s*(\d+)\]\)/);

      if (match && cellTextEditor) {
        const [_, line1, line2] = match.map(Number);

        console.log("lines in highlight: ", line1, " ", line2);
        console.log(`cell : ${cellTextEditor.document.uri}`);

        // Define decoration properties
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

        // Get or create decorationType
        const decorationType = getOrCreateDecorationType(decorationProperties);

        // Add decoration
        if (cellTextEditor) {
          applyDecorationToCell(
            cellTextEditor.document.uri,
            range,
            decorationType
          );

          // Create a unique key for this range
          const providerkey = getCompositeRangeKey(
            cellTextEditor.document.uri,
            range
          );
          console.log("range ici : ", range.start, "-", range.end);

          // Dispose of existing hover provider for this range if it exists
          const existingProvider =
            globals.registeredHoverProviders.get(providerkey);
          // Log the current hover providers
          logHoverProviders();
          if (existingProvider) {
            console.log("removing provider", providerkey);
            console.log("button : ", buttonText, onclickValue);
            existingProvider.provider.dispose();
            globals.registeredHoverProviders.delete(providerkey);
          }

          // Register new hover provider
          const hoverProvider = vscode.languages.registerHoverProvider(
            {
              scheme: cellTextEditor.document.uri.scheme,
              language: cellTextEditor.document.languageId,
            },
            {
              provideHover(document, position, token) {
                if (
                  range.contains(position) &&
                  document === cellTextEditor.document
                ) {
                  const hoverMessage = new vscode.MarkdownString(
                    `[Click to highlight train/test data](command:antileak-ml.highlightLine?${encodeURIComponent(
                      JSON.stringify([line1, line2])
                    )})`
                  );
                  hoverMessage.isTrusted = true;
                  return new vscode.Hover(hoverMessage);
                }
                return undefined;
              },
            }
          );

          // Store the new hover provider
          globals.registeredHoverProviders.set(providerkey, {
            cell: cellTextEditor,
            range,
            provider: hoverProvider,
          });
          // Log the current hover providers
          logHoverProviders();
        }
      }
    }
  }

  // Function to dispose all hover providers
  function disposeAllHoverProviders() {
    for (const [_, provider] of globals.registeredHoverProviders) {
      provider.provider.dispose();
    }
    globals.registeredHoverProviders.clear();
  }

  async function runDockerContainer(
    filePath: string,
    collection: vscode.DiagnosticCollection
  ) {
    const docker = new Docker();
    const inputDir = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const imageName = "nat2194/leakage-analysis:1.0";
    const logFilePath = path.join(inputDir, "docker_logs.txt"); // Log file path
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

      await container.start();

      // Attach to the container stream
      const stream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });

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

      await parseHtmlForDiagnostics(htmlOutputPath, filePath, collection);

      // Appeler cleanup pour supprimer le fichier HTML
      cleanup(htmlOutputPath);
    } catch (err) {
      // Message to remind to start docker if a 500 error is caught

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

  function updateDiagnostics(collection: vscode.DiagnosticCollection): void {
    collection.clear();
    if (vscode.window.activeNotebookEditor) {
      runDockerContainer(
        vscode.window.activeNotebookEditor.notebook.uri.fsPath,
        collection
      );
    } else {
      vscode.window.showErrorMessage("Cannot find Jupyter Notebook");
    }
  }

  function cleanup(filePath: string) {
    const dirPath = path.dirname(filePath);

    try {
      // Supprimer le fichier HTML
      if (fs.existsSync(filePath)) {
        //fs.unlinkSync(filePath);
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
          // Récursivement pour les sous-dossiers
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

  // Helper to apply AND store decorations with their type
  function applyDecorationToCell(
    cellUri: vscode.Uri,
    range: vscode.Range,
    decorationType: vscode.TextEditorDecorationType
  ) {
    if (!cellUri) {
      console.log("Cell URI is undefined");
      return;
    }

    const uriString = cellUri.toString();

    // Get existing decorations for this cell
    let cellDecorations = decorationMap.get(uriString) || [];

    // Check if this exact decoration (same type and range) already exists
    const existingDecorationIndex = cellDecorations.findIndex(
      (d) =>
        d.range.isEqual(range) && d.decorationType.key === decorationType.key
    );

    if (existingDecorationIndex === -1) {
      // Add new decoration to the array
      cellDecorations.push({ range, decorationType });
    } else {
      // Update existing decoration
      cellDecorations[existingDecorationIndex] = { range, decorationType };
    }

    // Update the map
    decorationMap.set(uriString, cellDecorations);

    // Apply all decorations for this cell to visible editors
    const visibleEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === uriString
    );

    console.log("Visible editor:", visibleEditor);

    if (visibleEditor) {
      console.log("Applying decorations to visible editor:", visibleEditor);
      console.log("Decoration type:", decorationType);
      console.log("Range:", range);

      // Group decorations by type
      const decorationsByType = new Map<
        vscode.TextEditorDecorationType,
        vscode.Range[]
      >();

      cellDecorations.forEach((decoration) => {
        const ranges = decorationsByType.get(decoration.decorationType) || [];
        ranges.push(decoration.range);
        decorationsByType.set(decoration.decorationType, ranges);
      });

      // Apply each decoration type with all its ranges
      decorationsByType.forEach((ranges, decType) => {
        console.log("Applying decoration type:", decType);
        console.log("Ranges:", ranges);
        visibleEditor.setDecorations(decType, ranges);
      });
    }
  }

  // Function to remove a specific decoration
  function removeDecoration(
    cellUri: vscode.Uri,
    range: vscode.Range,
    decorationType: vscode.TextEditorDecorationType
  ) {
    if (!cellUri) {
      return;
    }

    const uriString = cellUri.toString();
    const cellDecorations = decorationMap.get(uriString);

    if (cellDecorations) {
      // Filter out the specific decoration
      const updatedDecorations = cellDecorations.filter(
        (d) =>
          !(
            d.range.isEqual(range) &&
            d.decorationType.key === decorationType.key
          )
      );

      if (updatedDecorations.length === 0) {
        decorationMap.delete(uriString);
      } else {
        decorationMap.set(uriString, updatedDecorations);
      }

      // Update visible editor
      const visibleEditor = vscode.window.visibleTextEditors.find(
        (editor) => editor.document.uri.toString() === uriString
      );

      if (visibleEditor) {
        // Clear the specific decoration
        visibleEditor.setDecorations(decorationType, []);

        // Reapply remaining decorations
        const decorationsByType = new Map<
          vscode.TextEditorDecorationType,
          vscode.Range[]
        >();
        updatedDecorations.forEach((decoration) => {
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

  // Function to clear all decorations for a cell
  function clearCellDecorations(cellUri: vscode.Uri) {
    if (!cellUri) {
      return;
    }

    const uriString = cellUri.toString();
    const cellDecorations = decorationMap.get(uriString);

    if (cellDecorations) {
      const visibleEditor = vscode.window.visibleTextEditors.find(
        (editor) => editor.document.uri.toString() === uriString
      );

      if (visibleEditor) {
        // Clear all decorations
        cellDecorations.forEach((decoration) => {
          visibleEditor.setDecorations(decoration.decorationType, []);
        });
      }

      // Remove from map
      decorationMap.delete(uriString);
    }
  }
}
