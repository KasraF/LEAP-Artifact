import { ARTVLogger, LogEventData, LogResultData } from 'vs/editor/contrib/rtv/browser/RTVInterfaces';

export class RTVLogger extends ARTVLogger {

	constructor(_editor: any) { super(); }

	protected async log(code: string, msg?: string): Promise<string | undefined> {
		// Send to server
		const body = new LogEventData(this.getFilename(), code, msg);
		let id = undefined;

		try {
			const response = await fetch(
				'/log',
				{
					method: 'POST',
					body: JSON.stringify(body),
					mode: 'same-origin',
					headers: this.headers()
				});

			if (response.status !== 200) {
				console.error(`Logging to server failed with status [${response.status}: ${response.statusText}]:\n`, response);
				return undefined;
			}

			id = await response.text();
		} catch (err: any) {
			// Something failed?
			console.error('Logging to server failed:\n', err);
			return undefined;
		}

		// Also log it to console
		let log: string;
		if (msg) {
			msg = msg.replace(/\n/g, '\\n');
			log = `${id},${code},${msg}`;
		} else {
			log = `${id},${code}`;
		}
		console.log(log);

		return id;
	}

	protected async write(id: string | undefined, file: string, content: any): Promise<void> {
		let contentStr;

		if (content instanceof String || typeof content === 'string') {
			contentStr = content.toString();
		} else {
			contentStr = JSON.stringify(content);
		}

		const body = new LogResultData(id, file, contentStr);

		// This could be huge, so debug, not log.
		console.debug(`${id}_${file}`, body);

		fetch(
			'/logFile',
			{
				method: 'POST',
				body: JSON.stringify(body),
				mode: 'same-origin',
				headers: this.headers()
			});
	}

	private headers(contentType: string = 'application/json;charset=UTF-8'): Headers {
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

	private getFilename(): string {
		const queries = window.location.search;
		const matches = queries?.match('task=(.+)');

		if (matches && matches.length > 1) {
			return matches[1];
		} else {
			return 'undefined';
		}
	}
}
