import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	syncTailwindTokens,
	type TailwindSyncTokensResponse,
} from "../queries/tailwind-sync-tokens";
import type { TrickroomConfig } from "../types";
import {
	buildOrderedSystems,
	deriveTailwindSyncFlags,
	type TailwindSyncController,
	useTailwindSyncController,
} from "./useTailwindSyncController";

vi.mock("../queries/tailwind-sync-tokens", () => ({
	syncTailwindTokens: vi.fn(),
}));

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
};

class MinimalDomNode {
	nodeType: number;
	nodeName: string;
	tagName: string;
	namespaceURI = "http://www.w3.org/1999/xhtml";
	ownerDocument: MinimalDomNode | null = null;
	parentNode: MinimalDomNode | null = null;
	childNodes: MinimalDomNode[] = [];

	constructor(nodeType: number, nodeName: string) {
		this.nodeType = nodeType;
		this.nodeName = nodeName;
		this.tagName = nodeName;
	}

	addEventListener() {}

	removeEventListener() {}

	appendChild(child: MinimalDomNode) {
		this.childNodes.push(child);
		child.parentNode = this;
		return child;
	}

	insertBefore(child: MinimalDomNode, before: MinimalDomNode | null) {
		child.parentNode = this;
		if (!before) {
			this.childNodes.push(child);
			return child;
		}

		const beforeIndex = this.childNodes.indexOf(before);
		if (beforeIndex === -1) {
			this.childNodes.push(child);
			return child;
		}

		this.childNodes.splice(beforeIndex, 0, child);
		return child;
	}

	removeChild(child: MinimalDomNode) {
		this.childNodes = this.childNodes.filter((node) => node !== child);
		child.parentNode = null;
		return child;
	}
}

const syncTailwindTokensMock = vi.mocked(syncTailwindTokens);

const mountedRoots: Root[] = [];

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});

	return { promise, resolve, reject };
}

function syncResponse(
	systemName: string,
	cssPath: string,
	overrides: Partial<TailwindSyncTokensResponse> = {},
): TailwindSyncTokensResponse {
	return {
		status: "ok",
		systemName,
		cssPath,
		tailwindBaselineVersion: "4.2.4",
		tokens: [],
		baselineDiff: {
			added: [],
			overridden: [],
			unchanged: [],
			removed: [],
			missingDefaultTokenNames: [],
		},
		syncedAt: "2026-05-03T12:00:00.000Z",
		reviewRequired: false,
		...overrides,
	};
}

function createMinimalContainer() {
	const documentNode = new MinimalDomNode(9, "#document");
	documentNode.namespaceURI = "";
	const documentElement = new MinimalDomNode(1, "HTML");
	const body = new MinimalDomNode(1, "BODY");
	const container = new MinimalDomNode(1, "DIV");

	documentElement.ownerDocument = documentNode;
	body.ownerDocument = documentNode;
	container.ownerDocument = documentNode;
	documentNode.childNodes = [documentElement];

	return Object.assign(container, {
		ownerDocument: Object.assign(documentNode, {
			activeElement: body,
			body,
			createElement: (tagName: string) => {
				const element = new MinimalDomNode(1, tagName.toUpperCase());
				element.ownerDocument = documentNode;
				return element;
			},
			defaultView: globalThis,
			documentElement,
		}),
	});
}

async function flushPromises() {
	await act(async () => {
		await Promise.resolve();
	});
}

async function mountController(
	config: TrickroomConfig,
	onUpdate?: (controller: TailwindSyncController) => void,
) {
	const snapshots: TailwindSyncController[] = [];
	let currentController: TailwindSyncController | undefined;

	function TestComponent() {
		const controller = useTailwindSyncController(config);
		currentController = controller;
		snapshots.push(controller);
		onUpdate?.(controller);
		return null;
	}

	const root = createRoot(createMinimalContainer() as unknown as Element);
	mountedRoots.push(root);

	await act(async () => {
		root.render(React.createElement(TestComponent));
	});

	return {
		get controller() {
			if (!currentController) {
				throw new Error("Controller was not mounted");
			}
			return currentController;
		},
		snapshots,
	};
}

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	Object.assign(globalThis, {
		document: createMinimalContainer().ownerDocument,
		HTMLElement: MinimalDomNode,
		HTMLIFrameElement: class HTMLIFrameElement {},
		window: globalThis,
	});
	syncTailwindTokensMock.mockReset();
});

