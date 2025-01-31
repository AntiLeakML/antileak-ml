import * as vscode from "vscode";
import * as path from "path";
import * as cheerio from "cheerio";

export interface NotebookLineMapping {
  htmlRowNumber: number;
  notebookCellNumber: number;
  lineNumberInCell: number;
  cellType: "code" | "markdown";
  originalLine: string;
}

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

  // First pass: Extract all lines and their content from HTML
  const htmlLines: {
    lineNumber: number;
    content: string;
    isComment: boolean;
  }[] = [];
  let currentLineNumber = 1; // Start line numbering at 1

  // Select all spans within the code section
  const tableRows = $(".highlighttable .code .highlight pre > span");

  tableRows.each((_, element) => {
    const span = $(element);
    const content = span.text().trim();
    const isComment = span.hasClass("c1"); // Check if it's a comment

    // Add every span as a line, regardless of whether it has an id
    htmlLines.push({
      lineNumber: currentLineNumber,
      content,
      isComment,
    });

    // Only increment line number for spans that would traditionally have an id
    // This maintains alignment with the line numbers shown in the HTML
    if (span.attr("id") || content) {
      currentLineNumber++;
    }
  });

  // Second pass: Process notebook cells and create mappings
  notebook.getCells().forEach((cell, cellIndex) => {
    const cellLines = cell.document.getText().split("\n");

    cellLines.forEach((cellLine, lineIndexInCell) => {
      const trimmedCellLine = cellLine.trim();

      // Skip empty lines in the notebook
      if (!trimmedCellLine) {
        return;
      }

      // Find matching HTML lines
      const matchingHtmlLines = htmlLines.filter((htmlLine) => {
        // For comments, do an exact match after trimming
        if (htmlLine.isComment) {
          return htmlLine.content === trimmedCellLine;
        }

        // For non-comments, remove leading/trailing whitespace and comments
        const cleanHtmlContent = htmlLine.content
          .trim()
          .replace(/^\s*#.*$/, ""); // Remove comment lines

        if (!cleanHtmlContent) {
          return false;
        }

        // Check if the HTML line contains the notebook line
        return cleanHtmlContent.includes(trimmedCellLine);
      });

      // Create mappings for each match
      matchingHtmlLines.forEach((matchedLine) => {
        lineMappings.push({
          htmlRowNumber: matchedLine.lineNumber,
          notebookCellNumber: cellIndex,
          lineNumberInCell: lineIndexInCell + 1,
          cellType:
            cell.kind === vscode.NotebookCellKind.Code ? "code" : "markdown",
          originalLine: trimmedCellLine,
        });
      });
    });
  });

  // Add unmapped lines to mappings
  htmlLines.forEach((htmlLine) => {
    const isLineAlreadyMapped = lineMappings.some(
      (mapping) => mapping.htmlRowNumber === htmlLine.lineNumber
    );

    if (!isLineAlreadyMapped) {
      lineMappings.push({
        htmlRowNumber: htmlLine.lineNumber,
        notebookCellNumber: -1, // Indicate no direct cell mapping
        lineNumberInCell: -1,
        cellType: "code", // Assume code cell for unmapped lines
        originalLine: htmlLine.content,
      });
    }
  });

  // Sort final mappings by HTML line number
  lineMappings.sort((a, b) => a.htmlRowNumber - b.htmlRowNumber);

  // Write mappings to JSON file to debug
  //await writeLineMappingsToFile(lineMappings, htmlFilePath);

  return lineMappings;
}

async function writeLineMappingsToFile(
  mappings: NotebookLineMapping[],
  htmlFilePath: string
): Promise<void> {
  try {
    const outputFilename = path.join(
      path.dirname(htmlFilePath),
      `notebook_line_mappings_${Date.now()}.json`
    );

    const jsonContent = JSON.stringify(mappings, null, 2);

    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(outputFilename),
      new TextEncoder().encode(jsonContent)
    );

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

export async function mapNotebookHTML(htmlFilePath: string) {
  if (!htmlFilePath) {
    vscode.window.showInformationMessage("No HTML file selected.");
    return;
  }

  const activeNotebook = vscode.window.activeNotebookEditor?.notebook;

  if (!activeNotebook) {
    vscode.window.showInformationMessage("No active notebook found.");
    return;
  }

  try {
    const lineMappings = await mapPygmentsHTMLLinesToNotebook(
      htmlFilePath,
      activeNotebook
    );

    return lineMappings;
  } catch (error) {
    vscode.window.showErrorMessage(
      `Notebook HTML mapping failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
