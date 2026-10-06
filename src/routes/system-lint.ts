import type { Context, Hono } from "hono";
import { readLintReport } from "../lint/report";
import { runLint } from "../lint/run-lint";

/**
 * The lint report of a system for the dashboard:
 * `GET /api/trickroom/systems/:systemName/lint` returns the stored report
 * (404 `LINT_REPORT_NOT_FOUND` when none was written yet, 409
 * `LINT_REPORT_INVALID` when it cannot be read), and `POST` runs the
 * engine on demand, writes the report whatever the outcome (the ratchet
 * baseline inside it is kept when the run fails) and returns the run.
 */
export const registerSystemLintRoutes = (
	systemsRoutes: Hono,
	getProjectRoot: (c: Context) => string,
	getRouteSystem: (c: Context) => {
		system: { dir: string };
		systemId: string;
		systemName: string;
	},
) => {
	systemsRoutes.get("/:systemName/lint", async (c) => {
		const { system, systemId, systemName } = getRouteSystem(c);
		const read = await readLintReport(system.dir);
		if (read.status === "absent") {
			return c.json(
				{
					error: `No lint report for design system "${systemName}" yet. Run lint to create one.`,
					code: "LINT_REPORT_NOT_FOUND",
				},
				404,
			);
		}
		if (read.status === "invalid") {
			return c.json(
				{ error: read.issue.message, code: "LINT_REPORT_INVALID" },
				409,
			);
		}
		return c.json({ systemId, systemName, report: read.report });
	});

	systemsRoutes.post("/:systemName/lint", async (c) => {
		const projectRoot = getProjectRoot(c);
		const { systemId, systemName } = getRouteSystem(c);
		const result = await runLint({
			projectRoot,
			system: systemId,
			write: "always",
		});
		if (result.status === "error" || !result.report || !result.ratchet) {
			return c.json(
				{
					error:
						result.diagnostics
							.filter((diagnostic) => diagnostic.severity === "error")
							.map((diagnostic) => diagnostic.message)
							.join(" ") || "Lint did not complete.",
					code: "LINT_FAILED",
					diagnostics: result.diagnostics,
				},
				500,
			);
		}
		return c.json({
			systemId,
			systemName,
			status: result.status,
			report: result.report,
			ratchet: result.ratchet,
			written: result.written,
			diagnostics: result.diagnostics,
		});
	});
};
