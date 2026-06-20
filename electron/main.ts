import "./sentry-init";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
	app,
	BrowserWindow,
	clipboard,
	dialog,
	type IpcMainInvokeEvent,
	ipcMain,
	Menu,
	type MenuItemConstructorOptions,
	type OpenDialogOptions,
} from "electron";
import { getAppSession } from "./app-session";
import {
	resolveInitialProjectRootFromArgs,
	validateProjectRoot,
	getElectronUserArgs,
} from "./argv";
import { type BackendReady, BackendSupervisor } from "./backend-supervisor";
import {
	findTrickroomDeeplinkInArgs,
	isTrickroomDeeplinkUrl,
	normalizeTrickroomDeeplinkUrl,
} from "./deeplink";
import {
	installContentSecurityPolicy,
	installNavigationGuards,
	installPermissionPolicy,
	isAllowedAppUrl,
} from "./navigation-guard";
import {
	getBackendEntryPath,
	getMcpHelperPath,
	getPreloadPath,
	getRuntimeRoot,
} from "./paths";
import {
	createSessionAuthHeaders,
	installSessionAuthHeader,
} from "./session-auth";

const backendSupervisor = new BackendSupervisor();
const smokeMode = process.env.TRICKROOM_ELECTRON_SMOKE === "1";
const devRendererUrl = process.env.TRICKROOM_ELECTRON_RENDERER_URL?.trim();

if (process.platform === "darwin") {
	// Trickroom persists nothing through Chromium — bypass the macOS Safe Storage
	// keychain so users are never prompted for an unused encryption key.
	app.commandLine.appendSwitch("use-mock-keychain");
}

let mainWindow: BrowserWindow | null = null;
const tokenReferenceWindows = new Map<string, BrowserWindow>();
let backendReady: BackendReady | null = null;
let sessionToken = "";
let isQuitting = false;
let rendererUrl = "";
let rendererOrigin = "";
let pendingDeeplinkUrl: string | null = null;

const registerTrickroomProtocol = () => {
	if (process.defaultApp) {
		if (process.argv.length >= 2) {
			app.setAsDefaultProtocolClient("trickroom", process.execPath, [
				path.resolve(process.argv[1]),
			]);
			return;
		}
	}

	app.setAsDefaultProtocolClient("trickroom");
};

const createSessionToken = () => randomBytes(32).toString("base64url");

const normalizeRendererUrl = (value: string) => {
	const url = new URL(value);
	if (url.protocol !== "http:") {
		throw new Error("TRICKROOM_ELECTRON_RENDERER_URL must use http.");
	}
	if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
		throw new Error(
			"TRICKROOM_ELECTRON_RENDERER_URL must point to a loopback host.",
		);
	}

	url.pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/?$/, "/");
	return url;
};

const createDevBackendReady = async (value: string): Promise<BackendReady> => {
	const url = normalizeRendererUrl(value);
	const healthUrl = new URL("/api/trickroom/health", url);
	const response = await fetch(healthUrl);
	if (!response.ok) {
		throw new Error(
			`Dev renderer health check failed with HTTP ${response.status}.`,
		);
	}

	return {
		type: "trickroom:server-ready",
		version: 1,
		host: url.hostname,
		port: Number(url.port || "80"),
		url: url.href,
		origin: url.origin,
		electronMode: false,
	};
};

const appUrl = (path = "/") => {
	if (!rendererUrl) {
		throw new Error("Trickroom renderer is not ready.");
	}

	return new URL(path, rendererUrl).href;
};

const assertTrustedIpcSender = (event: IpcMainInvokeEvent) => {
	if (!mainWindow || event.sender !== mainWindow.webContents) {
		throw new Error("Rejected IPC call from an unexpected webContents.");
	}

	const senderFrame = event.senderFrame;
	if (
		!senderFrame ||
		!rendererOrigin ||
		!isAllowedAppUrl(senderFrame.url, rendererOrigin)
	) {
		throw new Error("Rejected IPC call from an unexpected origin.");
	}
};

const pickProjectFolder = async () => {
	const options: OpenDialogOptions = {
		properties: ["openDirectory", "createDirectory"],
	};
	const result = mainWindow
		? await dialog.showOpenDialog(mainWindow, options)
		: await dialog.showOpenDialog(options);

	if (result.canceled || result.filePaths.length === 0) {
		return { canceled: true as const };
	}

	return {
		canceled: false as const,
		path: result.filePaths[0],
	};
};

