import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TrickroomCodegenConfig } from "../types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
	warmTailwindCanonicalization,
} from "./test-support";

describe("lint tool", () => {
	// A lint run canonicalizes the system's classes; Tailwind's first
	// canonicalization of a system builds its tables (seconds), paid here
	// rather than inside a test's timeout.
	beforeAll(() => warmTailwindCanonicalization(), 30_000);

	let fixture: TrickroomMcpProjectFixture | undefined;
	let session: TrickroomMcpClientSession | undefined;

	afterEach(async () => {
		await session?.close();
		await fixture?.cleanup();
	});

	const setup = async (
		options: {
			codegen?: TrickroomCodegenConfig;
			mode?: "read-only" | "read-write";
		} = {},
	) => {
		fixture = await createTrickroomMcpProjectFixture();
		await fixture.readMcpContext();
		const config = JSON.parse(await readFile(fixture.configPath, "utf8"));
		await writeFile(
			fixture.configPath,
			JSON.stringify({
				...config,
				...(options.mode ? { mcp: { ...config.mcp, mode: options.mode } } : {}),
				...(options.codegen ? { codegen: options.codegen } : {}),
			}),
		);
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		return { client: session.client, projectRoot: fixture.projectRoot };
	};

	const call = async (args: Record<string, unknown>, name = "lint") =>
		session?.client.callTool({ name, arguments: args });

	const publish = async (slug: string, className: string) => {
		const read = await call({ systemName: "Core" }, "component_read");
		const created = await call(
			{
				systemName: "Core",
				expectedRevision: toolPayload(read).revision,
				slug,
				name: slug,
				draft: {
					root: {
						path: "root",
						library: "trickroom",
						component: "container",
						className,
					},
				},
			},
			"component_draft_create",
		);
		return toolPayload(
			await call(
				{
					systemName: "Core",
					componentId: toolPayload(created).componentId,
					expectedRevision: toolPayload(created).revision,
				},
				"component_publish",
			),
		);
	};

	it("lints, writes the report on a pass and reports a regression on check", async () => {
		const { projectRoot } = await setup({
			codegen: { version: 1, system: "Core", outDir: "src/ui" },
		});
		await publish("button", "px-3");
		const reportPath = path.join(
			projectRoot,
			".trickroom/systems/core/lint-report.json",
		);

		const first = await call({});
		expect(first?.isError, JSON.stringify(toolPayload(first))).toBeFalsy();
		expect(toolPayload(first)).toMatchObject({
			status: "success",
			lint: {
				status: "pass",
				mode: "write",
				system: { name: "Core" },
				baseline: "absent",
				written: true,
				reportPath: ".trickroom/systems/core/lint-report.json",
				ratchet: { status: "pass", regressions: [] },
				summary: {
					code: { findings: { errors: 1, warnings: 0, info: 0 } },
					design: { findings: { errors: 0, warnings: 0, info: 0 } },
				},
			},
		});
		expect(toolPayload(first).lint).not.toHaveProperty("report");
		await expect(stat(reportPath)).resolves.toBeTruthy();

		await call({ format: "variants" }, "design_export");
		const full = await call({ response: "full" });
		expect(toolPayload(full).lint).toMatchObject({
			status: "pass",
			written: true,
			report: {
				findings: [],
				components: [{ slug: "button", published: true, generated: true }],
			},
		});

		await publish("badge", "px-1");
		const failing = await call({ check: true, system: "Core" });
		expect(failing?.isError).toBeFalsy();
		expect(toolPayload(failing).lint).toMatchObject({
			status: "fail",
			ratchet: {
				regressions: [
					{ metric: "code.errors", baseline: 0, current: 1 },
					{ metric: "rule.code.variants-file-stale", baseline: 0, current: 1 },
				],
			},
		});
	});

	it("fails as a tool error when the run cannot complete", async () => {
		await setup();
		const result = await call({ system: "nope", check: true });
		expect(result?.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({
			code: "LINT_FAILED",
			lint: { status: "error" },
		});
		expect(toolPayload(result).message).toContain(
			'No design system matches "nope"',
		);
	});

	it("needs write access, also for checks", async () => {
		await setup({ mode: "read-only" });
		const result = await call({ check: true });
		expect(result?.isError).toBe(true);
		expect(toolPayload(result)).toMatchObject({ status: "POLICY_DENIED" });
	});
});