afterEach(async () => {
	for (const root of mountedRoots.splice(0)) {
		await act(async () => {
			root.unmount();
		});
	}
});

describe("buildOrderedSystems", () => {
	it("keeps insertion order and trims names and paths", () => {
		const systems = buildOrderedSystems({
			name: "Demo",
			systems: {
				" Core ": " src/core.css ",
				" Marketing ": " src/marketing.css ",
			},
		});

		expect(systems).toEqual([
			{ systemName: "Core", cssPath: "src/core.css" },
			{ systemName: "Marketing", cssPath: "src/marketing.css" },
		]);
	});

	it("omits empty names and paths", () => {
		const systems = buildOrderedSystems({
			name: "Demo",
			systems: {
				Core: " ",
				" ": "src/unused.css",
				Marketing: "src/marketing.css",
			},
		});

		expect(systems).toEqual([
			{ systemName: "Marketing", cssPath: "src/marketing.css" },
		]);
	});
});

describe("deriveTailwindSyncFlags", () => {
	it("is idle when no systems are configured", () => {
		expect(deriveTailwindSyncFlags({})).toEqual({
			isIdle: true,
			isPending: false,
			isSuccess: false,
			isPartialError: false,
			isError: false,
		});
	});

	it("is pending if at least one system is pending", () => {
		expect(
			deriveTailwindSyncFlags({
				Core: "pending",
				Marketing: "idle",
			}),
		).toMatchObject({
			isPending: true,
			isIdle: false,
		});
	});

	it("is success only when all systems are successful or updated", () => {
		expect(
			deriveTailwindSyncFlags({
				Core: "success",
				Marketing: "updated",
			}),
		).toMatchObject({
			isSuccess: true,
			isPartialError: false,
			isError: false,
		});
	});

	it("is partial error when some systems fail and some succeed or update", () => {
		expect(
			deriveTailwindSyncFlags({
				Core: "updated",
				Marketing: "error",
			}),
		).toMatchObject({
			isPartialError: true,
			isError: false,
		});
	});

	it("is error when all completed systems fail", () => {
		expect(
			deriveTailwindSyncFlags({
				Core: "error",
				Marketing: "error",
			}),
		).toMatchObject({
			isError: true,
			isPartialError: false,
		});
	});
});

