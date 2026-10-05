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

describe("editor focus requests", () => {
	const target = { designFileId: "design-2", boardId: null, elementId: "l1" };

	/** Connects a tab that acknowledges every focus event it receives. */
	const connectAcking = (
		sessions: ReturnType<typeof createEditorSessions>,
		clientId: string,
		status: "ok" | "blocked_dirty" = "ok",
	) => {
		const received: unknown[] = [];
		sessions.connect(clientId, (event, data) => {
			if (event !== "focus") return;
			const payload = JSON.parse(data) as { requestId: string };
			received.push(payload);
			queueMicrotask(() =>
				sessions.acknowledgeFocus({
					clientId,
					requestId: payload.requestId,
					status,
					outcome: status === "ok" ? "navigated" : null,
				}),
			);
		});
		return received;
	};

	it("reports no_browser without connected tabs", async () => {
		const sessions = createEditorSessions();
		expect(
			await sessions.requestFocus({ target, projectId: "proj_1" }),
		).toMatchObject({ status: "no_browser", clientId: null });
	});

	it("sends focus only to the most recently focused tab on the project", async () => {
		const clock = createClock();
		const sessions = createEditorSessions({ now: clock.now });
		const tabA = connectAcking(sessions, "tab-a");
		const tabB = connectAcking(sessions, "tab-b");
		const tabC = connectAcking(sessions, "tab-c");
		sessions.report(
			report({ clientId: "tab-a", focusedAt: 100, sentAt: clock.now() }),
		);
		sessions.report(
			report({ clientId: "tab-b", focusedAt: 200, sentAt: clock.now() }),
		);
		// Focused last, but on another project.
		sessions.report(
			report({
				clientId: "tab-c",
				projectId: "proj_2",
				focusedAt: 300,
				sentAt: clock.now(),
			}),
		);

		const response = await sessions.requestFocus({
			target,
			projectId: "proj_1",
		});
		expect(response).toMatchObject({
			status: "ok",
			clientId: "tab-b",
			outcome: "navigated",
		});
		expect(tabA).toEqual([]);
		expect(tabC).toEqual([]);
		expect(tabB).toEqual([
			{ ...target, projectId: "proj_1", requestId: response.requestId },
		]);
	});

	it("targets an explicit tab", async () => {
		const sessions = createEditorSessions();
		connectAcking(sessions, "tab-a");
		const tabB = connectAcking(sessions, "tab-b");
		sessions.report(report({ clientId: "tab-a", focusedAt: 2, sentAt: 0 }));
		sessions.report(report({ clientId: "tab-b", focusedAt: 1, sentAt: 0 }));

		const response = await sessions.requestFocus({
			target,
			projectId: "proj_1",
			clientId: "tab-b",
		});
		expect(response).toMatchObject({ status: "ok", clientId: "tab-b" });
		expect(tabB).toHaveLength(1);
		expect(
			await sessions.requestFocus({
				target,
				projectId: "proj_1",
				clientId: "tab-z",
			}),
		).toMatchObject({ status: "no_browser" });
	});

	it("reports browser_on_other_project when no tab shows the project", async () => {
		const sessions = createEditorSessions();
		const tab = connectAcking(sessions, "tab-a");
		sessions.report(report({ projectId: "proj_2", sentAt: 0 }));

		expect(
			await sessions.requestFocus({ target, projectId: "proj_1" }),
		).toMatchObject({ status: "browser_on_other_project" });
		expect(tab).toEqual([]);
	});

	it("passes the tab's blocked_dirty answer through", async () => {
		const sessions = createEditorSessions();
		connectAcking(sessions, "tab-a", "blocked_dirty");
		sessions.report(report({ sentAt: 0 }));

		expect(
			await sessions.requestFocus({ target, projectId: "proj_1" }),
		).toMatchObject({ status: "blocked_dirty", clientId: "tab-a" });
	});

	it("reports stale when the tab does not acknowledge in time", async () => {
		const sessions = createEditorSessions({ focusAckTimeoutMs: 20 });
		sessions.connect("tab-a", () => undefined);
		sessions.report(report({ sentAt: 0 }));

		const response = await sessions.requestFocus({
			target,
			projectId: "proj_1",
		});
		expect(response).toMatchObject({ status: "stale", clientId: "tab-a" });
		// A late acknowledgement is ignored.
		expect(
			sessions.acknowledgeFocus({
				clientId: "tab-a",
				requestId: response.requestId ?? "",
				status: "ok",
				outcome: "navigated",
			}),
		).toBe(false);
	});

	it("ignores acknowledgements from another tab", async () => {
		const sessions = createEditorSessions({ focusAckTimeoutMs: 50 });
		let requestId = "";
		sessions.connect("tab-a", (event, data) => {
			if (event === "focus") {
				requestId = (JSON.parse(data) as { requestId: string }).requestId;
			}
		});
		sessions.report(report({ sentAt: 0 }));

		const pending = sessions.requestFocus({ target, projectId: "proj_1" });
		expect(
			sessions.acknowledgeFocus({
				clientId: "tab-b",
				requestId,
				status: "ok",
				outcome: "navigated",
			}),
		).toBe(false);
		expect(await pending).toMatchObject({ status: "stale" });
	});
});
