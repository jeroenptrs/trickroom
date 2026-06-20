import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TailwindSyncController } from "../hooks/useTailwindSyncController";
import { systemsProjectQueryKey } from "../queries/systems";
import { TailwindSyncControllerContext } from "./contexts";
import { SystemEditor } from "./SystemEditor";

const routeElement = <SystemEditor />;
const syncControllerMock: TailwindSyncController = {
	isIdle: true,
	isPending: false,
	isSuccess: false,
	isPartialError: false,
	isError: false,
	results: {},
	statusBySystem: { core: "success" },
	targetsById: {
		core: {
			systemId: "core",
			systemName: "Core",
			cssPath: "styles/core.css",
		},
	},
	systems: [
		{
			systemId: "core",
			systemName: "Core",
			cssPath: "styles/core.css",
		},
	],
	syncAll: async () => {},
	syncSystem: async () => {},
};

const manifestRevision = "sha256:components-test";

function createFetchMock() {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;

		if (
			url.endsWith("/api/trickroom/systems/core/components") &&
			method === "GET"
		) {
			return new Response(
				JSON.stringify({
					systemId: "core",
					systemName: "Core",
					revision: manifestRevision,
					updatedAt: "2026-05-26T00:00:00.000Z",
					components: [],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}

		if (
			url.endsWith("/api/trickroom/systems/core/components") &&
			method === "POST"
		) {
			return new Response(
				JSON.stringify({
					systemId: "core",
					systemName: "Core",
					revision: "sha256:components-created",
					updatedAt: "2026-05-26T00:01:00.000Z",
					componentId: "cmp_new_button",
				}),
				{ status: 201, headers: { "content-type": "application/json" } },
			);
		}

		if (url.includes("/api/trickroom/systems/core/components/cmp_new_button")) {
			return new Response(
				JSON.stringify({
					systemId: "core",
					systemName: "Core",
					revision: "sha256:components-created",
					updatedAt: "2026-05-26T00:01:00.000Z",
					componentId: "cmp_new_button",
					valid: true,
					diagnostics: [],
					record: {
						componentId: "cmp_new_button",
						slug: body?.slug ?? "new-button",
						name: body?.name ?? "New Button",
						createdAt: "2026-05-26T00:01:00.000Z",
						updatedAt: "2026-05-26T00:01:00.000Z",
						draft: {
							root: {
								library: "trickroom",
								component: "container",
								children: [],
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}

		if (url.endsWith("/api/trickroom/tailwind/systems/core/tokens")) {
			return new Response(
				JSON.stringify({
					ok: true,
					systemId: "core",
					systemName: "Core",
					cssPath: "styles/core.css",
					syncedAt: "2026-05-26T00:00:00.000Z",
					tailwindBaselineVersion: "4",
					reviewRequired: false,
					domains: {
						color: {
							tokens: { primary: "#111111" },
							overrides: [],
							baselineDiff: { added: [], overridden: [], removed: [] },
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}

		if (url.endsWith("/api/trickroom/systems/core/assets")) {
			return new Response(
				JSON.stringify({
					systemId: "core",
					systemName: "Core",
					assets: [],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}

		if (url.endsWith("/api/trickroom/systems/core/icons")) {
			return new Response(
				JSON.stringify({
					systemId: "core",
					systemName: "Core",
					indexedAt: "2026-05-26T00:00:00.000Z",
					iconFolderPaths: [],
					icons: [],
					diagnostics: [],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}

		if (
			url.endsWith(
				"/api/trickroom/systems/core/components/cmp_button/variants",
			) &&
			method === "POST"
		) {
			return new Response(
				JSON.stringify({
					systemId: "core",
					systemName: "Core",
					revision: "sha256:components-variants",
					updatedAt: "2026-05-26T00:02:00.000Z",
					componentId: "cmp_button",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}

		if (
			url.endsWith("/api/trickroom/systems/core/components/cmp_button/draft") &&
			method === "POST"
		) {
			return new Response(
				JSON.stringify({
					systemId: "core",
					systemName: "Core",
					revision: "sha256:components-draft",
					updatedAt: "2026-05-26T00:02:00.000Z",
					componentId: "cmp_button",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}

		if (
			url.endsWith("/api/trickroom/systems/core/components/cmp_button") &&
			method === "DELETE"
		) {
			return new Response(
				JSON.stringify({
					systemId: "core",
					systemName: "Core",
					revision: "sha256:components-deleted",
					updatedAt: "2026-05-26T00:03:00.000Z",
					componentId: "cmp_button",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}

		return new Response("Not found", { status: 404 });
	});
}

function renderSystemEditor(
	path: string,
	components: Array<{
		componentId: string;
		slug: string;
		name: string;
		hasDraft: boolean;
		hasPublished: boolean;
		createdAt: string;
		updatedAt: string;
	}> = [],
) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	queryClient.setQueryData(systemsProjectQueryKey(), {
		systems: [
			{
				systemId: "core",
				systemName: "Core System",
				cssPath: "styles/core.css",
			},
		],
	});
	queryClient.setQueryData(["trickroom-system-components", "core"], {
		systemId: "core",
		systemName: "Core",
		revision: manifestRevision,
		updatedAt: "2026-05-26T00:00:00.000Z",
		components,
	});
	for (const component of components) {
		queryClient.setQueryData(
			["trickroom-system-component", "core", component.componentId],
			{
				systemId: "core",
				systemName: "Core",
				revision: manifestRevision,
				updatedAt: component.updatedAt,
				componentId: component.componentId,
				record: {
					componentId: component.componentId,
					slug: component.slug,
					name: component.name,
					createdAt: component.createdAt,
					updatedAt: component.updatedAt,
					draft: component.hasDraft
						? {
								root: {
									library: "trickroom",
									component: "container",
									path: "root",
									children: [],
								},
							}
						: undefined,
				},
				valid: true,
				diagnostics: [],
			},
		);
	}
	const router = createMemoryRouter(
		[
			{
				path: "/system/:systemId",
				element: routeElement,
			},
		],
		{
			initialEntries: [path],
		},
	);

	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<TailwindSyncControllerContext.Provider value={syncControllerMock}>
				<RouterProvider router={router} />
			</TailwindSyncControllerContext.Provider>
		</QueryClientProvider>,
	);
}

describe("SystemEditor", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", createFetchMock());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders title and workspace tabs without idle inspector chrome", () => {
		const html = renderSystemEditor("/system/core");

		expect(html).toContain("Core System");
		expect(html).toContain("Components");
		expect(html).toContain("Tokens");
		expect(html).toContain("Assets");
		expect(html).toContain("Icons");
		expect(html).toContain("w-[300px]");
		expect(html).not.toContain("Inspector");
		expect(html).toContain("No components yet");
	});

	it("shows an error message for unknown systems", () => {
		const html = renderSystemEditor("/system/unknown");

		expect(html).toContain("No system found for “unknown”.");
	});

	it("resolves a system by display name in the route param", () => {
		const html = renderSystemEditor("/system/Core%20System");

		expect(html).toContain("Core System");
		expect(html).not.toContain("No system found");
	});

	it("opens on the tokens tab from the route search param", () => {
		const html = renderSystemEditor("/system/core?tab=tokens");

		expect(html).toContain("Core Tokens");
		expect(html).toContain("Synced");
		expect(html).not.toContain("No components yet");
	});

	it("selects a component from the route search param", () => {
		const html = renderSystemEditor("/system/core?component=cmp_new_button", [
			{
				componentId: "cmp_new_button",
				slug: "new-button",
				name: "New Button",
				hasDraft: true,
				hasPublished: false,
				createdAt: "2026-05-26T00:01:00.000Z",
				updatedAt: "2026-05-26T00:01:00.000Z",
			},
		]);

		expect(html).toContain("New Button");
		expect(html).toContain("Draft only");
		expect(html).toContain("Save draft");
		expect(html).toContain("Variants");
		expect(html).not.toContain("Inspector");
		expect(html).not.toContain("Core System");
		expect(html).not.toContain("Tokens");
		expect(html).not.toContain("Select an item on the Components page");
	});
});

describe("SystemEditor page panels", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", createFetchMock());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("detects when a component draft has publishable changes", async () => {
		const { hasPublishableComponentDraftChanges } = await import(
			"./system-editor/SystemEditorComponentsPanel"
		);

		expect(
			hasPublishableComponentDraftChanges({
				hasDraft: true,
				hasPublishedVersion: false,
				draftTemplateHash: "sha256:draft",
				draftVariantSchemaHash: null,
			}),
		).toBe(true);
		expect(
			hasPublishableComponentDraftChanges({
				hasDraft: true,
				hasPublishedVersion: true,
				draftTemplateHash: "sha256:draft",
				draftVariantSchemaHash: null,
				publishedTemplateHash: "sha256:published",
				publishedVariantSchemaHash: null,
			}),
		).toBe(true);
		expect(
			hasPublishableComponentDraftChanges({
				hasDraft: true,
				hasPublishedVersion: true,
				draftTemplateHash: "sha256:same",
				draftVariantSchemaHash: "sha256:variants",
				publishedTemplateHash: "sha256:same",
				publishedVariantSchemaHash: "sha256:variants",
			}),
		).toBe(false);
		expect(
			hasPublishableComponentDraftChanges({
				hasDraft: false,
				hasPublishedVersion: true,
				draftTemplateHash: "sha256:draft",
				publishedTemplateHash: "sha256:published",
			}),
		).toBe(false);
	});

	it("exposes tokens browse copy on the tokens tab", async () => {
		const { SystemEditorComponentsRail } = await import(
			"./system-editor/SystemEditorComponentsPanel"
		);
		const { SystemEditorTokensPanel } = await import(
			"./system-editor/SystemEditorTokensPanel"
		);

		const panelQueryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		panelQueryClient.setQueryData(["trickroom-system-components", "core"], {
			systemId: "core",
			systemName: "Core",
			revision: manifestRevision,
			updatedAt: "2026-05-26T00:00:00.000Z",
			components: [],
		});
		panelQueryClient.setQueryData(["trickroom-tailwind-tokens", "core"], {
			ok: true,
			systemId: "core",
			systemName: "Core",
			cssPath: "styles/core.css",
			syncedAt: "2026-05-26T00:00:00.000Z",
			tailwindBaselineVersion: "4",
			reviewRequired: false,
			domains: {
				color: {
					tokens: { primary: "#111111" },
					overrides: [],
					baselineDiff: { added: [], overridden: [], removed: [] },
				},
			},
		});

		const componentsHtml = renderToStaticMarkup(
			<QueryClientProvider client={panelQueryClient}>
				<SystemEditorComponentsRail
					systemId="core"
					selectedComponentId={null}
					onSelectComponent={() => {}}
				/>
			</QueryClientProvider>,
		);
		const tokensHtml = renderToStaticMarkup(
			<QueryClientProvider client={panelQueryClient}>
				<TailwindSyncControllerContext.Provider value={syncControllerMock}>
					<SystemEditorTokensPanel systemId="core" />
				</TailwindSyncControllerContext.Provider>
			</QueryClientProvider>,
		);

		expect(componentsHtml).toContain("New component name");
		expect(componentsHtml).toContain("Search components");
		expect(tokensHtml).toContain("Core Tokens");
		expect(tokensHtml).toContain("Synced");
		expect(tokensHtml).toContain("GROUP BY");
		expect(tokensHtml).toContain("#111111");
		expect(tokensHtml).toContain("Hide defaults");
		expect(tokensHtml).toContain("Custom colors");
		expect(tokensHtml).toContain("Color Red");
		expect(tokensHtml).toContain("Font families");
		expect(tokensHtml).toContain("Text sizes");
		expect(tokensHtml).toContain("Font weights");
		expect(tokensHtml).toContain("Breakpoints");
		expect(tokensHtml).toContain("Containers");
		expect(tokensHtml).toContain("Radii");
		expect(tokensHtml).toContain("Shadows");
		expect(tokensHtml.indexOf("red-50")).toBeLessThan(
			tokensHtml.indexOf("red-100"),
		);
	});

	it("renders resource browser controls without dead view buttons", async () => {
		const { SystemEditorAssetsPanel } = await import(
			"./system-editor/SystemEditorAssetsPanel"
		);
		const { SystemEditorIconFoldersRail, SystemEditorIconsPanel } =
			await import("./system-editor/SystemEditorIconsPanel");
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		queryClient.setQueryData(["trickroom-system-assets", "core"], {
			systemId: "core",
			systemName: "Core",
			assets: [
				{
					id: "ast_app_icon",
					name: "App Icon",
					kind: "image",
					sourcePath: "assets/app-icon.png",
					mimeType: "image/png",
					width: 1024,
					height: 1024,
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
				{
					id: "ast_hero",
					name: "Hero",
					kind: "image",
					sourcePath: "assets/marketing/hero.jpg",
					mimeType: "image/jpeg",
					width: 1600,
					height: 900,
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
			],
		});
		queryClient.setQueryData(["trickroom-system-icons", "core"], {
			systemId: "core",
			systemName: "Core",
			indexedAt: "2026-05-26T00:00:00.000Z",
			iconFolderPaths: ["src/icons"],
			icons: [
				{
					id: "src/search",
					name: "search",
					sourcePath: "src/icons/search.svg",
					paint: "stroke",
					hash: "sha256:search",
				},
				{
					id: "src/menu",
					name: "menu",
					sourcePath: "src/icons/menu.svg",
					paint: "stroke",
					hash: "sha256:menu",
				},
			],
			diagnostics: [],
		});
		const scrollElementRef = { current: null };

		const assetsHtml = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<SystemEditorAssetsPanel
					systemId="core"
					scrollElementRef={scrollElementRef}
					selectedAssetId={null}
					onSelectAsset={() => {}}
				/>
			</QueryClientProvider>,
		);
		const iconsHtml = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<SystemEditorIconsPanel
					systemId="core"
					scrollElementRef={scrollElementRef}
					selectedIconId={null}
					onSelectIcon={() => {}}
				/>
			</QueryClientProvider>,
		);
		const iconFoldersHtml = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<SystemEditorIconFoldersRail systemId="core" />
			</QueryClientProvider>,
		);

		expect(assetsHtml).toContain("Assets");
		expect(assetsHtml).toContain("2 assets");
		expect(assetsHtml).toContain("Group folders");
		expect(assetsHtml).toContain("Add asset");
		expect(assetsHtml).not.toContain("Grid");
		expect(assetsHtml).not.toContain("List");
		expect(iconsHtml).toContain("Icons");
		expect(iconsHtml).toContain("2 icons");
		expect(iconsHtml).toContain("Group folders");
		expect(iconsHtml).not.toContain("Stroke");
		expect(iconsHtml).not.toContain("Mixed");
		expect(iconsHtml).not.toContain("Insert");
		expect(iconFoldersHtml).toContain("Icon folders");
		expect(iconFoldersHtml).toContain("src/icons");
		expect(iconFoldersHtml).toContain("Re-index");
		expect(iconFoldersHtml).toContain("Icon folder path");
	});

	it("creates a component draft through the component API", async () => {
		const fetchMock = createFetchMock();
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		queryClient.setQueryData(["trickroom-system-components", "core"], {
			systemId: "core",
			systemName: "Core",
			revision: manifestRevision,
			updatedAt: "2026-05-26T00:00:00.000Z",
			components: [],
		});

		const { SystemEditorComponentsRail } = await import(
			"./system-editor/SystemEditorComponentsPanel"
		);
		const { createSystemComponentDraft } = await import(
			"../queries/system-components"
		);

		const response = await createSystemComponentDraft("core", {
			expectedRevision: manifestRevision,
			slug: "new-button",
			name: "New Button",
		});

		expect(response.componentId).toBe("cmp_new_button");
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/systems/core/components",
			expect.objectContaining({ method: "POST" }),
		);

		queryClient.setQueryData(["trickroom-system-components", "core"], {
			systemId: "core",
			systemName: "Core",
			revision: "sha256:components-created",
			updatedAt: "2026-05-26T00:01:00.000Z",
			components: [
				{
					componentId: response.componentId,
					slug: "new-button",
					name: "New Button",
					hasDraft: true,
					hasPublished: false,
					createdAt: "2026-05-26T00:01:00.000Z",
					updatedAt: "2026-05-26T00:01:00.000Z",
				},
			],
		});

		const html = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<SystemEditorComponentsRail
					systemId="core"
					selectedComponentId={response.componentId}
					onSelectComponent={() => {}}
				/>
			</QueryClientProvider>,
		);

		expect(html).toContain("New Button");
		expect(html).toContain("Draft only");
	});

	it("deletes a component through the component API", async () => {
		const fetchMock = createFetchMock();
		vi.stubGlobal("fetch", fetchMock);
		const { deleteSystemComponent } = await import(
			"../queries/system-components"
		);

		const response = await deleteSystemComponent("core", "cmp_button", {
			expectedRevision: manifestRevision,
		});

		expect(response.componentId).toBe("cmp_button");
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/systems/core/components/cmp_button",
			expect.objectContaining({ method: "DELETE" }),
		);
	});

	it("labels component draft and publication states distinctly", async () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		queryClient.setQueryData(["trickroom-system-components", "core"], {
			systemId: "core",
			systemName: "Core",
			revision: manifestRevision,
			updatedAt: "2026-05-26T00:00:00.000Z",
			components: [
				{
					componentId: "cmp_draft",
					slug: "draft",
					name: "Draft",
					hasDraft: true,
					hasPublished: false,
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
				{
					componentId: "cmp_published",
					slug: "published",
					name: "Published",
					hasDraft: false,
					hasPublished: true,
					currentVersion: "1",
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
				{
					componentId: "cmp_both",
					slug: "both",
					name: "Both",
					hasDraft: true,
					hasPublished: true,
					currentVersion: "2",
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
			],
		});

		const { SystemEditorComponentsRail } = await import(
			"./system-editor/SystemEditorComponentsPanel"
		);
		const html = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<SystemEditorComponentsRail
					systemId="core"
					selectedComponentId={null}
					onSelectComponent={() => {}}
				/>
			</QueryClientProvider>,
		);

		expect(html).toContain("Draft only");
		expect(html).toContain("Published v1");
		expect(html).toContain("Draft over v2");
		expect(html).toContain("Create draft from published version for Published");
		expect(html).toContain("Delete Draft");
	});

	it("shows component usage and stale status in the components list", async () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		queryClient.setQueryData(["trickroom-system-components", "core"], {
			systemId: "core",
			systemName: "Core",
			revision: manifestRevision,
			updatedAt: "2026-05-26T00:00:00.000Z",
			components: [
				{
					componentId: "cmp_unused",
					slug: "unused",
					name: "Unused",
					hasDraft: false,
					hasPublished: true,
					currentVersion: "1",
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
				{
					componentId: "cmp_current",
					slug: "current",
					name: "Current",
					hasDraft: false,
					hasPublished: true,
					currentVersion: "2",
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
				{
					componentId: "cmp_stale",
					slug: "stale",
					name: "Stale",
					hasDraft: false,
					hasPublished: true,
					currentVersion: "2",
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
				{
					componentId: "cmp_missing",
					slug: "missing",
					name: "Missing",
					hasDraft: false,
					hasPublished: true,
					currentVersion: "1",
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
			],
		});
		queryClient.setQueryData(
			["trickroom-system-components-usage", "core", null, null],
			{
				systemId: "core",
				systemName: "Core",
				instances: [
					{
						systemId: "core",
						componentId: "cmp_current",
						version: "2",
						instanceId: "inst-current",
						designFileId: "design-current",
						designFile: "design-current.json",
						designName: "Current Design",
						elementId: "node-current",
						path: "boards[0]",
						versionStatus: {
							status: "current",
							message: "Current",
							componentId: "cmp_current",
							instanceVersion: "2",
							currentVersion: "2",
							publishedVersion: "2",
							reasons: [],
						},
					},
					{
						systemId: "core",
						componentId: "cmp_stale",
						version: "1",
						instanceId: "inst-stale",
						designFileId: "design-stale",
						designFile: "design-stale.json",
						designName: "Stale Design",
						elementId: "node-stale",
						path: "boards[0]",
						versionStatus: {
							status: "stale",
							message: "Stale",
							componentId: "cmp_stale",
							instanceVersion: "1",
							currentVersion: "2",
							publishedVersion: "1",
							reasons: ["version"],
						},
					},
				],
				diagnostics: [
					{
						code: "UNKNOWN_VERSION",
						message: "Missing version",
						componentId: "cmp_missing",
					},
				],
				usedByCount: 2,
				scannedDesignCount: 3,
				statusCounts: {
					current: 1,
					stale: 1,
					"missing-component": 0,
					"missing-version": 0,
					"hash-mismatch": 0,
				},
			},
		);

		const { SystemEditorComponentsRail } = await import(
			"./system-editor/SystemEditorComponentsPanel"
		);
		const html = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<SystemEditorComponentsRail
					systemId="core"
					selectedComponentId={null}
					onSelectComponent={() => {}}
				/>
			</QueryClientProvider>,
		);

		expect(html).toContain("No usages");
		expect(html).toContain("1 current");
		expect(html).toContain("1 stale");
		expect(html).toContain("Diagnostics missing");
	});

	it("shows stale and hash review badges instead of masking them as diagnostics missing", async () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		queryClient.setQueryData(["trickroom-system-components", "core"], {
			systemId: "core",
			systemName: "Core",
			revision: manifestRevision,
			updatedAt: "2026-05-26T00:00:00.000Z",
			components: [
				{
					componentId: "cmp_hash",
					slug: "hash",
					name: "Hash Review",
					hasDraft: false,
					hasPublished: true,
					currentVersion: "1",
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
			],
		});
		queryClient.setQueryData(
			["trickroom-system-components-usage", "core", null, null],
			{
				systemId: "core",
				systemName: "Core",
				instances: [
					{
						systemId: "core",
						componentId: "cmp_hash",
						version: "1",
						instanceId: "inst-hash",
						designFileId: "design-hash",
						designFile: "design-hash.json",
						designName: "Hash Design",
						elementId: "node-hash",
						path: "boards[0]",
						versionStatus: {
							status: "hash-mismatch",
							message: "Hash mismatch",
							componentId: "cmp_hash",
							instanceVersion: "1",
							currentVersion: "1",
							publishedVersion: "1",
							reasons: ["template-hash"],
						},
					},
				],
				diagnostics: [
					{
						code: "HASH_MISMATCH",
						message: "Hash mismatch",
						componentId: "cmp_hash",
					},
					{
						code: "STALE_VERSION",
						message: "Stale version",
						componentId: "cmp_hash",
					},
				],
				usedByCount: 1,
				scannedDesignCount: 1,
				statusCounts: {
					current: 0,
					stale: 0,
					"missing-component": 0,
					"missing-version": 0,
					"hash-mismatch": 1,
				},
			},
		);

		const { SystemEditorComponentsRail } = await import(
			"./system-editor/SystemEditorComponentsPanel"
		);
		const html = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<SystemEditorComponentsRail
					systemId="core"
					selectedComponentId={null}
					onSelectComponent={() => {}}
				/>
			</QueryClientProvider>,
		);

		expect(html).toContain("1 review");
		expect(html).not.toContain("Diagnostics missing");
	});

	it("shows stale and hash usage labels in inspector instead of generic diagnostics", async () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		queryClient.setQueryData(["trickroom-system-components", "core"], {
			systemId: "core",
			systemName: "Core",
			revision: manifestRevision,
			updatedAt: "2026-05-26T00:00:00.000Z",
			components: [
				{
					componentId: "cmp_hash",
					slug: "hash",
					name: "Hash Review",
					hasDraft: false,
					hasPublished: true,
					currentVersion: "1",
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
			],
		});
		queryClient.setQueryData(
			["trickroom-system-component", "core", "cmp_hash"],
			{
				systemId: "core",
				systemName: "Core",
				revision: manifestRevision,
				updatedAt: "2026-05-26T00:00:00.000Z",
				componentId: "cmp_hash",
				valid: true,
				diagnostics: [],
				record: {
					componentId: "cmp_hash",
					slug: "hash",
					name: "Hash Review",
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
					published: {
						currentVersion: "1",
						versions: {
							"1": {
								version: "1",
								publishedAt: "2026-05-26T10:00:00.000Z",
								templateHash: "sha256:published-template",
								variantSchemaHash: null,
								root: {
									path: "root",
									library: "trickroom",
									component: "container",
								},
							},
						},
					},
				},
			},
		);
		queryClient.setQueryData(
			["trickroom-system-component-usage", "core", "cmp_hash", null, null],
			{
				systemId: "core",
				systemName: "Core",
				componentId: "cmp_hash",
				instances: [
					{
						systemId: "core",
						componentId: "cmp_hash",
						version: "1",
						instanceId: "inst-hash",
						designFileId: "design-hash",
						designFile: "design-hash.json",
						designName: "Hash Design",
						elementId: "node-hash",
						path: "boards[0]",
						versionStatus: {
							status: "hash-mismatch",
							message: "Hash mismatch",
							componentId: "cmp_hash",
							instanceVersion: "1",
							currentVersion: "1",
							publishedVersion: "1",
							reasons: ["template-hash"],
						},
					},
				],
				diagnostics: [
					{
						code: "HASH_MISMATCH",
						message: "Hash mismatch",
						componentId: "cmp_hash",
					},
					{
						code: "STALE_VERSION",
						message: "Stale version",
						componentId: "cmp_hash",
					},
				],
				usedByCount: 1,
				scannedDesignCount: 1,
				statusCounts: {
					current: 0,
					stale: 0,
					"missing-component": 0,
					"missing-version": 0,
					"hash-mismatch": 1,
				},
			},
		);

		const { SystemEditorComponentContextPanel } = await import(
			"./system-editor/SystemEditorInspector"
		);
		const html = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<SystemEditorComponentContextPanel
					systemId="core"
					componentId="cmp_hash"
					mode="publish"
				/>
			</QueryClientProvider>,
		);

		expect(html).toContain("1 hash mismatch");
		expect(html).not.toContain("diagnostic needs attention");
		expect(html).not.toContain("diagnostics need attention");
	});

	it("renders draft variant axes and persists variant schema payloads", async () => {
		const fetchMock = createFetchMock();
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		queryClient.setQueryData(["trickroom-system-components", "core"], {
			systemId: "core",
			systemName: "Core",
			revision: manifestRevision,
			updatedAt: "2026-05-26T00:00:00.000Z",
			components: [
				{
					componentId: "cmp_button",
					slug: "button",
					name: "Button",
					hasDraft: true,
					hasPublished: false,
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
			],
		});
		queryClient.setQueryData(
			["trickroom-system-component", "core", "cmp_button"],
			{
				systemId: "core",
				systemName: "Core",
				revision: manifestRevision,
				updatedAt: "2026-05-26T00:00:00.000Z",
				componentId: "cmp_button",
				valid: true,
				diagnostics: [],
				record: {
					componentId: "cmp_button",
					slug: "button",
					name: "Button",
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
					draft: {
						root: {
							path: "root",
							library: "trickroom",
							component: "container",
						},
						variants: {
							axes: {
								tone: {
									label: "Tone",
									defaultValue: "primary",
									values: {
										primary: { label: "Primary" },
										secondary: { label: "Secondary" },
									},
								},
							},
							defaultValues: { tone: "primary" },
						},
					},
				},
			},
		);

		const { SystemEditorComponentContextPanel } = await import(
			"./system-editor/SystemEditorInspector"
		);
		const { updateSystemComponentVariants } = await import(
			"../queries/system-components"
		);

		const html = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<SystemEditorComponentContextPanel
					systemId="core"
					componentId="cmp_button"
					mode="variants"
				/>
			</QueryClientProvider>,
		);

		expect(html).toContain("Variants");
		expect(html).toContain("tone");
		expect(html).toContain("primary");
		expect(html).toContain("secondary");

		await updateSystemComponentVariants("core", "cmp_button", {
			expectedRevision: manifestRevision,
			variants: {
				axes: {
					tone: {
						label: "Tone",
						defaultValue: "secondary",
						values: {
							primary: { label: "Primary" },
							secondary: { label: "Secondary" },
						},
					},
				},
				defaultValues: { tone: "secondary" },
			},
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/systems/core/components/cmp_button/variants",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("renders publish preview, current version, and version history", async () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		queryClient.setQueryData(["trickroom-system-components", "core"], {
			systemId: "core",
			systemName: "Core",
			revision: manifestRevision,
			updatedAt: "2026-05-26T00:00:00.000Z",
			components: [
				{
					componentId: "cmp_button",
					slug: "button",
					name: "Button",
					hasDraft: true,
					hasPublished: true,
					currentVersion: "1",
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
			],
		});
		queryClient.setQueryData(
			["trickroom-system-component", "core", "cmp_button"],
			{
				systemId: "core",
				systemName: "Core",
				revision: manifestRevision,
				updatedAt: "2026-05-26T00:00:00.000Z",
				componentId: "cmp_button",
				valid: true,
				diagnostics: [],
				draftTemplateHash: "sha256:draft-template",
				draftVariantSchemaHash: "sha256:draft-variants",
				record: {
					componentId: "cmp_button",
					slug: "button",
					name: "Button",
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
					draft: {
						baseVersion: "1",
						root: {
							path: "root",
							library: "trickroom",
							component: "container",
						},
					},
					published: {
						currentVersion: "1",
						versions: {
							"1": {
								version: "1",
								publishedAt: "2026-05-26T10:00:00.000Z",
								templateHash: "sha256:published-template",
								variantSchemaHash: "sha256:published-variants",
								root: {
									path: "root",
									library: "trickroom",
									component: "container",
								},
							},
						},
					},
				},
			},
		);

		const { SystemEditorComponentContextPanel } = await import(
			"./system-editor/SystemEditorInspector"
		);
		const html = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<SystemEditorComponentContextPanel
					systemId="core"
					componentId="cmp_button"
					mode="publish"
				/>
			</QueryClientProvider>,
		);

		expect(html).toContain("Generated version");
		expect(html).toContain("sha256:draft-template");
		expect(html).toContain("Current published");
		expect(html).toContain("sha256:published-template");
		expect(html).toContain("Version history");
		expect(html).toContain("Version 1");
	});

	it("sends template and variants together through the combined draft endpoint", async () => {
		const fetchMock = createFetchMock();
		vi.stubGlobal("fetch", fetchMock);
		const { updateSystemComponentDraft } = await import(
			"../queries/system-components"
		);

		await updateSystemComponentDraft("core", "cmp_button", {
			expectedRevision: manifestRevision,
			expectedDraftTemplateHash: "sha256:draft-template",
			expectedDraftVariantSchemaHash: "sha256:draft-variants",
			root: {
				path: "root",
				library: "trickroom",
				component: "container",
			},
			slots: null,
			overrideTargets: null,
			variants: {
				axes: {
					tone: {
						label: "Tone",
						defaultValue: "primary",
						values: {
							primary: { label: "Primary" },
						},
					},
				},
				defaultValues: { tone: "primary" },
			},
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/systems/core/components/cmp_button/draft",
			expect.objectContaining({
				method: "POST",
				body: expect.stringContaining('"variants"'),
			}),
		);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/systems/core/components/cmp_button/draft",
			expect.objectContaining({
				body: expect.stringContaining(
					'"expectedDraftVariantSchemaHash":"sha256:draft-variants"',
				),
			}),
		);
	});
});
