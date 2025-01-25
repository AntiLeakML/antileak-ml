import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import Docker from "dockerode";
import * as cheerio from "cheerio";

// Map globale pour gérer les décorations par fichier
const notebookDecorationStore: Map<
  string,
  {
    ranges: vscode.Range[];
    backgroundColor: string;
  }[]
> = new Map();

export async function activate(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection("docker");

  let highlightedLines: Set<string> = new Set(); // Pour suivre les lignes surlignées

  const command = vscode.commands.registerCommand(
    "antileak-ml.detectPythonOrNotebook",
    () => {
      // Get the active text editor
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showInformationMessage("No active editor found.");
        return;
      }

      // Get the file name and its extension
      const fileName = editor.document.fileName;
      const fileExtension = fileName.split(".").pop()?.toLowerCase();

      const notebook = vscode.window.activeNotebookEditor?.notebook;
      vscode.window.showInformationMessage(`${notebook?.cellCount}`);

      // Check if the file is a Python file or a Jupyter Notebook
      if (fileExtension === "py") {
        vscode.window.showInformationMessage(
          "The opened file is a Python document."
        );
      } else if (fileExtension === "ipynb") {
        vscode.window.showInformationMessage(
          "The opened file is a Jupyter Notebook."
        );
      } else {
        vscode.window.showInformationMessage(
          "The opened file is neither a Python document nor a Jupyter Notebook."
        );
      }
    }
  );

  // Add to the context's subscriptions
  context.subscriptions.push(command);

  // Command to store decorations
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "antileak-ml.storeNotebookDecorations",
      (ranges: vscode.Range[], backgroundColor: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }

        // Find the containing notebook
        const containingNotebook = vscode.workspace.notebookDocuments.find(
          (nb) => {
            for (let i = 0; i < nb.cellCount; i++) {
              const cell = nb.cellAt(i);
              if (
                cell.document.uri.toString() === editor.document.uri.toString()
              ) {
                return true;
              }
            }
            return false;
          }
        );

        if (containingNotebook) {
          // Safely get existing decorations or initialize an empty array
          const existingDecorations =
            notebookDecorationStore.get(containingNotebook.uri.toString()) ??
            [];

          // Add new decorations
          const updatedDecorations = [
            ...existingDecorations,
            { ranges, backgroundColor },
          ];

          // Store updated decorations
          notebookDecorationStore.set(
            containingNotebook.uri.toString(),
            updatedDecorations
          );

          // Create and apply decoration
          const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: backgroundColor,
          });

          editor.setDecorations(decorationType, ranges);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("antileak-ml.loadDecorations", () => {
      const activeEditor = vscode.window.activeTextEditor;
      const activeNotebookEditor = vscode.window.activeNotebookEditor;

      if (activeEditor) {
        // Try to find the notebook for this editor
        const notebook = vscode.workspace.notebookDocuments.find((nb) => {
          for (let i = 0; i < nb.cellCount; i++) {
            const cell = nb.cellAt(i);
            if (
              cell.document.uri.toString() ===
              activeEditor.document.uri.toString()
            ) {
              return true;
            }
          }
          return false;
        });

        if (notebook) {
          // If the editor is part of a notebook, load notebook decorations
          const storedDecorations = notebookDecorationStore.get(
            notebook.uri.toString()
          );

          if (storedDecorations) {
            storedDecorations.forEach((decorationState) => {
              const decorationType =
                vscode.window.createTextEditorDecorationType({
                  backgroundColor: decorationState.backgroundColor,
                });

              activeEditor.setDecorations(
                decorationType,
                decorationState.ranges
              );
            });

            vscode.window.showInformationMessage(
              `Loaded ${storedDecorations.length} decorations for notebook`
            );
          } else {
            vscode.window.showInformationMessage(
              "No stored decorations found for this notebook"
            );
          }
        } else {
          // Handle non-notebook text documents if needed
          vscode.window.showInformationMessage(
            "No decorations available for this document"
          );
        }
      } else if (activeNotebookEditor) {
        // Direct notebook editor handling
        const storedDecorations = notebookDecorationStore.get(
          activeNotebookEditor.notebook.uri.toString()
        );

        if (storedDecorations) {
          // Find all text editors associated with this notebook
          const notebookEditors = vscode.window.visibleTextEditors.filter(
            (editor) => {
              for (
                let i = 0;
                i < activeNotebookEditor.notebook.cellCount;
                i++
              ) {
                const cell = activeNotebookEditor.notebook.cellAt(i);
                if (
                  cell.document.uri.toString() ===
                  editor.document.uri.toString()
                ) {
                  return true;
                }
              }
              return false;
            }
          );

          // Apply decorations to all associated text editors
          notebookEditors.forEach((editor) => {
            storedDecorations.forEach((decorationState) => {
              const decorationType =
                vscode.window.createTextEditorDecorationType({
                  backgroundColor: decorationState.backgroundColor,
                });

              editor.setDecorations(decorationType, decorationState.ranges);
            });
          });

          vscode.window.showInformationMessage(
            `Loaded ${storedDecorations.length} decorations for notebook`
          );
        } else {
          vscode.window.showInformationMessage(
            "No stored decorations found for this notebook"
          );
        }
      } else {
        vscode.window.showWarningMessage(
          "No active text editor or notebook editor"
        );
      }
    })
  );

  function loadNotebookDecorations(editor: vscode.TextEditor) {
    const notebook = vscode.workspace.notebookDocuments.find((nb) => {
      for (let i = 0; i < nb.cellCount; i++) {
        const cell = nb.cellAt(i);
        if (cell.document.uri.toString() === editor.document.uri.toString()) {
          return true;
        }
      }
      return false;
    });

    if (notebook) {
      const storedDecorations = notebookDecorationStore.get(
        notebook.uri.toString()
      );

      if (storedDecorations) {
        storedDecorations.forEach((decorationState) => {
          const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: decorationState.backgroundColor,
          });

          editor.setDecorations(decorationType, decorationState.ranges);
        });
      }
    }
  }

  // Handle decorations when a file is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      // Clear decorations for the closed document
      const fileUri = document.uri.toString();
      //notebookDecorationStore.delete(fileUri);
    })
  );

  // Add event listener for notebook cell changes
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      editors.forEach((editor) => {
        const notebook = vscode.workspace.notebookDocuments.find((nb) => {
          for (let i = 0; i < nb.cellCount; i++) {
            const cell = nb.cellAt(i);
            if (
              cell.document.uri.toString() === editor.document.uri.toString()
            ) {
              return true;
            }
          }
          return false;
        });

        // Only load decorations if the editor is part of a notebook
        if (notebook) {
          loadNotebookDecorations(editor);
        }
      });
    })
  );

  // Handle notebook document changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeNotebookDocument((event) => {
      // If a notebook document changes, update its decorations
      if (event.notebook) {
        const storedDecorations = notebookDecorationStore.get(
          event.notebook.uri.toString()
        );

        // Reapply decorations if they exist
        if (storedDecorations) {
          // Find the visible text editors for this notebook
          const notebookEditors = vscode.window.visibleTextEditors.filter(
            (editor) => {
              for (let i = 0; i < event.notebook.cellCount; i++) {
                const cell = event.notebook.cellAt(i);
                if (
                  cell.document.uri.toString() ===
                  editor.document.uri.toString()
                ) {
                  return true;
                }
              }
              return false;
            }
          );

          // Reapply decorations to each matching editor
          notebookEditors.forEach((editor) => {
            storedDecorations.forEach((decorationState) => {
              const decorationType =
                vscode.window.createTextEditorDecorationType({
                  backgroundColor: decorationState.backgroundColor,
                });

              editor.setDecorations(decorationType, decorationState.ranges);
            });
          });
        }
      }
    })
  );

  // Reapply decorations when a text editor becomes active
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) {
        return;
      }

      // Check if the editor is part of a notebook
      const notebook = vscode.workspace.notebookDocuments.find((nb) => {
        for (let i = 0; i < nb.cellCount; i++) {
          const cell = nb.cellAt(i);
          if (cell.document.uri.toString() === editor.document.uri.toString()) {
            return true;
          }
        }
        return false;
      });

      // If part of a notebook, load its decorations
      if (notebook) {
        const storedDecorations = notebookDecorationStore.get(
          notebook.uri.toString()
        );

        if (storedDecorations) {
          storedDecorations.forEach((decorationState) => {
            const decorationType = vscode.window.createTextEditorDecorationType(
              {
                backgroundColor: decorationState.backgroundColor,
              }
            );

            editor.setDecorations(decorationType, decorationState.ranges);
          });
        }
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
        if (highlightedLines.has(key1) && highlightedLines.has(key2)) {
          // Si les lignes sont déjà surlignées, retirer le surlignage
          highlightedLines.delete(key1);
          highlightedLines.delete(key2);
          editor.setDecorations(decorationType, []);
        } else {
          // Sinon, appliquer le surlignage
          highlightedLines.add(key1);
          highlightedLines.add(key2);
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
        // Reload the window
        //await vscode.commands.executeCommand("workbench.action.reloadWindow");

        // Update diagnostics for the saved document
        updateDiagnostics(document, null, collection);
      }
    }
  } else if (vscode.window.activeNotebookEditor) {
    let notebook = vscode.window.activeNotebookEditor.notebook;
    // Appel initial pour mettre à jour les diagnostics lorsque l'éditeur est actif
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
        updateDiagnostics(null, notebook, collection);
      }
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
          updateDiagnostics(document, null, collection);
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
          updateDiagnostics(null, notebook, collection);
        }
      }
    })
  );
}

