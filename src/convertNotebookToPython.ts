#!/usr/bin/env ts-node

import * as fs from "fs";
import * as path from "path";

function convertNotebookToPython(notebookPath: string): string {
  const outputDir = path.dirname(notebookPath);
  const baseName = path.basename(notebookPath, ".ipynb");
  const pythonFilePath = path.join(outputDir, `${baseName}.py`);

  // Read and parse the notebook JSON
  const notebookContent = JSON.parse(
    fs.readFileSync(notebookPath, { encoding: "utf8" })
  );

  const pythonScriptLines: string[] = [];

  // Iterate over the cells
  if (Array.isArray(notebookContent.cells)) {
    for (const cell of notebookContent.cells) {
      if (cell.cell_type === "code") {
        pythonScriptLines.push(...cell.source);
        pythonScriptLines.push(""); // Add an empty line between code cells
      } else if (cell.cell_type === "markdown") {
        const markdownComments = cell.source.map((line: string) => `# ${line}`);
        pythonScriptLines.push(...markdownComments);
        pythonScriptLines.push(""); // Add an empty line after markdown
      }
    }
  }

  // Join all lines into a single string
  const pythonScript = pythonScriptLines.join("\n");

  // Write the cleaned script to the file
  fs.writeFileSync(pythonFilePath, pythonScript, { encoding: "utf8" });

  return pythonFilePath;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("Usage: ts-node notebookToPython.ts <notebook-path>");
    process.exit(1);
  }

  const notebookPath = args[0];
  if (!fs.existsSync(notebookPath)) {
    console.error(`Error: The file "${notebookPath}" does not exist.`);
    process.exit(1);
  }

  try {
    const pythonFilePath = convertNotebookToPython(notebookPath);
    console.log(`Notebook converted to Python script: ${pythonFilePath}`);
  } catch (error) {
    console.error(
      `Error during conversion: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  }
}

main();
