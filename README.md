# Antileak-ML - VS Code Extension

**Antileak-ML** is a Visual Studio Code extension designed to help developers detect and prevent data leakage in Python scripts and Jupyter Notebooks. It analyzes your code for potential data leakage issues and provides visual feedback directly in the editor, making it easier to identify and fix problems.

This is an engineering project realized by a team of engineering students at EFREI (École d'Ingénieurs Généraliste du Numérique).

The team is composed of :

    - Achraf BEN BACCAR
    - Nathan CARLIER
    - Danny GRAINE
    - Thierno-Sadou DIALLO
    - Léo PETIT
    - Emerick SZONYI

---

## Features

- **Data Leakage Detection**: Automatically analyzes Python scripts and Jupyter Notebooks for data leakage issues.
- **Visual Feedback**: Highlights problematic lines in the code and provides diagnostic messages.
- **Interactive Results**: Displays a summary table of detected leakage issues in a new panel.
- **Docker Integration**: Uses a Docker container to perform the analysis, ensuring consistent and isolated execution as well as compatibility on all Operating Systems.

---

## Theoretical Concept

There are 3 kinds of leakages that our extension is able to detect:

- ### Preprocessing Leakage:
  When training data and test data are preprocessed (transformed) together, test data sometimes influences the transformations of the training data
  
- ### Overlap Leakage:
  A type of data leakage in machine learning that occurs when training and test sets share similar or identical data. This distorts the model's evaluation, as it has already seen samples from the test set during training, leading to an overestimation of its performance
  
- ### Multitest Leakage:
  A type of data leakage that occurs when the same test set is used several times to evaluate a model, distorting the real evaluation of its performance

---

## Requirements

Before using the **Antileak-ML** extension, ensure you have the following installed:

1. **Visual Studio Code**: The extension is designed for use with VS Code. Download it from [here](https://code.visualstudio.com/).
2. **Docker**: The extension relies on Docker to run the analysis. Install Docker from [here](https://www.docker.com/).
   - Ensure Docker is running before using the extension.
3. **Python**: The extension is designed for Python scripts and Jupyter Notebooks. Trying to run an analysis on other files won't work.
4. **Jupyter Notebook Support**: If analyzing Jupyter Notebooks, ensure the Jupyter extension is installed in VS Code.

---

## Installation

1. Open **Visual Studio Code**.
2. Go to the **Extensions** view by clicking on the Extensions icon in the Activity Bar on the side of the window or by pressing `Ctrl+Shift+X`.
3. Search for **Antileak-ML**.
4. Click **Install** to install the extension.

---

## Usage

### Running the Analysis

1. **Open a Python Script or Jupyter Notebook**:

   - Open a `.py` file or `.ipynb` file in VS Code.

2. **Run the Analysis**:

   - Click the **Run Analysis** button in the status bar (bottom-left corner of the editor). if you are trying to analyze a notebook, you may need to select a code cell for the button to appear.
   - Or, use the shortcut `Ctrl+Alt+A`.
   - Alternatively, use the command palette (`Ctrl+Shift+P`) and search for:
     - `Antileak-ML: Run Python Analysis` for Python scripts.
     - `Antileak-ML: Run Notebook Analysis` for Jupyter Notebooks.

3. **Confirm the Analysis**:

   - A confirmation dialog will appear. Click **Yes** to proceed with the analysis.

4. **View the Results**:
   - The extension will analyze the file and highlight problematic lines in the editor.
   - A summary table of detected leakage issues will be displayed in a WebView panel (if enabled).

### Toggling the Results Table

- To toggle the visibility of the results table, use the command palette (`Ctrl+Shift+P`) and search for:
  - `Antileak-ML: Toggle Results Table`.

### Highlighting Lines

- The extension allows you to highlight specific lines in the code. Click on the highlighted lines to toggle the highlighting. This allows you to detect training/test data couples in order to understand more your data flows.

---

## Configuration

The extension provides the following configuration option:

1. **Show Results Table**:

   - Toggle the visibility of the results table using the `Antileak-ML: Toggle Results Table` command.
   - The state is saved in the global user settings.

---

## How It Works

1. **Docker Container**:

   - The extension uses a Docker container (`nat2194/leakage-analysis:1.0`) to perform the analysis.
   - The container runs a script that analyzes the Python or Jupyter Notebook file and generates an HTML report.

2. **HTML Parsing**:

   - The extension parses the generated HTML report to extract diagnostic information and display it in the editor.

3. **Decorations and Diagnostics**:
   - The extension applies decorations to problematic lines and displays diagnostic messages in the Problems panel.

---

## Troubleshooting

### Docker Not Running

- If you encounter an error related to Docker not running, ensure Docker is installed and running on your system.
- Restart Docker and try running the analysis again.

### Analysis Fails

- If the analysis fails, check the console logs for more information.
- Ensure the file you are analyzing is valid and does not contain syntax errors.

### Extension Not Working

- Ensure the extension is properly installed and enabled in VS Code.
- Restart VS Code if the extension does not respond.

---

## Context and Credits

This extension is based on the work of the following static analysis tool to detect test data leakage in Python notebooks : [GitHub repository](https://github.com/malusamayo/leakage-analysis).
This tool itself is based on the ASE'22 paper: [Data Leakage in Notebooks: Static Detection and Better Processes](https://www.cs.cmu.edu/~cyang3/papers/ase22.pdf).
You can find our own version of the tool, including our Dockerfile to reproduce the Docker image on this [GitHub repository](https://github.com/Nat2194/leakage-analysis).

The Source Code of this extension is available on this [GitHub repository](https://github.com/Nat2194/antileak-ml).

---

## License

MIT License

Copyright (c) 2022 malusamayo
Copyright (c) 2025 AntiLeakML EFREI

---

## Dependances

- **Dockerode**: The extension relies on Docker for isolated and consistent analysis.
- **VS Code API**: The extension uses the VS Code API for integrating with the editor.
- **Cheerio**: Used for parsing HTML reports generated by the analysis tool.

---

## Contact

For questions, feedback, or support, please open an issue on the [GitHub repository](https://github.com/Nat2194/antileak-ml).

---

Enjoy using **Antileak-ML** to detect and prevent data leakage in your Python and Jupyter projects! 🚀
