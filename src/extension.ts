import * as vscode from "vscode";
import { handlePythonFile, pythonHandlerDeactivate } from "./pythonHandler";
import { handleJupyterFile, jupyterHandlerDeactivate } from "./jupyterHandler";
import { globals } from "./globals";

export async function activate(context: vscode.ExtensionContext) {
  // Create a diagnostic collection for Docker-related issues
  const collection = vscode.languages.createDiagnosticCollection("docker");

  // Register the command to run Python file analysis
  const runAnalysisPython = vscode.commands.registerCommand(
    "antileak-ml.runAnalysisPython",
    () => {
      handlePythonFile(context);
    }
  );

  // Register the command to run Jupyter Notebook analysis
  const runAnalysisNotebook = vscode.commands.registerCommand(
    "antileak-ml.runAnalysisNotebook",
    () => {
      handleJupyterFile(context);
    }
  );

  // Define a key for storing the global boolean variable in the extension's global state
  const SHOW_RESULTS_TABLE_KEY = "antileak-ml.showResultsTable";

  // Retrieve the boolean value from global state (default to false if not set)
  let showResultsTable = context.globalState.get(SHOW_RESULTS_TABLE_KEY, false);

  // Register the command to toggle the boolean value for showing/hiding the results table
  const toggleResultsTable = vscode.commands.registerCommand(
    "antileak-ml.toggleTable",
    () => {
      // Toggle the boolean value
      showResultsTable = !showResultsTable;

      // Update the global state with the new value
      context.globalState.update(SHOW_RESULTS_TABLE_KEY, showResultsTable);

      // Notify the user about the change (optional)
      vscode.window.showInformationMessage(
        `Results table visibility is now: ${showResultsTable ? "ON" : "OFF"}`
      );
    }
  );

  // Add the toggle command to the extension's subscriptions
  context.subscriptions.push(toggleResultsTable);

  // Add the analysis commands to the extension's subscriptions
  context.subscriptions.push(runAnalysisPython, runAnalysisNotebook);

  // Create a status bar button for running analysis
  const statusBarButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarButton.text = "$(file-code) Run Analysis"; // Default text and icon
  statusBarButton.tooltip = "Run analysis based on the current file type";
  context.subscriptions.push(statusBarButton);

  // Function to update the status bar button's command and visibility based on the active file
  function updateStatusBar() {
    const activeEditor = vscode.window.activeTextEditor;

    if (activeEditor) {
      // Get the file extension of the active document
      const fileExtension = activeEditor.document.fileName.split(".").pop();

      if (fileExtension === "py") {
        // Set the command and text for Python files
        statusBarButton.command = "antileak-ml.runAnalysisPython";
        statusBarButton.text = "$(python) Run Python Analysis";
        statusBarButton.tooltip =
          "Analyze your Python script for data leakages";
        statusBarButton.show();
      } else if (fileExtension === "ipynb") {
        // Set the command and text for Jupyter Notebook files
        statusBarButton.command = "antileak-ml.runAnalysisNotebook";
        statusBarButton.text = "$(notebook) Run Notebook Analysis";
        statusBarButton.tooltip =
          "Analyze your Jupyter Notebook for data leakages";
        statusBarButton.show();
      } else {
        // Hide the button if the file is neither .py nor .ipynb
        statusBarButton.hide();
      }
    } else {
      // Hide the button if no editor is active
      statusBarButton.hide();
    }
  }

  // Update the status bar button when the extension is activated
  updateStatusBar();

  // Update the status bar button whenever the active text editor changes
  vscode.window.onDidChangeActiveTextEditor(
    updateStatusBar,
    null,
    context.subscriptions
  );

  // Listen for file save events and trigger analysis based on the file type
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      const fileExtension = document.fileName.split(".").pop();
      if (document && fileExtension === "py") {
        handlePythonFile(context);
      } else if (fileExtension === "ipynb") {
        handlePythonFile(context);
      }
    })
  );

  // Listen for notebook save events and trigger analysis based on the file type
  context.subscriptions.push(
    vscode.workspace.onDidSaveNotebookDocument(async (document) => {
      if (document && document.uri.path.endsWith("py")) {
        handlePythonFile(context);
      } else if (document.uri.path.endsWith("ipynb")) {
        handlePythonFile(context);
      }
    })
  );
}

export function deactivate() {
  // Clean up decorations used in the extension
  for (const decorationType of globals.decorationPropertiesMap.values()) {
    decorationType.dispose();
  }
  globals.decorationPropertiesMap.clear();

  // Clean up hover providers registered by the extension
  for (const providerInfo of globals.registeredHoverProviders.values()) {
    providerInfo.provider.dispose();
  }
  globals.registeredHoverProviders.clear();

  // Clear any highlighted lines in the editor
  globals.highlightedLines.clear();

  // Clean up resources used by the Python handler
  pythonHandlerDeactivate();

  // Clean up resources used by the Jupyter handler
  jupyterHandlerDeactivate();

  // Log a message indicating that the extension has been deactivated
  console.log("Antileak-ML extension has been deactivated.");

  // Reload the VS Code window to ensure all decorations and changes are removed
  vscode.commands.executeCommand("workbench.action.reloadWindow");
}