const pickCssFile = async (projectRoot: string) => {
	if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) {
		throw new Error("Project root must be an absolute path.");
	}

	const options: OpenDialogOptions = {
		properties: ["openFile"],
		defaultPath: projectRoot,
		filters: [{ name: "CSS", extensions: ["css"] }],
	};
	const result = mainWindow
		? await dialog.showOpenDialog(mainWindow, options)
		: await dialog.showOpenDialog(options);

	if (result.canceled || result.filePaths.length === 0) {
		return { canceled: true as const };
	}

	const absoluteFile = result.filePaths[0];
	const normalizedRoot = path.resolve(projectRoot);
	const normalizedFile = path.resolve(absoluteFile);
	const relative = path.relative(normalizedRoot, normalizedFile);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error("CSS file must live inside the project folder.");
	}

	return {
		canceled: false as const,
		relativePath: relative.split(path.sep).join("/"),
	};
};

const pickProjectRelativeFile = async (
	projectRoot: string,
	options: OpenDialogOptions,
) => {
	if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) {
		throw new Error("Project root must be an absolute path.");
	}

	const result = mainWindow
		? await dialog.showOpenDialog(mainWindow, options)
		: await dialog.showOpenDialog(options);

	if (result.canceled || result.filePaths.length === 0) {
		return { canceled: true as const };
	}

	const absoluteFile = result.filePaths[0];
	const normalizedRoot = path.resolve(projectRoot);
	const normalizedFile = path.resolve(absoluteFile);
	const relative = path.relative(normalizedRoot, normalizedFile);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error("File must live inside the project folder.");
	}

	return {
		canceled: false as const,
		relativePath: relative.split(path.sep).join("/"),
	};
};

const pickAssetFile = (projectRoot: string) =>
	pickProjectRelativeFile(projectRoot, {
		properties: ["openFile"],
		defaultPath: projectRoot,
		filters: [
			{
				name: "Raster images",
				extensions: ["png", "jpg", "jpeg", "webp", "gif"],
			},
		],
	});

const openTokenReferenceWindow = async (systemId: string) => {
	const normalizedSystemId = systemId.trim();
	if (!normalizedSystemId) {
		throw new Error("System id is required.");
	}

	const existingWindow = tokenReferenceWindows.get(normalizedSystemId);
	if (existingWindow && !existingWindow.isDestroyed()) {
		if (existingWindow.isMinimized()) {
			existingWindow.restore();
		}
		existingWindow.focus();
		return;
	}

	const appSession = getAppSession();
	const window = new BrowserWindow({
		width: 1040,
		height: 820,
		minWidth: 720,
		minHeight: 520,
		show: false,
		title: "Design Tokens",
		backgroundColor: "#f8fafc",
		parent: mainWindow ?? undefined,
		webPreferences: {
			session: appSession,
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
		},
	});

	tokenReferenceWindows.set(normalizedSystemId, window);
	installNavigationGuards(window, rendererOrigin);

	window.on("closed", () => {
		if (tokenReferenceWindows.get(normalizedSystemId) === window) {
			tokenReferenceWindows.delete(normalizedSystemId);
		}
	});
	window.once("ready-to-show", () => {
		window.show();
	});
	window.webContents.on("did-fail-load", (_event, _code, description) => {
		showDesktopError("Failed to load design tokens", description);
	});

	await window.loadURL(
		appUrl(
			`/api/trickroom/tailwind/systems/${encodeURIComponent(
				normalizedSystemId,
			)}/tokens.html`,
		),
	);
};

const registerIpcHandlers = () => {
	ipcMain.handle("trickroom:pick-project-folder", async (event) => {
		assertTrustedIpcSender(event);
		return pickProjectFolder();
	});
	ipcMain.handle(
		"trickroom:pick-css-file",
		async (event, projectRoot: string) => {
			assertTrustedIpcSender(event);
			return pickCssFile(projectRoot);
		},
	);
	ipcMain.handle(
		"trickroom:pick-asset-file",
		async (event, projectRoot: string) => {
			assertTrustedIpcSender(event);
			return pickAssetFile(projectRoot);
		},
	);
	ipcMain.handle("trickroom:get-mcp-helper-path", (event) => {
		assertTrustedIpcSender(event);
		return getMcpHelperPath();
	});
	ipcMain.handle("trickroom:clipboard-write", (event, text: string) => {
		assertTrustedIpcSender(event);
		clipboard.writeText(text);
	});
	ipcMain.handle("trickroom:clipboard-read", (event) => {
		assertTrustedIpcSender(event);
		return clipboard.readText();
	});
	ipcMain.handle(
		"trickroom:open-design-tokens",
		async (event, systemId: string) => {
			assertTrustedIpcSender(event);
			if (typeof systemId !== "string") {
				throw new Error("System id is required.");
			}
			await openTokenReferenceWindow(systemId);
		},
	);
};

