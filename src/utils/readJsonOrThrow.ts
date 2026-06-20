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

export const readJsonOrThrow = async <T>(response: Response): Promise<T> => {
	if (!response.ok) {
		const body = (await response
			.json()
			.catch(() => null)) as ErrorResponse | null;
		throw new HttpError(
			body?.error ?? `Request failed with status ${response.status}`,
			response.status,
		);
	}

	return (await response.json()) as T;
};
