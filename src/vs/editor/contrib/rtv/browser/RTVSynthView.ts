import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { MarkdownRenderer } from 'vs/editor/contrib/markdownRenderer/browser/markdownRenderer';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { DelayedRunAtMostOne } from 'vs/editor/contrib/rtv/browser/RTVInterfaces';
import { TableElement, isHtmlEscape, removeHtmlEscape } from 'vs/editor/contrib/rtv/browser/RTVUtils';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { badgeBackground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';

export class ErrorHoverManager {
	private errorHover?: HTMLElement = undefined;
	private addHoverTimer = new DelayedRunAtMostOne();

	constructor(private editor: ICodeEditor) { }

	public remove() {
		this.addHoverTimer.cancel();
		this.errorHover?.remove();
		this.errorHover = undefined;
	}

	public add(element: HTMLElement, msg: string, timeout: number = 0, fadeout: number = 1000) {
		this.addHoverTimer.run(timeout, async () => {
			if (this.errorHover) {
				this.errorHover.remove();
				this.errorHover = undefined;
			}

			// First, squiggly lines!
			// element.className += 'squiggly-error';

			// Use monaco's monaco-hover class to keep the style the same
			this.errorHover = document.createElement('div');
			this.errorHover.className = 'monaco-hover visible';
			this.errorHover.id = 'snippy-example-hover';

			const scrollable = document.createElement('div');
			scrollable.className = 'monaco-scrollable-element';
			scrollable.style.position = 'relative';
			scrollable.style.overflow = 'hidden';

			const row = document.createElement('row');
			row.className = 'hover-row markdown-hover';

			const content = document.createElement('div');
			content.className = 'monaco-hover-content';

			const div = document.createElement('div');
			const p = document.createElement('p');
			p.innerText = msg;

			div.appendChild(p);
			content.appendChild(div);
			row.appendChild(content);
			scrollable.appendChild(row);
			this.errorHover.appendChild(scrollable);

			const position = element.getBoundingClientRect();
			this.errorHover.style.position = 'fixed';
			this.errorHover.style.top = position.top.toString() + 'px';
			this.errorHover.style.left = position.right.toString() + 'px';
			this.errorHover.style.padding = '3px';

			// Add it to the DOM
			const editorNode = this.editor.getDomNode()!;
			editorNode.appendChild(this.errorHover);

			this.errorHover.ontransitionend = () => {
				if (this.errorHover) {
					if (this.errorHover.style.opacity === '0') {
						this.errorHover.remove();
					}
				}
			};

			setTimeout(() => {// TODO Make the error fade over time
				if (this.errorHover) {
					this.errorHover.style.transitionDuration = '2s'; // increased from 1s
					this.errorHover.style.opacity = '0';
				}
			}, fadeout);
		})
			.catch(err => {
				if (err) {
					console.error(err);
				}
			});
	}
}

export class RTVSynthView {

	private _langService: ILanguageService;
	private _openerService: IOpenerService;

	// core elements
	private _box: HTMLDivElement;
	private _line: HTMLDivElement;
	private _errorBox: ErrorHoverManager;

	// helper data structures/info
	private _synthTimer: DelayedRunAtMostOne = new DelayedRunAtMostOne();
	private _firstEditableCellId?: string = undefined;
	private _table?: HTMLTableElement;
	private _cellStyle?: CSSStyleDeclaration;

	exitSynthHandler?: (accept?: boolean) => void;
	requestValidateInput?: (input: string) => Promise<string | undefined>;
	requestSynth?: (idx: number, varname: string, cell: HTMLElement, force?: boolean | undefined, updateSynthBox?: boolean | undefined, includeRow?: boolean | undefined) => Promise<boolean>;
	requestUpdateBoxContent?: (updateSynthBox: boolean, includedTimes: Set<number>) => Promise<string | undefined>;
	requestToggleIfChanged?: (idx: number, varname: string, cell: HTMLElement, updateBoxContent?: boolean | undefined) => Promise<boolean>;
	requestToggleElement?: (idx: number, varname: string, cell: HTMLElement, force?: boolean | undefined, updateSynthBox?: boolean | undefined) => Promise<boolean>;
	updateCursorPos?: (range: Range, node: HTMLElement) => void;
	onCellElementsChanged?: (cells: Map<string, HTMLTableCellElement[]>) => void;
	requestNextCell?: (backwards: boolean, skipLine: boolean, varname: string) => HTMLTableCellElement;
	requestCurrNode?: () => HTMLElement;
	resetHighlight?: (idx: number, editable?: boolean | undefined) => void;


	constructor(
		private readonly _editor: ICodeEditor,
		readonly originalLineNode: HTMLElement,
		readonly originalBoxNode: HTMLElement,
		readonly langService: ILanguageService,
		readonly openerService: IOpenerService,
		readonly lineNumber: number,
		readonly outputVars: string[],
		@IThemeService readonly _themeService: IThemeService
	) {
		this._box = originalBoxNode.cloneNode(true) as HTMLDivElement;
		this._line = originalLineNode.cloneNode(true) as HTMLDivElement;
		this._langService = langService;
		this._openerService = openerService;
		this._box.id = 'rtv-synth-box';
		this._box.style.opacity = '0';
		this._line.id = 'rtv-synth-line';
		this._line.style.opacity = '0';
		this._errorBox = new ErrorHoverManager(this._editor);

		for (
			let elm: Node = this._box;
			elm.firstChild;
			elm = elm.firstChild
		) {
			// find the table node
			if (elm.nodeName === 'TABLE') {
				this._table = elm as HTMLTableElement;
				continue;
			}
			// make a copy of existing cell style to be inherited
			if (elm.nodeName === 'TD' && !this._cellStyle) {
				this._cellStyle = (elm as HTMLElement).style;
				break;
			}
		}

	}

	bindExitSynth(handler: (accept?: boolean) => void) {
		this.exitSynthHandler = handler;
	}

	bindValidateInput(handler: (input: string) => Promise<string | undefined>) {
		this.requestValidateInput = handler;
	}

	bindSynth(handler: (idx: number, varname: string, cell: HTMLElement, force?: boolean | undefined, updateSynthBox?: boolean | undefined, includeRow?: boolean) => Promise<boolean>) {
		this.requestSynth = handler;
	}

	bindUpdateBoxContent(handler: (updateSynthBox: boolean, includedTimes: Set<number>) => Promise<string | undefined>) {
		this.requestUpdateBoxContent = handler;
	}

	bindUpdateCursorPos(handler: (range: Range, node: HTMLElement) => void) {
		this.updateCursorPos = handler;
	}

	bindCellElementsChanged(handler: (cells: Map<string, HTMLTableCellElement[]>) => void) {
		this.onCellElementsChanged = handler;
	}

	bindRequestNextCell(handler: (backwards: boolean, skipLine: boolean, varname: string) => HTMLTableCellElement) {
		this.requestNextCell = handler;
	}

	bindRequestCurrNode(handler: () => HTMLElement) {
		this.requestCurrNode = handler;
	}

	bindToggleIfChanged(handler: (idx: number, varname: string, cell: HTMLElement, updateBoxContent?: boolean | undefined) => Promise<boolean>) {
		this.requestToggleIfChanged = handler;
	}

	bindToggleElement(handler: (idx: number, varname: string, cell: HTMLElement, force?: boolean | undefined, updateSynthBox?: boolean | undefined) => Promise<boolean>) {
		this.requestToggleElement = handler;
	}

	bindResetHighlight(handler: (idx: number, editable?: boolean | undefined) => void) {
		this.resetHighlight = handler;
	}

	// ------------
	// property getters and setters
	// ------------
	public show() {
		if (this.isHidden()) {
			this._box.style.opacity = '1';
			this._line.style.opacity = '1';
			const editor_div = this._editor.getDomNode();
			if (editor_div === null) {
				throw new Error('Cannot find Monaco Editor');
			}
			editor_div.appendChild(this._line);
			editor_div.appendChild(this._box);
		}
	}

	public hide() {
		this._box.style.opacity = '0';
		this._line.style.opacity = '0';
	}

	private isHidden() {
		return this._box.style.opacity === '0';
	}

	public destroy() {
		if (this._box) {
			this._box.remove();
		}
		if (this._line) {
			this._line.remove();
		}
	}

	public getElement(): HTMLElement {
		return this._box!;
	}

	public getCellId(varname: string, idx: number): string {
		return `${this.lineNumber}-${varname}-${idx}-synth`;
	}

	public getRowId(idx: number): string {
		return `${this.lineNumber}-${idx}-synth`;
	}

	public getRow(idx: number): HTMLTableRowElement | null {
		return document.getElementById(this.getRowId(idx)) as HTMLTableRowElement;
	}

	public getTableId(): string {
		return `${this.lineNumber}-table-synth`;
	}

	public getCell(varname: string, idx: number): HTMLTableCellElement | null {
		return document.getElementById(this.getCellId(varname, idx)) as HTMLTableCellElement;
	}

	// ------------
	// front-end updates
	// ------------

	public updateBoxContent(rows: TableElement[][], init: boolean = false) {
		const renderer = new MarkdownRenderer(
			{ 'editor': this._editor },
			this._langService,
			this._openerService);
		const outputVars = new Set(this.outputVars);

		this._firstEditableCellId = undefined;
		const cellElements = new Map<string, HTMLTableCellElement[]>();

		if (init) {
			// remove existing cells
			this._table!.childNodes.forEach((child) => {
				this._table!.removeChild(child);
			});
			this._table!.id = this.getTableId();

			this.show();
		}

		// update cell contents and add event listeners
		for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
			let newRow: HTMLTableRowElement;
			if (init) {
				newRow = this._table!.insertRow(-1);
				if (rowIdx > 0) { // skip the headers
					newRow.id = this.getRowId(rowIdx - 1);
				}
			}
			const row = rows[rowIdx];
			for (let _colIdx = 0; _colIdx < row.length; _colIdx++) {
				let cell: HTMLTableCellElement | undefined;
				const elmt = row[_colIdx];
				const vname = elmt.vname!;
				if (init) {
					cell = newRow!.insertCell(-1);
					if (rowIdx > 0) {
						cell!.id = this.getCellId(elmt.vname!, rowIdx - 1);
					}
					this.addCellContentAndStyle(cell!, elmt, renderer, rowIdx === 0);
				}

				// skip the headers
				if (rowIdx > 0) {
					if (!cell) {
						// not init
						cell = this.getCell(vname, rowIdx - 1)!;
					}
					if (cell! !== null) {
						if (!init) {
							cell = this.updateCell(cell!, elmt, renderer);
						}
						if (!this._firstEditableCellId && vname === this.outputVars[0] && elmt.editable && elmt.content.trim() !== '') {
							this._firstEditableCellId = this.getCellId(vname, rowIdx - 1);
						}

						// build cellElements
						if (outputVars.has(vname)) {
							const vcells = cellElements!.get(vname) ?? [];
							vcells.push(cell!);
							cellElements!.set(vname, vcells);
						}

						// finally, re-highlight rows and remove highlight of rows that are no longer valid
						this.resetHighlight!(rowIdx - 1, elmt.editable);
					}

				}
			}
		}

		// send vcells info back to Model
		this.onCellElementsChanged!(cellElements);
	}

	private addCellContentAndStyle(cell: HTMLTableCellElement, elmt: TableElement, r: MarkdownRenderer, header: boolean = false) {
		cell.style.borderLeft = this._cellStyle!.borderLeft;
		cell.style.paddingLeft = this._cellStyle!.paddingLeft;
		cell.style.paddingRight = this._cellStyle!.paddingRight;
		cell.style.paddingTop = this._cellStyle!.paddingTop;
		cell.style.paddingBottom = this._cellStyle!.paddingBottom;
		cell.style.boxSizing = this._cellStyle!.boxSizing;
		cell.align = 'center';

		this.updateCell(cell, elmt, r, header);
	}

	private updateCell(cell: HTMLTableCellElement, elmt: TableElement, r: MarkdownRenderer, header: boolean = false): HTMLTableCellElement {

		const s = elmt.content;
		let cellContent: HTMLElement;
		if (s === '') {
			// Make empty strings into a space to make sure it's allocated a space
			// Otherwise, the divs in a row could become invisible if they are
			// all empty
			cellContent = document.createElement('div');
			cellContent.innerHTML = '&nbsp';
		}
		else if (isHtmlEscape(s)) {
			cellContent = document.createElement('div');
			cellContent.innerHTML = removeHtmlEscape(s);
		} else {
			const renderedText = r.render(new MarkdownString(s));
			cellContent = renderedText.element;
		}


		// Remove any existing content
		cell.childNodes?.forEach((child) => cell.removeChild(child));

		if (elmt.editable) {
			// make the TableCellElement `td` editable if applicable
			cell.contentEditable = 'true';
		}

		const outputVars = new Set(this.outputVars);

		// Add the new content
		cell.appendChild(cellContent);

		if (!header && outputVars.has(elmt.vname!)) {
			this.addListeners(cell);
		}

		return cell;
	}

	// ------------
	// utility functions
	// ------------

	private select(node: Node) {
		const selection = window.getSelection()!;
		const range = selection.getRangeAt(0);
		range.selectNodeContents(node);
		selection.removeAllRanges();
		selection.addRange(range);
		this.updateCursorPos!(range, node as HTMLElement);
	}

	public highlightRow(idx: number) {
		const row = this.getRow(idx)!;
		const theme = this._themeService.getColorTheme();
		row.style.fontWeight = '900';
		row.style.backgroundColor = String(theme.getColor(badgeBackground) ?? '');
	}

	public removeHighlight(idx: number) {
		const row = this.getRow(idx)!;
		row.style.fontWeight = row.style.backgroundColor = '';
	}

	private addListeners(cell: HTMLElement) {
		if (cell.id) { // won't work for cells w/o id, i.e., the header cells
			const [varname, idx] = cell.id.split('-').slice(1);

			cell.onclick = (e: MouseEvent) => {
				const selection = window.getSelection()!;
				const range = selection.getRangeAt(0)!;
				this.updateCursorPos!(range, cell);
			};

			cell.onblur = async () => {
				await this.requestToggleIfChanged!(+idx, varname, cell);
			};

			cell.onkeydown = (e: KeyboardEvent) => {
				let rs: boolean = true;

				const selection = window.getSelection()!;
				const range = selection.getRangeAt(0)!;

				this.updateCursorPos!(range, cell);

				switch (e.key) {
					case 'Enter':
						e.preventDefault();

						if (e.shiftKey) {
							this._synthTimer.run(1, async () => {
								const success = await this.requestSynth!(+idx, varname, cell, true, false, true);
								if (success) {
									this.highlightRow(+idx);
									this.synthesizeFragment(cell);
								}
							});
						} else {
							// without Shift: accept and exit
							this.exitSynthHandler!(true);
						}
						break;

					case 'Escape':
						// stop synth
						rs = false;
						e.preventDefault();
						this.exitSynthHandler!();
						break;

					default:
						// how do we handle the situation where `Tab` is pressed immediately after a regular keystroke?
						// - currently we _don't_ process any synth request under this situation
						if (e.key === 'Tab') {
							e.preventDefault();
							this.focusNextRow(cell, e.shiftKey);
						}
						this._synthTimer.run(1000, async () => {
							const success = await this.requestSynth!(+idx, varname, cell, true, false, false);
							if (success) {
								this.synthesizeFragment(cell);
							}
						}).catch(err => {
							if (err) {
								console.error(err);
							}
						});
						break;
				}
				return rs;
			}; // end of onkeydown
		}

	}

	private synthesizeFragment(cell: HTMLElement) {
		const sel = window.getSelection()!;
		let offset = sel.anchorOffset;
		const range = document.createRange();

		const isString = cell.innerText[0] === '\'' || cell.innerText[0] === '"';

		let dest: HTMLElement = cell;
		while (dest.firstChild && (!dest.classList.contains('monaco-tokenized-source') || dest.childNodes.length === 1)) {
			dest = dest.firstChild as HTMLElement;
		}

		if (dest.childNodes.length > 1) {
			const isNegNum = dest.firstChild!.textContent === '-';
			offset = isNegNum ? cell.innerText.length : dest.childNodes.length - 1;
		} else {
			// Select the actual text
			while (dest.firstChild) {
				dest = dest.firstChild as HTMLElement;
			}

			offset = isString ? cell.innerText.length - 1 : cell.innerText.length;
		}

		const currNode: HTMLElement = this.requestCurrNode!();

		if (currNode.id === cell.id) {
			try {
				range.selectNodeContents(dest);
				range.setStart(dest, offset);
				range.collapse(true);

				sel.removeAllRanges();
				sel.addRange(range);
			} catch (e) {
				// TODO Better error handling
				console.error(e);
				range.selectNodeContents(dest);
				range.setStart(dest, 0);
				range.collapse(true);

				sel.removeAllRanges();
				sel.addRange(range);
			}
		}
		else {
			// console.error(`cursorPos: ${this._cursorPos!.node.id}; currCell: ${cell.id}`);
			this.select(currNode);
		}
	}


	/**
	 * moves the cursor to the next editable cell
	 * @param cell
	 * @param backwards
	 * @param trackChanges
	 * @param skipLine
	 * @param updateBoxContent
	 */
	private async focusNextRow(
		cell: HTMLElement,
		backwards: boolean = false,
		trackChanges: boolean = true,
		skipLine: boolean = false,
		updateBoxContent: boolean = true
	): Promise<void> {
		// Extract the info from the cell ID, skip the first, which is the lineno
		const [varname, idxStr]: string[] = cell.id.split('-').slice(1);
		const idx: number = parseInt(idxStr);

		if (trackChanges) {
			const success = await this.requestToggleIfChanged!(idx, varname, cell, updateBoxContent);
			if (!success) {
				return;
			}
		}

		// Finally, select the next value.
		const nextCell = this.requestNextCell!(backwards, skipLine, varname);
		this.select(nextCell!);
	}

	/**
	 * attempts to move the cursor to the first editable cell inside the table
	 * @returns ... is successful
	 */
	public selectFirstEditableCell(): boolean {
		const firstVar = this.outputVars[0];
		try {
			const cellVar = this._firstEditableCellId!.split('-')[1];

			if (firstVar !== cellVar) {
				console.error(`No cell found with key "${firstVar}"`);
				return false;
			}

			// this._currRow = +cellId; // already handled by this.select
			const cell = document.getElementById(this._firstEditableCellId!);
			cell!.contentEditable = 'true';
			this.select(cell!);
			return true;

		} catch (err) {
			console.error(`No non-empty cells found for key "${firstVar}".`);
			return false;
		}
	}

	/**
	 * asks errorBox to display the error msg to be attached to the synth box
	 * or a cell if specified
	 * @param error
	 * @param cell
	 * @param timeout
	 * @param fadeout
	 */
	public addError(error: string, cell?: HTMLElement, timeout?: number, fadeout?: number) {
		this._errorBox.add(cell ?? this._box, error, timeout, fadeout);
	}

}
