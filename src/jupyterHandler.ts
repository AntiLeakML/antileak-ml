import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import Docker from "dockerode";
import * as cheerio from "cheerio";
import { globals } from "./globals";
import * as jupyterNotebookParser from "./components/jupyterNotebookParser";

const decorationMap = new Map<
  string,
  Array<{
    range: vscode.Range;
    decorationType: vscode.TextEditorDecorationType;
  }>
>();

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

          // Reapply ALL stored decorations for this cell
          decorations.forEach(({ range, decorationType }) => {
            textEditor.setDecorations(decorationType, [range]);
          });
        }
      }
    })
  );

  // Proceed only if the user confirms
  if (confirmAnalysis === "Yes") {
    // Reload the window
    //await vscode.commands.executeCommand("workbench.action.reloadWindow");

    // Update diagnostics for the saved document
    updateDiagnostics(collection);
  }

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
          editor.setDecorations(decorationType, []);
        } else {
          // Sinon, appliquer le surlignage
          globals.highlightedLines.add(key1);
          globals.highlightedLines.add(key2);
          editor.setDecorations(decorationType, [range1, range2]);
        }
      }
    )
  );

  // Type de décoration défini globalement pour le surlignage
  const decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: isThemeLight()
      ? "rgba(173, 216, 230, 0.3)"
      : "rgba(135, 206, 250, 0.3)",
  });

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

    const logStream = fs.createWriteStream(logFilePath, { flags: "a" });
    stream.pipe(logStream);

    const output: Buffer[] = [];
    stream.on("data", (chunk) => {
      output.push(chunk); // Capture logs for parsing
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
      fs.appendFileSync(
        logFilePath,
        `Failed to stop container: ${stopErrorMessage}\n`,
        { encoding: "utf8" }
      );
    }

    try {
      await container.remove();
    } catch (removeErr) {
      const removeErrorMessage =
        removeErr instanceof Error ? removeErr.message : String(removeErr);
      console.error(`Failed to remove container: ${removeErrorMessage}`);
      fs.appendFileSync(
        logFilePath,
        `Failed to remove container: ${removeErrorMessage}\n`,
        { encoding: "utf8" }
      );
    }

    // Close the log stream
    logStream.end();

    await parseHtmlForDiagnostics(htmlOutputPath, filePath, collection);

    // Appeler cleanup pour supprimer le fichier HTML
    cleanup(htmlOutputPath);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${errorMessage}`);
    vscode.window.showErrorMessage(`Error: ${errorMessage}`);

    // Write error to log file
    const errorLog = `Error: ${errorMessage}\n`;
    fs.appendFileSync(logFilePath, errorLog, { encoding: "utf8" });
    console.log(`Error logged to ${logFilePath}`);
  }
}
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
          }

          // Delete the button from the original buttons array
          const index = buttons.indexOf(button);
          if (index !== -1) {
            buttons.splice(index, 1);
          }
        }
      }
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

  let buttonCounter = 0;

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

            // TODO: Avoid duplicates
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
        } else {
          console.log("pas de mapping");
          vscode.window.showErrorMessage("Mapping undefined");
        }
      } else {
        console.log("pas de lineMapping");
        vscode.window.showErrorMessage("Line Mappings undefined");
      }
    });

    // Ajoute les diagnostics à la collection
    const fileUri = vscode.Uri.file(filePath);
    collection.set(fileUri, diagnostics);

    // Afficher la table dans un WebView
    showHtmlInWebView(fullHtmlContent);
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

    // Vérifie si une décoration avec le même texte existe déjà
    const existingDecoration = globals.decorations.find(
      (decoration: vscode.TextEditorDecorationType) => {
        const options = decoration as vscode.DecorationRenderOptions;
        return options.after?.contentText === buttonText;
      }
    );

    if (!existingDecoration) {
      // Crée une décoration pour l'affichage de l'erreur
      const decorationType = vscode.window.createTextEditorDecorationType({
        after: {
          contentText: buttonText, // Texte du bouton
          backgroundColor: "red", // Couleur de fond rouge
          color: "white", // Couleur du texte
          margin: "0 10px 0 10px", // Espacement
        },
        borderRadius: "5px", // Arrondi des coins
        cursor: "pointer", // Apparence du curseur
      });
      // Ajoute la décoration
      if (cellTextEditor) {
        //cellTextEditor.setDecorations(decorationType, [range]);
        applyDecorationToCell(
          cellTextEditor.document.uri,
          range,
          decorationType
        );
        globals.decorations.push(decorationType);
      }
    } else {
      // Ajoute la décoration
      if (cellTextEditor) {
        //cellTextEditor.setDecorations(existingDecoration, [range]);
        applyDecorationToCell(
          cellTextEditor.document.uri,
          range,
          existingDecoration
        );
        globals.decorations.push(existingDecoration);
      }
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
    // Ajoute un diagnostic informatif
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

      // Crée une décoration pour l'affichage du texte
      const decorationType = vscode.window.createTextEditorDecorationType({
        after: {
          contentText: "highlight train/test sites",
          backgroundColor: isThemeLight()
            ? "rgba(173, 216, 230, 0.3)"
            : "rgba(135, 206, 250, 0.3)",
          margin: "0 10px 0 10px",
        },
        borderRadius: "5px", // Arrondi des coins
        cursor: "pointer", // Apparence du curseur
      });

      // Ajoute la décoration
      if (cellTextEditor) {
        //cellTextEditor.setDecorations(decorationType, [range]);
        applyDecorationToCell(
          cellTextEditor.document.uri,
          range,
          decorationType
        );
        globals.decorations.push(decorationType);
      }
      // Enregistrer un HoverProvider pour ajouter un message de survol cliquable
      vscode.languages.registerHoverProvider("*", {
        provideHover(document, position) {
          if (range.contains(position)) {
            const hoverMessage = new vscode.MarkdownString(
              `[Cliquez pour surligner les données train/test](command:antileak-ml.highlightLine?${encodeURIComponent(
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

// Helper to apply AND store decorations with their type
export function applyDecorationToCell(
  cellUri: vscode.Uri,
  range: vscode.Range,
  decorationType: vscode.TextEditorDecorationType
) {
  if (cellUri) {
    const uriString = cellUri.toString();
    const existing = decorationMap.get(uriString) || [];

    // Avoid duplicates
    if (
      !existing.some(
        (d) => d.range.isEqual(range) && d.decorationType === decorationType
      )
    ) {
      existing.push({ range, decorationType });
      decorationMap.set(uriString, existing);
    }

    // Apply to visible editors
    const visibleEditor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === uriString
    );
    if (visibleEditor) {
      visibleEditor.setDecorations(decorationType, [range]);
    }
  } else {
  }
}
