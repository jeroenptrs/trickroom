import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDesignResourceUri } from "./mcp/resources";
import { expandRegistryRecipe } from "./recipes/expansion";
import {
	RECIPE_MARKER_PROP_KEYS,
	recipeIdProp,
	recipePathProp,
} from "./recipes/markers";
import { recipeLoadRepairHeaderName } from "./recipes/repair";
import { createTrickroomApp } from "./server";
import { isTrickroomConfig, isTrickroomDesign } from "./server-utils";
import type { Node, TrickroomDesign } from "./types";
import { createDesignSystemStorage } from "./utils/design-system-store";
import { assetIdProp } from "./utils/resource-props";
import {
	getSystemComponentMarkerProps,
	systemComponentRootProp,
} from "./utils/system-component-markers";

const validDesign = {
	name: "Valid Design",
	boards: [
		{
			id: "root",
			props: {
				"data-trickroom-name": "Root",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [
				{
					id: "title",
					props: {
						"data-trickroom-name": "Title",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
					},
					children: "Demo UI",
				},
			],
		},
	],
};

describe("server design validation", () => {
	it("accepts the registry-backed serialized design shape", () => {
		expect(isTrickroomDesign(validDesign)).toBe(true);
	});

	it("accepts explicit component migration policy values", () => {
		expect(
			isTrickroomDesign({
				...validDesign,
				componentMigrationPolicy: "auto",
			}),
		).toBe(true);
		expect(
			isTrickroomDesign({
				...validDesign,
				componentMigrationPolicy: "manual",
			}),
		).toBe(true);
		expect(
			isTrickroomDesign({
				...validDesign,
				componentMigrationPolicy: "inherit",
			}),
		).toBe(true);
	});

	it("rejects invalid component migration policy values", () => {
		expect(
			isTrickroomDesign({
				...validDesign,
				componentMigrationPolicy: "silent",
			}),
		).toBe(false);
	});

	// TODO: this can be deleted
	it("rejects deprecated node host type", () => {
		expect(
			isTrickroomDesign({
				...validDesign,
				boards: [{ ...validDesign.boards[0], type: "div" }],
			}),
		).toBe(false);
	});

	// TODO: this can be deleted
	it("rejects deprecated data-trickroom-type props", () => {
		expect(
			isTrickroomDesign({
				...validDesign,
				boards: [
					{
						...validDesign.boards[0],
						props: {
							...validDesign.boards[0].props,
							"data-trickroom-type": "container",
						},
					},
				],
			}),
		).toBe(false);
	});

	it("accepts registry-invalid role metadata for later diagnostics", () => {
		expect(
			isTrickroomDesign({
				...validDesign,
				boards: [
					{
						...validDesign.boards[0],
						props: {
							...validDesign.boards[0].props,
							"data-trickroom-role": "text",
						},
						children: "Root text",
					},
				],
			}),
		).toBe(true);
	});
});

describe("server config validation", () => {
	it("accepts a config with optional systems", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				systems: {
					Core: "src/index.css",
				},
			}),
		).toBe(true);
	});

	it("accepts a config without systems", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
			}),
		).toBe(true);
	});

	it("accepts a config with MCP enabled", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				mcp: {
					enabled: true,
				},
			}),
		).toBe(true);
	});

	it("rejects empty project names", () => {
		expect(
			isTrickroomConfig({
				name: " ",
				systems: {
					Core: "src/index.css",
				},
			}),
		).toBe(false);
	});

	it("rejects empty system names", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				systems: {
					" ": "src/index.css",
				},
			}),
		).toBe(false);
	});

	it("rejects empty system css paths", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				systems: {
					Core: " ",
				},
			}),
		).toBe(false);
	});

	it("rejects deprecated tailwind roots", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				tailwindRoot: "src/index.css",
			}),
		).toBe(false);
	});

	it("rejects invalid MCP config shapes", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				mcp: {
					enabled: "yes",
				},
			}),
		).toBe(false);
	});

	it("accepts default system config fields", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				defaultSystemId: "sys_00000000-0000-4000-8000-000000000000",
				defaultSystemName: "Core",
			}),
		).toBe(true);
	});
});

