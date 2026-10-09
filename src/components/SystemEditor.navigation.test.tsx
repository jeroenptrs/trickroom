// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TailwindSyncController } from "../hooks/useTailwindSyncController";
import { systemsProjectQueryKey } from "../queries/systems";
import {
	componentDraftStore,
	hasUnsavedComponentDraft,
	resetComponentDraftStore,
	updateTemplateNodeClassName,
} from "../stores/component-draft-store";
import { resetComponentEditorSession } from "../stores/component-editor-session-store";
import { resetEditorChrome } from "../stores/editor-chrome-store";
import { buildSystemComponentPath } from "../utils/system-deep-link";
import { TailwindSyncControllerContext } from "./contexts";
import { SystemEditor } from "./SystemEditor";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const now = "2026-05-26T00:00:00.000Z";
const syncController: TailwindSyncController = {
	isIdle: true,
	isPending: false,
	isSuccess: false,
	isPartialError: false,
	isError: false,
	results: {},
	statusBySystem: { core: "success" },
	targetsById: {
		core: { systemId: "core", systemName: "Core", cssPath: "styles/core.css" },
	},
	systems: [
		{ systemId: "core", systemName: "Core", cssPath: "styles/core.css" },
	],
	syncAll: async () => {},
	syncSystem: async () => {},
};

const component = (id: string, name: string, baseVersion?: string) => ({
	summary: {
		componentId: id,
		slug: name.toLowerCase(),
		name,
		hasDraft: true,
		hasPublished: true,
		currentVersion: "5",
		createdAt: now,
		updatedAt: now,
	},
	record: {
		componentId: id,
		slug: name.toLowerCase(),
		name,
		createdAt: now,
		updatedAt: now,
		draft: {
			...(baseVersion ? { baseVersion } : {}),
			root: {
				library: "trickroom",
				component: "container",
				path: "root",
				children: [
					{
						library: "trickroom",
						component: "container",
						path: "popup",
						children: [],
					},
				],
			},
		},
		published: { currentVersion: "5", versions: {} },
	},
});

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(path: string, baseVersion?: string) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false },
		},
	});
	queryClient.setQueryData(systemsProjectQueryKey(), {
		systems: [
			{ systemId: "core", systemName: "Core", cssPath: "styles/core.css" },
		],
	});
	const entries = [
		component("cmp_a", "Alpha", baseVersion),
		component("cmp_b", "Beta", baseVersion),
	];
	queryClient.setQueryData(["trickroom-system-components", "core"], {
		systemId: "core",
		systemName: "Core",
		revision: "sha256:components-test",
		updatedAt: now,
		components: entries.map((entry) => entry.summary),
	});
	for (const entry of entries) {
		queryClient.setQueryData(
			["trickroom-system-component", "core", entry.summary.componentId],
			{
				systemId: "core",
				systemName: "Core",
				revision: "sha256:components-test",
				updatedAt: now,
				componentId: entry.summary.componentId,
				record: entry.record,
				valid: true,
				diagnostics: [],
			},
		);
	}
	const router = createMemoryRouter(
		[{ path: "/system/:systemId", element: <SystemEditor /> }],
		{ initialEntries: [path] },
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root?.render(
			<QueryClientProvider client={queryClient}>
				<TailwindSyncControllerContext.Provider value={syncController}>
					<RouterProvider router={router} />
				</TailwindSyncControllerContext.Provider>
			</QueryClientProvider>,
		);
	});
	return router;
}

const flush = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});

const button = (label: string) =>
	[...document.body.querySelectorAll("button, [role=tab]")].find(
		(element) => element.textContent?.trim() === label,
	) as HTMLElement | undefined;

const click = async (label: string) => {
	const target = button(label);
	expect(target, `button "${label}"`).toBeDefined();
	await act(async () => {
		target?.click();
	});
	await flush();
};

