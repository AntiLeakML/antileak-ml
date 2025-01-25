import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import Docker from "dockerode";
import * as cheerio from "cheerio";
import { handlePythonFile } from "./pythonHandler";
import { handleJupyterFile } from "./jupyterHandler";
import { globals } from "./globals";

export async function activate(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection("docker");
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

      // Check if the file is a Python file or a Jupyter Notebook
      if (fileExtension === "py") {
        vscode.window.showInformationMessage(
          "The opened file is a Python document."
        );
        handlePythonFile(context);
      } else if (fileExtension === "ipynb") {
        vscode.window.showInformationMessage(
          "The opened file is a Jupyter Notebook."
        );
        handleJupyterFile(context);
      } else {
        vscode.window.showInformationMessage(
          "The opened file is neither a Python document nor a Jupyter Notebook."
        );
      }
    }
  );

  context.subscriptions.push(command);
}