describe("server design routes", () => {
	let tempProjectRoot: string;
	let tempTrickroomHome: string;

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-design-route-test-"),
		);
		tempTrickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-home-route-test-"),
		);
	});

	afterEach(async () => {
		await rm(tempProjectRoot, { force: true, recursive: true });
		await rm(tempTrickroomHome, { force: true, recursive: true });
	});

	const importTestServer = async () => {
		return createTrickroomApp({
			trickroomHome: tempTrickroomHome,
			initialProjectRoot: tempProjectRoot,
		});
	};

	const writeDesign = async (file: string, design: unknown) => {
		const designPath = path.join(
			tempProjectRoot,
			".trickroom",
			"designs",
			file,
		);
		await mkdir(path.dirname(designPath), { recursive: true });
		await writeFile(designPath, JSON.stringify(design), "utf8");
	};

	const readStoredDesign = async (file: string) =>
		JSON.parse(
			await readFile(
				path.join(tempProjectRoot, ".trickroom", "designs", file),
				"utf8",
			),
		) as TrickroomDesign;

	const expandAvatarRecipeForRoute = (idPrefix: string, instanceId: string) => {
		const ids = [
			`${idPrefix}-root`,
			`${idPrefix}-image`,
			`${idPrefix}-fallback`,
		];
		return expandRegistryRecipe("base-ui", "avatar.default", {
			createRecipeInstanceId: () => instanceId,
			createElementId: () => {
				const id = ids.shift();
				if (!id) throw new Error("missing test element id");
				return id;
			},
		}).root;
	};

	const createRecipeDesign = (
		boards: Node[],
		name = "Recipe Route Design",
	): TrickroomDesign => ({
		name,
		boards,
	});

	const visitTree = (node: Node, visit: (node: Node) => void) => {
		visit(node);
		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				visitTree(child, visit);
			}
		}
	};

	const setRecipeId = (node: Node, recipeId: string) => {
		visitTree(node, (child) => {
			if (child.props[recipeIdProp]) {
				child.props[recipeIdProp] = recipeId;
			}
		});
	};

	const expectNoRecipeMarkers = (node: Node) => {
		visitTree(node, (child) => {
			for (const key of RECIPE_MARKER_PROP_KEYS) {
				expect(child.props).not.toHaveProperty(key);
			}
		});
	};

	it("reports a clear no-project response when no project is active", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });

		const response = await app.request("/api/trickroom/designs");

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			error: "No Trickroom project is selected.",
		});
	});

	it("reports health without an active project", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });

		const response = await app.request("/api/trickroom/health");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			ok: true,
			mode: "local",
			activeProject: null,
		});
	});

	it("opens an active project event stream", async () => {
		const app = await importTestServer();
		const controller = new AbortController();
		const response = await app.request("/api/trickroom/events", {
			signal: controller.signal,
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const reader = response.body?.getReader();
		expect(reader).toBeDefined();
		const firstChunk = await reader?.read();
		expect(new TextDecoder().decode(firstChunk?.value)).toContain(
			"event: ready",
		);

		controller.abort();
		await reader?.cancel();
	});

	it("streams direct design-file edits to connected clients", async () => {
		const app = await importTestServer();
		const controller = new AbortController();
		const response = await app.request("/api/trickroom/events", {
			signal: controller.signal,
		});
		const reader = response.body?.getReader();
		if (!reader) throw new Error("event stream body is unavailable");

		try {
			await reader.read();
			await new Promise((resolve) => setTimeout(resolve, 150));
			await writeDesign("live.json", validDesign);
			const changeChunk = await reader.read();
			const eventText = new TextDecoder().decode(changeChunk.value);

			expect(eventText).toContain("event: change");
			expect(eventText).toContain('"file":"designs/live.json"');
			expect(eventText).toMatch(/"revision":"sha256:[a-f0-9]{64}"/);
		} finally {
			controller.abort();
			await reader.cancel();
		}
	});

	it("reports health with an initial active project", async () => {
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/health");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			mode: "local",
			activeProject: {
				projectId: expect.any(String),
				locationId: expect.any(String),
				projectRoot: tempProjectRoot,
				name: path.basename(tempProjectRoot),
			},
		});
	});

	it("requires a session token when auth is configured", async () => {
		const app = createTrickroomApp({
			trickroomHome: tempTrickroomHome,
			sessionToken: "test-token",
		});

		const forbidden = await app.request("/api/trickroom/health");
		expect(forbidden.status).toBe(403);
		await expect(forbidden.json()).resolves.toEqual({ error: "Forbidden" });

		const allowed = await app.request("/api/trickroom/health", {
			headers: { "x-trickroom-session": "test-token" },
		});
		expect(allowed.status).toBe(200);
		await expect(allowed.json()).resolves.toMatchObject({
			ok: true,
			mode: "shared",
		});
	});

	it("bootstraps an HTTP-only cookie and redirects to a clean URL", async () => {
		const app = createTrickroomApp({
			trickroomHome: tempTrickroomHome,
			sessionToken: "test token",
		});

		const bootstrap = await app.request(
			"/api/trickroom/health?view=compact&token=test%20token",
		);
		expect(bootstrap.status).toBe(302);
		expect(bootstrap.headers.get("location")).toBe(
			"/api/trickroom/health?view=compact",
		);
		const cookie = bootstrap.headers.get("set-cookie");
		expect(cookie).toContain("trickroom_session=test%20token");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Strict");

		const allowed = await app.request("/api/trickroom/health", {
			headers: { cookie: cookie?.split(";", 1)[0] ?? "" },
		});
		expect(allowed.status).toBe(200);
	});

	it("does not bootstrap a cookie from an invalid token", async () => {
		const app = createTrickroomApp({
			trickroomHome: tempTrickroomHome,
			sessionToken: "test-token",
		});

		const response = await app.request("/?token=wrong-token");
		expect(response.status).toBe(403);
		expect(response.headers.get("set-cookie")).toBeNull();
	});

	it("opens a project through the runtime registry flow", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });

		const response = await app.request("/api/trickroom/projects/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: tempProjectRoot }),
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			project: {
				projectRoot: tempProjectRoot,
				name: path.basename(tempProjectRoot),
			},
			configPath: path.join(tempProjectRoot, ".trickroom", "config.json"),
			source: "new",
		});

		const session = await app.request("/api/trickroom/session");
		await expect(session.json()).resolves.toMatchObject({
			activeProject: {
				projectRoot: tempProjectRoot,
				name: path.basename(tempProjectRoot),
			},
			recentProjects: [
				{
					projectRoot: tempProjectRoot,
					name: path.basename(tempProjectRoot),
				},
			],
		});
	});

	it("opens a registered design through a trickroom resource deeplink", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });
		const designId = "12345678-1234-4abc-8def-123456789abc";
		await writeDesign(`${designId}.json`, {
			...validDesign,
			name: "Deeplink Design",
		});

		const openResponse = await app.request("/api/trickroom/projects/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: tempProjectRoot }),
		});
		expect(openResponse.status).toBe(200);
		const openBody = (await openResponse.json()) as {
			project: { locationId: string };
		};

		const uri = buildDesignResourceUri(
			openBody.project.locationId,
			designId,
			"Deeplink Design",
		);
		const response = await app.request("/api/trickroom/deeplink/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ uri }),
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			project: {
				projectRoot: tempProjectRoot,
			},
			designId,
			designFile: `${designId}.json`,
		});
	});

	it("rejects deeplink URIs for unknown project locations", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });
		const response = await app.request("/api/trickroom/deeplink/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				uri: buildDesignResourceUri(
					"loc_missing",
					"12345678-1234-4abc-8def-123456789abc",
				),
			}),
		});

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: 'Unknown project location "loc_missing".',
		});
	});

	it("rejects deeplink URIs when the design file does not exist", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });
		const openResponse = await app.request("/api/trickroom/projects/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: tempProjectRoot }),
		});
		expect(openResponse.status).toBe(200);
		const openBody = (await openResponse.json()) as {
			project: { locationId: string };
		};

		const response = await app.request("/api/trickroom/deeplink/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				uri: buildDesignResourceUri(
					openBody.project.locationId,
					"12345678-1234-4abc-8def-123456789abd",
				),
			}),
		});

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: 'Design file "12345678-1234-4abc-8def-123456789abd" not found.',
		});
	});

	it("renames a project config and registry location", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });
		const openResponse = await app.request("/api/trickroom/projects/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: tempProjectRoot }),
		});
		expect(openResponse.status).toBe(200);
		const openBody = (await openResponse.json()) as {
			project: { locationId: string };
		};

		const response = await app.request(
			`/api/trickroom/projects/${openBody.project.locationId}/rename`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "Renamed Project" }),
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			project: {
				projectRoot: tempProjectRoot,
				name: "Renamed Project",
			},
			activeProject: {
				projectRoot: tempProjectRoot,
				name: "Renamed Project",
			},
			recentProjects: [
				{
					projectRoot: tempProjectRoot,
					name: "Renamed Project",
				},
			],
			config: {
				name: "Renamed Project",
			},
		});
		await expect(
			readFile(
				path.join(tempProjectRoot, ".trickroom", "config.json"),
				"utf8",
			).then(JSON.parse),
		).resolves.toMatchObject({
			name: "Renamed Project",
		});

		const session = await app.request("/api/trickroom/session");
		await expect(session.json()).resolves.toMatchObject({
			activeProject: {
				projectRoot: tempProjectRoot,
				name: "Renamed Project",
			},
			recentProjects: [
				{
					projectRoot: tempProjectRoot,
					name: "Renamed Project",
				},
			],
		});
	});

	it("rejects invalid project rename payloads", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });
		const openResponse = await app.request("/api/trickroom/projects/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: tempProjectRoot }),
		});
		const openBody = (await openResponse.json()) as {
			project: { locationId: string };
		};

		const response = await app.request(
			`/api/trickroom/projects/${openBody.project.locationId}/rename`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: " " }),
			},
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "Missing required project name.",
		});
	});

	it("updates only project MCP settings", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });
		await app.request("/api/trickroom/projects/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				path: tempProjectRoot,
				config: {
					name: "MCP Settings Project",
					mcp: {
						enabled: true,
						mode: "read-write",
						allowedDesignFileIds: ["design-one"],
						auditLog: true,
					},
				},
			}),
		});

		const readOnlyResponse = await app.request("/api/trickroom/config/mcp", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ enabled: true, mode: "read-only" }),
		});

		expect(readOnlyResponse.status).toBe(200);
		await expect(readOnlyResponse.json()).resolves.toMatchObject({
			name: "MCP Settings Project",
			mcp: {
				enabled: true,
				mode: "read-only",
				allowedDesignFileIds: ["design-one"],
				auditLog: true,
			},
		});

		const disabledResponse = await app.request("/api/trickroom/config/mcp", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ enabled: false }),
		});

		expect(disabledResponse.status).toBe(200);
		const disabledConfig = (await disabledResponse.json()) as {
			mcp?: { enabled: boolean; mode?: string };
		};
		expect(disabledConfig.mcp).toMatchObject({ enabled: false });
		expect(disabledConfig.mcp?.mode).toBeUndefined();
		await expect(
			readFile(
				path.join(tempProjectRoot, ".trickroom", "config.json"),
				"utf8",
			).then(JSON.parse),
		).resolves.toMatchObject({
			mcp: {
				enabled: false,
				allowedDesignFileIds: ["design-one"],
				auditLog: true,
			},
		});
	});

	it("rejects invalid project MCP settings payloads", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });
		await app.request("/api/trickroom/projects/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: tempProjectRoot }),
		});

		const response = await app.request("/api/trickroom/config/mcp", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ enabled: true }),
		});

		expect(response.status).toBe(400);
	});

	it("reads and updates global MCP tool group settings", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });

		const initialResponse = await app.request("/api/trickroom/settings/mcp");
		expect(initialResponse.status).toBe(200);
		const initial = (await initialResponse.json()) as {
			toolGroups: Array<{ id: string; enabled: boolean }>;
		};
		expect(initial.toolGroups).toHaveLength(8);
		expect(initial.toolGroups.every((group) => group.enabled)).toBe(true);

		const updateResponse = await app.request("/api/trickroom/settings/mcp", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				toolGroups: {
					designWrite: false,
				},
			}),
		});
		expect(updateResponse.status).toBe(200);
		const updated = (await updateResponse.json()) as {
			toolGroups: Array<{ id: string; enabled: boolean }>;
		};
		expect(
			updated.toolGroups.find((group) => group.id === "designWrite")?.enabled,
		).toBe(false);
	});

	it("updates the project default system and applies it to new designs", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });
		await app.request("/api/trickroom/projects/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: tempProjectRoot }),
		});

		const createSystemResponse = await app.request("/api/trickroom/systems", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				systemName: "Core",
				cssPath: "src/index.css",
				setAsDefault: true,
			}),
		});
		expect(createSystemResponse.status).toBe(201);
		const createdSystem = (await createSystemResponse.json()) as {
			systemId: string;
			config: { defaultSystemId?: string };
		};
		expect(createdSystem.config.defaultSystemId).toBe(createdSystem.systemId);

		const createDesignResponse = await app.request(
			"/api/trickroom/design?file=default-linked.json",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "Untitled",
					boards: [],
				}),
			},
		);
		expect(createDesignResponse.status).toBe(201);
		const createdDesign = (await createDesignResponse.json()) as {
			systemId: string;
		};
		expect(createdDesign.systemId).toBe(createdSystem.systemId);

		const explicitUnlinkedResponse = await app.request(
			"/api/trickroom/design?file=explicit-unlinked.json",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "Unlinked",
					systemId: null,
					boards: [],
				}),
			},
		);
		expect(explicitUnlinkedResponse.status).toBe(201);
		await expect(explicitUnlinkedResponse.json()).resolves.toMatchObject({
			systemId: null,
		});

		const defaultSystemResponse = await app.request(
			"/api/trickroom/config/default-system",
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ systemId: null }),
			},
		);
		expect(defaultSystemResponse.status).toBe(200);
		await expect(defaultSystemResponse.json()).resolves.not.toHaveProperty(
			"defaultSystemId",
		);
	});

	it("closes the active project without clearing recent projects", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });
		await app.request("/api/trickroom/projects/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: tempProjectRoot }),
		});

		const response = await app.request("/api/trickroom/projects/close", {
			method: "POST",
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ activeProject: null });

		const session = await app.request("/api/trickroom/session");
		await expect(session.json()).resolves.toMatchObject({
			activeProject: null,
			registryActiveProject: null,
			recentProjects: [
				{
					projectRoot: tempProjectRoot,
					name: path.basename(tempProjectRoot),
				},
			],
		});
	});

	it("deletes a recent project location without deleting project files", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });
		const openResponse = await app.request("/api/trickroom/projects/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: tempProjectRoot }),
		});
		expect(openResponse.status).toBe(200);
		const openBody = (await openResponse.json()) as {
			project: { locationId: string };
		};

		const response = await app.request(
			`/api/trickroom/projects/${openBody.project.locationId}/delete`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			project: {
				projectRoot: tempProjectRoot,
				name: path.basename(tempProjectRoot),
			},
			activeProject: null,
			recentProjects: [],
		});
		await expect(
			readFile(path.join(tempProjectRoot, ".trickroom", "config.json"), "utf8"),
		).resolves.toContain(path.basename(tempProjectRoot));

		const session = await app.request("/api/trickroom/session");
		await expect(session.json()).resolves.toMatchObject({
			activeProject: null,
			recentProjects: [],
		});
	});

	it("returns 404 when deleting an unknown project location", async () => {
		const app = createTrickroomApp({ trickroomHome: tempTrickroomHome });

		const response = await app.request(
			"/api/trickroom/projects/loc_missing/delete",
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Project location not found.",
		});
	});

	it("lists only valid design summaries without leaking service revisions", async () => {
		await writeDesign("b.json", { ...validDesign, name: "Design B" });
		await writeDesign("a.json", {
			...validDesign,
			name: "Design A",
			systemName: null,
		});
		await writeDesign("invalid.json", { name: "Invalid" });
		await writeDesign("notes.txt", validDesign);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/designs");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual([
			{
				uuid: "a",
				file: "a.json",
				name: "Design A",
				systemName: null,
				boardsCount: 1,
				layersCount: 1,
				modifiedAt: expect.any(String),
			},
			{
				uuid: "b",
				file: "b.json",
				name: "Design B",
				boardsCount: 1,
				layersCount: 1,
				modifiedAt: expect.any(String),
			},
		]);
	});

	it("returns an empty audit log summary when the audit log is missing", async () => {
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/audit-log/summary");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			count: 0,
			mostRecentAt: null,
		});
	});

	it("summarizes the audit log entry count and most recent timestamp", async () => {
		await mkdir(path.join(tempProjectRoot, ".trickroom"), { recursive: true });
		await writeFile(
			path.join(tempProjectRoot, ".trickroom", "audit-log.jsonl"),
			[
				JSON.stringify({ timestamp: "2026-05-14T10:00:00.000Z" }),
				JSON.stringify({ timestamp: "2026-05-14T14:00:00.000+02:00" }),
				JSON.stringify({ timestamp: "2026-05-14T12:30:00.000Z" }),
				"not-json",
			].join("\n"),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/audit-log/summary");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			count: 4,
			mostRecentAt: "2026-05-14T12:30:00.000Z",
		});
	});

	it("refreshes cached audit log summaries when the log file changes", async () => {
		await mkdir(path.join(tempProjectRoot, ".trickroom"), { recursive: true });
		const auditLogPath = path.join(
			tempProjectRoot,
			".trickroom",
			"audit-log.jsonl",
		);
		await writeFile(
			auditLogPath,
			`${JSON.stringify({ timestamp: "2026-05-14T10:00:00.000Z" })}\n`,
			"utf8",
		);
		const app = await importTestServer();

		const firstResponse = await app.request("/api/trickroom/audit-log/summary");
		expect(firstResponse.status).toBe(200);
		await expect(firstResponse.json()).resolves.toEqual({
			count: 1,
			mostRecentAt: "2026-05-14T10:00:00.000Z",
		});

		await writeFile(
			auditLogPath,
			[
				JSON.stringify({ timestamp: "2026-05-14T10:00:00.000Z" }),
				JSON.stringify({ timestamp: "2026-05-14T11:00:00.000Z" }),
			].join("\n"),
			"utf8",
		);

		const secondResponse = await app.request(
			"/api/trickroom/audit-log/summary",
		);
		expect(secondResponse.status).toBe(200);
		await expect(secondResponse.json()).resolves.toEqual({
			count: 2,
			mostRecentAt: "2026-05-14T11:00:00.000Z",
		});
	});

	it("keeps design reads scoped to the project designs directory", async () => {
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/design?file=../x.json");

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "Design file path must be inside .trickroom/designs",
		});
	});

	it("returns valid attached recipe designs unchanged without repair metadata", async () => {
		const design = createRecipeDesign([
			expandAvatarRecipeForRoute("valid-avatar", "valid-recipe-instance"),
		]);
		await writeDesign("valid-recipe.json", design);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/design?file=valid-recipe.json",
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-trickroom-revision")).toMatch(
			/^sha256:[a-f0-9]{64}$/,
		);
		expect(response.headers.get(recipeLoadRepairHeaderName)).toBeNull();
		const body = (await response.json()) as TrickroomDesign;
		expect(body).toEqual(design);
		expect(body.boards[0].props[recipeIdProp]).toBe("base-ui/avatar.default");
		await expect(readStoredDesign("valid-recipe.json")).resolves.toEqual(
			design,
		);
	});

	it("auto-detaches invalid known recipes before returning the design and persists the repair", async () => {
		const invalidRoot = expandAvatarRecipeForRoute(
			"broken-avatar",
			"broken-recipe-instance",
		);
		const unknownRoot = expandAvatarRecipeForRoute(
			"unknown-avatar",
			"unknown-recipe-instance",
		);
		invalidRoot.children = (invalidRoot.children as Node[]).filter(
			(child) => child.id !== "broken-avatar-image",
		);
		setRecipeId(unknownRoot, "base-ui/unknown.default");
		const design = createRecipeDesign([invalidRoot, unknownRoot]);
		await writeDesign("invalid-recipe.json", design);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/design?file=invalid-recipe.json",
		);

		expect(response.status).toBe(200);
		const repairHeader = response.headers.get(recipeLoadRepairHeaderName);
		expect(repairHeader).not.toBeNull();
		expect(JSON.parse(repairHeader ?? "{}")).toMatchObject({
			repairedCount: 1,
			repairedInstances: [
				expect.objectContaining({
					recipeId: "base-ui/avatar.default",
					instanceId: "broken-recipe-instance",
					rootElementId: "broken-avatar-root",
					targetElementId: "broken-avatar-root",
					detachedElementIds: ["broken-avatar-root", "broken-avatar-fallback"],
					issueCodes: expect.arrayContaining([
						"MISSING_RECIPE_NODE",
						"RECIPE_NODE_CHILDREN_MISMATCH",
					]),
				}),
			],
			unknownCount: 1,
			unknownInstances: [
				expect.objectContaining({
					recipeId: "base-ui/unknown.default",
					instanceId: "unknown-recipe-instance",
					rootElementId: "unknown-avatar-root",
				}),
			],
		});
		const body = (await response.json()) as TrickroomDesign;
		expectNoRecipeMarkers(body.boards[0]);
		expect(body.boards[1].props[recipeIdProp]).toBe("base-ui/unknown.default");
		expect((body.boards[1].children as Node[])[0].props[recipeIdProp]).toBe(
			"base-ui/unknown.default",
		);
		await expect(readStoredDesign("invalid-recipe.json")).resolves.toEqual(
			body,
		);
	});

	it("auto-detaches stale recipe instances on browser load", async () => {
		const staleRoot = expandAvatarRecipeForRoute(
			"stale-avatar",
			"stale-recipe-instance",
		);
		const fallback = (staleRoot.children as Node[]).find(
			(child) => child.id === "stale-avatar-fallback",
		);
		if (!fallback) throw new Error("missing stale fallback");
		fallback.props[recipePathProp] = "legacy-fallback";
		staleRoot.children = [fallback];
		const design = createRecipeDesign([staleRoot]);
		await writeDesign("stale-recipe.json", design);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/design?file=stale-recipe.json",
		);

		expect(response.status).toBe(200);
		const repairHeader = response.headers.get(recipeLoadRepairHeaderName);
		expect(repairHeader).not.toBeNull();
		expect(JSON.parse(repairHeader ?? "{}")).toMatchObject({
			repairedCount: 1,
			repairedInstances: [
				expect.objectContaining({
					recipeId: "base-ui/avatar.default",
					instanceId: "stale-recipe-instance",
					rootElementId: "stale-avatar-root",
					targetElementId: "stale-avatar-root",
					detachedElementIds: ["stale-avatar-root", "stale-avatar-fallback"],
					issueCodes: expect.arrayContaining([
						"UNEXPECTED_RECIPE_PATH",
						"RECIPE_NODE_CHILDREN_MISMATCH",
						"MISSING_RECIPE_NODE",
					]),
				}),
			],
			staleCount: 0,
			unknownCount: 0,
		});
		const body = (await response.json()) as TrickroomDesign;
		expectNoRecipeMarkers(body.boards[0]);
		await expect(readStoredDesign("stale-recipe.json")).resolves.toEqual(body);
	});

	it("leaves unknown recipe ids untouched when there is no known repair", async () => {
		const unknownRoot = expandAvatarRecipeForRoute(
			"unknown-only-avatar",
			"unknown-only-recipe-instance",
		);
		setRecipeId(unknownRoot, "base-ui/unknown.default");
		const design = createRecipeDesign([unknownRoot]);
		await writeDesign("unknown-recipe.json", design);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/design?file=unknown-recipe.json",
		);

		expect(response.status).toBe(200);
		expect(response.headers.get(recipeLoadRepairHeaderName)).toBeNull();
		await expect(response.json()).resolves.toEqual(design);
		await expect(readStoredDesign("unknown-recipe.json")).resolves.toEqual(
			design,
		);
	});

	it("writes valid design payloads through the extracted service", async () => {
		await mkdir(path.join(tempProjectRoot, ".trickroom", "designs"), {
			recursive: true,
		});
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/design?file=new.json", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(validDesign),
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(validDesign);
		await expect(
			readFile(
				path.join(tempProjectRoot, ".trickroom", "designs", "new.json"),
				"utf8",
			).then(JSON.parse),
		).resolves.toEqual(validDesign);
	});

	it("rejects a browser save when its disk revision is stale", async () => {
		await writeDesign("concurrent.json", validDesign);
		const app = await importTestServer();
		const initialResponse = await app.request(
			"/api/trickroom/design?file=concurrent.json",
		);
		const initialRevision = initialResponse.headers.get("x-trickroom-revision");
		expect(initialRevision).toMatch(/^sha256:[a-f0-9]{64}$/);

		const externalDesign = {
			...validDesign,
			name: "Changed by another client",
		};
		await writeDesign("concurrent.json", externalDesign);
		const staleSave = await app.request(
			"/api/trickroom/design?file=concurrent.json",
			{
				method: "PUT",
				headers: {
					"content-type": "application/json",
					"x-trickroom-expected-revision": initialRevision ?? "",
				},
				body: JSON.stringify({ ...validDesign, name: "Stale browser" }),
			},
		);

		expect(staleSave.status).toBe(409);
		await expect(staleSave.json()).resolves.toEqual({
			error: "Design file changed since it was loaded",
		});
		await expect(readStoredDesign("concurrent.json")).resolves.toEqual(
			externalDesign,
		);
	});

	it("creates design files exclusively through POST", async () => {
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/design?file=new.json", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(validDesign),
		});

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual(validDesign);

		const duplicate = await app.request("/api/trickroom/design?file=new.json", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...validDesign, name: "Duplicate" }),
		});
		expect(duplicate.status).toBe(409);
		await expect(duplicate.json()).resolves.toEqual({
			error: "Design file already exists",
		});

		await expect(
			readFile(
				path.join(tempProjectRoot, ".trickroom", "designs", "new.json"),
				"utf8",
			).then(JSON.parse),
		).resolves.toEqual(validDesign);
	});

	it("treats systemId null as an explicit disconnected design reference", async () => {
		await mkdir(path.join(tempProjectRoot, ".trickroom"), {
			recursive: true,
		});
		await writeFile(
			path.join(tempProjectRoot, ".trickroom", "config.json"),
			JSON.stringify({
				name: "Disconnected Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
		);
		await writeDesign("disconnected.json", {
			...validDesign,
			name: "Disconnected",
			systemId: null,
			systemName: "Core",
		});
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/design?file=disconnected.json",
		);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toMatchObject({
			name: "Disconnected",
			systemId: null,
		});
		expect(body).not.toHaveProperty("systemName");
		await expect(readStoredDesign("disconnected.json")).resolves.toEqual(
			expect.objectContaining({
				name: "Disconnected",
				systemId: null,
			}),
		);
		await expect(
			readStoredDesign("disconnected.json"),
		).resolves.not.toHaveProperty("systemName");
	});

	it("deletes design files through DELETE", async () => {
		await writeDesign("delete-me.json", validDesign);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/design?file=delete-me.json",
			{
				method: "DELETE",
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		await expect(
			readFile(
				path.join(tempProjectRoot, ".trickroom", "designs", "delete-me.json"),
				"utf8",
			),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("extracts a subtree to a new design file through the route", async () => {
		await mkdir(path.join(tempProjectRoot, ".trickroom"), {
			recursive: true,
		});
		await writeFile(
			path.join(tempProjectRoot, ".trickroom", "config.json"),
			JSON.stringify({
				name: "Extract Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
		);
		const sourceDesign = {
			...validDesign,
			name: "Source Design",
			systemName: "Core",
		};
		await writeDesign("source.json", sourceDesign);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/design/extract", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				sourceFile: "source.json",
				targetFile: "target.json",
				elementId: "title",
			}),
		});

		expect(response.status).toBe(201);
		const extracted = await response.json();
		expect(extracted).toMatchObject({
			name: "Title",
			systemId: expect.stringMatching(/^sys_/),
			systemName: "Core",
			boards: [
				{
					props: {
						"data-trickroom-name": "Title",
						"data-trickroom-component": "text",
					},
					children: "Demo UI",
				},
			],
		});
		expect(extracted.boards[0].id).not.toBe("title");
		const { systemName: _displaySystemName, ...storedExtracted } = extracted;
		void _displaySystemName;
		await expect(
			readFile(
				path.join(tempProjectRoot, ".trickroom", "designs", "target.json"),
				"utf8",
			).then(JSON.parse),
		).resolves.toEqual(storedExtracted);
		await expect(
			readFile(
				path.join(tempProjectRoot, ".trickroom", "designs", "source.json"),
				"utf8",
			).then(JSON.parse),
		).resolves.toEqual(sourceDesign);
	});

	it("extracts a complete system component through the route using filesystem projectRoot linkage", async () => {
		const { systemId } = await createDesignSystemStorage(tempProjectRoot, {
			systemName: "Core",
			cssPath: "src/core.css",
		});
		const sourceDesign: TrickroomDesign = {
			name: "Component Source",
			systemName: "Core",
			boards: [
				{
					id: "component-root",
					props: {
						"data-trickroom-name": "Component Root",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
						...getSystemComponentMarkerProps({
							systemId,
							componentId: "cmp_11111111-1111-4111-8111-111111111111",
							instanceId: "component-instance-1",
							version: "1",
							path: "root",
							isRoot: true,
							variantValues: { tone: "brand" },
							overrides: {},
							templateHash: "sha256:template",
							variantSchemaHash: "sha256:variants",
						}),
					},
					children: [
						{
							id: "component-label",
							props: {
								"data-trickroom-name": "Component Label",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "text",
								"data-trickroom-role": "text",
								...getSystemComponentMarkerProps({
									systemId,
									componentId: "cmp_11111111-1111-4111-8111-111111111111",
									instanceId: "component-instance-1",
									version: "1",
									path: "label",
								}),
							},
							children: "Locked",
						},
					],
				},
			],
		};
		await writeDesign("component-source.json", sourceDesign);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/design/extract", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				sourceFile: "component-source.json",
				targetFile: "component-target.json",
				elementId: "component-root",
			}),
		});

		expect(response.status).toBe(201);
		const extracted = (await response.json()) as TrickroomDesign;
		expect(extracted.boards[0].props[systemComponentRootProp]).toBe("true");
		expect(extracted.systemName).toBe("Core");
	});

	it("rejects extracted subtrees with invalid inherited system or resources", async () => {
		await writeDesign("missing-system.json", {
			...validDesign,
			systemName: "Missing",
		});
		await mkdir(path.join(tempProjectRoot, ".trickroom"), {
			recursive: true,
		});
		await writeFile(
			path.join(tempProjectRoot, ".trickroom", "config.json"),
			JSON.stringify({
				name: "Extract Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
		);
		await writeDesign("missing-asset.json", {
			name: "Missing Asset",
			systemName: "Core",
			boards: [
				{
					id: "asset",
					props: {
						"data-trickroom-name": "Asset",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "asset",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "ast_missing",
					},
					children: [],
				},
			],
		});
		const app = await importTestServer();

		const missingSystem = await app.request("/api/trickroom/design/extract", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				sourceFile: "missing-system.json",
				targetFile: "missing-system-target.json",
				elementId: "title",
			}),
		});
		expect(missingSystem.status).toBe(400);
		await expect(missingSystem.json()).resolves.toEqual({
			error: 'Design system "Missing" is not configured for this project.',
		});

		const missingAsset = await app.request("/api/trickroom/design/extract", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				sourceFile: "missing-asset.json",
				targetFile: "missing-asset-target.json",
				elementId: "asset",
			}),
		});
		expect(missingAsset.status).toBe(400);
		await expect(missingAsset.json()).resolves.toEqual({
			error: 'Asset id "ast_missing" does not exist in system "Core".',
		});
	});
});
