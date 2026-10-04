import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerAsset } from "../utils/asset-manifest-service";
import { writeDesignSystemManifest } from "../utils/design-system-store";
import { syncIconManifest } from "../utils/icon-manifest-service";
import {
	DESIGN_OPERATION_PARAMETERS,
	designOperationNameSchema,
	validateDryRunOperationParameters,
} from "./design-operations";
import { DESIGN_GUIDE_TOPIC_NAMES } from "./guide/design-guide";
import { SYSTEM_COMPONENT_GUIDE_TOPIC_NAMES } from "./guide/system-component-guide";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesign,
	trickroomMcpTestDesignUuid,
} from "./test-support";

const safeSvg =
	'<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h16" stroke="currentColor" stroke-width="2"/></svg>';

// The core is read once per design session, so it has a hard size budget.
const CORE_BUDGET = 6_500;
const TOPIC_BUDGET = 9_000;

// biome-ignore lint/suspicious/noExplicitAny: tool payloads are untyped JSON
type Json = Record<string, any>;
type Operation = { operation: string; parameters: Json };

/** Fill guide placeholders such as "<parent id>" with real ids. */
const fill = <T>(value: T, replacements: Record<string, string>): T =>
	JSON.parse(
		Object.entries(replacements).reduce(
			(text, [placeholder, id]) => text.replaceAll(placeholder, id),
			JSON.stringify(value),
		),
	);

