import { type ChildProcess, fork } from "node:child_process";
import path from "node:path";
import { createSessionAuthHeaders } from "./session-auth";

export type BackendReadyMessage = {
	type: "trickroom:server-ready";
	version: 1;
	host: string;
	port: number;
	url: string;
	electronMode: boolean;
};

export type BackendReady = BackendReadyMessage & {
	origin: string;
};

export type BackendStartOptions = {
	appRoot: string;
	backendEntry: string;
	initialProjectRoot?: string | null;
	trickroomHome?: string;
	sessionToken?: string;
	startupTimeoutMs?: number;
	onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
};

const defaultStartupTimeoutMs = 15_000;

const appendTail = (current: string, next: string, maxLength = 8_000) => {
	const combined = current + next;
	return combined.length <= maxLength
		? combined
		: combined.slice(combined.length - maxLength);
};

export const isBackendReadyMessage = (
	value: unknown,
): value is BackendReadyMessage => {
	if (!value || typeof value !== "object") {
		return false;
	}

	const message = value as Record<string, unknown>;
	return (
		message.type === "trickroom:server-ready" &&
		message.version === 1 &&
		typeof message.host === "string" &&
		message.host.length > 0 &&
		typeof message.port === "number" &&
		Number.isInteger(message.port) &&
		message.port > 0 &&
		typeof message.url === "string" &&
		message.url.length > 0 &&
		typeof message.electronMode === "boolean"
	);
};

export const createBackendEnvironment = ({
	initialProjectRoot,
	trickroomHome,
	sessionToken,
}: Pick<
	BackendStartOptions,
	"initialProjectRoot" | "trickroomHome" | "sessionToken"
>) => ({
	...process.env,
	ELECTRON_RUN_AS_NODE: "1",
	TRICKROOM_ELECTRON: "1",
	TRICKROOM_RUNTIME_ENV:
		process.env.TRICKROOM_RUNTIME_ENV ??
		(process.defaultApp ? "development" : "production"),
	TRICKROOM_HTTP_HOST: "127.0.0.1",
	TRICKROOM_HTTP_PORT: "0",
	TRICKROOM_READY_JSON: "1",
	...(initialProjectRoot ? { TRICKROOM_PROJECT_DIR: initialProjectRoot } : {}),
	...(trickroomHome ? { TRICKROOM_HOME: trickroomHome } : {}),
	...(sessionToken ? { TRICKROOM_SESSION_TOKEN: sessionToken } : {}),
});

const verifyBackendHealth = async (
	ready: BackendReady,
	sessionToken?: string,
) => {
	const healthUrl = new URL("/api/trickroom/health", ready.url);
	const response = await fetch(healthUrl, {
		headers: sessionToken ? createSessionAuthHeaders(sessionToken) : undefined,
	});

	if (!response.ok) {
		throw new Error(
			`Backend health check failed with HTTP ${response.status}.`,
		);
	}
};

export class BackendSupervisor {
	private child: ChildProcess | null = null;
	private ready: BackendReady | null = null;
	private stopping = false;

	isRunning() {
		return this.child !== null && this.child.exitCode === null;
	}

	async start(options: BackendStartOptions): Promise<BackendReady> {
		if (this.ready && this.isRunning()) {
			return this.ready;
		}

		const backendEntry = path.resolve(options.backendEntry);
		const startupTimeoutMs =
			options.startupTimeoutMs ?? defaultStartupTimeoutMs;
		let stderrTail = "";
		let settled = false;

		const child = fork(backendEntry, [], {
			cwd: options.appRoot,
			env: createBackendEnvironment(options),
			execPath: process.execPath,
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		});

		this.child = child;

		child.stdout?.on("data", (chunk: Buffer) => {
			process.stdout.write(chunk);
		});

		child.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			stderrTail = appendTail(stderrTail, text);
			process.stderr.write(text);
		});

		return new Promise<BackendReady>((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timeout);
				child.off("message", onMessage);
				child.off("exit", onExit);
				child.off("error", onError);
			};

			const fail = (error: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				cleanup();
				this.ready = null;
				reject(error);
			};

			const timeout = setTimeout(() => {
				const suffix = stderrTail ? `\n\nBackend stderr:\n${stderrTail}` : "";
				fail(
					new Error(
						`Timed out waiting for Trickroom backend readiness.${suffix}`,
					),
				);
			}, startupTimeoutMs);

			const onMessage = (message: unknown) => {
				if (!isBackendReadyMessage(message)) {
					return;
				}

				const url = new URL(message.url);
				if (message.host !== "127.0.0.1" || url.hostname !== "127.0.0.1") {
					fail(
						new Error(
							`Unexpected backend host "${message.host}" for Electron mode.`,
						),
					);
					return;
				}

				const ready: BackendReady = {
					...message,
					origin: url.origin,
				};

				void verifyBackendHealth(ready, options.sessionToken)
					.then(() => {
						if (settled) {
							return;
						}
						settled = true;
						cleanup();
						this.ready = ready;
						child.once("exit", (code, signal) => {
							const intentional = this.stopping;
							this.child = null;
							this.ready = null;
							this.stopping = false;
							if (!intentional) {
								options.onExit?.(code, signal);
							}
						});
						resolve(ready);
					})
					.catch(fail);
			};

			const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
				const suffix = stderrTail ? `\n\nBackend stderr:\n${stderrTail}` : "";
				fail(
					new Error(
						`Trickroom backend exited before readiness. code=${String(
							code,
						)} signal=${String(signal)}${suffix}`,
					),
				);
			};

			const onError = (error: Error) => {
				fail(error);
			};

			child.on("message", onMessage);
			child.on("exit", onExit);
			child.on("error", onError);
		});
	}

	async stop() {
		const child = this.child;
		this.child = null;
		this.ready = null;

		if (!child || child.exitCode !== null) {
			this.stopping = false;
			return;
		}

		this.stopping = true;
		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				if (child.exitCode === null) {
					child.kill("SIGKILL");
				}
				resolve();
			}, 2_000);

			child.once("exit", () => {
				clearTimeout(timeout);
				resolve();
			});

			child.kill("SIGTERM");
		});
	}
}