describe("useTailwindSyncController", () => {
	it("syncs each configured system once on startup and never concurrently", async () => {
		const config = {
			name: "Demo",
			systems: {
				Core: "src/core.css",
				Marketing: "src/marketing.css",
				Product: "src/product.css",
			},
		};
		const deferredBySystem = new Map([
			["Core", createDeferred<ReturnType<typeof syncResponse>>()],
			["Marketing", createDeferred<ReturnType<typeof syncResponse>>()],
			["Product", createDeferred<ReturnType<typeof syncResponse>>()],
		]);
		const activeSystems = new Set<string>();
		let maxConcurrentCalls = 0;

		syncTailwindTokensMock.mockImplementation(async (request) => {
			const systemName = "systemName" in request ? request.systemName : "";
			const deferred = deferredBySystem.get(systemName);
			if (!deferred) {
				throw new Error(`Unexpected system ${systemName}`);
			}

			activeSystems.add(systemName);
			maxConcurrentCalls = Math.max(maxConcurrentCalls, activeSystems.size);
			try {
				return await deferred.promise;
			} finally {
				activeSystems.delete(systemName);
			}
		});

		const mounted = await mountController(config);

		expect(syncTailwindTokensMock).toHaveBeenCalledTimes(1);
		expect(syncTailwindTokensMock).toHaveBeenLastCalledWith({
			systemName: "Core",
		});
		expect(mounted.controller.statusBySystem).toEqual({
			Core: "pending",
			Marketing: "idle",
			Product: "idle",
		});

		deferredBySystem.get("Core")?.resolve(syncResponse("Core", "src/core.css"));
		await flushPromises();

		expect(syncTailwindTokensMock).toHaveBeenCalledTimes(2);
		expect(syncTailwindTokensMock).toHaveBeenLastCalledWith({
			systemName: "Marketing",
		});
		expect(mounted.controller.statusBySystem).toEqual({
			Core: "success",
			Marketing: "pending",
			Product: "idle",
		});

		deferredBySystem
			.get("Marketing")
			?.resolve(syncResponse("Marketing", "src/marketing.css"));
		await flushPromises();

		expect(syncTailwindTokensMock).toHaveBeenCalledTimes(3);
		expect(syncTailwindTokensMock).toHaveBeenLastCalledWith({
			systemName: "Product",
		});
		expect(mounted.controller.statusBySystem).toEqual({
			Core: "success",
			Marketing: "success",
			Product: "pending",
		});

		deferredBySystem
			.get("Product")
			?.resolve(syncResponse("Product", "src/product.css"));
		await flushPromises();

		expect(syncTailwindTokensMock).toHaveBeenCalledTimes(3);
		expect(maxConcurrentCalls).toBe(1);
		expect(mounted.controller.statusBySystem).toEqual({
			Core: "success",
			Marketing: "success",
			Product: "success",
		});
		expect(mounted.controller).toMatchObject({
			isIdle: false,
			isPending: false,
			isSuccess: true,
			isPartialError: false,
			isError: false,
		});
	});

	it("stays idle and does not call the sync API when no systems are configured", async () => {
		const mounted = await mountController({
			name: "Demo",
			systems: {},
		});

		expect(syncTailwindTokensMock).not.toHaveBeenCalled();
		expect(mounted.controller.statusBySystem).toEqual({});
		expect(mounted.controller.results).toEqual({});
		expect(mounted.controller).toMatchObject({
			isIdle: true,
			isPending: false,
			isSuccess: false,
			isPartialError: false,
			isError: false,
		});
	});

	it("records a failed system, continues later systems, and reports partial failure", async () => {
		const config = {
			name: "Demo",
			systems: {
				Core: "src/core.css",
				Marketing: "src/marketing.css",
				Product: "src/product.css",
			},
		};
		const failedSync = new Error("Marketing sync failed");

		syncTailwindTokensMock.mockImplementation(async (request) => {
			if (!("systemName" in request)) {
				throw new Error("Expected systemName request");
			}

			if (request.systemName === "Marketing") {
				throw failedSync;
			}

			return syncResponse(
				request.systemName,
				config.systems[request.systemName as keyof typeof config.systems],
			);
		});

		const mounted = await mountController(config);
		await flushPromises();

		expect(syncTailwindTokensMock).toHaveBeenCalledTimes(3);
		expect(
			syncTailwindTokensMock.mock.calls.map(([request]) => request),
		).toEqual([
			{ systemName: "Core" },
			{ systemName: "Marketing" },
			{ systemName: "Product" },
		]);
		expect(mounted.controller.statusBySystem).toEqual({
			Core: "success",
			Marketing: "error",
			Product: "success",
		});
		expect(mounted.controller).toMatchObject({
			isIdle: false,
			isPending: false,
			isSuccess: false,
			isPartialError: true,
			isError: false,
		});
		expect(mounted.controller.results.Marketing).toEqual({
			status: "error",
			error: failedSync,
		});
	});

	it("prepares per-system result data for future notification UI", async () => {
		syncTailwindTokensMock.mockImplementation(async (request) => {
			if (!("systemName" in request)) {
				throw new Error("Expected systemName request");
			}

			return syncResponse(
				request.systemName,
				request.systemName === "Core" ? "src/core.css" : "src/marketing.css",
			);
		});

		const mounted = await mountController({
			name: "Demo",
			systems: {
				Core: "src/core.css",
				Marketing: "src/marketing.css",
			},
		});
		await flushPromises();

		expect(mounted.controller.results).toEqual({
			Core: {
				status: "success",
				data: syncResponse("Core", "src/core.css"),
			},
			Marketing: {
				status: "success",
				data: syncResponse("Marketing", "src/marketing.css"),
			},
		});
		expect(Object.keys(mounted.controller.results)).toEqual([
			"Core",
			"Marketing",
		]);
	});

	it("sets status to updated when the API returns updated", async () => {
		syncTailwindTokensMock.mockResolvedValue(
			syncResponse("Core", "src/core.css", { status: "updated" }),
		);

		const mounted = await mountController({
			name: "Demo",
			systems: { Core: "src/core.css" },
		});
		await flushPromises();

		expect(mounted.controller.statusBySystem.Core).toBe("updated");
		expect(mounted.controller.results.Core.status).toBe("updated");
	});

	it("threads reviewRequired through result.data without coupling it to the controller status", async () => {
		// Two systems: one returns status='ok' but reviewRequired=true, the other
		// returns status='updated' with reviewRequired=false. The controller
		// status should still come from sync `status`, while `reviewRequired` is
		// exposed via the result data so the UI can drive review/warning state
		// from it independently.
		syncTailwindTokensMock.mockImplementation(async (request) => {
			if (!("systemName" in request)) {
				throw new Error("Expected systemName request");
			}

			if (request.systemName === "Core") {
				return {
					status: "ok",
					systemName: "Core",
					cssPath: "src/core.css",
					tailwindBaselineVersion: "4.2.4",
					syncedAt: "2026-05-03T12:00:00.000Z",
					reviewRequired: true,
					tokens: [],
					baselineDiff: {
						added: [],
						overridden: [],
						unchanged: [],
						removed: [],
						missingDefaultTokenNames: [],
					},
				};
			}

			return {
				status: "updated",
				systemName: "Marketing",
				cssPath: "src/marketing.css",
				tailwindBaselineVersion: "4.2.4",
				syncedAt: "2026-05-03T12:00:00.000Z",
				reviewRequired: false,
				tokens: [],
				baselineDiff: {
					added: [],
					overridden: [],
					unchanged: [],
					removed: [],
					missingDefaultTokenNames: [],
				},
			};
		});

		const mounted = await mountController({
			name: "Demo",
			systems: {
				Core: "src/core.css",
				Marketing: "src/marketing.css",
			},
		});
		await flushPromises();

		expect(mounted.controller.statusBySystem).toEqual({
			Core: "success",
			Marketing: "updated",
		});
		expect(mounted.controller.results.Core.data?.reviewRequired).toBe(true);
		expect(mounted.controller.results.Marketing.data?.reviewRequired).toBe(
			false,
		);
	});

	it("re-running syncSystem refreshes a single system's data without re-syncing the others", async () => {
		// Simulates the post save-and-confirm flow: after the save mutation
		// success, Systems.tsx invalidates the stored-token query AND calls
		// syncController.syncSystem(systemName) so any stale review/warning
		// indicators clear once the server reports reviewRequired=false.
		const responsesByCall = new Map<number, boolean>([
			[1, true], // Core initial sync
			[2, false], // Marketing initial sync
			[3, false], // Re-run for Core after save-and-confirm
		]);

		syncTailwindTokensMock.mockImplementation(async (request) => {
			if (!("systemName" in request)) {
				throw new Error("Expected systemName request");
			}

			const callIndex = syncTailwindTokensMock.mock.calls.length;
			const reviewRequired = responsesByCall.get(callIndex) ?? false;
			return {
				status: reviewRequired ? "ok" : "updated",
				systemName: request.systemName,
				cssPath:
					request.systemName === "Core" ? "src/core.css" : "src/marketing.css",
				tailwindBaselineVersion: "4.2.4",
				syncedAt: "2026-05-03T12:00:00.000Z",
				reviewRequired,
				tokens: [],
				baselineDiff: {
					added: [],
					overridden: [],
					unchanged: [],
					removed: [],
					missingDefaultTokenNames: [],
				},
			};
		});

		const mounted = await mountController({
			name: "Demo",
			systems: {
				Core: "src/core.css",
				Marketing: "src/marketing.css",
			},
		});
		await flushPromises();

		expect(syncTailwindTokensMock).toHaveBeenCalledTimes(2);
		expect(mounted.controller.results.Core.data?.reviewRequired).toBe(true);

		await act(async () => {
			await mounted.controller.syncSystem("Core");
		});

		expect(syncTailwindTokensMock).toHaveBeenCalledTimes(3);
		expect(syncTailwindTokensMock).toHaveBeenLastCalledWith({
			systemName: "Core",
		});
		expect(mounted.controller.results.Core.data?.reviewRequired).toBe(false);
		// Marketing was untouched by the targeted refresh.
		expect(mounted.controller.results.Marketing.data?.reviewRequired).toBe(
			false,
		);
	});
});