describe("getDesignAuthoringContract", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const sessions: TrickroomMcpClientSession[] = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
	});

	const createSession = async (
		options: Parameters<typeof createTrickroomMcpProjectFixture>[0] = {},
	) => {
		const fixture = await createTrickroomMcpProjectFixture(options);
		fixtures.push(fixture);
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		sessions.push(session);
		const call = async (name: string, args: Json = {}) => {
			const result = await session.client.callTool({ name, arguments: args });
			return {
				result,
				payload: result.structuredContent as Json,
				size: (result.content as Array<{ text: string }>)[0].text.length,
			};
		};
		return { fixture, session, call };
	};

	const contract = async (
		call: Awaited<ReturnType<typeof createSession>>["call"],
		args: Json = {},
	) => (await call("getDesignAuthoringContract", args)).payload;

	it("returns a small core with rules, workflow, design facts and the topic list", async () => {
		const { call } = await createSession();

		const { payload: core, size } = await call("getDesignAuthoringContract", {
			designFileId: trickroomMcpTestDesignUuid,
		});
		const listed = await call("listDesignFiles");

		expect(size).toBeLessThan(CORE_BUDGET);
		expect(core).toMatchObject({
			contract: "design-authoring",
			schemaVersion: 2,
			design: {
				id: trickroomMcpTestDesignUuid,
				boardCount: 1,
				boards: [{ id: "board", name: "Board" }],
			},
			designSystem: { systemName: "Core", linked: true },
			memoryNotes: { design: 0, system: 0, project: 0 },
		});
		expect(core.design.revision).toBe(
			listed.payload.designFiles.find(
				(file: Json) => file.id === trickroomMcpTestDesignUuid,
			).revision,
		);
		expect(core.rules[0]).toContain(
			"Do not create separate boards per breakpoint",
		);
		expect(core.rules.join(" ")).toContain("expectedRevision");
		expect(core.rules.join(" ")).toContain("locked");
		expect(Object.keys(core.topics)).toEqual([...DESIGN_GUIDE_TOPIC_NAMES]);
	});

	it("works without designFileId and omits design-specific facts", async () => {
		const { call } = await createSession();

		const core = await contract(call);

		expect(core.design).toBeUndefined();
		expect(core.memoryNotes).toEqual({ project: 0 });
		expect(core.topics).toHaveProperty("operations");
	});

	it("applies the core example as written", async () => {
		const { call } = await createSession();
		const core = await contract(call, {
			designFileId: trickroomMcpTestDesignUuid,
		});

		const { result, payload } = await call(
			"applyDesignOperations",
			fill(core.example.arguments, {
				"<design uuid>": trickroomMcpTestDesignUuid,
				"<revision from your last read or write>": core.design.revision,
			}),
		);

		expect(result.isError).toBeFalsy();
		expect(payload.status).toBe("success");
	});

	it("returns only the requested topics, each within budget", async () => {
		const { call } = await createSession();

		for (const topic of DESIGN_GUIDE_TOPIC_NAMES) {
			const { payload, size } = await call("getDesignAuthoringContract", {
				designFileId: trickroomMcpTestDesignUuid,
				topic,
			});
			expect(payload.topics).toEqual([topic]);
			expect(payload[topic]).toBeDefined();
			expect(payload.rules).toBeUndefined();
			expect(size, topic).toBeLessThan(TOPIC_BUDGET);
		}

		const several = await contract(call, { topic: ["boards", "overlays"] });
		expect(Object.keys(several)).toEqual(
			expect.arrayContaining(["boards", "overlays"]),
		);
		expect(several.operations).toBeUndefined();
	});

	it("rejects an unknown topic with the list of valid topics", async () => {
		const { session } = await createSession();

		const outcome = await session.client
			.callTool({
				name: "getDesignAuthoringContract",
				arguments: { topic: "recipe" },
			})
			.then(
				(result) => JSON.stringify(result.content),
				(error: Error) => error.message,
			);

		expect(outcome).toContain("recipes");
		expect(outcome).toContain("step-references");
	});

	it("documents every batch operation with parameters and a valid example", async () => {
		const { call } = await createSession();
		const { operations } = await contract(call, { topic: "operations" });

		expect(operations.operations.map((entry: Json) => entry.operation)).toEqual(
			designOperationNameSchema.options,
		);
		for (const entry of operations.operations) {
			expect(
				Object.keys(entry.parameters).map((name) => name.replace(/\?$/u, "")),
				entry.operation,
			).toEqual(
				DESIGN_OPERATION_PARAMETERS[
					entry.operation as keyof typeof DESIGN_OPERATION_PARAMETERS
				].map((parameter) => parameter.name),
			);
			expect(() =>
				validateDryRunOperationParameters(
					entry.operation,
					entry.example.parameters,
					{ designFileId: trickroomMcpTestDesignUuid },
				),
			).not.toThrow();
		}
	});

	it("step-references example fills a recipe slot in one batch", async () => {
		const { call } = await createSession();
		const { "step-references": topic } = await contract(call, {
			topic: "step-references",
		});
		const core = await contract(call, {
			designFileId: trickroomMcpTestDesignUuid,
		});

		const { result, payload } = await call("applyDesignOperations", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: core.design.revision,
			operations: fill(topic.example, { "board-id": "board" }),
		});

		expect(result.isError).toBeFalsy();
		expect(payload.status).toBe("success");
	});

	it("sets a recipe control from a batch the way the recipes topic says", async () => {
		const { call } = await createSession();
		const { recipes, overlays } = await contract(call, {
			topic: ["recipes", "overlays"],
		});
		expect(recipes.openByDefault).toEqual(
			expect.arrayContaining([
				"base-ui/dialog.default",
				"base-ui/drawer.default",
			]),
		);
		expect(overlays.behavior.join(" ")).toContain("base-ui/dialog.default");
		const core = await contract(call, {
			designFileId: trickroomMcpTestDesignUuid,
		});

		const { result, payload } = await call("applyDesignOperations", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: core.design.revision,
			operations: [
				{
					operation: "addRecipe",
					parameters: {
						parentId: "board",
						index: 0,
						library: "base-ui",
						recipe: "dialog.default",
					},
				},
				{
					operation: "updateElementProps",
					parameters: { elementId: "$step:0", props: { defaultOpen: false } },
				},
			],
		});
		expect(result.isError).toBeFalsy();

		const root = await call("readElement", {
			designFileId: trickroomMcpTestDesignUuid,
			elementId: payload.steps[0].changedElementId,
			detail: "full",
		});
		expect(root.payload.element.props.defaultOpen).toBe(false);
	});

	it("indexes recipes and details one recipe by name", async () => {
		const { call } = await createSession();

		const index = await contract(call, { topic: "recipes" });
		expect(index.recipes.recipes).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^base-ui\/dialog\.default: Dialog\. slots: /u),
			]),
		);

		const dialog = await contract(call, { topic: "recipes", name: "dialog" });
		expect(dialog.recipes.recipes).toHaveLength(1);
		expect(dialog.recipes.recipes[0]).toMatchObject({
			recipe: "base-ui/dialog.default",
			template: { path: "root", component: "base-ui/dialog.root" },
			slots: expect.arrayContaining([
				expect.objectContaining({ name: "content" }),
				expect.objectContaining({ name: "trigger" }),
			]),
			controls: expect.arrayContaining([
				expect.objectContaining({ prop: "defaultOpen", path: "root" }),
			]),
		});
	});

	it("lists registry families and details a filtered family", async () => {
		const { call } = await createSession();

		const families = await contract(call, { topic: "registry" });
		const baseUi = families.registry.libraries.find(
			(entry: Json) => entry.library === "base-ui",
		);
		expect(baseUi.families).toHaveProperty("select");
		expect(baseUi.elements).toBeUndefined();

		const select = await contract(call, { topic: "registry", name: "select" });
		expect(
			select.registry.elements.every((element: Json) =>
				element.component.startsWith("base-ui/select."),
			),
		).toBe(true);
		expect(select.registry.elements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					component: "base-ui/select.root",
					role: "branch",
				}),
			]),
		);
	});

	it("filters registry elements and recipes by component policy", async () => {
		const { call } = await createSession({
			config: {
				mcp: { enabled: true, allowedComponents: ["trickroom/text"] },
			},
		});

		const { registry, recipes } = await contract(call, {
			topic: ["registry", "recipes"],
			library: "trickroom",
		});

		expect(registry.elements.map((element: Json) => element.component)).toEqual(
			["trickroom/text"],
		);
		expect(recipes.recipes).toEqual([]);
	});

	it("summarizes the linked system's tokens, assets and icons", async () => {
		const { fixture, call } = await createSession({
			designs: { [trickroomMcpTestDesignUuid]: trickroomMcpTestDesign },
			tokenSnapshots: [
				{
					systemName: "Core",
					cssPath: "src/index.css",
					tokens: { "brand-500": "#2563eb" },
					overrides: ["brand-500"],
					reviewRequired: true,
				},
			],
		});
		const imagePath = path.join(
			fixture.projectRoot,
			"src",
			"assets",
			"hero.png",
		);
		await mkdir(path.dirname(imagePath), { recursive: true });
		await writeFile(
			imagePath,
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
				"base64",
			),
		);
		await registerAsset(fixture.projectRoot, "Core", {
			name: "Hero Shot",
			sourcePath: "src/assets/hero.png",
		});
		await mkdir(path.join(fixture.projectRoot, "src", "icons"), {
			recursive: true,
		});
		await writeFile(
			path.join(fixture.projectRoot, "src", "icons", "search.svg"),
			safeSvg,
		);
		await writeDesignSystemManifest(fixture.projectRoot, "Core", {
			iconFolderPaths: ["src/icons"],
		});
		await syncIconManifest(fixture.projectRoot, "Core");

		const core = await contract(call, {
			designFileId: trickroomMcpTestDesignUuid,
		});
		expect(core.designSystem).toMatchObject({
			systemName: "Core",
			tokens: { color: 1 },
			tokenReviewRequired: true,
			assets: 1,
			icons: 1,
		});

		const { tokens, resources } = await contract(call, {
			designFileId: trickroomMcpTestDesignUuid,
			topic: ["tokens", "resources"],
		});
		expect(tokens.system).toMatchObject({
			systemName: "Core",
			tokensByDomain: { color: 1 },
			reviewRequired: expect.any(String),
		});
		expect(resources.system).toEqual({
			systemName: "Core",
			assets: 1,
			icons: 1,
		});
	});

	it("lists published system components and places one as the examples show", async () => {
		const { call } = await createSession();
		const { examples: draftExamples } = (
			await call("getSystemComponentAuthoringContract", {
				topic: "examples",
			})
		).payload;
		const listed = await call("listSystemComponents", { systemName: "Core" });
		const created = await call(
			"createSystemComponentDraft",
			fill(draftExamples[0].arguments, {
				"<manifest revision from your last read or write>":
					listed.payload.revision,
			}),
		);
		expect(created.result.isError).toBeFalsy();
		const componentId = created.payload.componentId;
		const published = await call(
			"publishSystemComponent",
			fill(draftExamples[2].arguments, {
				"cmp_…": componentId,
				"<manifest revision from your last read or write>":
					created.payload.revision,
			}),
		);
		expect(published.result.isError).toBeFalsy();

		const core = await contract(call, {
			designFileId: trickroomMcpTestDesignUuid,
		});
		expect(core.designSystem.components).toEqual({
			published: 1,
			slugs: ["status-pill"],
		});
		const { components } = await contract(call, {
			designFileId: trickroomMcpTestDesignUuid,
			topic: "components",
		});
		expect(components.components).toEqual([
			expect.objectContaining({
				componentId,
				slug: "status-pill",
				variants: { tone: ["neutral", "success"] },
				overrides: { label: ["text", "className"] },
			}),
		]);

		const { examples } = await contract(call, { topic: "examples" });
		const placement = examples.find((example: Json) =>
			example.task.includes("design system component"),
		);
		const operations = fill(placement.calls[0].arguments.operations, {
			"<parent id>": "board",
			"sys_…": core.designSystem.systemId,
			"cmp_…": componentId,
		}).map((step: Operation) =>
			step.operation === "addSystemComponent"
				? {
						...step,
						parameters: {
							...step.parameters,
							variantValues: { tone: "success" },
							overrides: { label: { text: "Upgrade" } },
						},
					}
				: {
						...step,
						parameters: {
							...step.parameters,
							variantValues: { tone: "neutral" },
						},
					},
		);
		const placed = await call("applyDesignOperations", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: core.design.revision,
			operations,
		});
		expect(placed.result.isError).toBeFalsy();
	});

	it("runs the new-screen and dialog-board examples", async () => {
		const { call } = await createSession();
		const { examples } = await contract(call, { topic: "examples" });
		const [screen, dialogBoard] = examples;
		const core = await contract(call, {
			designFileId: trickroomMcpTestDesignUuid,
		});

		const built = await call(
			"applyDesignOperations",
			fill(screen.calls[1].arguments, {
				"<design uuid>": trickroomMcpTestDesignUuid,
				"<revision from your last read or write>": core.design.revision,
			}),
		);
		expect(built.result.isError).toBeFalsy();
		const { page, main } = built.payload.steps[0].idMap;

		const withDialog = await call(
			"applyDesignOperations",
			fill(dialogBoard.calls[0].arguments, {
				"<design uuid>": trickroomMcpTestDesignUuid,
				"<revision from your last read or write>": built.payload.newRevision,
				"<page board id>": page,
				"<main element id>": main,
			}),
		);
		expect(withDialog.result.isError).toBeFalsy();
		expect(withDialog.payload.status).toBe("success");
	});

	it("reports memory note counts", async () => {
		const { call } = await createSession();
		await call("addMemoryNote", {
			scope: { kind: "design", designFileId: trickroomMcpTestDesignUuid },
			category: "intent",
			title: "Purpose",
			body: "Harness design.",
		});

		const core = await contract(call, {
			designFileId: trickroomMcpTestDesignUuid,
		});
		expect(core.memoryNotes).toEqual({ design: 1, system: 0, project: 0 });
	});
});

