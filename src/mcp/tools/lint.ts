import { z } from "zod";
import { runLint } from "../../lint/run-lint";
import { assertCanWriteProject, getMcpPolicy } from "../governance";
import { getProjectReference } from "../payloads/project";
import { TOOL } from "../tool-names";
import { SEARCH_HINT_META_KEY } from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult, createToolErrorResult } from "./results";
import { withProjectScopedInput } from "./schemas";

/**
 * `lint`: run the design system lint engine (docs/lint.md) and ratchet the
 * result against the committed report. Needs read-write mode in every
 * case, like `design_export`: the codegen check runs the project's
 * formatter command, and a non-check run writes the report.
 */
export const registerLintTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		TOOL.lint,
		{
			title: "Lint Design System",
			description: `Lint a design system on both sides and ratchet the result against the committed report (.trickroom/systems/<id>/lint-report.json). Code side: the generated variants files of published components (stale, missing, orphaned) and, as rule kinds ship, how the app uses them; design side: how Designs use the system. Rule instances, source globs and thresholds come from the system's lint.json; without it every rule kind runs at its default severity. Without check, a passing run writes the report as the new baseline; a failing run writes nothing. check: true never writes. system selects a system by id, name or storage key (default: the codegen block's system, else the project's default system). response "summary" (default) returns the status, the ratchet result (numbers that got worse, thresholds broken) and the per-side counts; "full" adds the whole report with every finding, component coverage and file counts. Fails with LINT_FAILED when the run could not complete (no system, invalid lint.json, a crashed rule).`,
			inputSchema: withProjectScopedInput({
				check: z
					.boolean()
					.optional()
					.describe(
						"Compare and report without writing the report file. Default false.",
					),
				system: z
					.string()
					.min(1)
					.optional()
					.describe("System id, name or storage key. Defaults as documented."),
				response: z
					.enum(["summary", "full"])
					.optional()
					.describe('"summary" (default) or "full" (adds the whole report).'),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"lint check design system adherence variants stale ratchet baseline report coverage findings",
			},
		},
		async ({ check, system, response, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				assertCanWriteProject(getMcpPolicy(context.config));
				const result = await runLint({
					projectRoot: context.projectRoot,
					system: system ?? null,
					check: check === true,
				});
				if (result.status === "error" || !result.report || !result.ratchet) {
					return createToolErrorResult(
						context,
						"LINT_FAILED",
						result.diagnostics
							.filter((diagnostic) => diagnostic.severity === "error")
							.map((diagnostic) => diagnostic.message)
							.join(" ") || "Lint did not complete.",
						{
							lint: {
								status: result.status,
								system: result.system,
								diagnostics: result.diagnostics,
							},
						},
					);
				}
				const { report, ...rest } = result;
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					lint: {
						...rest,
						generatedAt: report.generatedAt,
						summary: report.summary,
						...(response === "full" ? { report } : {}),
					},
				});
			}),
	);
};
