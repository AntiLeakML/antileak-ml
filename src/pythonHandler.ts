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

// Map to store decorations for each file URI
const decorationMap = new Map<string, StoredDecoration[]>();

// Define a decoration type for highlighting lines
const highlightDecorationType = getOrCreateDecorationType({
  backgroundColor: isThemeLight()
    ? "rgba(173, 216, 230, 0.3)"
    : "rgba(135, 206, 250, 0.3)",
});

// Function to handle Python file analysis
export async function handlePythonFile(context: vscode.ExtensionContext) {
  // Create a diagnostic collection for Docker-related issues
  const collection = vscode.languages.createDiagnosticCollection("docker");

  // Check if there is an active text editor
  if (vscode.window.activeTextEditor) {
    let document = vscode.window.activeTextEditor.document;
    if (document && document.languageId === "python") {
      // Show a confirmation dialog to the user
      const confirmAnalysis = await vscode.window.showInformationMessage(
        "Do you want to analyze your code for leakage?",
        { modal: true },
        "Yes"
      );

      // Proceed only if the user confirms
      if (confirmAnalysis === "Yes") {
        // Update diagnostics for the saved document
        updateDiagnostics(document, collection);
      }
    }
  }

  // Listen for changes in visible text editors (including notebook cells)
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((visibleEditors) => {
      for (const textEditor of visibleEditors) {
        const cellUri = textEditor.document.uri.toString();
        const decorations = decorationMap.get(cellUri) || [];

        // Reapply all stored decorations for this text editor
        decorations.forEach(({ range, decorationType }) => {
          textEditor.setDecorations(decorationType, [range]);
        });
      }
    })
  );

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

            // Define ranges for the lines to highlight
            const range1 = new vscode.Range(
              new vscode.Position(line1 - 1, 0),
              new vscode.Position(line1 - 1, Number.MAX_SAFE_INTEGER)
            );

            const range2 = new vscode.Range(
              new vscode.Position(line2 - 1, 0),
              new vscode.Position(line2 - 1, Number.MAX_SAFE_INTEGER)
            );

            // Create unique keys for the highlighted lines
            const key1 = `${line1}:${editor.document.uri.toString()}`;
            const key2 = `${line2}:${editor.document.uri.toString()}`;

            // Check if the lines are already highlighted
            if (
              globals.highlightedLines.has(key1) &&
              globals.highlightedLines.has(key2)
            ) {
              // Remove highlighting if already applied
              globals.highlightedLines.delete(key1);
              globals.highlightedLines.delete(key2);
              editor.setDecorations(highlightDecorationType, []);
            } else {
              // Apply highlighting if not already applied
              globals.highlightedLines.add(key1);
              globals.highlightedLines.add(key2);
              editor.setDecorations(highlightDecorationType, [range1, range2]);
            }
          }
        )
      );
    }
  });

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

      // Parse the HTML output for diagnostics
      parseHtmlOutput(htmlOutputPath, filePath, collection);

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

  // Function to parse the HTML output to generate diagnostics and decorations
  function parseHtmlOutput(
    htmlPath: string,
    filePath: string,
    collection: vscode.DiagnosticCollection
  ) {
    const htmlContent = fs.readFileSync(htmlPath, "utf8");
    const $ = cheerio.load(htmlContent);

    const diagnostics: vscode.Diagnostic[] = [];

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

        // Find the span with the line number
        const lineNumberSpan = $(element).prevAll("span[id]").first();
        const lineNumber = parseInt(lineNumberSpan.attr("id") || "0", 10);

        // If a valid line number is found
        if (lineNumber > 0) {
          const range = new vscode.Range(
            new vscode.Position(lineNumber - 1, 0), // Convert to 0-based position
            new vscode.Position(lineNumber - 1, 100) // Arbitrary width for the range
          );

          // Check the button's background color
          const backgroundColor = $(element).css("background-color");

          // Call detection functions
          detectLeakage(buttonText, backgroundColor, range, diagnostics);
          highlightTrainTestSites(buttonText, onclickValue, range, diagnostics);
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
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        applyDecorationToFile(editor.document.uri, range, decorationType);
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
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          applyDecorationToFile(editor.document.uri, range, decorationType);
        }

        // Register a hover provider for the highlighted lines
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

  // Function to show HTML content in a WebView
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

  // Function to apply decorations to a file
  function applyDecorationToFile(
    fileUri: vscode.Uri,
    range: vscode.Range,
    decorationType: vscode.TextEditorDecorationType
  ) {
    const uriString = fileUri.toString();
    let fileDecorations = decorationMap.get(uriString) || [];

    // Check if this exact decoration (same type and range) already exists
    const existingDecorationIndex = fileDecorations.findIndex(
      (d) =>
        d.range.isEqual(range) && d.decorationType.key === decorationType.key
    );

    if (existingDecorationIndex === -1) {
      // Add new decoration to the array
      fileDecorations.push({ range, decorationType });
    } else {
      // Update existing decoration
      fileDecorations[existingDecorationIndex] = { range, decorationType };
    }

    // Update the map
    decorationMap.set(uriString, fileDecorations);

    // Find the visible editor for this file
    const visibleEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === uriString
    );

    if (visibleEditor) {
      // Group decorations by type
      const decorationsByType = new Map<
        vscode.TextEditorDecorationType,
        vscode.Range[]
      >();

      fileDecorations.forEach((decoration) => {
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

// Function to deactivate the Python handler
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

  // Log a message indicating that the Python handler has been deactivated
  console.log("Python handler has been deactivated.");
}
