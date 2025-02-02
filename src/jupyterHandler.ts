import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import Docker from "dockerode";
import * as cheerio from "cheerio";
import {
  globals,
  getOrCreateDecorationType,
  StoredDecoration,
  getCompositeRangeKey,
  isThemeLight,
} from "./globals";
import * as jupyterNotebookParser from "./components/jupyterNotebookParser";

// Map to store decorations for each cell URI
const decorationMap = new Map<string, StoredDecoration[]>();

// Map to store HTML buttons and their associated metadata
const buttonsHTML = new Map<
  string,
  Array<{
    mapping: jupyterNotebookParser.NotebookLineMapping;
    buttonText: string;
    backgroundColor: string | undefined;
    onclickValue: string | undefined;
  }>
>();

// Array to store diagnostics (e.g., errors, warnings)
const diagnostics: vscode.Diagnostic[] = [];

// Variable to store line mappings between notebook cells and HTML rows
let lineMappings: jupyterNotebookParser.NotebookLineMapping[] | undefined;

// Define a decoration type for highlighting lines
const highlightDecorationType = getOrCreateDecorationType({
  backgroundColor: isThemeLight()
    ? "rgba(173, 216, 230, 0.3)"
    : "rgba(135, 206, 250, 0.3)",
});

// Function to handle Jupyter file analysis
export async function handleJupyterFile(context: vscode.ExtensionContext) {
  // Create a diagnostic collection for Docker-related issues
  const collection = vscode.languages.createDiagnosticCollection("docker");

  // Clear existing decorations and buttons
  decorationMap.clear();
  buttonsHTML.clear();

  // Show a confirmation dialog to the user
  const confirmAnalysis = await vscode.window.showInformationMessage(
    "Do you want to analyze your code for leakage?",
    { modal: true },
    "Yes"
  );

  // Listen for changes in visible text editors (including notebook cells)
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((visibleEditors) => {
      for (const textEditor of visibleEditors) {
        if (textEditor.document.uri.scheme === "vscode-notebook-cell") {
          // Update decorations for the visible editor
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

          // Reapply all stored decorations for this cell
          decorationsByType.forEach((ranges, decorationType) => {
            textEditor.setDecorations(decorationType, ranges);
          });
        }
      }
    })
  );

  // Proceed with analysis only if the user confirms
  if (confirmAnalysis === "Yes") {
    // Update diagnostics for the saved document
    updateDiagnostics(collection);
  }

  // Check if the "highlightLine" command already exists
  const commandExists = vscode.commands.getCommands(true).then((commands) => {
    return commands.includes("antileak-ml.highlightLine");
  });

  commandExists.then((exists) => {
    if (!exists) {
      // Register the "highlightLine" command if it doesn't exist
      context.subscriptions.push(
        vscode.commands.registerCommand(
          "antileak-ml.highlightLine",
          (line1: number, line2: number) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
              return;
            }

            // Find the line mappings for the given lines
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

            // Get the corresponding notebook cells
            const cell1 = vscode.window.activeNotebookEditor?.notebook.cellAt(
              mapping1.notebookCellNumber
            );
            const cell2 = vscode.window.activeNotebookEditor?.notebook.cellAt(
              mapping2.notebookCellNumber
            );
            if (!cell1 || !cell2) {
              vscode.window.showErrorMessage(
                "Could not find the corresponding cells."
              );
              return;
            }

            // Get the URIs of the cells
            const cellUri1 = cell1.document.uri.toString();
            const cellUri2 = cell2.document.uri.toString();

            // Define ranges for the lines to highlight
            const range1 = new vscode.Range(
              new vscode.Position(mapping1.lineNumberInCell - 1, 0), // Convert to 0-based position
              new vscode.Position(
                mapping1.lineNumberInCell - 1,
                Number.MAX_SAFE_INTEGER
              )
            );

            const range2 = new vscode.Range(
              new vscode.Position(mapping2.lineNumberInCell - 1, 0), // Convert to 0-based position
              new vscode.Position(
                mapping2.lineNumberInCell - 1,
                Number.MAX_SAFE_INTEGER
              )
            );

            // Create unique keys for the highlighted lines
            const key1 = `${mapping1.htmlRowNumber}:${cellUri1}`;
            const key2 = `${mapping2.htmlRowNumber}:${cellUri2}`;

            // Check if the lines are already highlighted
            if (
              globals.highlightedLines.has(key1) &&
              globals.highlightedLines.has(key2)
            ) {
              // Remove highlighting if already applied
              globals.highlightedLines.delete(key1);
              globals.highlightedLines.delete(key2);
              editor.setDecorations(highlightDecorationType, []); // Clear decorations
            } else {
              // Apply highlighting if not already applied
              globals.highlightedLines.add(key1);
              globals.highlightedLines.add(key2);

              // Find the text editors for the cells
              const cellTextEditor1 = vscode.window.visibleTextEditors.find(
                (editor) => editor.document.uri.toString() === cellUri1
              );
              const cellTextEditor2 = vscode.window.visibleTextEditors.find(
                (editor) => editor.document.uri.toString() === cellUri2
              );

              // Apply decorations to the correct cells

              // Particular case because setDecorations resets other decorations of this decoration type
              if (cellTextEditor1 && cellTextEditor1 === cellTextEditor2) {
                cellTextEditor1.setDecorations(highlightDecorationType, [
                  range1,
                  range2,
                ]);
              } else if (cellTextEditor1) {
                cellTextEditor1.setDecorations(highlightDecorationType, [
                  range1,
                ]);
              } else if (cellTextEditor2) {
                cellTextEditor2.setDecorations(highlightDecorationType, [
                  range2,
                ]);
              }
            }
          }
        )
      );
    }
  });

  // Listen for text document save events
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document && document.languageId === "python") {
        // Show a confirmation dialog
        const confirmAnalysis = await vscode.window.showInformationMessage(
          "Do you want to analyze your code for leakage?",
          { modal: true },
          "Yes",
          "No"
        );

        // Proceed only if the user confirms
        if (confirmAnalysis === "Yes") {
          // Update diagnostics for the saved document
          updateDiagnostics(collection);
        }
      }
    })
  );

  // Listen for notebook document save events
  context.subscriptions.push(
    vscode.workspace.onDidSaveNotebookDocument(async (notebook) => {
      if (notebook && notebook.notebookType === "jupyter-notebook") {
        // Show a confirmation dialog
        const confirmAnalysis = await vscode.window.showInformationMessage(
          "Do you want to analyze your code for leakage?",
          { modal: true },
          "Yes",
          "No"
        );

        // Proceed only if the user confirms
        if (confirmAnalysis === "Yes") {
          // Update diagnostics for the saved document
          updateDiagnostics(collection);
        }
      }
    })
  );

  // Function to update decorations based on diagnostics
  function updateDecorations(diagnostics: vscode.Diagnostic[]) {
    buttonsHTML.forEach((buttons, key) => {
      // Create a copy of the buttons array to avoid modifying it while iterating
      const buttonsCopy = [...buttons];

      buttonsCopy.forEach((button) => {
        if (lineMappings) {
          // Find the correspondance between the HTML output and the notebook editor for the button
          const mapping = lineMappings.find(
            (map: jupyterNotebookParser.NotebookLineMapping) =>
              map.htmlRowNumber === button.mapping.htmlRowNumber
          );
          if (mapping) {
            // Get the corresponding notebook cell
            const cell = vscode.window.activeNotebookEditor?.notebook.cellAt(
              mapping.notebookCellNumber
            );
            // Find the text editor for this cell's document
            const cellTextEditor = vscode.window.visibleTextEditors.find(
              (editor) =>
                editor.document.uri.toString() === cell?.document.uri.toString()
            );
            if (cellTextEditor) {
              // Define the range for the decoration
              const range = new vscode.Range(
                new vscode.Position(mapping.lineNumberInCell - 1, 0), // Convert to 0-based position
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
              // Remove the button from the original buttons array
              const index = buttons.indexOf(button);
              if (index !== -1) {
                buttons.splice(index, 1);
              }
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

  // Function to generate a composite key for buttons
  function getCompositeKey(
    htmlRowNumber: number,
    buttonText: string,
    backgroundColor: string | undefined
  ): string {
    return `${htmlRowNumber}-${buttonText}-${backgroundColor}`;
  }

  // Function to parse the HTML output to generate diagnostics and decorations
  async function parseHtmlOutput(
    htmlPath: string,
    filePath: string,
    collection: vscode.DiagnosticCollection
  ) {
    const htmlContent = fs.readFileSync(htmlPath, "utf8");
    const $ = cheerio.load(htmlContent);

    // Find the correspondances between the HTML output and the notebook editor and put them in a map
    lineMappings = await jupyterNotebookParser.mapNotebookHTML(htmlPath);

    // Parse the sum table from the HTML output
    parseSumTable($, diagnostics);

    // Find the sum table in the HTML
    const sumTable = $("table.sum").html();

    if (sumTable) {
      // Generate HTML content for the WebView
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

      // Iterate over all buttons in the HTML
      $("button").each((index, element) => {
        const buttonText = $(element).text().trim(); // Button text
        const onclickValue = $(element).attr("onclick"); // Onclick attribute value
        const backgroundColor = $(element).css("background-color"); // Background color

        // Find the span with the line number
        const lineNumberSpan = $(element).prevAll("span[id]").first();
        const lineNumber = parseInt(lineNumberSpan.attr("id") || "0", 10);

        if (lineMappings) {
          // Find the line mapping for the button
          const mapping = lineMappings.find(
            (map: jupyterNotebookParser.NotebookLineMapping) =>
              map.htmlRowNumber === lineNumber
          );
          if (mapping) {
            // Get the corresponding notebook cell
            const cell = vscode.window.activeNotebookEditor?.notebook.cellAt(
              mapping.notebookCellNumber
            );
            // Find the text editor for this cell's document
            const cellTextEditor = vscode.window.visibleTextEditors.find(
              (editor) =>
                editor.document.uri.toString() === cell?.document.uri.toString()
            );
            if (cellTextEditor) {
              // Define the range for the decoration
              const range = new vscode.Range(
                new vscode.Position(mapping.lineNumberInCell - 1, 0), // Convert to 0-based position
                new vscode.Position(mapping.lineNumberInCell - 1, 100) // Arbitrary width for the range
              );

              // Call detection functions
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
              // Store the button in the buttonsHTML map if the cell text editor is not found
              // VS Code API currently does not have any built-in method to find all text editors in a file
              // Each notebook cell is considered a unique text editor, so we cannot find all the cells at once
              // We store the buttons in an array to be able to parse them when the corresponding cell is displayed on screen
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
          console.log("Line Mappings undefined");
          vscode.window.showErrorMessage("Line Mappings undefined");
        }
      });

      // Add the diagnostics to the collection
      const fileUri = vscode.Uri.file(filePath);
      collection.set(fileUri, diagnostics);

      // Retrieve the boolean value from global state
      let showResultsTable = context.globalState.get(
        "antileak-ml.showResultsTable"
      );

      // Show the table in a WebView if the setting is enabled
      if (showResultsTable) {
        showHtmlInWebView(fullHtmlContent);
      }
    }
  }

  // Function to detect leakage based on button text and background color
  function detectLeakage(
    buttonText: string,
    backgroundColor: string | undefined,
    cellTextEditor: vscode.TextEditor | undefined,
    range: vscode.Range,
    diagnostics: vscode.Diagnostic[]
  ) {
    if (backgroundColor === "red") {
      const diagnosticSeverity = vscode.DiagnosticSeverity.Error; // Severity level for errors
      const diagnosticMessage = buttonText;

      // Define decoration properties
      const decorationProperties: vscode.DecorationRenderOptions = {
        after: {
          contentText: buttonText, // Button text
          backgroundColor: "red", // Red background
          color: "white", // White text
          margin: "0 10px 0 10px", // Spacing
        },
        borderRadius: "5px", // Rounded corners
        cursor: "pointer", // Pointer cursor
      };

      // Get or create the decoration type
      const decorationType = getOrCreateDecorationType(decorationProperties);
      // Apply the decoration to the cell
      if (cellTextEditor) {
        applyDecorationToCell(
          cellTextEditor.document.uri,
          range,
          decorationType
        );
      }

      // Add the diagnostic
      const diagnostic = new vscode.Diagnostic(
        range,
        diagnosticMessage,
        diagnosticSeverity
      );
      diagnostics.push(diagnostic);
    }
  }

  // Function to highlight train/test sites based on button text and onclick value
  function highlightTrainTestSites(
    buttonText: string,
    onclickValue: string | undefined,
    cellTextEditor: vscode.TextEditor | undefined,
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

      if (match && cellTextEditor) {
        const [_, line1, line2] = match.map(Number);

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

        // Get or create the decoration type
        const decorationType = getOrCreateDecorationType(decorationProperties);

        // Apply the decoration to the cell
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

          // Dispose of existing hover provider for this range if it exists
          const existingProvider =
            globals.registeredHoverProviders.get(providerkey);
          if (existingProvider) {
            existingProvider.provider.dispose();
            globals.registeredHoverProviders.delete(providerkey);
          }

          // Register a new hover provider
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
        }
      }
    }
  }

  // Function to run a Docker container for analysis
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

      // Parse the HTML output for diagnostics
      await parseHtmlOutput(htmlOutputPath, filePath, collection);

      // Clean up the generated HTML file
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

  // Function to parse the sum table for diagnostics
  function parseSumTable(
    $: cheerio.CheerioAPI,
    diagnostics: vscode.Diagnostic[]
  ) {
    const tableRows = $("table.sum tbody tr");

    tableRows.each((index, row) => {
      const cells = $(row).find("td");

      // Skip the header row
      if (index === 0) {
        return;
      }

      const leakageType = $(cells[0]).text().trim();
      const detectedCount = $(cells[1]).text().trim();
      const locations = $(cells[2]).text().trim();

      // Create a diagnostic message
      const diagnosticMessage = `Leakage: ${leakageType}, Detected: ${detectedCount}, Locations: ${locations}`;

      vscode.window.showInformationMessage(diagnosticMessage);

      // Define the range for the diagnostic
      const range = new vscode.Range(
        new vscode.Position(index - 1, 0),
        new vscode.Position(index - 1, 100)
      );

      // Add an informational diagnostic
      const diagnostic = new vscode.Diagnostic(
        range,
        diagnosticMessage,
        vscode.DiagnosticSeverity.Information
      );

      diagnostics.push(diagnostic);
    });
  }

  // Function to show HTML content in a WebView (for the results table)
  function showHtmlInWebView(htmlContent: string) {
    // Create a WebView panel
    const panel = vscode.window.createWebviewPanel(
      "LeakageReport", // Unique identifier for the WebView
      "Leakage Report", // Panel title
      vscode.ViewColumn.Two, // Position in the editor
      {
        enableScripts: true, // Allow scripts in the WebView
      }
    );

    // Inject the HTML content into the WebView
    panel.webview.html = htmlContent;
  }

  // Function to update diagnostics
  function updateDiagnostics(collection: vscode.DiagnosticCollection): void {
    collection.clear();
    if (vscode.window.activeNotebookEditor) {
      // Run the Docker container for analysis
      runDockerContainer(
        vscode.window.activeNotebookEditor.notebook.uri.fsPath,
        collection
      );
    } else {
      vscode.window.showErrorMessage("Cannot find Jupyter Notebook");
    }
  }

  // Function to clean up generated files and directories
  function cleanup(filePath: string) {
    const dirPath = path.dirname(filePath);

    try {
      // Delete the HTML file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`File ${filePath} has been deleted.`);
      }

      // Delete directories ending with "-fact"
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

      // Delete directories ending with "ip-fact"
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

      // Delete files ending with ".ir.py"
      const irPyFiles = fs
        .readdirSync(dirPath)
        .filter((item) => item.endsWith(".ir.py"));
      for (const file of irPyFiles) {
        fs.unlinkSync(path.join(dirPath, file));
        console.log(`File ${file} has been deleted.`);
      }

      // Delete files ending with ".py.json"
      const pyJsonFiles = fs
        .readdirSync(dirPath)
        .filter((item) => item.endsWith(".py.json"));
      for (const file of pyJsonFiles) {
        fs.unlinkSync(path.join(dirPath, file));
        console.log(`File ${file} has been deleted.`);
      }

      // Delete files ending with ".ipynb.json"
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

  // Recursive function to delete a folder and its contents
  function deleteFolderRecursive(folderPath: string) {
    if (fs.existsSync(folderPath)) {
      fs.readdirSync(folderPath).forEach((file) => {
        const curPath = path.join(folderPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          // Recursively delete subdirectories
          deleteFolderRecursive(curPath);
        } else {
          // Delete files
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(folderPath);
      console.log(`Directory ${folderPath} has been deleted.`);
    }
  }

  // Helper function to apply and store decorations with their type
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

    if (visibleEditor) {
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
        visibleEditor.setDecorations(decType, ranges);
      });
    }
  }
}

// Function to deactivate the Jupyter handler
export function jupyterHandlerDeactivate() {
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

  // Clear buttonsHTML map
  buttonsHTML.clear();

  // Clear diagnostics array
  diagnostics.length = 0;

  // Log a message indicating that the Jupyter handler has been deactivated
  console.log("Jupyter handler has been deactivated.");
}
