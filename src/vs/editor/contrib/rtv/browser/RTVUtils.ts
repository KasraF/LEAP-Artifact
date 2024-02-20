import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
// import { kill } from 'process';
import { Utils, RunResult, IRTVLogger, SynthProblem, SynthResult, SynthProcess, RunProcess } from 'vs/editor/contrib/rtv/browser/RTVInterfaces';
import { RTVLogger } from 'vs/editor/contrib/rtv/browser/RTVLogger';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
// import { runAtThisOrScheduleAtNextAnimationFrame } from 'vs/base/browser/dom';
// import { MainThreadFileSystem } from 'vs/workbench/api/browser/mainThreadFileSystem';

// Helper functions / class
export function getOSEnvVariable(v: string): string {
	const result = process.env[v];
	if (result === undefined) {
		throw new Error('OS environment variable ' + v + ' is not defined.');
	}
	return result;
}

// temporarily move the following three functions/class from RTVDisplay
// to resolve a dependency cycle between RTVDisplay and RTVSynthDisplay: RTVDisplay (-> RTVSynth -> RTVSynthDisplay) -> RTVDisplay

export function isHtmlEscape(s: string): boolean {
	return s.startsWith('```html\n') && s.endsWith('```');
}

export function removeHtmlEscape(s: string): string {
	const x = '```html\n'.length;
	const y = '```'.length;
	return s.substring(x, s.length - y);
}

export class TableElement {
	constructor(
		public content: string,
		public loopID: string,
		public iter: string,
		public controllingLineNumber: number,
		public vname?: string,
		public env?: any,
		public leftBorder?: boolean,
		public editable?: boolean
	) { }
}


const PY3 = getOSEnvVariable('PYTHON3');
const RUNPY = getOSEnvVariable('RUNPY');
const IMGSUM = getOSEnvVariable('IMGSUM');
const SYNTH: string = ''; //getOSEnvVariable('SYNTH');
const JAVA = ''; //getOSEnvVariable('JAVA');
const HEAP = process.env['HEAP'];
const SNIPPY_UTILS = ''; // getOSEnvVariable('SNIPPY_UTILS');

class LocalRunProcess implements RunProcess {
	protected _reject?: () => void;
	protected _promise: Promise<RunResult> = new Promise(() => { });

	public stdout: string = '';
	public stderr: string = '';

	constructor(
		protected _file: string,
		protected _process: ChildProcessWithoutNullStreams) {
		this._promise = new Promise((resolve, reject) => {
			this._reject = reject;

			this._process.stdout.on('data', (data) => this.stdout += data);
			this._process.stderr.on('data', (data) => {
				console.log(data.toString());
				this.stderr += data;
			});
			this._process.on('exit', (exitCode) => {
				let result = undefined;
				if (exitCode !== null) {
					result = fs.readFileSync(this._file + '.out').toString();
				}
				resolve(new RunResult(this.stdout, this.stderr, exitCode, result));
			});
		});
	}

	async kill(): Promise<boolean> {
		this._process.kill();
		if (this._reject) {
			this._reject();
			this._reject = undefined;
		}
		return true;
	}

