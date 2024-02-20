import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { LeapConfig, ILeapUtils, ALeapUtils, OpenAIRequest, ALeapLogger, ILeapLogger } from 'vs/editor/contrib/leap/browser/LeapInterfaces';
import { LogEventData, LogResultData } from 'vs/editor/contrib/rtv/browser/RTVInterfaces';

class RemoteUtils extends ALeapUtils {
	public readonly EOL: string = '\n';
	private _requestTemplate: OpenAIRequest = {
		model: "gpt-3.5-turbo-instruct",
		temperature: 0.5,
		n: 5,
		max_tokens: 512,
		stop: [this.EOL + this.EOL],
		stream: true,
		prompt: null,
	};

	constructor() {
		super();
		this.fetchRequestTemplate();
	}

	async getConfig(): Promise<LeapConfig> {
		const queries = window.location.search;
		const rq = await fetch(
			`/getLeapConfig${queries}`,
			{
				method: 'GET',
				mode: 'same-origin'
			}
		);
		const body: LeapConfig = await rq.json();
		console.log('Received LEAP config from server:', body);

		return body;
	}


	async getCompletions(request: OpenAIRequest, signal: AbortSignal, progressCallback: (e: any) => void): Promise<string[]> {
		// TODO (kas) handle this with SSEs, similar to OpenAI's API.
		const rq = await fetch(
			'/getCompletions',
			{
				method: 'POST',
				body: JSON.stringify(request),
				mode: 'same-origin',
				signal: signal,
			}
		);

		const reader = rq.body!.getReader();
		const decoder = new TextDecoder();
		let jsonStr = '';
		while (true) {
			const { done, value } = await reader.read();
			const text = decoder.decode(value);
			progressCallback(text);
			jsonStr += text;
			if (done || text.includes('[DONE]')) {
				break;
			}
		}
		reader.cancel();

		console.log('Received completions from server:\n', jsonStr);

		// Now that we have the entries, we need to parse them.
		const codes = Array.from({ length: (request.n || 1) }, () => "");
		for (let entry of jsonStr.trim().split('\n')) {
			// The entries are streamed as JSON strings
			// So we need to parse twice:
			// Once to go from a JSON string to a string
			// Then again to go from a string to a JSON object
			entry = JSON.parse(entry.trim());
			if (entry.startsWith('data: ')) {
				entry = entry.substring(6);
			}

			if (entry) {
				try {
					console.log("Trying to parse as JSON:\n", entry);
					const part = JSON.parse(entry);
					const i = part.choices[0].index;
					const delta = part.choices[0].text ?? '';
					codes[i] += delta;
				} catch (e) {
					console.error("Failed to parse entry. Skipping:\n", entry);
				}
			}
		}

		return this.cleanUpCompletions(request, codes);
	}

	getLogger(_editor: ICodeEditor): ILeapLogger {
		return new LeapLogger();
	}

	async buildRequest(prefix: string, suffix: string): Promise<OpenAIRequest> {
		return {
			...this._requestTemplate,
			prompt: prefix,
			suffix: suffix
		};
	}

	private async fetchRequestTemplate(): Promise<OpenAIRequest> {
		const queries = window.location.search;
		const res = await fetch(
			`/openAIRequest${queries}`,
			{
				method: 'GET',
				mode: 'same-origin'
			}
		);
		const body: OpenAIRequest = await res.json();
		this._requestTemplate = body;
		return body;
	}
}

export function getUtils(): ILeapUtils {
	return new RemoteUtils();
}

export class LeapLogger extends ALeapLogger {

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
