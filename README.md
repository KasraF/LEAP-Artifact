# Validating AI-Generated Code with Live Programming

## Table of Content
1. [About](#about)
1. [Prerequisites](#prerequisites)
2. [How to Build](#how-to-build)
3. [How to Run](#how-to-run)
4. [How to Use](#how-to-use)

## About
LEAP (**L**ive **E**xploration of **A**I-Generated **P**rograms) combines [Projection Boxes](https://dl.acm.org/doi/10.1145/3313831.3376494) with a Copilot-like tool that generates code completions within the current buffer.

LEAP (similar to Projection Boxes) uses a modified version of [Visual Studio Code](https://github.com/microsoft/vscode), including Projeciton Boxes and LEAP as separate _contributions_ in the editor. For code generation, it uses [OpenAI's _Completion_ API](https://platform.openai.com/docs/api-reference/completions).

For any questions, please reach out to the authors of the paper [Kasra Ferdowsi](mailto:kferdows@ucsd.edu) and [Ruanqianqian (Lisa) Huang](mailto:r6huang@ucsd.edu).

## Prerequisites
To build LEAP, you need to first install the following:

1. [Node.js 16](https://nodejs.org/en/about/previous-releases)
2. [Python 3.8](https://www.python.org/downloads/) or above
3. The [`numpy`](https://pypi.org/project/numpy/) Python package
4. The [`matplotlib`](https://pypi.org/project/matplotlib/) Python package
3. [npm](https://nodejs.org/en/download/package-manager)
4. [yarn](https://classic.yarnpkg.com/en/)
5. An [OpenAI API key](https://platform.openai.com/docs/api-reference/authentication) to use for generating completions.

Once you satisfy the requirements please follow the next steps to setup your environment.

## How to Build

### Building from the terminal
The simplest way to build and run LEAP is directly within the terminal. To do so:

1. (Mac users only) Open up a terminal, type `arch` to ensure that you are using a x86_64 architecture. M1 is currently not supported.
2. Navigate to the directory containing this README file.
3. Run `yarn` or `yarn install`. This will install all the necessary node packages. Ensure that this command finishes successfully. If not, please look at the errors and address them before moving on.
4. Run `yarn compile`. This will compile the source code.

### Building from VSCode
You can also build LEAP by opening this directory inside a regular instance of VSCode. To do so:

1. Follow steps 1-3 [above](#building-from-the-terminal).
2. Open the directory containing this README in VSCode.
3. Run `Ctrl + Shift + B` (`Cmd + Shift + B` on Mac) to compile the source code.

Unlike the terminal instructions which build the source once, this starts a build daemon which automatically recompiles the code after edits. You may find this useful if you are modifying the source code.

## How to Run

LEAP depends on a number of environment variables that must be present and set correctly for it to work. These env vars are:

1. `PYTHON3`: Absolute path to the Python 3 executable.
2. `RUNPY`: Absolute path to the `./src/run.py` file.
3. `IMGSUM`: Absolute path to the `./src/img-summary.py` file.
4. `LEAP_PROMPT`: Absolute path to the `./src/implement_it.txt` file.
5. `OPENAI_API_KEY`: Your OpenAI API key.

How you set these variables is up to you (e.g. you could set them globally) but here we include instructions for setting them for running from the terminal, and from VSCode.

### Running from the terminal
We have provided a shell script for running LEAP in `./run.py`. First edit the script in a text editor and replace `OPENAI API KEY HERE` with your OpenAI API key. The other env vars should be set automatically, but if you run into issues, you may want to hard code them in this script as well.

After editing this file, save and close and run it with `./run.py`. Note that you must [build](#how-to-build) LEAP _before_ running this script, otherwise you will run into errors.

### Running from VSCode
To run LEAP directly from VSCode:

1. Open the directory containing this README in VSCode.
2. In the `launch.json` under `.vscode` directory set the env vars above under `Launch VS Code Internal`
	- You may also configure these environment variables in your shell configuration (e.g., in `~/.profile`).
	- Alternatively, you may configure the variables in `./.env`, and declare in `inputs` in `.vscode/launch.json` the id's and keys of the configured variables. For example, if you have configured `PYTHON3=/usr/local/bin/python3` in `./.env`, then the `inputs` in `./vscode/launch.json` should be
	```
		"inputs": [
			{
				"id": "envPYTHON3",
				"type": "command",
				"command": "extension.commandvariable.file.content",
				"args": {
				  "fileName": "${workspaceFolder}/.env",
				  "key": "PYTHON3",
				  "default": ""
				}
			}
		]
	```
	and the environment variable configuration in `Launch VS Code Internal`, under `.vscode/launch.json`, should be
	```
	"env": {
		"PYTHON3": "${input:envPYTHON3}"
	}
	```
3. Run the build by pressing `F5`. Note that you must [build](#how-to-build) LEAP before pressing `F5`, otherwise you will run into errors.

## How to Use
To use LEAP, first open a python file or open a new file and save it with a `.py` extension. Then, as you write executable Python code, you should see Projection Boxes appearing to show your program's runtime values. To invoke the AI assistant, press `Ctrl + Enter` (`Cmd + Enter` on Mac) on a _new line_. This should open a side panel containing code suggestions.