// Gestion des décorations par fichier
function getStoredRangesForFile(fileUri: string): vscode.Range[] {
  // Remplacez cette logique par une gestion des ranges si vous enregistrez les positions
  return [];
}

function mapNotebookCellLinesToHtmlLineNumbers(
  notebook: vscode.NotebookDocument,
  htmlPath: string
): Map<number, number> {
  const lineMapping = new Map<number, number>();

  // Read the HTML content
  const htmlContent = fs.readFileSync(htmlPath, "utf8");
  const $ = cheerio.load(htmlContent);

  // Extract all line numbers from HTML spans
  const htmlLineNumbers: number[] = [];
  $("span[id]").each((_, element) => {
    const lineNumber = parseInt($(element).attr("id") || "0", 10);
    if (lineNumber > 0) {
      htmlLineNumbers.push(lineNumber);
    }
  });

  // Iterate through notebook cells and match their content with HTML line numbers
  let currentHtmlLineIndex = 0;
  notebook.cellCount > 0 && notebook.cellAt(0);

  for (let i = 0; i < notebook.cellCount; i++) {
    const cell = notebook.cellAt(i);

    // Only process code cells
    if (cell.kind === vscode.NotebookCellKind.Code) {
      const cellText = cell.document.getText();
      const cellLines = cellText.split("\n");

      // Try to match cell content with consecutive HTML line numbers
      for (let j = 0; j < cellLines.length; j++) {
        if (currentHtmlLineIndex < htmlLineNumbers.length) {
          lineMapping.set(
            cell.index * 1000 + j, // Use a unique key combining cell index and line
            htmlLineNumbers[currentHtmlLineIndex]
          );
          currentHtmlLineIndex++;
        }
      }
    }
  }

  return lineMapping;
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
        Memory: 8 * 1024 * 1024 * 1024, // 8 GB of memory
        NanoCpus: 8000000000, // 5 CPUs
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

    //parseHtmlForDiagnostics(htmlOutputPath, filePath, collection);
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
        highlightTrainTestSites(
          buttonText,
          onclickValue,
          lineNumber,
          range,
          diagnostics
        );
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
  range: vscode.Range,
  diagnostics: vscode.Diagnostic[]
) {
  if (backgroundColor === "red") {
    const diagnosticSeverity = vscode.DiagnosticSeverity.Error;
    const diagnosticMessage = buttonText;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    // Find the containing notebook
    const containingNotebook = vscode.workspace.notebookDocuments.find((nb) => {
      for (let i = 0; i < nb.cellCount; i++) {
        const cell = nb.cellAt(i);
        if (cell.document.uri.toString() === editor.document.uri.toString()) {
          return true;
        }
      }
      return false;
    });

    // Create decoration type
    const decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: buttonText,
        backgroundColor: "red",
        color: "white",
        margin: "0 10px 0 10px",
      },
      borderRadius: "5px",
      cursor: "pointer",
    });

    // Set decorations for the current editor
    editor.setDecorations(decorationType, [range]);

    // Store decorations if in a notebook
    if (containingNotebook) {
      // Get existing decorations or initialize a new array
      const existingDecorations =
        notebookDecorationStore.get(containingNotebook.uri.toString()) || [];

      // Add new decoration state
      existingDecorations.push({
        ranges: [range],
        backgroundColor: "red",
      });

      // Update the notebook decoration store
      notebookDecorationStore.set(
        containingNotebook.uri.toString(),
        existingDecorations
      );
    }

    // Add diagnostic
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
  lineNumber: number,
  range: vscode.Range,
  diagnostics: vscode.Diagnostic[]
) {
  if (buttonText === "train" || buttonText === "test") {
    // Add an informative diagnostic
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

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      // Find the containing notebook
      const containingNotebook = vscode.workspace.notebookDocuments.find(
        (nb) => {
          for (let i = 0; i < nb.cellCount; i++) {
            const cell = nb.cellAt(i);
            if (
              cell.document.uri.toString() === editor.document.uri.toString()
            ) {
              return true;
            }
          }
          return false;
        }
      );

      // Create decoration type
      const decorationType = vscode.window.createTextEditorDecorationType({
        after: {
          contentText: "highlight train/test sites",
          backgroundColor: isThemeLight()
            ? "rgba(173, 216, 230, 0.3)"
            : "rgba(135, 206, 250, 0.3)",
          margin: "0 10px 0 10px",
        },
        borderRadius: "5px",
        cursor: "pointer",
      });

      // Set decorations for the current editor
      editor.setDecorations(decorationType, [range]);

      // Store decorations if in a notebook
      if (containingNotebook) {
        // Get existing decorations or initialize a new array
        const existingDecorations =
          notebookDecorationStore.get(containingNotebook.uri.toString()) || [];

        // Add new decoration state
        existingDecorations.push({
          ranges: [range],
          backgroundColor: isThemeLight()
            ? "rgba(173, 216, 230, 0.3)"
            : "rgba(135, 206, 250, 0.3)",
        });

        // Update the notebook decoration store
        notebookDecorationStore.set(
          containingNotebook.uri.toString(),
          existingDecorations
        );
      }

      // Register a hover provider with a clickable link to highlight lines
      vscode.languages.registerHoverProvider("*", {
        provideHover(document, position) {
          if (range.contains(position)) {
            const hoverMessage = new vscode.MarkdownString(
              `[Click to highlight train/test sites](command:antileak-ml.highlightLine?${encodeURIComponent(
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
  notebook: vscode.NotebookDocument | null,
  collection: vscode.DiagnosticCollection
): void {
  if (notebook && notebook.notebookType === "jupyter-notebook") {
    collection.clear();

    // Run the Docker container and get the HTML path
    runDockerContainer(notebook.uri.fsPath, collection);

    const htmlOutputPath = path.join(
      path.dirname(notebook.uri.fsPath),
      path.basename(notebook.uri.fsPath, path.extname(notebook.uri.fsPath)) +
        ".html"
    );

    // Map notebook cell lines to HTML line numbers
    const lineMapping = mapNotebookCellLinesToHtmlLineNumbers(
      notebook,
      htmlOutputPath
    );

    // Modify existing parsing methods to use this line mapping
    function modifiedParseHtmlForDiagnostics(
      htmlOutputPath: string,
      filePath: string,
      collection: vscode.DiagnosticCollection,
      lineMapping: Map<number, number>
    ) {
      const htmlContent = fs.readFileSync(htmlOutputPath, "utf8");
      const $ = cheerio.load(htmlContent);

      const diagnostics: vscode.Diagnostic[] = [];

      $("button").each((index, element) => {
        const buttonText = $(element).text().trim();
        const onclickValue = $(element).attr("onclick");

        const htmlLineNumber = parseInt(
          $(element).prevAll("span[id]").first().attr("id") || "0",
          10
        );

        // Find the corresponding notebook cell line
        let notebookLineKey = -1;
        for (const [key, value] of lineMapping.entries()) {
          if (value === htmlLineNumber) {
            notebookLineKey = key;
            break;
          }
        }

        if (notebookLineKey !== -1) {
          const cellIndex = Math.floor(notebookLineKey / 1000);
          const lineInCell = notebookLineKey % 1000;

          const range = new vscode.Range(
            new vscode.Position(cellIndex, lineInCell),
            new vscode.Position(cellIndex, lineInCell + 1)
          );

          // Vérifie la couleur de fond du bouton
          const backgroundColor = $(element).css("background-color");
          // Rest of the existing logic for detecting leakage and highlighting
          detectLeakage(buttonText, backgroundColor, range, diagnostics);
          highlightTrainTestSites(
            buttonText,
            onclickValue,
            htmlLineNumber,
            range,
            diagnostics
          );
        }
      });

      const fileUri = vscode.Uri.file(filePath);
      collection.set(fileUri, diagnostics);
    }

    // Call the modified parsing method
    modifiedParseHtmlForDiagnostics(
      htmlOutputPath,
      notebook.uri.fsPath,
      collection,
      lineMapping
    );
  } else if (document && document.languageId === "python") {
    collection.clear();
    const htmlOutputPath = path.join(
      path.dirname(document.uri.fsPath),
      path.basename(document.uri.fsPath, path.extname(document.uri.fsPath)) +
        ".html"
    );
    runDockerContainer(document.uri.fsPath, collection);
    parseHtmlForDiagnostics(htmlOutputPath, document.uri.fsPath, collection);
  } else {
    return;
  }
  // Appeler cleanup pour supprimer le fichier HTML
  //cleanup(htmlOutputPath);
}

// Fonction pour créer un type de décoration basé sur le thème actuel
function isThemeLight(): boolean {
  return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light;
}

function cleanup(filePath: string) {
  const dirPath = path.dirname(filePath);
  const htmlOutputPath = path.join(
    dirPath,
    path.basename(filePath, path.extname(filePath)) + ".html"
  );

  try {
    // Supprimer le fichier HTML
    if (fs.existsSync(htmlOutputPath)) {
      fs.unlinkSync(htmlOutputPath);
      console.log(`File ${htmlOutputPath} has been deleted.`);
    }
    // Supprimer le fichier Python temporaire si le fichier est un notebook
    if (path.extname(filePath) === ".ipynb") {
      const pythonTempFilePath = path.join(
        dirPath,
        path.basename(filePath, path.extname(filePath)) + ".py"
      );
      fs.unlinkSync(pythonTempFilePath);
      console.log(`File ${pythonTempFilePath} has been deleted.`);
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
