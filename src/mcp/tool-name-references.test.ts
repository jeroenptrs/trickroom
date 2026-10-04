import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { designOperationNameSchema } from "./design-operations";
import { GUIDE_TOPIC_NAMES } from "./payloads/authoring-contract";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesignUuid,
} from "./test-support";
import { TOOL_NAMES } from "./tool-names";

// The 74 tools before the consolidation. Batch operations keep their names
// (addElement, copySubtree, ...): they are operations of design_apply, not
// tools, so only the other old names are retired.
const PRE_CONSOLIDATION_TOOL_NAMES = [
	"listProjects",
	"registerProject",
	"selectProject",
	"getSelectedProject",
	"getActiveProject",
	"resolveProject",
	"openProject",
	"trickroom_project_info",
	"listDesignFiles",
	"readDesignFile",
	"readDesignGraph",
	"readElement",
	"readSubtree",
	"exportDesignHtml",
	"screenshotBoard",
	"screenshotNode",
	"createDesignFile",
	"extractSubtree",
	"addSubtree",
	"copySubtree",
	"renameDesignFile",
	"applyDesignOperations",
	"addElement",
	"addRecipe",
	"addSystemComponent",
	"updateSystemComponentInstance",
	"detachSystemComponent",
	"updateElementProps",
	"updateRecipeControl",
	"updateRecipeInstance",
	"updateElementText",
	"moveElement",
	"deleteElement",
	"detachRecipeInstance",
	"validateDesignFile",
	"validateOperation",
	"validateOperationPlan",
	"validateSubtree",
	"validateCopySubtree",
	"listRegistries",
	"listRegistryComponents",
	"describeRegistryComponent",
	"listRegistryRecipes",
	"describeRegistryRecipe",
	"getDesignAuthoringContract",
	"getSystemComponentAuthoringContract",
	"getDesignSystemForDesignFile",
	"listDesignTokens",
	"listSystemAssets",
	"describeAsset",
	"listSystemIcons",
	"describeIcon",
	"findAssetUsage",
	"findIconUsage",
	"addSystemAsset",
	"removeSystemAsset",
	"addSystemIconFolder",
	"removeSystemIconFolder",
	"refreshSystemAssetMetadata",
	"listSystemComponents",
	"describeSystemComponent",
	"listStaleSystemComponentUsages",
	"createSystemComponentDraft",
	"updateSystemComponentDraft",
	"publishSystemComponent",
	"deleteSystemComponent",
	"migrateSystemComponentInstance",
	"bulkMigrateSystemComponentUsages",
	"listMemoryNotes",
	"getMemoryNote",
	"addMemoryNote",
	"updateMemoryNote",
	"deleteMemoryNote",
	"listReferenceTargets",
];

const OPERATION_NAMES = new Set<string>(designOperationNameSchema.options);
const RETIRED_TOOL_NAMES = PRE_CONSOLIDATION_TOOL_NAMES.filter(
	(name) => !OPERATION_NAMES.has(name),
);
const RETIRED_PATTERN = new RegExp(
	`\\b(?:${RETIRED_TOOL_NAMES.join("|")})\\b`,
	"gu",
);
/** Tool-shaped snake_case tokens: a family prefix and a verb or noun. */
const FAMILY_TOKEN_PATTERN =
	/\b(?:project|design|editor|memory|system|component)_[a-z]+(?:_[a-z]+)*\b/gu;
const REGISTERED = new Set<string>(TOOL_NAMES);

/** Every tool reference in `text` that does not name a registered tool. */
const findBadToolReferences = (text: string) => [
	...new Set([
		...(text.match(RETIRED_PATTERN) ?? []),
		...(text.match(FAMILY_TOKEN_PATTERN) ?? []).filter(
			(token) => !REGISTERED.has(token),
		),
	]),
];

/** String literal contents of a TypeScript or JavaScript source file. */
const stringLiterals = (source: string) =>
	source.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/gu) ??
	[];

const listSources = async (dir: string): Promise<string[]> => {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) => {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) return listSources(fullPath);
			return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
				? [fullPath]
				: [];
		}),
	);
	return files.flat();
};

describe("tool references in agent-facing text", () => {
	let fixture: TrickroomMcpProjectFixture | undefined;
	let session: TrickroomMcpClientSession | undefined;

	afterEach(async () => {
		await session?.close();
		await fixture?.cleanup();
	});

	it("knows the retired names", () => {
		expect(PRE_CONSOLIDATION_TOOL_NAMES).toHaveLength(74);
		expect(RETIRED_TOOL_NAMES.length).toBeGreaterThan(50);
		expect(findBadToolReferences("call readSubtree, then design_reed")).toEqual(
			["readSubtree", "design_reed"],
		);
		expect(
			findBadToolReferences("design_apply with addElement and copySubtree"),
		).toEqual([]);
	});

	it("names only registered tools in descriptions, schemas, instructions, prompts and the guide", async () => {
		fixture = await createTrickroomMcpProjectFixture();
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		const { client } = session;
		const texts: Array<[string, string]> = [
			["instructions", client.getInstructions() ?? ""],
		];
		for (const tool of (await client.listTools()).tools) {
			texts.push([`tool ${tool.name}`, JSON.stringify(tool)]);
		}
		const promptArguments: Record<string, Record<string, string>> = {
			add_component_to_design: {
				designFileId: trickroomMcpTestDesignUuid,
				parentId: "board",
			},
			create_design_file_from_brief: { brief: "A pricing page" },
			reuse_design_subtree: {
				sourceDesignFileId: trickroomMcpTestDesignUuid,
				sourceElementId: "title",
				targetDesignFileId: trickroomMcpTestDesignUuid,
			},
		};
		for (const prompt of (await client.listPrompts()).prompts) {
			const result = await client.getPrompt({
				name: prompt.name,
				arguments: promptArguments[prompt.name] ?? {
					designFileId: trickroomMcpTestDesignUuid,
				},
			});
			texts.push([`prompt ${prompt.name}`, JSON.stringify(result)]);
		}
		const guide = async (args: Record<string, unknown>) =>
			JSON.stringify(
				(await client.callTool({ name: "guide", arguments: args })).content,
			);
		texts.push([
			"guide core",
			await guide({ designFileId: trickroomMcpTestDesignUuid }),
		]);
		for (const topic of GUIDE_TOPIC_NAMES) {
			texts.push([
				`guide topic ${topic}`,
				await guide({ topic, designFileId: trickroomMcpTestDesignUuid }),
			]);
		}

		const problems = texts.flatMap(([where, text]) =>
			findBadToolReferences(text).map((token) => `${where}: ${token}`),
		);
		expect(problems).toEqual([]);
	});

	it("names only registered tools in string literals of hint and message sources", async () => {
		const root = process.cwd();
		const files = [
			...(await listSources(path.join(root, "src/mcp"))),
			path.join(root, "src/services/element-lookup-hints.ts"),
			path.join(root, "src/services/design-transform-service.ts"),
			path.join(root, "src/utils/memory-manifest-service.ts"),
			path.join(root, "src/utils/system-component-draft-schemas.ts"),
			path.join(root, "bin/trickroom.js"),
		].filter((file) => !file.endsWith("tool-name-references.test.ts"));
		const problems: string[] = [];
		for (const file of files) {
			const source = await readFile(file, "utf8");
			for (const literal of stringLiterals(source)) {
				for (const token of findBadToolReferences(literal)) {
					problems.push(
						`${path.relative(root, file)}: ${token} in ${literal.slice(0, 80)}`,
					);
				}
			}
		}
		expect(problems).toEqual([]);
	});
});