const requestBackend = async (path: string, init: RequestInit = {}) => {
	if (!backendReady) {
		throw new Error("Trickroom backend is not ready.");
	}

	const url = new URL(path, backendReady.url);
	const headers = new Headers(init.headers);
	for (const [name, value] of Object.entries(
		createSessionAuthHeaders(sessionToken),
	)) {
		headers.set(name, value);
	}
	return fetch(url, {
		...init,
		headers,
	});
};

const openProjectFromMain = async (projectRoot: string) => {
	const response = await requestBackend("/api/trickroom/projects/open", {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({ path: projectRoot }),
	});

	if (!response.ok) {
		throw new Error(`Failed to open project: HTTP ${response.status}`);
	}

	await mainWindow?.loadURL(appUrl());
};

const handleDeeplinkUrl = async (rawUrl: string) => {
	const url = normalizeTrickroomDeeplinkUrl(rawUrl);
	if (!isTrickroomDeeplinkUrl(url)) {
		return;
	}

	if (!mainWindow || !backendReady) {
		pendingDeeplinkUrl = url;
		return;
	}

	const response = await requestBackend("/api/trickroom/deeplink/open", {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({ uri: url }),
	});

	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			error?: string;
		} | null;
		throw new Error(
			body?.error ?? `Failed to open design link: HTTP ${response.status}`,
		);
	}

	const payload = (await response.json()) as { designId: string };
	await mainWindow.loadURL(appUrl(`/design/${payload.designId}`));
	focusExistingWindow();
};

const queueDeeplinkUrl = (rawUrl: string) => {
	const url = normalizeTrickroomDeeplinkUrl(rawUrl);
	if (!isTrickroomDeeplinkUrl(url)) {
		return;
	}

	if (app.isReady() && backendReady && mainWindow) {
		void handleDeeplinkUrl(url).catch((error) => {
			showDesktopError("Failed to open design link", error);
		});
		return;
	}

	pendingDeeplinkUrl = url;
};

const closeProjectFromMain = async () => {
	const response = await requestBackend("/api/trickroom/projects/close", {
		method: "POST",
	});

	if (!response.ok) {
		throw new Error(`Failed to close project: HTTP ${response.status}`);
	}

	await mainWindow?.loadURL(appUrl());
};

const showDesktopError = (title: string, error: unknown) => {
	const detail = error instanceof Error ? error.message : String(error);
	console.error(`${title}: ${detail}`);
	dialog.showErrorBox(title, detail);
};

