type ErrorResponse = {
	error?: string;
};

export class HttpError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "HttpError";
		this.status = status;
	}
}

/** Shown when a response is not the JSON the app asked for (an HTML page, say). */
export const UNEXPECTED_RESPONSE_MESSAGE =
	"Trickroom got an unexpected response from its server. Reload the page, or restart Trickroom.";

const parseJson = (
	text: string,
): { ok: true; value: unknown } | { ok: false } => {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false };
	}
};

/**
 * Reads a JSON body, or throws an `HttpError` whose message can be shown as
 * is: the server's `error` field, or a readable fallback, never a raw parse
 * error.
 */
export const readJsonOrThrow = async <T>(response: Response): Promise<T> => {
	const text = await response.text().catch(() => "");
	const parsed = parseJson(text);

	if (!response.ok) {
		const body = parsed.ok ? (parsed.value as ErrorResponse | null) : null;
		throw new HttpError(
			body?.error ??
				`The Trickroom server returned an error (${response.status}).`,
			response.status,
		);
	}

	if (!parsed.ok) {
		throw new HttpError(UNEXPECTED_RESPONSE_MESSAGE, response.status);
	}

	return parsed.value as T;
};
