import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { Event } from 'vs/base/common/event';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IModelContentChangedEvent } from 'vs/editor/common/textModelEvents';

export interface IRTVDisplayBox {
	/**
	 * Returns the box's HTML element.
	 * */
	getElement(): HTMLElement;

	getCellContent(): { [k: string]: [HTMLElement] };

	/**
	 * Returns the environments displayed in this PB.
	 * The values are not identical to the result of
	 * `runProgram()`, since the box does some post
	 * processing before displaying its `envs`.
	 */
	getEnvs(): any[];

	/**
	 * Return the ID of the HTML <TD> element at the
	 * given row and column.
	 */
	getCellId(varname: string, idx: number): string;

	/**
	 * Return the HTML <TD> element at the given row and column.
	 */
	getCell(varname: string, idx: number): HTMLTableCellElement | null;

	/**
	 * Updates the box's values, destroys the existing
	 * HTML table and recreates it from the new data.
	 *
	 * @param allEnvs Optional. If provided, these values
	 * will be used to update the box. If not, it reads the
	 * `envs` from its `RTVController`.
	 * @param updateInPlace Optional. If `true`, the table
	 * values will be updated in-place, without destroying
	 * the table and rebuilding it from scratch.
	 */
	updateContent(allEnvs?: any[], updateInPlace?: boolean, outputVars?: string[], prevEnvs?: Map<number, any>): void;

	/**
	 * Returns if the box is a SynthBox
	 */
	isSynthBox(): boolean;
}

export class BoxUpdateEvent {
	constructor(
		public isStart: boolean,
		public isCancel: boolean,
		public isFinish: boolean,
	) { }
}

export interface IRTVController extends IEditorContribution {
	// Fields
	studyGroup: StudyGroup | undefined;

	// Utility functions for accessing the editor or PB content
	getBox(lineno: number): IRTVDisplayBox;
	getLineContent(lineno: number): string;
	getProgram(): string;
	getModelForce(): ITextModel;
	envs: { [k: string]: any[]; };
	pythonProcess?: RunProcess;
	onUpdateEvent: Event<BoxUpdateEvent>;

	// Functions for running the program
	updateBoxes(e?: IModelContentChangedEvent, outputVars?: string[], prevEnvs?: Map<number, any>): Promise<any>;
	updateBoxesNoRefresh(
		e?: IModelContentChangedEvent,
		runResults?: [string, string, any?],
		outputVars?: string[],
		prevEnvs?: Map<number, any>): Promise<any>;
	runProgram(): Promise<any>;
	getId(): string;
	byRowOrCol: RowColMode;

	// Disabling the controller
	enable(): void;
	disable(): void;
	isEnabled(): boolean;

	// Misc.
	viewMode: ViewMode;
	changeViewMode(m: ViewMode): void;
	resetChangedLinesWhenOutOfDate(): void;
	toggleLeapOn(): void;
}

export enum StudyGroup {
	Control = 'Control',
	Treatment = 'Treatment',
	Admin = 'Admin'
}

export abstract class ALogger {
	protected abstract log(code: string, msg?: string): Promise<string | undefined>;
	protected abstract write(id: string | undefined, file: string, content: any): Promise<void>;
}

/**
 * The Logging interface for RTVDisplay.
 */
export interface IRTVLogger {
	// General Projection Boxes
	projectionBoxCreated(): Promise<void>;
	projectionBoxDestroyed(): Promise<void>;
	projectionBoxUpdateStart(program: string): Promise<void>;
	projectionBoxUpdateEnd(result: string | undefined): Promise<void>;
	projectionBoxModeChanged(mode: string): Promise<void>;

	// Image Processing
	imgSummaryStart(lineno: number, variable: string): Promise<void>;
	imgSummaryEnd(result?: string): Promise<void>;

	// Output Box
	showOutputBox(): Promise<void>;
	hideOutputBox(): Promise<void>;

	// LooPy
	synthProcessStart(): Promise<void>;
	synthStart(varnames: string[], lineno: number): Promise<void>;
	synthEnd(): Promise<void>;
	synthSubmit(problem: SynthProblem): Promise<void>;
	synthResult(result: SynthResult): Promise<void>;
	synthStdout(msg: string): Promise<void>;
	synthStderr(msg: string): Promise<void>;
	synthProcessEnd(): Promise<void>;
}

export class LogEventData {
	constructor(
		public filename: string,
		public code: string,
		public message?: string,
	) { }
}

export class LogResultData {
	constructor(
		public id: string | undefined,
		public file: string,
		public content: string) { }
}

export abstract class ARTVLogger extends ALogger implements IRTVLogger {
	// ---------------------------------------------------------------
	// General Projection Boxes
	// ---------------------------------------------------------------

	public async projectionBoxCreated() {
		await this.log('projectionBox.created');
	}

	public async projectionBoxDestroyed() {
		await this.log('projectionBox.destroyed');
	}

