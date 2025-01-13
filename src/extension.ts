import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import Docker from "dockerode";
import * as cheerio from "cheerio";

export function activate(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection("docker");

  let highlightedLines: Set<string> = new Set(); // Pour suivre les lignes surlignées

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
    // Appel initial pour mettre à jour les diagnostics lorsque l'éditeur est actif
    updateDiagnostics(
      vscode.window.activeTextEditor.document,
      collection,
      context
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      updateDiagnostics(document, collection, context);
    })
  );
}

async function runDockerContainer(
  filePath: string,
  collection: vscode.DiagnosticCollection,
  context: vscode.ExtensionContext
) {
  const docker = new Docker();
  const inputDir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const imageName = "nat2194/leakage-analysis:1.0";
  const logFilePath = path.join(inputDir, "docker_logs.txt"); // Log file path
  const extension = path.extname(filePath);
  let newExtension = "";

  if (extension === ".py") {
    newExtension = ".html";
  } else if (extension === ".ipynb") {
    newExtension = ".ip.html";
  } else {
    throw new Error("Unsupported file type");
  }

  const htmlOutputPath = path.join(
    inputDir,
    path.basename(filePath, extension) + newExtension
  );

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

    parseHtmlForDiagnostics(htmlOutputPath, filePath, collection);
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
  const decorations: vscode.TextEditorDecorationType[] = [];

  // Appelle parseSumTable pour analyser la table .sum et ajouter des diagnostics
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

    // Afficher la table dans un WebView
    showHtmlInWebView(fullHtmlContent);

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
        detectLeakage(
          buttonText,
          backgroundColor,
          range,
          decorations,
          diagnostics
        );
        highlightTrainTestSites(
          buttonText,
          onclickValue,
          lineNumber,
          range,
          decorations,
          diagnostics
        );
      }
    });

    // Ajoute les diagnostics à la collection
    const fileUri = vscode.Uri.file(filePath);
    collection.set(fileUri, diagnostics);
  }
}

function detectLeakage(
  buttonText: string,
  backgroundColor: string | undefined,
  range: vscode.Range,
  decorations: vscode.TextEditorDecorationType[],
  diagnostics: vscode.Diagnostic[]
) {
  if (backgroundColor === "red") {
    const diagnosticSeverity = vscode.DiagnosticSeverity.Error; // Niveau de gravité pour les erreurs
    const diagnosticMessage = buttonText;

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
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.setDecorations(decorationType, [range]);
      decorations.push(decorationType);
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
  lineNumber: number,
  range: vscode.Range,
  decorations: vscode.TextEditorDecorationType[],
  diagnostics: vscode.Diagnostic[]
) {
  vscode.window.showErrorMessage("test2");

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
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        editor.setDecorations(decorationType, [range]);
        decorations.push(decorationType);
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

function updateDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
  context: vscode.ExtensionContext
): void {
  if (document.languageId !== "python" && document.languageId !== "jupyter") {
    collection.clear();
    return;
  }

  runDockerContainer(document.uri.fsPath, collection, context);
}

// Fonction pour créer un type de décoration basé sur le thème actuel
function isThemeLight(): boolean {
  return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light;
}