	async then<TResult1 = RunResult, TResult2 = never>(
		onfulfilled?: ((value: RunResult) => TResult1 | PromiseLike<TResult1>) | undefined | null,
		onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2> {
		return this._promise.then(onfulfilled, onrejected);
	}

	async catch<TResult = never>(
		onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<any | TResult> {
		return this._promise.catch(onrejected);
	}
}


class EmptySynthProcess implements SynthProcess {
	synthesize(_problem: SynthProblem): Promise<SynthResult | undefined> {
		return Promise.resolve(undefined);
	}

	stop(): boolean {
		return true;
	}

	connected(): boolean {
		return true;
	}
}


class LocalSynthProcess implements SynthProcess {
	private _resolve?: (value: SynthResult) => void = undefined;
	private _reject?: () => void = undefined;
	private _problemIdx: number = -1;
	private _synthProcess: ChildProcessWithoutNullStreams;

	constructor(protected logger?: IRTVLogger) {
		this.logger?.synthProcessStart();

		if (HEAP) {
			this._synthProcess = spawn(JAVA, [`-Xmx${HEAP}`, '-jar', SYNTH]);
		} else {
			this._synthProcess = spawn(JAVA, ['-jar', SYNTH]);
		}

		// shut down the synthesizer with the editor
		process.on('exit', () => this.dispose());
		process.on('beforeExit', async () => this.dispose());
		process.on('uncaughtException', () => this.dispose());
		process.on('SIGINT', () => this.dispose());

		// Log if the synth crashes/exits
		this._synthProcess.on('exit', () => this.logger?.synthProcessEnd());
		this._synthProcess.on('close', () => this.logger?.synthProcessEnd());

		// Log all synthesizer output
		this._synthProcess.stdout.on('data', data => this.logger?.synthStdout(data));
		this._synthProcess.stderr.on('data', data => this.logger?.synthStderr(data));

		// Set up the listeners we use to communicate with the synth
		this._synthProcess.stdout.on('data', (data) => {
			const resultStr = String.fromCharCode.apply(null, data);

			if (this._resolve && this._reject) {
				try {
					// TODO Check result id
					const rs = JSON.parse(resultStr) as SynthResult;
					if (rs.id === this._problemIdx) {
						// request not discarded
						this._resolve(rs);
						this._resolve = undefined;
						this._reject = undefined;
					} else if (rs.id === -1) {
						console.error(`The synthesizer crashed!`, rs);
					} else {
						console.error(`Request already discarded: ${rs.id}`);
					}
				} catch (e) {
					console.error('Failed to parse synth output: ' + String.fromCharCode.apply(null, data));
				}
			} else {
				console.error('Synth output when not waiting on promise: ');
				console.error(resultStr);
			}
		});

		// TODO (kas) why was this here?!
		// this._synthProcess
	}

	public synthesize(problem: SynthProblem): Promise<SynthResult | undefined> {
		if (this._reject) {
			this._reject();
			this._resolve = undefined;
			this._reject = undefined;
		}

		// First, create the promise we're returning.
		const rs: Promise<SynthResult> = new Promise((resolve, reject) => {
			this._resolve = resolve;
			this._reject = reject;
		});

		// Then send the problem to the synth
		problem.id = ++this._problemIdx;
		this._synthProcess.stdin.write(JSON.stringify(problem) + '\n');
		console.log(`Started synth process: ${this._problemIdx}`);

		// And we can return!
		return rs;
	}

	public stop(): boolean {
		if (this._reject) {
			this._reject();
			this._reject = undefined;
			this._resolve = undefined;
			return true;
		}
		return false;
	}

	public dispose() {
		this._synthProcess?.kill('SIGKILL');
	}

	public connected(): boolean {
		return this._synthProcess &&
			// this._synthProcess.connected &&
			!this._synthProcess.stdin.destroyed;
	}
}


class LocalUtils implements Utils {
	readonly EOL: string = os.EOL;
	readonly pathSep: string = path.sep;
	_logger?: IRTVLogger;
	_synth?: SynthProcess;

	logger(editor: ICodeEditor): IRTVLogger {
		if (!this._logger) {
			this._logger = new RTVLogger(editor);
		}
		return this._logger;
	}

	runProgram(program: string, cwd?: string, values?: any): RunProcess {
		const file: string = os.tmpdir() + path.sep + 'tmp.py';
		fs.writeFileSync(file, program);

		let local_process;

		let options = undefined;
		if (cwd) {
			options = { cwd: cwd };
		}
		if (values) {
			const values_file: string = os.tmpdir() + path.sep + 'tmp_values.json';
			fs.writeFileSync(values_file, JSON.stringify(values));
			local_process = spawn(PY3, [RUNPY, file, values_file], options);
		} else {
			local_process = spawn(PY3, [RUNPY, file], options);
		}

		return new LocalRunProcess(file, local_process);
	}

	runImgSummary(program: string, line: number, varname: string): RunProcess {
		const file: string = os.tmpdir() + path.sep + 'tmp.py';
		fs.writeFileSync(file, program);
		const local_process = spawn(PY3, [IMGSUM, file, line.toString(), varname]);
		return new LocalRunProcess(file, local_process);
	}

	async validate(input: string): Promise<string | undefined> {
		return new Promise((resolve, reject) => {
			const process = spawn(SNIPPY_UTILS, ['validate', input]);
			let output: string = '';
			let error: string = '';
			process.stdout.on('data', (data: string) => output += data);
			process.stderr.on('data', (data: string) => error += data);

			process.on('exit', (exitCode: number) => {
				if (exitCode !== 0) {
					reject(error);
				} else {
					resolve(output);
				}
			});
		});
	}

	synthesizer(): SynthProcess {
		// create a new process on init and when the existing child process is killed
		// TODO: maybe there's a better way to handle this...?
		if (!this._synth || !this._synth.connected()) {
			if (SYNTH !== '') {
				this._synth = new LocalSynthProcess(this._logger);
			} else {
				this._synth = new EmptySynthProcess();
			}
		}
		return this._synth;
	}
}

let utils: LocalUtils | undefined = undefined;
export function getUtils(): Utils {
	if (!utils) {
		utils = new LocalUtils();
	}
	return utils;
}
