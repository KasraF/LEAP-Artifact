import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IModelContentChangedEvent } from 'vs/editor/common/textModelEvents';
import { EditorAction, registerEditorAction, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { MarkdownRenderer } from 'vs/editor/contrib/markdownRenderer/browser/markdownRenderer';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { Range } from 'vs/editor/common/core/range';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { editorBackground, editorErrorBackground, editorErrorForeground, editorForeground, editorErrorBorder } from 'vs/platform/theme/common/colorRegistry';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { LeapConfig, ILeapUtils, StudyGroup, PythonCode, ErrorMessage, Completion, LeapState, ILeapLogger } from 'vs/editor/contrib/leap/browser/LeapInterfaces';
import { getUtils } from 'vs/editor/contrib/leap/browser/LeapUtils';
import { IRTVController, ViewMode } from '../../rtv/browser/RTVInterfaces';
import { RTVController } from '../../rtv/browser/RTVDisplay';
import { ITextModel } from 'vs/editor/common/model';

const htmlPolicy = window.trustedTypes?.createPolicy('leap', { createHTML: (value) => value, createScript: (value) => value });

function setInner(elem: HTMLElement, inner: string): void {
	if (htmlPolicy) {
		elem.innerHTML = htmlPolicy.createHTML(inner) as unknown as string;
	} else {
		// @ts-ignore
		elem.innerHTML = inner;
	}
}

/**
 * Helper function for waiting in an async environment.
 */
async function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

class Leap implements IEditorContribution {

	// ---------------------------
	// Static fields and functions
	// ---------------------------

	public static ID: string = 'editor.contrib.leap';

	public static readonly completionComment = '## ---';

	public static get(editor: ICodeEditor): Leap {
		const rs = editor.getContribution<Leap>(Leap.ID);
		if (!rs) {
			throw new Error('Leap contribution not found. This should not happen.');
		}
		return rs;
	}

	// -----------------------------------
	// The actual class fields and methods
	// -----------------------------------

	private _editor: ICodeEditor;
	private _themeService: IThemeService;
	private _panel: HTMLElement | undefined;
	private _mdRenderer: MarkdownRenderer;
	private _lastCompletions: Completion[] | undefined; // TODO (kas) This is a bad idea... we need to carefully think about how to handle state.
	private _lastCursorPos: IPosition | undefined;
	private _state: LeapState = LeapState.Off;
	private _utils: ILeapUtils = getUtils();
	private _logger: ILeapLogger;
	private _decorationList: string[] = [];
	private _suggestionDecor: string = 'bgcolor';
	private _config?: LeapConfig = undefined;
	private _projectionBoxes: IRTVController;
	private _abort: AbortController;

	public constructor(
		editor: ICodeEditor,
		@IThemeService themeService: IThemeService,
		@IOpenerService openerService: IOpenerService,
		@ILanguageService langService: ILanguageService) {

		this._abort = new AbortController();
		this._editor = editor;
		this._themeService = themeService;
		this._projectionBoxes = editor.getContribution(RTVController.ID)!;
		this._logger = this._utils.getLogger(editor);

		this._mdRenderer = new MarkdownRenderer(
			{ 'editor': this._editor },
			langService,
			openerService);

		this._utils.getConfig().then(async (config) => {
			this._config = config;

			// Wait for the editor to load
			while (!this._editor.getDomNode()) {
				await sleep(500);
			}

			// Move the cursor if necessary.
			if (this._config.cursor) {
				this._editor.setPosition(this._config.cursor);
			}

			// Register event handlers.
			addEventListener('leap', (e: any) => {
				const completionId = e.detail;
				if (completionId === undefined) {
					console.error('Completion ID was undefined:', completionId);
					return;
				}
				this.previewCompletion(completionId);
			});

			this._editor.onDidChangeModelContent((e) => { this.onDidChangeModelContent(e); });

			// Disable projection boxes if necessary.
			this._projectionBoxes.studyGroup = this._config.group;
			if (this._config.group === StudyGroup.Control) {
				this._projectionBoxes.changeViewMode(ViewMode.Stealth);
			}

			// [lisa] Bad Hack: Disable the KeyDown handler on `Escape` in Projection Boxes
			// For preventing the Projection Boxes to show Full View when the user presses `Escape`
			// which is needed for Leap cancellation.
			this._projectionBoxes.toggleLeapOn();

			// Finally, toggle if this is in hardcoded mode
			if (this._config?.completions) {
				await this._projectionBoxes.runProgram();
				await this.toggle();
			}
		});
	}

	public set state(state: LeapState) {
		console.debug(`State <- ${LeapState[state]}`);
		this._logger.panelState(state);
		this._state = state;
	}

	public get state(): LeapState {
		return this._state;
	}

	public dispose(): void {
		this._logger.panelClose();
		this._panel?.remove();
		this._panel = undefined;
	}

	public async toggle(): Promise<void> {
		// TODO (kas) We should probably think more carefully about the interface for interacting
		//  with leap. For now, this will do as a simple on-off toggle.
		this._abort.abort();
		const abort = new AbortController();
		this._abort = abort;

		switch (this.state) {
			case LeapState.Off:
			case LeapState.Loading:
				// Just start!
				this.state = LeapState.Loading;
				await this.showCompletions(abort.signal);
				break;
			case LeapState.Shown:
				this.hideCompletions();
				this.state = LeapState.Off;
				break;
			default:
				console.error('Leap State not recognized: ', this.state);
		}
	}

	// clears out the code completion indicated by the completion comments, if any
	public async escape(): Promise<void> {
		this._abort.abort();

		if (this.state !== LeapState.Off) {
			// set commentOnly to false so that we remove the text as well
			this.hideCompletions(false);
			this.state = LeapState.Off;
		}
	}

	/**
	 * Creates the panel if it doesn't already exist.
	 * Clears the content if it does.
	 */
	public createPanel(): HTMLElement {
		if (!this._panel) {
			const editor_div = this._editor.getDomNode();
			if (!editor_div) {
				throw new Error('Editor Div does not exist. This should not happen.');
			}

			this._panel = document.createElement('div');

			// Set the panel style
			this._panel.className = 'monaco-hover';
			this._panel.style.position = 'absolute';
			this._panel.style.top = '30px';
			this._panel.style.bottom = '14px';
			this._panel.style.right = '14px';
			this._panel.style.width = '500px';
			this._panel.style.padding = '10px';
			this._panel.style.transitionProperty = 'all';
			this._panel.style.transitionDuration = '0.3s';
			this._panel.style.transitionDelay = '0s';
			this._panel.style.transitionTimingFunction = 'ease-in';
			this._panel.onmouseenter = (e) => {
				this.expandPanel();
				this._panel!.style.zIndex = '1000'; // place on top of everything inside the editor
			};
			this._panel.onmouseleave = (e) => {
				if (e.offsetY < 0 || e.offsetX < 0) {
					this.compressPanel();
				}
				this._panel!.style.zIndex = '0'; // place below Projection Boxes
			};
			editor_div.appendChild(this._panel);
		}

		// Clear the panel content
		this._panel.childNodes.forEach(n => n.remove());

		this._logger.panelOpen();

		return this._panel;
	}

	public compressPanel(): void {
		this._logger.panelUnfocus();

		if (this._panel) {
			this._panel.style.right = '-300px';
			this._panel.style.opacity = '0.3';
		}
	}

	public expandPanel(): void {
		this._logger.panelFocus();

		if (this._panel) {
			this._panel.style.right = '14px';
			this._panel.style.opacity = '1';
		}
	}

	public async showCompletions(signal: AbortSignal): Promise<void> {
		this._lastCompletions = this._config?.completions?.map(code => new PythonCode(code));

		// Move the cursor if fixed
		if (this._config?.cursor) {
			const pos = this._config?.cursor;
			this._editor.setPosition(pos);
			this._lastCursorPos = pos;
		}

		if (!this._lastCompletions) {
			// First, get the text from the editor
			const model = this._editor.getModel();
			if (!model) {
				console.error(`Can't toggle Leap: model is ${model}`);
				return;

			}

			// Get the cursor position
			const pos = this._editor.getPosition();
			if (pos === null) {
				console.error(`Can't toggle Leap: cursor position is ${pos}`);
				return;
			}

			this._lastCursorPos = pos;
			const lastLineIdx = model.getLineCount() - 1;
			const lastLineWidth = model.getLineMaxColumn(lastLineIdx);
			const prefix: string = model.getValueInRange(new Range(0, 0, this._lastCursorPos.lineNumber, this._lastCursorPos.column));
			const suffix: string = model.getValueInRange(new Range(this._lastCursorPos.lineNumber, this._lastCursorPos.column, lastLineIdx, lastLineWidth));

			// then, get the completions
			this._lastCompletions = await this.getCompletions(prefix, suffix, signal);
		}

		if (signal.aborted) {
			console.debug('Leap operation was aborted. Not drawing the panel.');
			return;
		}

		// Create the HTML for the webview
		const html = this.renderPanelContent(this._lastCompletions);
		const panel = this.createPanel();
		panel.appendChild(html);

		// Finally, update the state.
		this.state = LeapState.Shown;
	}

	public hideCompletions(commentOnly: boolean = true): void {
		// first, hide the exploration panel
		this.dispose();

		// second, clean up the comment markups
		// if commentOnly is true, we only remove the comments
		this.removeCompletion(commentOnly);
	}

	/**
	 * Makes the Codex API to get completions for the given text.
	 * @param textInBuffer The text up to the current cursor position.
	 */
	public async getCompletions(prefix: string, suffix: string, signal: AbortSignal): Promise<Completion[]> {
		const rs: Completion[] = [];

		try {
			// Start by putting a progress bar in the panel
			const panel = this.createPanel();
			const container = document.createElement('div');
			const title = document.createElement('h2');
			title.innerText = 'Getting suggestions. Please wait...';
			const barContainer = document.createElement('div');
			const progressBar = new ProgressBar(barContainer).total(10);
			const barElement = progressBar.getContainer();
			barElement.style.position = 'inherit';
			(barElement.firstElementChild! as HTMLElement).style.position = 'inherit';
			container.appendChild(title);
			container.appendChild(barContainer);
			panel.appendChild(container);

			// TODO (lisa) bad hack to get around the references to completions
			progressBar.done();

			// TODO (lisa) bad hack below, should remove when the server logic is set up for the web version
			const modelRequest = await this._utils.buildRequest(prefix, suffix);
			this._logger.modelRequest(modelRequest);
			const codes: string[] = await this._utils.getCompletions(
				modelRequest,
				signal,
				(_e) => progressBar.worked(1));

			console.debug('Got the following completions from the server:\n', codes);

			// Remove empty or repeated completions.
			const set = new Set();
			for (const code of codes) {
				if (code === '' || set.has(code)) {
					continue;
				}
				set.add(code);
				rs.push(new PythonCode(code));
			}

			if (set.size === 0) {
				rs.push(new ErrorMessage('All suggestions were empty. Please try again.'));
			}

			progressBar.dispose();
		} catch (error: any) {
			// TODO (kas) error handling
			if (error.message === 'canceled' || error instanceof DOMException && error.message.includes('The operation was aborted')) {
				// This error was cancelled.
				console.debug('Request cancelled:\n', error);
				rs.push(new ErrorMessage("Request cancelled by the user."));
				return rs;
			}

			if (error.response) {
				console.error(error.response.status, error.response.data);
				console.error(error);

				let code: string = String(error.response.status);
				if ('error' in error.response.data && 'code' in error.response.data.error) {
					code += `: ${error.response.data.error.code}`;
				}

				let message;
				if ('error' in error.response.data && 'message' in error.response.data.error) {
					message = error.response.data.error.message;
				} else {
					message = error.response.data;
				}

				rs.push(new ErrorMessage(`[${code}]\n${message}`));
			} else {
				console.error('Error with OpenAI API request:');
				console.error(error);
				rs.push(new ErrorMessage(error.message));
			}
		} finally {
			console.debug("Returning the following suggestions:\n", rs);
		}

		this._logger.modelResponse(rs);
		return rs;
	}

	public renderPanelContent(completions: Completion[]): HTMLElement {
		const div = document.createElement('div');
		div.style.overflowY = 'scroll';
		div.style.height = '100%';
		div.style.width = '100%';
		div.style.display = 'inline-block';

		div.onwheel = (e) => {
			e.stopImmediatePropagation();
		};

		for (let i = 0; i < completions.length; i++) {
			div.appendChild(this.renderCompletion(i, completions[i]));
		}

		const script = document.createElement('script');
		setInner(script, `
			function previewCompletion(id) {
				const event = new CustomEvent('leap', { completion: id });
				dispatchEvent(event);
			}`);
		div.appendChild(script);

		return div;
	}

	public updateSuggestionDecor() {
		switch (this._suggestionDecor) {
			case 'bgcolor':
				this._suggestionDecor = 'opacity';
				break;
			case 'opacity':
				this._suggestionDecor = 'bgcolor';
				break;
			default:
				throw new Error('Invalid suggestion decoration type');
		}

		// if there are already decorated code suggestions, update existing suggestions
		if (this._decorationList.length > 0) {
			this.decorateSuggestion();
		}
	}

	private renderCompletion(id: number, completion: Completion): HTMLElement {
		let rs;

		if (completion instanceof PythonCode) {
			rs = this.renderPython(id, completion);
		} else {
			rs = this.renderError(id, completion);
		}

		return rs;
	}

	private renderError(_: number, error: ErrorMessage): HTMLElement {
		const block = document.createElement('div');
		const md = new MarkdownString();
		md.appendMarkdown('> **ERROR!**\n>\n');
		for (const line of error.message.split('\n')) {
			md.appendMarkdown(`> ${line}\n>\n`);
		}

		// Style it!
		const theme = this._themeService.getColorTheme();
		const codeWrapper = document.createElement('div');
		codeWrapper.style.padding = '10px';
		codeWrapper.style.borderRadius = '3px';
		codeWrapper.style.borderWidth = '1px';
		codeWrapper.style.borderColor = theme.getColor(editorErrorBorder)?.toString() ?? '';
		codeWrapper.style.backgroundColor = theme.getColor(editorErrorBackground)?.toString() ?? '';
		codeWrapper.style.color = theme.getColor(editorErrorForeground)?.toString() ?? '';
		codeWrapper.appendChild(this._mdRenderer.render(md).element);

		block.appendChild(codeWrapper);

		return block;
	}

	private renderPython(id: number, code: PythonCode): HTMLElement {
		const block = document.createElement('div');
		block.style.marginBottom = '20px';

		// First, append the title
		const title = document.createElement('h2');
		setInner(title, `Suggestion ${id + 1}`);
		block.appendChild(title);

		// Then the links we use to communicate!
		// TODO (kas) Add a "revert" link here!
		const link = document.createElement('a');
		block.appendChild(link);

		setInner(link, 'Preview');
		link.onclick = (_) => {
			console.log('link clicked');
			this.previewCompletion(id);
			this.compressPanel();
		};

		let completion = code.code;

		// Prepend whitespace if necessary
		if (this._lastCursorPos?.column) {
			completion = ' '.repeat(this._lastCursorPos.column - 1) + completion;
		}

		// finally, add the code block itself
		const md = new MarkdownString();
		md.appendCodeblock('python', completion);

		// Style it!
		const theme = this._themeService.getColorTheme();
		const codeWrapper = document.createElement('div');
		codeWrapper.style.padding = '10px';
		codeWrapper.style.borderRadius = '3px';
		codeWrapper.style.borderWidth = '1px';
		codeWrapper.style.borderColor = theme.getColor(editorForeground)?.toString() ?? '';
		codeWrapper.style.backgroundColor = theme.getColor(editorBackground)?.toString() ?? '';
		codeWrapper.appendChild(this._mdRenderer.render(md).element);

		block.appendChild(codeWrapper);

		return block;
	}

	// (lisa) why is it async?
	private async previewCompletion(index: number): Promise<void> {
		// TODO (kas) error handling.
		if (!this._lastCompletions ||
			this._lastCompletions.length <= index) {
			console.error('previewCompletion called with invalid index. Ignoring: ', index);
			return;
		}

		const completion = this._lastCompletions[index];
		if (!(completion instanceof PythonCode)) {
			console.error(`previewCompletion called with index ${index}, but entry is an error:\n${completion.message}`);
			return;
		}

		this._logger.preview(index, completion.code);

		// TODO (kas) for now, we're assuming that we are indenting with spaces.
		const code =
			Leap.completionComment + '\n' +
			' '.repeat(this._lastCursorPos!.column - 1) + completion.code + '\n' +
			' '.repeat(this._lastCursorPos!.column - 1) + Leap.completionComment;

		// Get the model for the buffer content
		const model = this._editor.getModel();
		const text = model?.getValue();
		if (!model || !text) {
			return;
		}

		// Get the start and end range to replace
		let start: IPosition;
		let end: IPosition;

		// See if we need to replace an existing completion
		const startIdx = text.indexOf(Leap.completionComment);
		const endIdx = text.lastIndexOf(Leap.completionComment);


		if (startIdx >= 0 && startIdx !== endIdx) {
			// We have a previous completion to replace!
			start = model.getPositionAt(startIdx);
			end = model.getPositionAt(endIdx + Leap.completionComment.length);
		} else if (this._lastCursorPos) {
			// No previous completion to replace. Just insert it.
			start = this._lastCursorPos;
			end = this._lastCursorPos; // TODO (kas) Do we need to set it to the precise position based on the completion?
		} else {
			// Show an error in vscode
			throw new Error('Could not insert suggestion. No previous suggestion to replace and no cursor position to insert at.');
		}

		// Now put the completion in the buffer!
		const range = new Range(start.lineNumber, start.column, end.lineNumber, end.column);

		// Replate that range!
		this._editor.pushUndoStop();
		this._editor.executeEdits(
			Leap.ID,
			[{ range: range, text: code }]);
		this._editor.focus();
		this._editor.setPosition(new Position(start.lineNumber + 1, start.column));
	}

	private removeCompletion(commentOnly: boolean = true): void {
		// TODO (lisa) error handling.
		if (!this._lastCompletions) {
			return;
		}

		// First, get the start and end range to perform the edits.
		// - Get the model for the buffer content
		const model = this._editor.getModel();
		const text = model?.getValue();
		if (!model || !text) {
			return;
		}

		// - See if there are completion comments to remove
		const startIdx = text.indexOf(Leap.completionComment);
		const endIdx = text.lastIndexOf(Leap.completionComment);

		// -- if there are no completion comments, then no edit is necessary
		if (startIdx < 0) {
			// then endIdx must be less than 0 as well
			console.log(`No completion comment removal is necessary`);
			return;
		} else {
			const model = this._editor.getModel()!;
			// -- else, we do the edits

			const start = model.getPositionAt(startIdx);
			const end = model.getPositionAt(endIdx + Leap.completionComment.length);

			let textEndLine: number;
			let textEndCol: number;
			let editEndLine: number;
			let editEndCol: number;

			let singleCompletionComment: boolean = false;

			if (startIdx === endIdx) {
				// there is only one completion comment for whatever weird reason...
				// user accidentally removed the last completion comment? maybe
				// simply removing that line would be enough.

				singleCompletionComment = true;

				// get the end point of the last character in the file
				const numLines = model.getLineCount();
				textEndLine = numLines;
				textEndCol = model.getLineLength(numLines) + 1;

				// record the ending point of the edit range, which would be the end of the entire file
				editEndLine = textEndLine;
				editEndCol = textEndCol;

			} else {
				// there are more than one completion comments.
				// remove the one at the beginning and the one at the end

				// get the end point of the text in between the comments
				const endHead = model.getPositionAt(endIdx);
				const lastLine = model.getLineContent(end.lineNumber - 1);
				textEndLine = end.lineNumber - 1;
				textEndCol = endHead.column + lastLine.length;

				// record the ending point of the edit range
				editEndLine = end.lineNumber;
				editEndCol = end.column;

			}

			// get the existing content within the range
			// suggestion code should be kept only when commentOnly is true or only one completion comment is present
			const textRange = new Range(start.lineNumber + 1, start.column, textEndLine, textEndCol);
			const text = (commentOnly || singleCompletionComment) ? model.getValueInRange(textRange) : '';

			// Finally, keep only the innerText within the edit range
			const editRange = new Range(start.lineNumber, start.column, editEndLine, editEndCol);
			this._editor.pushUndoStop();
			this._editor.executeEdits(
				Leap.ID,
				[{ range: editRange, text: text }]);
		}
	}

	private async onDidChangeModelContent(e: IModelContentChangedEvent) {
		this.decorateSuggestion();
	}

	private async decorateSuggestion() {
		if (this._decorationList.length > 0) {
			this._editor.changeDecorations((c) => {
				this._decorationList.forEach((d) => {
					c.removeDecoration(d);
				});
			});
			this._decorationList = [];
		}

		if (this.state !== LeapState.Shown) {
			return;
		}

		const model = this._editor.getModel();
		if (!model) {
			return;
		}
		const maxline = model.getLineCount();
		let start = -1;
		let end = -1;
		for (let k = 1; k <= maxline; k++) {
			if (model.getLineContent(k).indexOf(Leap.completionComment) !== -1) {
				if (start === -1) {
					start = k;
				} else {
					end = k;
					break;
				}
			}
		}
		if (start !== -1 && end !== -1) {
			this.addDecoration(model, start, end, maxline);
		}
	}

	private addDecoration(model: ITextModel, start: number, end: number, maxline: number) {
		switch (this._suggestionDecor) {
			case 'bgcolor':
				this.highlightSuggestionBgColor(model, start, end);
				break;
			case 'opacity':
				this.reduceNonSuggestionOpacity(model, start, end, maxline);
				break;
			default:
				throw new Error('Invalid suggestion decoration type');
		}
	}

	private reduceNonSuggestionOpacity(model: ITextModel, start: number, end: number, maxline: number) {
		// skip the suggestion, including the completion comments
		const range1 = new Range(1, model.getLineMaxColumn(1), start - 1, model.getLineMaxColumn(start - 1));
		let range2: Range | undefined = undefined;
		// reduce opacity of code after the inserted suggestion, if any
		if (end + 1 <= maxline) {
			range2 = new Range(end + 1, model.getLineMaxColumn(end + 1), maxline, model.getLineMaxColumn(maxline));
		}
		const options = { description: 'LEAP Fragment Focus', inlineClassName: 'code-suggestion-opacity', isWholeLine: true };
		this._editor.changeDecorations((c) => {
			// this._decorationList = [c.addDecoration(range, options)];
			this._decorationList = [c.addDecoration(range1, options)];
			if (range2) {
				this._decorationList.push(c.addDecoration(range2, options));
			}
		});
	}

	private highlightSuggestionBgColor(model: ITextModel, start: number, end: number) {
		// skip the completion comments
		const range = new Range(start + 1, model.getLineMaxColumn(start + 1), end - 1, model.getLineMaxColumn(end - 1));
		// [sorin] note: Here are some optios for className that create various versions
		// of background highlighting for LEAP-generated code. For now, we will
		// use 'selectionHighlight' because, of all three options, it is the one
		// that still allows the user to select text and see some contrast between
		// the selected text and the LEAP highlight.
		//   className: 'selectionHighlight'
		//   classname: 'wordHighlight'
		//   className: 'wordHighlightStrong'
		const options = { description: 'LEAP Fragment Focus', className: 'code-suggestion-bgcolor', isWholeLine: true };
		this._editor.changeDecorations((c) => {
			this._decorationList = [c.addDecoration(range, options)];
		});
	}

}

class LeapAction extends EditorAction {
	constructor() {
		super({
			id: 'leap.toggle',
			label: 'Toggle Leap',
			alias: 'Toggle Leap',
			precondition: undefined,
			kbOpts: {
				kbExpr: null,
				primary: KeyMod.CtrlCmd | KeyCode.Enter,
				weight: KeybindingWeight.EditorContrib // TODO (kas) EditorCore?
			}
		});
	}

	public async run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): Promise<void> {
		const leap = Leap.get(editor);
		leap.toggle();
	}
}

