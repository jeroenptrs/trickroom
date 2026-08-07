import { describe, expect, it } from "vitest";
import { resolveTrickroomCommand } from "./cli-command.js";

describe("resolveTrickroomCommand", () => {
	it("selects the explicit serve command and removes it from forwarded argv", () => {
		expect(
			resolveTrickroomCommand([
				"node",
				"trickroom",
				"serve",
				"--port",
				"0",
				"/project",
			]),
		).toEqual({
			command: "serve",
			argv: ["node", "trickroom", "--port", "0", "/project"],
		});
	});

	it("keeps bare trickroom as a serve shortcut", () => {
		expect(resolveTrickroomCommand(["node", "trickroom"])).toEqual({
			command: "serve",
			argv: ["node", "trickroom"],
		});
	});

	it("allows serve flags on the bare shortcut", () => {
		const argv = ["node", "trickroom", "--no-open"];
		expect(resolveTrickroomCommand(argv)).toEqual({
			command: "serve",
			argv,
		});
	});

	it("selects MCP without changing its argv", () => {
		const argv = ["node", "trickroom", "mcp"];
		expect(resolveTrickroomCommand(argv)).toEqual({ command: "mcp", argv });
	});

	it("rejects implicit project paths", () => {
		expect(() =>
			resolveTrickroomCommand(["node", "trickroom", "/project"]),
		).toThrow('Use "trickroom serve [project]"');
	});
});
