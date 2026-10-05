import { spawn } from "node:child_process";

/**
 * Runs the project's configured formatter on one generated file: no shell,
 * cwd the project root, the source on stdin, the formatted source read from
 * stdout. The command only ever comes from `.trickroom/config.json`.
 */

export const DEFAULT_FORMATTER_TIMEOUT_MS = 30_000;
export const FORMATTER_CONCURRENCY = 4;

const STDERR_TAIL_CHARS = 600;

export type CodegenFormatter = { command: string; args: string[] };

export type FormatResult =
	| { ok: true; contents: string }
	| { ok: false; message: string };

const tail = (text: string) => {
	const trimmed = text.trim();
	return trimmed.length > STDERR_TAIL_CHARS
		? `…${trimmed.slice(-STDERR_TAIL_CHARS)}`
		: trimmed;
};

export function runCodegenFormatter(
	formatter: CodegenFormatter,
	input: {
		projectRoot: string;
		/** Output path relative to the project root, substituted for `{file}`. */
		file: string;
		contents: string;
		timeoutMs?: number;
	},
): Promise<FormatResult> {
	const args = formatter.args.map((arg) =>
		arg.replaceAll("{file}", input.file),
	);
	const label = [formatter.command, ...args].join(" ");
	const timeoutMs = input.timeoutMs ?? DEFAULT_FORMATTER_TIMEOUT_MS;

	return new Promise((resolve) => {
		let settled = false;
		let timer: NodeJS.Timeout | undefined;
		const settle = (result: FormatResult) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve(result);
			}
		};

		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(formatter.command, args, {
				cwd: input.projectRoot,
				shell: false,
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			});
		} catch (error) {
			settle({
				ok: false,
				message: `Formatter "${label}" could not start: ${error instanceof Error ? error.message : String(error)}`,
			});
			return;
		}

		timer = setTimeout(() => {
			child.kill("SIGKILL");
			settle({
				ok: false,
				message: `Formatter "${label}" did not finish within ${timeoutMs} ms for ${input.file}.`,
			});
		}, timeoutMs);

		const stdout: Buffer[] = [];
		let stderr = "";
		child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString("utf8")).slice(-4 * STDERR_TAIL_CHARS);
		});
		child.on("error", (error) =>
			settle({
				ok: false,
				message: `Formatter "${label}" could not start: ${error.message}`,
			}),
		);
		child.on("close", (code, signal) => {
			const output = Buffer.concat(stdout).toString("utf8");
			const detail = tail(stderr);
			if (code !== 0) {
				settle({
					ok: false,
					message: `Formatter "${label}" failed for ${input.file} (${signal ? `signal ${signal}` : `exit ${code}`})${detail ? `: ${detail}` : "."}`,
				});
			} else if (output.trim().length === 0) {
				settle({
					ok: false,
					message: `Formatter "${label}" printed nothing for ${input.file}; it must write the formatted source to stdout${detail ? `. stderr: ${detail}` : "."}`,
				});
			} else {
				settle({ ok: true, contents: output });
			}
		});
		// A formatter that exits without reading stdin closes the pipe; the
		// exit code above reports it.
		child.stdin?.on("error", () => undefined);
		child.stdin?.end(input.contents, "utf8");
	});
}

/** `map` with at most `limit` calls in flight; results keep input order. */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	map: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await map(items[index]);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return results;
}