// write an EditorAction that uses Escape as the primary key
class LeapEscapeAction extends EditorAction {
	constructor() {
		super({
			id: 'leap.escape',
			label: 'Escape Leap',
			alias: 'Escape Leap',
			precondition: undefined,
			kbOpts: {
				kbExpr: null,
				primary: KeyCode.Escape,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public async run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): Promise<void> {
		const leap = Leap.get(editor);
		leap.escape();
	}
}

class LeapDecorAction extends EditorAction {
	constructor() {
		super({
			id: 'leap.decor.suggestion',
			label: 'Decorate Leap Suggestion',
			alias: 'Decorate Leap Suggestion',
			precondition: undefined,
			kbOpts: {
				kbExpr: null,
				primary: KeyMod.Shift | KeyMod.Alt | KeyMod.CtrlCmd | KeyCode.KeyD,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public async run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): Promise<void> {
		const leap = Leap.get(editor);
		leap.updateSuggestionDecor();
	}
}

// -------------------------------------
// Top-level stuff
// -------------------------------------

// Register the Leap class as a vscode
registerEditorContribution(Leap.ID, Leap);

// Register the Leap keybinding
registerEditorAction(LeapAction);

// Register the Leap Escape keybinding
registerEditorAction(LeapEscapeAction);

// Register the Leap keybinding for updating suggestion decoration
registerEditorAction(LeapDecorAction);
