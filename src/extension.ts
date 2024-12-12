import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import Docker from "dockerode";

export function activate(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection("docker");

  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor.document, collection);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        updateDiagnostics(editor.document, collection);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document) {
        updateDiagnostics(event.document, collection);
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

    // Parse logs
    parseDockerOutput(Buffer.concat(output).toString(), filePath, collection);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Docker error: ${errorMessage}`);
    vscode.window.showErrorMessage(`Docker error: ${errorMessage}`);

    // Write error to log file
    const errorLog = `Docker error: ${errorMessage}\n`;
    fs.appendFileSync(logFilePath, errorLog, { encoding: "utf8" });
    console.log(`Error logged to ${logFilePath}`);
  }
}

function parseDockerOutput(
  output: string,
  filePath: string,
  collection: vscode.DiagnosticCollection
) {
  const diagnostics: vscode.Diagnostic[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const errorMatch = line.match(/(.+):(\d+):(\d+) - error: (.+) \((.+)\)/);
    if (errorMatch) {
      const [, file, lineNumber, column, message, code] = errorMatch;
      const startPos = new vscode.Position(
        parseInt(lineNumber) - 1,
        parseInt(column) - 1
      );
      const endPos = startPos.translate(0, message.length);
      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(startPos, endPos),
          `${message} (${code})`,
          vscode.DiagnosticSeverity.Error
        )
      );
    } else if (line.trim().length > 0) {
      // Handle uninterpretable lines
      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(0, 1)
          ),
          `Uninterpretable output: ${JSON.stringify(line.trim())}`,
          vscode.DiagnosticSeverity.Warning
        )
      );
    }
  }

  const fileUri = vscode.Uri.file(filePath);
  collection.set(fileUri, diagnostics);
}

function updateDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
): void {
  if (document.languageId !== "python" && document.languageId !== "jupyter") {
    collection.clear();
    return;
  }

  runDockerContainer(document.uri.fsPath, collection);
}
