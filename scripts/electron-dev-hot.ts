import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const rendererUrl = new URL(
	process.env.TRICKROOM_ELECTRON_RENDERER_URL ?? "http://127.0.0.1:18100/",
);
const electronArgs = process.argv.slice(2);
const startedAt = Date.now();
const watchFiles = [
	path.join(rootDirectory, "dist-electron", "main", "main.js"),
	path.join(rootDirectory, "dist-electron", "preload", "preload.cjs"),
];

let shuttingDown = false;
let restartingElectron = false;
let electronProcess: ChildProcess | null = null;
let watchSignature = "";

const longRunningProcesses = new Set<ChildProcess>();

const spawnProcess = (
	name: string,
	command: string,
	args: string[],
	options: { env?: NodeJS.ProcessEnv; longRunning?: boolean } = {},
) => {
	const child = spawn(command, args, {
		cwd: rootDirectory,
		env: options.env ?? process.env,
		stdio: "inherit",
	});

	if (options.longRunning) {
		longRunningProcesses.add(child);
		child.once("exit", (code, signal) => {
			longRunningProcesses.delete(child);
			if (!shuttingDown) {
				console.error(
					`${name} exited unexpectedly. code=${String(code)} signal=${String(
						signal,
					)}`,
				);
				void shutdown(code ?? 1);
			}
		});
	}

	child.once("error", (error) => {
		if (!shuttingDown) {
			console.error(`${name} failed to start:`, error);
			void shutdown(1);
		}
	});

	return child;
};

const runOnce = (name: string, command: string, args: string[]) =>
	new Promise<void>((resolve, reject) => {
		const child = spawnProcess(name, command, args);
		child.once("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(
				new Error(
					`${name} failed. code=${String(code)} signal=${String(signal)}`,
				),
			);
		});
	});

const getFileSignature = () =>
	watchFiles
		.map((filePath) => {
			if (!existsSync(filePath)) {
				return `${filePath}:missing`;
			}
			const stat = statSync(filePath);
			return `${filePath}:${stat.mtimeMs}:${stat.size}`;
		})
		.join("|");

const waitForBuildOutputs = async (minimumMtimeMs = startedAt - 1_000) => {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const ready = watchFiles.every((filePath) => {
			if (!existsSync(filePath)) {
				return false;
			}
			return statSync(filePath).mtimeMs >= minimumMtimeMs;
		});
		if (ready) {
			watchSignature = getFileSignature();
			return;
		}

		await delay(250);
	}

	throw new Error("Timed out waiting for Electron main/preload build outputs.");
};

const waitForRenderer = async () => {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(new URL("/", rendererUrl));
			if (response.ok) {
				return;
			}
		} catch {
			// Keep waiting while Vite starts.
		}

		await delay(250);
	}

	throw new Error(`Timed out waiting for Vite at ${rendererUrl.href}.`);
};

const startElectron = () => {
	electronProcess = spawnProcess(
		"electron",
		pnpmCommand,
		["exec", "electron", ".", ...electronArgs],
		{
			env: {
				...process.env,
				TRICKROOM_ELECTRON_RENDERER_URL: rendererUrl.href,
				TRICKROOM_ELECTRON_DEVTOOLS:
					process.env.TRICKROOM_ELECTRON_DEVTOOLS ?? "1",
			},
		},
	);

	electronProcess.once("exit", (code, signal) => {
		electronProcess = null;
		if (!shuttingDown && !restartingElectron) {
			console.error(
				`electron exited. code=${String(code)} signal=${String(signal)}`,
			);
			void shutdown(code ?? 0);
		}
	});
};

const stopElectron = async () => {
	const child = electronProcess;
	if (!child || child.exitCode !== null) {
		electronProcess = null;
		return;
	}

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
};

const restartElectron = async () => {
	if (restartingElectron || shuttingDown) {
		return;
	}

	restartingElectron = true;
	try {
		await stopElectron();
		if (!shuttingDown) {
			startElectron();
		}
	} finally {
		restartingElectron = false;
	}
};

const watchElectronOutputs = async () => {
	while (!shuttingDown) {
		await delay(500);
		const nextSignature = getFileSignature();
		if (nextSignature !== watchSignature) {
			await waitForBuildOutputs(0);
			await restartElectron();
		}
	}
};

const shutdown = async (exitCode = 0) => {
	if (shuttingDown) {
		return;
	}

	shuttingDown = true;
	await stopElectron();
	for (const child of longRunningProcesses) {
		if (child.exitCode === null) {
			child.kill("SIGTERM");
		}
	}
	setTimeout(() => process.exit(exitCode), 250);
};

process.on("SIGINT", () => {
	void shutdown(0);
});

process.on("SIGTERM", () => {
	void shutdown(0);
});

try {
	await runOnce("tailwind token generation", pnpmCommand, [
		"generate:tailwind-tokens",
	]);

	spawnProcess(
		"vite renderer",
		pnpmCommand,
		[
			"exec",
			"vite",
			"--host",
			rendererUrl.hostname,
			"--port",
			rendererUrl.port || "18100",
			"--strictPort",
		],
		{ longRunning: true },
	);
	spawnProcess(
		"electron main watcher",
		pnpmCommand,
		["exec", "vite", "build", "--config", "vite.electron-main.config.ts", "--watch"],
		{ longRunning: true },
	);
	spawnProcess(
		"electron preload watcher",
		pnpmCommand,
		[
			"exec",
			"vite",
			"build",
			"--config",
			"vite.electron-preload.config.ts",
			"--watch",
		],
		{ longRunning: true },
	);

	await Promise.all([waitForBuildOutputs(), waitForRenderer()]);
	startElectron();
	await watchElectronOutputs();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	await shutdown(1);
}
