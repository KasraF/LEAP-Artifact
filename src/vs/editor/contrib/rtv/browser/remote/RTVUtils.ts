import { IRTVLogger, Utils, RunProcess, RunResult, SynthProcess, SynthResult, SynthProblem, IRTVController } from 'vs/editor/contrib/rtv/browser/RTVInterfaces';
import { RTVLogger } from 'vs/editor/contrib/rtv/browser/RTVLogger';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

interface MonacoWindow extends Window {
	editor?: ICodeEditor;
}

declare const window: MonacoWindow;

class IDGenerator {
	private next: number;

	constructor() {
		this.next = 0;
	}

	getId(): number {
		return this.next++;
	}
}

const idGen: IDGenerator = new IDGenerator();

enum ResponseType {
	// Responses related to the running program
	STDOUT = 1,
	STDERR = 2,
	RESULT = 3,
	EXCEPTION = 4,

	// Responses related to the web worker itself
	ERROR = 5,
	LOADED = 6,
	LOADING = 7,
}

enum RequestType {
	RUNPY = 1,
	IMGSUM = 2,
	SNIPPY = 3,
	INTERRUPT_BUFFER = 4,
}

class PyodideWorkerResponse {
	constructor(
		public id: number,
		public type: ResponseType,
		public readonly stdout: string,
		public readonly stderr: string,
		public readonly exitCode: number | null,
		public readonly result: string | undefined) { }
}

abstract class PyodideRequest {
	public id: number = idGen.getId();

	constructor(public type: RequestType) { }
}

class RunpyRequest extends PyodideRequest {
	public name: string;

	constructor(
		public program: string,
		public values?: string
	) {
		super(RequestType.RUNPY);
		this.name = `program_${this.id}.py`;
	}
}

class ImgSumRequest extends PyodideRequest {
	public name: string;
	constructor(
		public content: string,
		public line: number,
		public varname: string
	) {
		super(RequestType.IMGSUM);
		this.name = `imgum_${this.id}.py`;
	}
}

class SnipPyRequest extends PyodideRequest {
	constructor(public readonly action: string,
		public readonly parameter: string) {
		super(RequestType.SNIPPY);
	}
}

class InterruptBufferRequest extends PyodideRequest {
	constructor(public readonly interruptBuffer: Uint8Array) {
		super(RequestType.INTERRUPT_BUFFER);
	}
}

class RemoteSynthProcess implements SynthProcess {
	protected _controller = new AbortController();
	protected _problemIdx: number = -1;

	constructor(protected _logger?: IRTVLogger) { }

	async synthesize(problem: SynthProblem): Promise<SynthResult | undefined> {
		// First cancel any previous call
		this._controller.abort();
		this._controller = new AbortController();
		problem.id = ++this._problemIdx;

		try {
			const response = await fetch(
				'/synthesize',
				{
					method: 'POST',
					body: JSON.stringify(problem),
					signal: this._controller.signal,
					mode: 'same-origin',
					headers: headers()
				});

			if (response && response.status < 200 || response.status >= 300 || response.redirected) {
				// TODO Error handling
				console.error(response);
				return new SynthResult(problem.id, false, '');
			} else if (response && problem.id !== this._problemIdx) {
				console.error('Request already discarded', problem, response);
				return;
			}

			const rs = await response.json();
			this._logger?.synthStdout(rs.toString());
			return rs;
		}
		catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				// The request was cancelled. We can ignore this.
				return undefined;
			}

			console.error(err);
			return new SynthResult(problem.id, false, err.toString());
		}
	}

	stop(): boolean {
		this._controller.abort();
		return true;
	}

	connected(): boolean {
		return true;
	}
}

async function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}


export function headers(contentType: string = 'application/json;charset=UTF-8'): Headers {
	const headers = new Headers();
	headers.append('Content-Type', contentType);

	// We need this for CSRF protection on the server
	const csrfInput = document.getElementById('csrf-parameter') as HTMLInputElement;
	const csrfToken = csrfInput.value;
	const csrfHeaderName = csrfInput.name;
	if (csrfHeaderName) {
		headers.append(csrfHeaderName, csrfToken);
	}

	return headers;
}

class RemoteRunProcess implements RunProcess {
	protected _promise: Promise<RunResult>;
	private resolve: (rs: RunResult) => void = (_: RunResult) => console.error('resolve() called before it was set!');
	private reject: () => void = () => { };
	private id: number;
	private eventListener: (this: Worker, event: MessageEvent) => void;
	private startTime: number;

