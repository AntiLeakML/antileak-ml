import * as vscode from "vscode";
import * as path from "path";
import * as cheerio from "cheerio";

/**
 * Interface representing the mapping between HTML and Jupyter Notebook lines
 */
interface NotebookLineMapping {
  htmlRowNumber: number;
  notebookCellNumber: number;
  lineNumberInCell: number;
  cellType: "code" | "markdown";
  originalLine: string;
}

/**
 * Maps lines from a Pygments-generated HTML representation to their corresponding locations in a Jupyter Notebook
 *
 * @param htmlFilePath Path to the HTML file representing the notebook
 * @param notebook The Jupyter notebook document to map against
 * @returns A map of line mappings
 */
export async function mapPygmentsHTMLLinesToNotebook(
  htmlFilePath: string,
  notebook: vscode.NotebookDocument
): Promise<NotebookLineMapping[]> {
  // Read HTML file
  const htmlContent = await vscode.workspace.fs.readFile(
    vscode.Uri.file(htmlFilePath)
  );
  const htmlText = new TextDecoder().decode(htmlContent);

  // Parse HTML using cheerio
  const $ = cheerio.load(htmlText);

  // Initialize mapping results
  const lineMappings: NotebookLineMapping[] = [];

  // Extract lines from the highlighttable
  const htmlLines: { lineNumber: number; lineContent: string }[] = [];
  $(".highlighttable tr").each((rowIndex, row) => {
    const lineNoCell = $(row).find(".linenos");
    const codeCell = $(row).find(".code");

    if (lineNoCell.length && codeCell.length) {
      const lineNumber = parseInt(lineNoCell.text().trim());
      const lineContent = codeCell
        .map((i, span) => $(span).text().trim())
        .get()
        .join("");

      if (!isNaN(lineNumber)) {
        htmlLines.push({
          lineNumber,
          lineContent: lineContent || "", // Ensure empty string for empty lines
        });
      }
    }
  });

  // Iterate through notebook cells
  notebook.getCells().forEach((cell, cellIndex) => {
    // Get cell source lines, excluding comments
    const sourceLines = cell.document
      .getText()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    // Match notebook cell lines to HTML lines
    sourceLines.forEach((sourceLine, lineIndexInCell) => {
      // Find all matching HTML line indices
      const matchingHtmlLines = htmlLines.filter((htmlLine) =>
        htmlLine.lineContent.includes(sourceLine)
      );

      // Create mappings for each match
      matchingHtmlLines.forEach((matchedLine) => {
        lineMappings.push({
          htmlRowNumber: matchedLine.lineNumber,
          notebookCellNumber: cellIndex,
          lineNumberInCell: lineIndexInCell,
          cellType:
            cell.kind === vscode.NotebookCellKind.Code ? "code" : "markdown",
          originalLine: sourceLine,
        });
      });
    });
  });

  // Write mappings to JSON file
  await writeLineMappingsToFile(lineMappings, htmlFilePath);

  return lineMappings;
}

/**
 * Writes line mappings to a JSON file in the same directory as the HTML file
 *
 * @param mappings The line mappings to write
 * @param htmlFilePath Path of the original HTML file
 */
async function writeLineMappingsToFile(
  mappings: NotebookLineMapping[],
  htmlFilePath: string
): Promise<void> {
  try {
    // Generate output filename
    const outputFilename = path.join(
      path.dirname(htmlFilePath),
      `notebook_line_mappings_${Date.now()}.json`
    );

    // Convert mappings to JSON
    const jsonContent = JSON.stringify(mappings, null, 2);

    // Write file using workspace filesystem
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(outputFilename),
      new TextEncoder().encode(jsonContent)
    );

    // Notify user
    vscode.window.showInformationMessage(
      `Line mappings saved to ${outputFilename}. Total mappings: ${mappings.length}`
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to write line mappings: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * VS Code command to execute notebook HTML mapping
 */
export async function mapNotebookHTML() {
  // Prompt user to select HTML file
  const htmlFileUris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: {
      "HTML Files": ["html"],
    },
    title: "Select Pygments Notebook HTML File",
  });

  // Ensure a file was selected
  if (!htmlFileUris || htmlFileUris.length === 0) {
    vscode.window.showInformationMessage("No HTML file selected.");
    return;
  }

  // Get active notebook
  const activeNotebook = vscode.window.activeNotebookEditor?.notebook;

  if (!activeNotebook) {
    vscode.window.showInformationMessage("No active notebook found.");
    return;
  }

  try {
    // Perform mapping
    const lineMappings = await mapPygmentsHTMLLinesToNotebook(
      htmlFileUris[0].fsPath,
      activeNotebook
    );

    // Optional: Log mappings to console
    console.log("Notebook Line Mappings:", lineMappings);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Notebook HTML mapping failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