	public async projectionBoxUpdateStart(program: string) {
		const id = await this.log('projectionBox.update.start');
		await this.write(id, `program.py`, program);
	}

	public async projectionBoxUpdateEnd(result: string | undefined) {
		const id = await this.log('projectionBox.update.end');
		await this.write(id, 'result.json', result ? result : 'undefined');
	}

	public async projectionBoxModeChanged(mode: string) {
		await this.log('projectionBox.mode', mode);
	}

	// ---------------------------------------------------------------
	// Image Processing
	// ---------------------------------------------------------------

	public async imgSummaryStart(lineno: number, variable: string) {
		await this.log('img.start', `${lineno},${variable}`);
	}

	public async imgSummaryEnd() {
		await this.log('img.end');
	}

	// ---------------------------------------------------------------
	// Output Box
	// ---------------------------------------------------------------

	public async showOutputBox() {
		await this.log(`outputBox.show`);
	}

	public async hideOutputBox() {
		await this.log(`outputBox.hide`);
	}

	// ---------------------------------------------------------------
	// Synthesis
	// ---------------------------------------------------------------

	public async synthProcessStart() {
		await this.log('synth.process.start');
	}

	public async synthStart(varnames: string[], lineno: number) {
		await this.log('synth.start', `${varnames},${lineno}`);
	}

	public async synthEnd() {
		await this.log('synth.end');
	}

	public async synthSubmit(problem: SynthProblem) {
		const id = await this.log('synth.submit');
		await this.write(id, `problem.json`, JSON.stringify(problem, undefined, '\t'));
	}

	public async synthResult(result: SynthResult) {
		const id = await this.log('synth.result');
		await this.write(id, `result.json`, JSON.stringify(result, undefined, '\t'));
	}

	public async synthStdout(msg: string) {
		await this.log('synth.stdout', msg.toString());
	}

	public async synthStderr(msg: string) {
		await this.log('synth.stderr', msg.toString());
	}

	public async synthProcessEnd() {
		await this.log('synth.process.end');
	}
}

export interface Utils {
	readonly EOL: string;
	readonly pathSep: string;
	logger(editor: ICodeEditor): IRTVLogger;
	runProgram(program: string, cwd?: string, values?: any): RunProcess;
	runImgSummary(program: string, line: number, varname: string): RunProcess;
	validate(input: string): Promise<string | undefined>;
	synthesizer(): SynthProcess;
}

/**
 * This class is used to return the result of running
 * a run.py or img-summary.py file.
 **/
export class RunResult {
	constructor(
		public readonly stdout: string,
		public readonly stderr: string,
		public readonly exitCode: number | null,
		public readonly result: string | undefined,
	) { }
}

export class SynthResult {
	constructor(
		public id: number,
		public success: boolean,
		public result?: string
	) { }
}

export class SynthProblem {
	public id: number = -1;
	constructor(
		public varNames: string[],
		public previousEnvs: { [t: string]: any },
		public envs: any[],
		public optEnvs: any[] = []
	) { }
}

/**
 * A "Process" interface that lets us share the API
 * between the local and remote versions of RTVDisplay.
 */
export interface RunProcess extends PromiseLike<RunResult> {
	kill(): Promise<boolean>;
}

export interface SynthProcess {
	synthesize(problem: SynthProblem): Promise<SynthResult | undefined>;
	stop(): boolean;
	connected(): boolean;
}


/**
 * An empty implementation of Process. Can be used in place of the
 * actual process until initial setups are completed. Resolves
 * immediately.
 */
// export class EmptyProcess implements Process {
// 	onExit(_fn: (exitCode: any, result?: string) => void): void {}
// 	onStdout(_fn: (data: any) => void): void {}
// 	onStderr(_fn: (data: any) => void): void {}
// 	toStdin(msg: string): void {}
// 	kill(): void {}
// 	toPromise(): Promise<any> {
// 		return new Promise((resolve) => {
// 			resolve('[]');
// 		});
// 	}
// }

/**
 * The Projection Box view modes.
 */
export enum ViewMode {
	Full = 'Full',
	CursorAndReturn = 'Cursor and Return',
	Cursor = 'Cursor',
	Compact = 'Compact',
	Stealth = 'Stealth',
	Focused = 'Focused',
	Custom = 'Custom'
}

/**
 * Whether 'time' in the projection boxes is
 * displayed as a row or as a column.
 */
export enum RowColMode {
	ByRow = 'By Row',
	ByCol = 'By Col'
}

export class DelayedRunAtMostOne {
	private _reject?: () => void;

	public async run(delay: number, c: () => Promise<void>) {
		if (this._reject) {
			this._reject();
		}

		if (delay === 0) {
			this._reject = undefined;
		} else {
			await new Promise((resolve, reject) => {
				let timeout = setTimeout(resolve, delay);
				this._reject = () => {
					clearTimeout(timeout);
					reject();
				};
			});
		}

		await c();
	}

	public cancel() {
		if (this._reject) {
			this._reject();
			this._reject = undefined;
		}
	}
}
