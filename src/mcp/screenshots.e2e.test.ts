import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import type { Node as DesignNode, TrickroomDesign } from "../types";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesign,
	trickroomMcpTestDesignUuid,
} from "./test-support";

const node = (
	id: string,
	library: string,
	component: string,
	props: Record<string, unknown>,
	children: DesignNode["children"] = [],
): DesignNode => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": library,
		"data-trickroom-component": component,
		...props,
	},
	children,
});

const text = (id: string, value: string) =>
	node(id, "trickroom", "text", { "data-trickroom-role": "text" }, value);

/** A board with an open dialog whose popup sits at `popupClassName`. */
const dialogBoard = (id: string, popupClassName: string) =>
	node(
		id,
		"trickroom",
		"container",
		{ className: "flex w-full flex-col p-4" },
		[
			text(`${id}-page`, "Page content"),
			node(`${id}-root`, "base-ui", "dialog.root", { defaultOpen: true }, [
				node(`${id}-portal`, "base-ui", "dialog.portal", {}, [
					node(`${id}-backdrop`, "base-ui", "dialog.backdrop", {
						className: "fixed inset-0 bg-[#00000080]",
					}),
					node(
						`${id}-popup`,
						"base-ui",
						"dialog.popup",
						{
							className: `fixed w-[320px] bg-[#ffffff] p-4 ${popupClassName}`,
						},
						[text(`${id}-title`, "Dialog title")],
					),
				]),
			]),
		],
	);

const overlayDesignUuid = "00000000-0000-4000-8000-0000000000d1";
const overlayDesign = {
	...trickroomMcpTestDesign,
	name: "Overlay fixtures",
	boards: [
		dialogBoard(
			"centered",
			"left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
		),
		dialogBoard("offboard", "left-0 top-[1400px] h-20"),
	],
} satisfies TrickroomDesign;

const imageSize = (data: string) => {
	const png = Buffer.from(data, "base64");
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

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

		it("keeps an open dialog contained in its board at every viewport", async () => {
			fixture = await createTrickroomMcpProjectFixture({
				designs: { [overlayDesignUuid]: overlayDesign },
			});
			session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			const result = (await session.client.callTool(
				{
					name: "screenshotBoard",
					arguments: {
						designFileId: overlayDesignUuid,
						boardId: "centered",
						viewport: ["mobile", "desktop"],
						scale: 1,
					},
				},
				CallToolResultSchema,
			)) as CallToolResult;
			const images = result.content.flatMap((item) =>
				item.type === "image" ? [imageSize(item.data)] : [],
			);
			const summary =
				result.content[0]?.type === "text" ? result.content[0].text : "";

			expect(result.isError).not.toBe(true);
			// The board has no height of its own: while the dialog is open it
			// gets the viewport height, as in the responsive view.
			expect(images).toEqual([
				{ width: 390, height: 844 },
				{ width: 1440, height: 900 },
			]);
			expect(summary).not.toContain("Warnings");

			const popup = (await session.client.callTool(
				{
					name: "screenshotNode",
					arguments: {
						designFileId: overlayDesignUuid,
						nodeId: "centered-popup",
						viewport: "mobile",
					},
				},
				CallToolResultSchema,
			)) as CallToolResult;
			const popupImage = popup.content.find((item) => item.type === "image");
			expect(popup.isError).not.toBe(true);
			expect(
				popupImage?.type === "image" ? imageSize(popupImage.data).width : 0,
			).toBe(320);
		});

		it("warns when an overlay extends past the captured board", async () => {
			fixture = await createTrickroomMcpProjectFixture({
				designs: { [overlayDesignUuid]: overlayDesign },
			});
			session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			const result = (await session.client.callTool(
				{
					name: "screenshotBoard",
					arguments: {
						designFileId: overlayDesignUuid,
						boardId: "offboard",
						viewport: "mobile",
					},
				},
				CallToolResultSchema,
			)) as CallToolResult;
			const summary =
				result.content[0]?.type === "text" ? result.content[0].text : "";

			expect(result.isError).not.toBe(true);
			expect(summary).toContain("OVERLAY_CLIPPED");
		});

		it("captures a system component variant matrix without a design file", async () => {
			fixture = await createTrickroomMcpProjectFixture();
			session = await createTrickroomMcpTestClient(
				await fixture.readMcpContext(),
			);
			const listed = await session.client.callTool({
				name: "listSystemComponents",
				arguments: { systemName: "Core" },
			});
			await session.client.callTool({
				name: "createSystemComponentDraft",
				arguments: {
					systemName: "Core",
					expectedRevision: listed.structuredContent?.revision,
					slug: "chip",
					name: "Chip",
					draft: {
						root: {
							path: "root",
							library: "trickroom",
							component: "text",
							text: "Chip",
							className: "inline-block px-2 py-1",
						},
						variants: {
							axes: {
								tone: {
									label: "Tone",
									defaultValue: "plain",
									values: {
										plain: { classesByPath: { root: "bg-[#eeeeee]" } },
										loud: { classesByPath: { root: "bg-[#ff0066]" } },
									},
								},
							},
						},
					},
				},
			});
			const result = (await session.client.callTool(
				{
					name: "screenshotBoard",
					arguments: { component: { componentId: "chip", matrix: "tone" } },
				},
				CallToolResultSchema,
			)) as CallToolResult;
			const image = result.content.find((item) => item.type === "image");

			expect(result.isError).not.toBe(true);
			expect(
				image?.type === "image" ? imageSize(image.data).height : 0,
			).toBeGreaterThan(60);
		});
	},
);
