import { describe, expect, it } from "vitest";
import type { EditorContextReport } from "./editor-channel.types";
import {
	createEditorSessions,
	isEditorClientId,
	parseEditorContextReport,
} from "./editor-sessions";

const report = (
	overrides: Partial<EditorContextReport> = {},
): EditorContextReport => ({
	clientId: "tab-a",
	projectId: "proj_1",
	designFileId: "design-1",
	activeBoardId: "board-1",
	selectedId: null,
	stageMode: "canvas",
	responsiveWidth: 640,
	focusedAt: null,
	visible: true,
	sentAt: 0,
	...overrides,
});

const createClock = (start = 1_000_000) => {
	let time = start;
	return {
		now: () => time,
		advance: (ms: number) => {
			time += ms;
		},
	};
};

describe("editor sessions", () => {
	it("lists only connected tabs that have reported, with their age", () => {
		const clock = createClock();
		const sessions = createEditorSessions({ now: clock.now });
		sessions.connect("tab-a", () => undefined);
		expect(sessions.list().clients).toEqual([]);

		sessions.report(report({ sentAt: clock.now() }));
		clock.advance(250);
		const { clients } = sessions.list();
		expect(clients).toHaveLength(1);
		expect(clients[0]).toMatchObject({
			clientId: "tab-a",
			designFileId: "design-1",
			activeBoardId: "board-1",
			ageMs: 250,
		});

		// A report without a stream (a closed tab's late request) is not listed.
		sessions.report(report({ clientId: "tab-b", sentAt: clock.now() }));
		expect(sessions.list().clients.map((client) => client.clientId)).toEqual([
			"tab-a",
		]);
	});

	it("drops a tab when its last stream closes", () => {
		const sessions = createEditorSessions();
		const closeFirst = sessions.connect("tab-a", () => undefined);
		const closeSecond = sessions.connect("tab-a", () => undefined);
		sessions.report(report({ sentAt: Date.now() }));

		closeFirst();
		expect(sessions.list().clients).toHaveLength(1);
		closeSecond();
		expect(sessions.list().clients).toEqual([]);
	});

	it("orders tabs by focus time corrected for each tab's clock", () => {
		const clock = createClock(10_000);
		const sessions = createEditorSessions({ now: clock.now });
		sessions.connect("tab-a", () => undefined);
		sessions.connect("tab-b", () => undefined);

		// tab-a's clock runs 5s ahead of the server: focused 1s ago in real time.
		sessions.report(
			report({ clientId: "tab-a", focusedAt: 14_000, sentAt: 15_000 }),
		);
		// tab-b's clock matches the server: focused 500ms ago.
		sessions.report(
			report({ clientId: "tab-b", focusedAt: 9_500, sentAt: 10_000 }),
		);

		const listed = sessions.list();
		expect(listed.mostRecentlyFocusedClientId).toBe("tab-b");
		expect(listed.clients.map((client) => client.focusedAt)).toEqual([
			new Date(9_500).toISOString(),
			new Date(9_000).toISOString(),
		]);
	});

	it("falls back to the latest report when no tab was focused", () => {
		const clock = createClock();
		const sessions = createEditorSessions({ now: clock.now });
		sessions.connect("tab-a", () => undefined);
		sessions.connect("tab-b", () => undefined);
		sessions.report(report({ clientId: "tab-a", sentAt: clock.now() }));
		clock.advance(10);
		sessions.report(report({ clientId: "tab-b", sentAt: clock.now() }));

		expect(sessions.list().mostRecentlyFocusedClientId).toBe("tab-b");
	});
});

describe("editor context reports", () => {
	it("accepts a well-formed report and normalizes empty fields", () => {
		expect(
			parseEditorContextReport({
				...report({ sentAt: 5 }),
				designFileId: "",
				stageMode: "zoomed",
			}),
		).toEqual({
			...report({ sentAt: 5 }),
			designFileId: null,
			stageMode: null,
		});
	});

	it("rejects reports without a usable client id, visibility or send time", () => {
		expect(parseEditorContextReport(null)).toBeNull();
		expect(
			parseEditorContextReport({ ...report(), clientId: "../etc" }),
		).toBeNull();
		expect(
			parseEditorContextReport({ ...report(), visible: "yes" }),
		).toBeNull();
		expect(parseEditorContextReport({ ...report(), sentAt: "now" })).toBeNull();
	});

	it("limits client ids to a safe token", () => {
		expect(isEditorClientId("0b8e4c1e-2f6a-4d1b-9a43-1c2d3e4f5a6b")).toBe(true);
		expect(isEditorClientId("")).toBe(false);
		expect(isEditorClientId("a b")).toBe(false);
		expect(isEditorClientId("x".repeat(129))).toBe(false);
	});
});