	constructor(request: PyodideRequest) {
		this.startTime = new Date().getTime();
		this.id = request.id;

		this.eventListener = (event: MessageEvent) => {
			const msg: PyodideWorkerResponse = event.data;

			if (msg.id !== this.id) {
				if (msg.id >= 0) {
					console.debug(`Received message for id ${msg.id}, but this process id is ${this.id}.`);
				}
				return;
			}

			switch (msg.type) {
				case ResponseType.RESULT:
					console.debug(`RunProcess ${this.id} completed after ${(new Date().getTime() - this.startTime) / 1000}s.`);
					this.resolve(msg);
					pyodideWorker.removeEventListener('message', this.eventListener);
					break;
				case ResponseType.EXCEPTION:
					console.error('An Exception occurred!\n', msg);
					this.reject();
					pyodideWorker.removeEventListener('message', this.eventListener);
					break;
				default:
					console.error('WebWorker message not recognized: ');
					console.error(msg);
					break;
			}
		};

		pyodideWorker.addEventListener('message', this.eventListener);

		this._promise = loadPyodide
			.then(async () => {
				// First, make sure resolve and reject are set.
				const rs: Promise<RunResult> = new Promise((resolve, reject) => {
					this.resolve = resolve;
					this.reject = reject;
				});

				// Send the message!
				if (Atomics.load(interruptBuffer, 0) !== 0) {
					console.debug(`Pyodide interrupt was not reset. Waiting...`);

					let count = 5;
					while (Atomics.load(interruptBuffer, 0) !== 0 && count > 0) {
						await sleep(100);
						count--;
					}

					if (count === 0) {
						console.warn(`Pyodide interrupt was not reset after 0.5 seconds. Resetting for ${this.id}...`);
					}

					Atomics.store(interruptBuffer, 0, 0);
				}

				pyodideWorker.postMessage(request);

				return await rs;
			});
	}

	async kill(): Promise<boolean> {
		this.reject();

		while (Atomics.load(interruptBuffer, 0) !== 0) {
			console.debug(`Pyodide is being interrupted. Waiting for ${this.id}...`);
			await sleep(1);
		}

		Atomics.store(interruptBuffer, 0, 1);
		console.debug(`Interrupted Pyodide for ${this.id}...`);
		pyodideWorker.removeEventListener('message', this.eventListener);
		console.debug(`RunProcess ${this.id} cancelled after ${(new Date().getTime() - this.startTime) / 1000}s.`);
		return true;
	}

	then<TResult1>(
		onfulfilled?: ((value: RunResult) => TResult1 | PromiseLike<TResult1>) | undefined | null,
		onrejected?: ((reason: any) => never | PromiseLike<never>) | undefined | null): PromiseLike<TResult1 | never> {
		return this._promise.then(onfulfilled, onrejected);
	}
}


class RemoteUtils implements Utils {
	// Assuming the server is running on a unix system
	readonly EOL: string = '\n';
	readonly pathSep: string = '/';

	protected _logger?: IRTVLogger;
	protected _synthProcess?: SynthProcess;
	protected _editor?: ICodeEditor;

	logger(editor: ICodeEditor): IRTVLogger {
		this._editor = editor;
		if (!this._logger) {
			this._logger = new RTVLogger(editor);
		}
		return this._logger;
	}

	runProgram(program: string, values?: any): RunProcess {
		// First, save the program!
		// The cleanup code might mess with the user's actual code, so try to get the real buffer value
		// if possible.
		const actualProgram: string = this._editor?.getModel()?.getLinesContent().join('\n') || program;
		this.saveProgram(actualProgram);

		return new RemoteRunProcess(new RunpyRequest(program, JSON.stringify(values)));
	}

	runImgSummary(program: string, line: number, varname: string): RunProcess {
		// TODO Make this feature optional in the web version.
		return new RemoteRunProcess(new ImgSumRequest(program, line, varname));
	}

	async saveProgram(program: string): Promise<void> {
		// Forward the queries!
		const queries = window.location.search;
		await fetch(
			`/save${queries}`,
			{
				method: 'POST',
				body: program,
				mode: 'same-origin',
				headers: headers()
			});
	}

	async validate(input: string): Promise<string | undefined> {
		const rs = await new RemoteRunProcess(new SnipPyRequest('validate', input));
		return rs.stdout;
	}

	synthesizer(): SynthProcess {
		if (!this._synthProcess) {
			this._synthProcess = new RemoteSynthProcess(this._logger);
		}
		return this._synthProcess;
	}
}

const utils = new RemoteUtils();
export function getUtils(): Utils {
	return utils;
}

// Start the web worker
const pyodideWorker = new Worker('pyodide/webworker.js');
const interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));

let resolvePyodide: (value?: unknown) => void;
const loadPyodide = new Promise(resolve => resolvePyodide = resolve);

const pyodideWorkerInitListener = (event: MessageEvent) => {
	const msg = event.data as PyodideWorkerResponse;

	if (msg.type === ResponseType.LOADING) {
		console.log(msg.result);
		const domElem = document.getElementById('loading-status');
		if (domElem && msg.result) {
			domElem.innerText = msg.result;
		}
	}
	else if (msg.type === ResponseType.LOADED) {
		console.log('Pyodide loaded!');

		// Set interrupt buffer
		console.debug('Setting interrupt buffer...');
		pyodideWorker.postMessage(new InterruptBufferRequest(interruptBuffer));

		resolvePyodide();
		pyodideWorker.removeEventListener('message', pyodideWorkerInitListener);

		if (!window.editor) {
			console.error('Window does not have an editor. Look for another exception further up ^');
			return;
		}

		const program = window.editor.getModel()!!.getLinesContent().join('\n');
		utils.runProgram(program).then(() => {
			(window.editor!.getContribution('editor.contrib.rtv') as IRTVController).runProgram();
			(document.getElementById('spinner') as HTMLInputElement).style.display = 'none';
		});
	}
	else {
		console.error('First message from pyodide worker was not a load message!');
		console.error(msg.type);
		console.error(ResponseType.LOADED);
	}
};

pyodideWorker.onerror = console.error;
pyodideWorker.addEventListener('message', pyodideWorkerInitListener);

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
