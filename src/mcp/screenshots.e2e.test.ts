import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesignUuid,
} from "./test-support";

describe.runIf(process.env.TRICKROOM_SCREENSHOT_E2E === "1")(
	"MCP screenshot browser integration",
	() => {
		let fixture: TrickroomMcpProjectFixture | null = null;
		let session: TrickroomMcpClientSession | null = null;

		afterEach(async () => {
			await session?.close();
			await fixture?.cleanup();
		});

		it("starts a project-scoped capture host and returns a real PNG", async () => {
			fixture = await createTrickroomMcpProjectFixture();
			session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			const result = (await session.client.callTool(
				{
					name: "screenshotNode",
					arguments: {
						designFileId: trickroomMcpTestDesignUuid,
						nodeId: "title",
						viewport: { width: 800, height: 600 },
					},
				},
				CallToolResultSchema,
			)) as CallToolResult;
			const image = result.content.find((item) => item.type === "image");

			expect(result.isError).not.toBe(true);
			expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
			if (image?.type === "image") {
				expect(Buffer.from(image.data, "base64").subarray(0, 8)).toEqual(
					Buffer.from("89504e470d0a1a0a", "hex"),
				);
			}
		});
	},
);
