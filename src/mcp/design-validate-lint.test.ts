import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { flatPayload, publishedComponent } from "../codegen/test-support";
import type { Node, TrickroomDesign } from "../types";
import { serializeSystemComponentManifest } from "../utils/system-component-manifest-service";
import { getSystemComponentMarkerProps } from "../utils/system-component-markers";
import { createEmptySystemComponentManifest } from "../utils/system-components";
import { getDesignDiagnostics, type McpDesignIssue } from "./diagnostics";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
	trickroomMcpTestDesignUuid,
} from "./test-support";

type Issue = McpDesignIssue & {
	check?: string;
	classToken?: string;
	component?: string;
};

const chip = publishedComponent("chip", {
	...flatPayload("px-2"),
	variants: {
		axes: { size: { label: "Size", values: { sm: {}, lg: {} } } },
		compoundVariants: [],
	},
});

const layer = (
	id: string,
	props: Record<string, unknown> = {},
	children: Node[] = [],
): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		...props,
	} as Node["props"],
	children,
});

/** Puts a folder where lint.json goes, so reading it fails with EISDIR. */
const LINT_JSON_DIRECTORY = Symbol("lint.json is a directory");

// Each session compiles its own system CSS, and the first canonicalization
// (design.non-canonical-class) builds Tailwind's lookup tables: seconds
// under a parallel run.
describe("design_validate with the system's design lint rules", {
	timeout: 30_000,
}, () => {
	let fixture: TrickroomMcpProjectFixture | undefined;
	let session: TrickroomMcpClientSession | undefined;

	afterEach(async () => {
		await session?.close();
		await fixture?.cleanup();
		session = undefined;
		fixture = undefined;
	});

	const systemDir = () =>
		path.join(fixture?.projectRoot ?? "", ".trickroom/systems/core");

	const setup = async (lintConfig?: unknown) => {
		fixture = await createTrickroomMcpProjectFixture({ designs: {} });
		await fixture.readMcpContext();
		const { systemId } = JSON.parse(
			await readFile(path.join(systemDir(), "system.json"), "utf8"),
		) as { systemId: string };
		await writeFile(
			path.join(systemDir(), "components.json"),
			serializeSystemComponentManifest({
				...createEmptySystemComponentManifest(),
				components: { [chip.componentId]: chip },
			}),
		);
		if (lintConfig === LINT_JSON_DIRECTORY) {
			await mkdir(path.join(systemDir(), "lint.json"));
		} else if (lintConfig !== undefined) {
			await writeFile(
				path.join(systemDir(), "lint.json"),
				typeof lintConfig === "string"
					? lintConfig
					: JSON.stringify(lintConfig),
			);
		}
		const design: TrickroomDesign = {
			name: "Shop",
			systemId,
			boards: [
				layer("board", { className: "flex text-missing-500" }, [
					layer("bad-chip", {
						...getSystemComponentMarkerProps({
							systemId,
							componentId: chip.componentId,
							instanceId: "inst_bad",
							version: "1",
							path: "root",
							isRoot: true,
							variantValues: { size: "xl" },
						}),
					}),
				]),
			],
		};
		await fixture.writeDesign(trickroomMcpTestDesignUuid, design);
		const context = await fixture.readMcpContext();
		session = await createTrickroomMcpTestClient(context);
		return { context, design };
	};

	const validate = async (args: Record<string, unknown> = {}) => {
		const result = await session?.client.callTool({
			name: "design_validate",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				response: "full",
				...args,
			},
		});
		const payload = toolPayload(result) as {
			valid: boolean;
			summary: { codes: Record<string, number> };
			issues: Issue[];
			warnings?: Issue[];
		};
		return {
			...payload,
			all: [...payload.issues, ...(payload.warnings ?? [])],
		};
	};

	it("reports lint findings with the rule kind as the code", async () => {
		const { context, design } = await setup();
		const result = await validate();
		expect(result.valid).toBe(false);
		expect(result.issues).toEqual([
			{
				severity: "error",
				code: "design.unknown-variant-value",
				message:
					'Instance of "chip" sets "size" to "xl", which version 1 does not have. Pick one of "sm", "lg".',
				path: "boards[0].children[0]",
				elementId: "bad-chip",
				component: "chip",
				axis: "size",
				value: "xl",
				version: "1",
			},
		]);
		expect(result.warnings).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				code: "design.unknown-class-token",
				check: "UNKNOWN_COLOR_TOKEN",
				classToken: "text-missing-500",
				elementId: "board",
				path: "boards[0].props.className",
			}),
		);

		// The rule runs the same class checks the diagnostics always ran.
		const plain = await getDesignDiagnostics(context, design);
		const linted = await getDesignDiagnostics(context, design, {
			lint: { designId: trickroomMcpTestDesignUuid },
		});
		const pairs = (
			issues: Issue[],
			code: (issue: Issue) => string | undefined,
		) =>
			issues
				.filter((issue) => issue.classToken !== undefined)
				.map((issue) => [code(issue), issue.classToken, issue.elementId]);
		expect(pairs(linted.issues as Issue[], (issue) => issue.check)).toEqual(
			pairs(plain.issues as Issue[], (issue) => issue.code),
		);
		expect(pairs(plain.issues as Issue[], (issue) => issue.code)).not.toEqual(
			[],
		);
	});

	it("leaves out a kind lint.json disables", async () => {
		await setup({
			version: 1,
			rules: { "design.unknown-class-token": { enabled: false } },
		});
		const result = await validate();
		expect(result.summary.codes).toEqual({ "design.unknown-variant-value": 1 });
	});

	it("uses the severity lint.json sets", async () => {
		await setup({
			version: 1,
			rules: { "design.unknown-variant-value": { severity: "warning" } },
		});
		const result = await validate();
		expect(result.valid).toBe(true);
		expect(result.issues).toEqual([]);
		expect(result.warnings).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				code: "design.unknown-variant-value",
				elementId: "bad-chip",
			}),
		);
	});

	it("drops info findings and applies allow-lists", async () => {
		await setup({
			version: 1,
			rules: {
				"design.unknown-variant-value": { severity: "info" },
				"design.unknown-class-token": {
					options: { allow: ["text-missing-*"] },
				},
			},
		});
		const result = await validate();
		expect(result.valid).toBe(true);
		expect(result.summary.codes).toEqual({});
	});

	it("falls back to the defaults and says so when lint.json is invalid", async () => {
		await setup("{ nope");
		const result = await validate();
		expect(result.warnings).toContainEqual(
			expect.objectContaining({
				code: "INVALID_LINT_CONFIG",
				message: expect.stringContaining(
					".trickroom/systems/core/lint.json is invalid, so the default rules apply",
				),
			}),
		);
		expect(result.summary.codes["design.unknown-variant-value"]).toBe(1);
	});

	it("applies the defaults with a warning when lint.json cannot be read, in both modes", async () => {
		await setup(LINT_JSON_DIRECTORY);
		const unreadable = expect.objectContaining({
			severity: "warning",
			code: "INVALID_LINT_CONFIG",
			message: expect.stringContaining(
				".trickroom/systems/core/lint.json could not be read, so the default rules apply",
			),
		});

		const whole = await validate();
		expect(whole.warnings).toContainEqual(unreadable);
		expect(whole.summary.codes["design.unknown-variant-value"]).toBe(1);

		const read = await session?.client.callTool({
			name: "design_read",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		const revision = (toolPayload(read) as { designFile: { revision: string } })
			.designFile.revision;
		const dryRun = await validate({
			expectedRevision: revision,
			operations: [
				{
					operation: "addElement",
					parameters: {
						parentId: "board",
						index: 0,
						library: "trickroom",
						component: "container",
						name: "Promo",
						className: "bg-missing-200",
					},
				},
			],
		});
		expect(dryRun.warnings).toContainEqual(unreadable);
		expect(dryRun.all).toContainEqual(
			expect.objectContaining({
				code: "design.unknown-class-token",
				classToken: "bg-missing-200",
			}),
		);
	});

	it("keeps validating with a warning when the components cannot be read", async () => {
		await setup();
		await rm(path.join(systemDir(), "components.json"));
		await mkdir(path.join(systemDir(), "components.json"));
		const result = await validate();
		expect(result.warnings).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				code: "INVALID_COMPONENT_MANIFEST",
			}),
		);
		expect(result.summary.codes["design.unknown-class-token"]).toBe(1);
	});

	it("runs the rules on the elements a dry-run touches", async () => {
		await setup({
			version: 1,
			rules: { "design.unknown-variant-value": { severity: "warning" } },
		});
		const read = await session?.client.callTool({
			name: "design_read",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		const revision = (toolPayload(read) as { designFile: { revision: string } })
			.designFile.revision;
		const result = await validate({
			expectedRevision: revision,
			operations: [
				{
					operation: "addElement",
					parameters: {
						parentId: "board",
						index: 0,
						library: "trickroom",
						component: "container",
						name: "Promo",
						className: "bg-missing-200",
					},
				},
			],
		});
		expect(result.valid).toBe(true);
		// Warnings on untouched elements stay out of a dry-run.
		expect(
			result.all.map((issue) => [issue.code, issue.classToken ?? null]),
		).toEqual([["design.unknown-class-token", "bg-missing-200"]]);
	});
});
