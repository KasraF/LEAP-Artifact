import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { ARTVLogger } from 'vs/editor/contrib/rtv/browser/RTVInterfaces';

/*
 * Things to log:
 *   - How many requests?
 *   - How often?
 *   - How many fail?
 *   - Attempts to synthesize dependent loops?
 *   - How many examples do they provide?
 */
export class RTVLogger extends ARTVLogger {
	// States for various things we need to log
	private logDir: string;
	private currentFileName: string = 'unknown';
	private readonly logFile: string;

	constructor(private editor: ICodeEditor) {
		super();

		// Build output dir name
		let dir = process.env['LOG_DIR'];

		if (!dir) {
			dir = os.tmpdir() + path.sep;
		} else {
			if (!dir.endsWith(path.sep)) {
				dir += path.sep;
			}

			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir);
			}
		}

		// Build an fs-safe date/time:
		const now = new Date();
		dir += `snippy_log_${now.getMonth() + 1}-${now.getDate()}_${now.getHours()}-${now.getMinutes()}_${now.getSeconds()}`;

		// Don't overwrite existing logs!
		if (fs.existsSync(dir!!)) {
			console.error('Two log dirs created at the exact same time. This should not happen.');
			let counter = 0;
			dir = dir + '_' + counter;
			while (fs.existsSync(dir)) {
				dir = dir.substring(0, dir.length - 1) + counter++;
			}
		}

		this.logDir = dir! + path.sep;
		fs.mkdirSync(this.logDir);
		this.logFile = 'snippy_plus.log';
	}

	private now(): string {
		return new Date().getTime().toString();
	}

	protected async log(code: string, msg?: string): Promise<string | undefined> {
		let str: string;
		const id = this.now();

		if (msg) {
			msg = msg.replace(/\n/g, '\\n');
			str = `${id},${this.now()},${this.getCurrentFileName()},${code},${msg}`;
		} else {
			str = `${id},${this.now()},${this.getCurrentFileName()},${code}`;
		}

		console.log(str);
		await fs.promises.appendFile(this.logDir + this.logFile, str + '\n');
		return id;
	}

	protected async write(id: string | undefined, file: string, content: string): Promise<void> {
		let done = false;
		let fileName = `${this.logDir}${id}_${file}`;
		let counter = 0;

		console.debug(fileName, ':\n', content);

		while (!done && counter <= 50) {
			try {
				const fd = await fs.promises.open(fileName, 'wx');
				await fd.writeFile(content);
				done = true;
			} catch (err) {
				if (err.code === 'EEXIST') {
					// The file already exists.
					fileName = `${this.logDir}${id}_${counter}_${file}`;
					counter += 1;
				} else {
					console.error('log write() failed:\n', err);
					done = true;
				}
			}
		}

		if (!done) {
			console.error('Failed to write log file after 50 tries!');
		}
	}

	private getCurrentFileName() {
		const rs = this.editor.getModel()?.uri.toString();

		if (rs) {
			if (!rs.includes(this.currentFileName)) {
				const start = rs.lastIndexOf('/') + 1;
				const end = rs.length - start - 3;
				this.currentFileName = rs.substr(start, end);
			}
		} else {
			this.currentFileName = 'unknown';
		}

		return this.currentFileName;
	}
}