describe("getSystemComponentAuthoringContract", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const sessions: TrickroomMcpClientSession[] = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
	});

	it("returns a core and per-part topics", async () => {
		const fixture = await createTrickroomMcpProjectFixture();
		fixtures.push(fixture);
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		sessions.push(session);

		const core = await session.client.callTool({
			name: "getSystemComponentAuthoringContract",
			arguments: { systemName: "Core" },
		});
		expect(core.structuredContent).toMatchObject({
			contract: "system-component-authoring",
			system: {
				requested: "Core",
				configured: true,
				components: { componentCount: 0 },
			},
		});
		expect(Object.keys((core.structuredContent as Json).topics)).toEqual([
			...SYSTEM_COMPONENT_GUIDE_TOPIC_NAMES,
		]);
		expect(
			(core.content as Array<{ text: string }>)[0].text.length,
		).toBeLessThan(CORE_BUDGET);

		const topics = await session.client.callTool({
			name: "getSystemComponentAuthoringContract",
			arguments: { topic: [...SYSTEM_COMPONENT_GUIDE_TOPIC_NAMES] },
		});
		expect(topics.structuredContent).toMatchObject({
			template: { type: "RecipeTemplateNode" },
			slots: { requiredPerSlot: ["name", "hostPath"] },
			variants: {
				classesByPath: expect.stringContaining("template path"),
				compoundVariants: expect.stringContaining("single string values"),
				defaultValues: expect.stringContaining("real value ids"),
				instanceUpdates: expect.stringContaining("unsetVariantAxes"),
				rules: expect.arrayContaining([
					expect.stringContaining("does not fabricate the first value"),
					expect.stringContaining("duplicate signatures"),
					expect.stringContaining("garbage-collected"),
					expect.stringContaining("Array-valued when"),
				]),
			},
			overrides: { capabilities: ["className", "text", "icon", "asset"] },
			examples: expect.arrayContaining([
				expect.objectContaining({ tool: "createSystemComponentDraft" }),
			]),
		});
	});
});
