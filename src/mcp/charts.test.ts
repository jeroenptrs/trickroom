import { afterEach, describe, expect, it } from "vitest";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	toolPayload,
	trickroomMcpTestDesign,
	trickroomMcpTestDesignUuid,
} from "./test-support";

const rows = Array.from({ length: 200 }, (_, index) => [
	1793400000000 + index * 60_000,
	40 + index / 10,
]);
const data = JSON.stringify({ columns: ["t", "cpu"], rows });

const createdId = (write: Record<string, unknown>) =>
	Object.values(write.created as Record<string, unknown>)
		.flat()
		.map((entry) =>
			typeof entry === "string" ? entry : (entry as { id: string }).id,
		)[0];

describe("chart elements through MCP", () => {
	const fixtures: Array<{ cleanup: () => Promise<void> }> = [];

	afterEach(async () => {
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
	});

	const setup = async () => {
		const fixture = await createTrickroomMcpProjectFixture({
			designs: { [trickroomMcpTestDesignUuid]: trickroomMcpTestDesign },
		});
		fixtures.push(fixture);
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		const call = async (name: string, args: Record<string, unknown>) =>
			toolPayload(await session.client.callTool({ name, arguments: args }));
		const read = await call("design_read", {
			designFileId: trickroomMcpTestDesignUuid,
		});
		const designFile = read.designFile as { revision: string };
		return { call, designFile };
	};

	const addChart = (props: Record<string, unknown>, boardId: string) => ({
		operation: "addElement",
		parameters: {
			parentId: boardId,
			index: 0,
			library: "charts",
			component: "chart",
			props,
		},
	});

	it("sets form and data with design_apply, and reads them back", async () => {
		const { call, designFile } = await setup();
		const write = await call("design_apply", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: designFile.revision,
			operations: [
				addChart(
					{ form: "stacked-bar", data, limits: '[{"value":90}]', ySuffix: "%" },
					"board",
				),
			],
		});
		expect(write.status).toBe("success");
		expect(write.warnings).toBeUndefined();
		const elementId = createdId(write);

		const compact = await call("design_read", {
			designFileId: trickroomMcpTestDesignUuid,
			elementId,
			depth: 0,
		});
		const node = JSON.stringify(compact);
		expect(node).toContain('"form":"stacked-bar"');
		expect(node).toContain("charts/chart");
		expect(node).toContain(`"dataLength":${data.length}`);
		expect(node.length).toBeLessThan(data.length);

		const full = await call("design_read", {
			designFileId: trickroomMcpTestDesignUuid,
			elementId,
			depth: 0,
			detail: "full",
		});
		expect(JSON.stringify(full)).toContain(JSON.stringify(data).slice(1, 60));
	});

	it("warns on a bad data string without refusing the write", async () => {
		const { call, designFile } = await setup();
		const write = await call("design_apply", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: designFile.revision,
			operations: [addChart({ data: "{nope" }, "board")],
		});
		expect(write.status).toBe("success");
		expect(JSON.stringify(write.warnings)).toContain("INVALID_CHART_PROP");
	});

	it("gives a new chart a size and renderable sample data", async () => {
		const { call, designFile } = await setup();
		const write = await call("design_apply", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: designFile.revision,
			operations: [addChart({}, "board")],
		});
		const elementId = createdId(write);
		const full = await call("design_read", {
			designFileId: trickroomMcpTestDesignUuid,
			elementId,
			depth: 0,
			detail: "full",
		});
		expect(JSON.stringify(full)).toContain("h-40 w-full");
		expect(JSON.stringify(full)).toContain("Series 1");
	});

	it("documents the elements with a worked example that applies", async () => {
		const { call, designFile } = await setup();
		const guide = await call("guide", { topic: "charts" });
		const topic = JSON.stringify(guide);
		expect(topic).toContain("charts/map");
		expect(topic).toContain("--chart-series-1");
		const example = (
			guide as unknown as {
				charts: {
					example: {
						arguments: {
							operations: Array<{ parameters: Record<string, unknown> }>;
						};
					};
				};
			}
		).charts.example;
		const [operation] = example.arguments.operations;
		const write = await call("design_apply", {
			designFileId: trickroomMcpTestDesignUuid,
			expectedRevision: designFile.revision,
			operations: [
				{
					...operation,
					parameters: {
						...operation.parameters,
						parentId: "board",
						index: 0,
					},
				},
			],
		});
		expect(write.status).toBe("success");
		expect(write.warnings).toBeUndefined();
	});
});