describe("SystemEditor URL navigation", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("Not found", { status: 404 })),
		);
		resetComponentDraftStore();
		resetComponentEditorSession();
		resetEditorChrome();
	});

	afterEach(() => {
		act(() => root?.unmount());
		container?.remove();
		root = null;
		container = null;
		vi.unstubAllGlobals();
	});

	it("asks before a URL change drops unsaved edits, and cancel restores the URL", async () => {
		const router = mount("/system/core?component=cmp_a");
		await flush();
		expect(componentDraftStore.get().componentId).toBe("cmp_a");
		act(() => updateTemplateNodeClassName("root", "p-2"));
		expect(hasUnsavedComponentDraft()).toBe(true);

		await act(async () => {
			await router.navigate("/system/core?component=cmp_b");
		});
		await flush();
		expect(document.body.textContent).toContain("Discard unsaved changes?");
		// Nothing was dropped while the question is open.
		expect(componentDraftStore.get().componentId).toBe("cmp_a");
		expect(hasUnsavedComponentDraft()).toBe(true);

		await click("Cancel");
		expect(document.body.textContent).not.toContain("Discard unsaved changes?");
		expect(router.state.location.search).toBe("?component=cmp_a");
		expect(componentDraftStore.get().componentId).toBe("cmp_a");
		expect(hasUnsavedComponentDraft()).toBe(true);
	});

	it("discards the edits and opens the other component when asked to", async () => {
		const router = mount("/system/core?component=cmp_a");
		await flush();
		act(() => updateTemplateNodeClassName("root", "p-2"));

		await act(async () => {
			await router.navigate("/system/core?component=cmp_b");
		});
		await flush();
		await click("Discard changes");
		expect(document.body.textContent).not.toContain("Discard unsaved changes?");
		expect(router.state.location.search).toBe("?component=cmp_b");
		expect(componentDraftStore.get().componentId).toBe("cmp_b");
		expect(hasUnsavedComponentDraft()).toBe(false);
	});

	it("does not ask when nothing is unsaved", async () => {
		const router = mount("/system/core?component=cmp_a");
		await flush();
		await act(async () => {
			await router.navigate("/system/core?component=cmp_b");
		});
		await flush();
		expect(document.body.textContent).not.toContain("Discard unsaved changes?");
		expect(componentDraftStore.get().componentId).toBe("cmp_b");
	});

	it("returns to the Lint tab with Back after following a component link", async () => {
		const router = mount("/system/core");
		await flush();
		await click("Lint");
		expect(router.state.location.search).toBe("?tab=lint");
		expect(document.body.textContent).toContain("Run lint");

		await act(async () => {
			await router.navigate(
				buildSystemComponentPath("core", "cmp_a", {
					version: "5",
					path: "root",
				}),
			);
		});
		await flush();
		expect(document.body.textContent).toContain("Alpha");
		expect(document.body.textContent).not.toContain("Run lint");

		await act(async () => {
			await router.navigate(-1);
		});
		await flush();
		expect(router.state.location.search).toBe("?tab=lint");
		expect(document.body.textContent).toContain("Run lint");
	});

	it("selects the linked node only when the loaded draft is over the finding's version", async () => {
		const over5 = mount("/system/core", "5");
		await flush();
		await act(async () => {
			await over5.navigate(
				buildSystemComponentPath("core", "cmp_a", {
					version: "5",
					path: "popup",
				}),
			);
		});
		await flush();
		expect(componentDraftStore.get().selectedPath).toBe("popup");

		act(() => root?.unmount());
		container?.remove();
		resetComponentDraftStore();
		resetComponentEditorSession();

		const over4 = mount("/system/core", "4");
		await flush();
		await act(async () => {
			await over4.navigate(
				buildSystemComponentPath("core", "cmp_a", {
					version: "5",
					path: "popup",
				}),
			);
		});
		await flush();
		expect(componentDraftStore.get().componentId).toBe("cmp_a");
		expect(componentDraftStore.get().selectedPath).toBeNull();
	});
});