const installMenu = () => {
	const template: MenuItemConstructorOptions[] = [
		...(process.platform === "darwin"
			? [
					{
						label: app.name,
						submenu: [
							{ role: "about" as const },
							{ type: "separator" as const },
							{ role: "hide" as const },
							{ role: "hideOthers" as const },
							{ role: "unhide" as const },
							{ type: "separator" as const },
							{ role: "quit" as const },
						],
					},
				]
			: []),
		{
			label: "File",
			submenu: [
				{
					label: "Open Project",
					accelerator: "CmdOrCtrl+O",
					click: async () => {
						try {
							const result = await pickProjectFolder();
							if (!result.canceled) {
								await openProjectFromMain(result.path);
							}
						} catch (error) {
							showDesktopError("Failed to open project", error);
						}
					},
				},
				{
					label: "New Project",
					click: async () => {
						if (backendReady) {
							await mainWindow?.loadURL(appUrl("/new"));
						}
					},
				},
				{
					label: "Close Project",
					click: async () => {
						try {
							await closeProjectFromMain();
						} catch (error) {
							showDesktopError("Failed to close project", error);
						}
					},
				},
				{ type: "separator" },
				process.platform === "darwin" ? { role: "close" } : { role: "quit" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "pasteAndMatchStyle" },
				{ role: "delete" },
				{ type: "separator" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				...(process.env.TRICKROOM_ELECTRON_DEVTOOLS === "1"
					? [{ role: "toggleDevTools" as const }]
					: []),
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
			],
		},
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const createMainWindow = async (initialProjectRoot: string | null) => {
	if (!backendReady) {
		sessionToken = createSessionToken();
		backendReady = devRendererUrl
			? await createDevBackendReady(devRendererUrl)
			: await backendSupervisor.start({
					appRoot: getRuntimeRoot(),
					backendEntry: getBackendEntryPath(),
					initialProjectRoot,
					sessionToken,
					onExit: (code, signal) => {
						if (isQuitting) {
							return;
						}
						showDesktopError(
							"Trickroom backend exited",
							`The backend process exited unexpectedly. code=${String(
								code,
							)} signal=${String(signal)}`,
						);
					},
				});
		rendererUrl = devRendererUrl
			? normalizeRendererUrl(devRendererUrl).href
			: backendReady.url;
		rendererOrigin = new URL(rendererUrl).origin;
	}

	const appSession = getAppSession();
	installPermissionPolicy(appSession);
	installSessionAuthHeader(appSession, backendReady.origin, sessionToken);
	if (!devRendererUrl) {
		installContentSecurityPolicy(appSession, backendReady.origin);
	}

	const window = new BrowserWindow({
		width: 1280,
		height: 860,
		minWidth: 1024,
		minHeight: 680,
		show: false,
		title: "Trickroom",
		backgroundColor: "#ffffff",
		webPreferences: {
			session: appSession,
			preload: getPreloadPath(),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
		},
	});

	mainWindow = window;
	installNavigationGuards(window, rendererOrigin);

	window.on("closed", () => {
		if (mainWindow === window) {
			mainWindow = null;
		}
	});

	window.once("ready-to-show", () => {
		if (!smokeMode) {
			window.show();
		}
	});

	window.webContents.on("did-fail-load", (_event, _code, description) => {
		showDesktopError("Failed to load Trickroom", description);
	});

	if (smokeMode) {
		window.webContents.once("did-finish-load", async () => {
			try {
				const response = await requestBackend("/api/trickroom/session");
				if (!response.ok) {
					console.error(
						`Electron smoke session check failed with HTTP ${response.status}.`,
					);
				}
				app.exit(response.ok ? 0 : 1);
			} catch (error) {
				console.error(
					error instanceof Error
						? (error.stack ?? error.message)
						: String(error),
				);
				app.exit(1);
			}
		});
	}

	if (devRendererUrl && initialProjectRoot) {
		const response = await requestBackend("/api/trickroom/projects/open", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({ path: initialProjectRoot }),
		});
		if (!response.ok) {
			throw new Error(`Failed to open project: HTTP ${response.status}`);
		}
	}

	await window.loadURL(appUrl());
	installMenu();
};

const focusExistingWindow = () => {
	if (!mainWindow) {
		return;
	}

	if (mainWindow.isMinimized()) {
		mainWindow.restore();
	}
	mainWindow.focus();
};

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
	app.quit();
} else {
	registerTrickroomProtocol();
	registerIpcHandlers();

	if (process.platform === "darwin") {
		app.on("open-url", (event, url) => {
			event.preventDefault();
			queueDeeplinkUrl(url);
		});
	}

	app.on("second-instance", async (_event, argv, cwd) => {
		focusExistingWindow();
		const deeplink = findTrickroomDeeplinkInArgs(getElectronUserArgs(argv));
		if (deeplink) {
			try {
				await handleDeeplinkUrl(deeplink);
			} catch (error) {
				showDesktopError("Failed to open design link", error);
			}
			return;
		}

		const projectRoot = resolveInitialProjectRootFromArgs(argv, cwd);
		if (!projectRoot) {
			return;
		}

		try {
			validateProjectRoot(projectRoot);
			await openProjectFromMain(projectRoot);
		} catch (error) {
			showDesktopError("Failed to open project", error);
		}
	});

	app
		.whenReady()
		.then(async () => {
			const initialDeeplink =
				pendingDeeplinkUrl ??
				findTrickroomDeeplinkInArgs(getElectronUserArgs());
			const initialProjectRoot = initialDeeplink
				? null
				: resolveInitialProjectRootFromArgs();
			if (initialProjectRoot) {
				validateProjectRoot(initialProjectRoot);
			}

			await createMainWindow(initialProjectRoot);

			if (initialDeeplink) {
				try {
					await handleDeeplinkUrl(initialDeeplink);
				} catch (error) {
					showDesktopError("Failed to open design link", error);
				} finally {
					pendingDeeplinkUrl = null;
				}
			}
		})
		.catch((error) => {
			showDesktopError("Failed to start Trickroom", error);
			app.exit(1);
		});

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0 && backendReady) {
			void createMainWindow(null).catch((error) => {
				showDesktopError("Failed to start Trickroom", error);
			});
		}
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") {
			app.quit();
		}
	});

	app.on("before-quit", (event) => {
		if (isQuitting) {
			return;
		}

		event.preventDefault();
		void backendSupervisor.stop().finally(() => {
			isQuitting = true;
			app.quit();
		});
	});
}
