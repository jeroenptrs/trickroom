import { describe, expect, it } from "vitest";
import type {
	AnnotationActor,
	AnnotationStatus,
	AnnotationTarget,
} from "../services/annotations.types";
import {
	type AnnotationPresentationState,
	annotationAnchorId,
	annotationTargetKey,
	compareAnnotationStates,
	describeAnnotationActor,
	describeChangeCount,
	formatAcknowledgement,
	getAnnotationPresentationState,
	groupAnnotationMarker,
	isAgentResolved,
	isAnnotationShown,
	isSameAnnotationMarker,
} from "./annotation-presentation";

const human: AnnotationActor = { role: "human" };
const agent: AnnotationActor = { role: "agent", sessionId: "session-1234567" };

const state = (status: AnnotationStatus, resolvedBy?: AnnotationActor) => ({
	status,
	resolvedBy,
});

describe("getAnnotationPresentationState", () => {
	it("reads a live status as itself", () => {
		for (const status of [
			"open",
			"acknowledged",
			"addressed",
			"needs_input",
		] as const) {
			expect(getAnnotationPresentationState(state(status), false)).toBe(status);
		}
	});

	it("separates agent-resolved from human-resolved", () => {
		expect(
			getAnnotationPresentationState(state("resolved", agent), false),
		).toBe("agent_resolved");
		expect(
			getAnnotationPresentationState(state("resolved", human), false),
		).toBe("resolved");
		expect(getAnnotationPresentationState(state("resolved"), false)).toBe(
			"resolved",
		);
	});

	it("only flags the detached state on live annotations", () => {
		expect(getAnnotationPresentationState(state("open"), true)).toBe(
			"detached",
		);
		expect(getAnnotationPresentationState(state("needs_input"), true)).toBe(
			"detached",
		);
		expect(getAnnotationPresentationState(state("resolved", human), true)).toBe(
			"resolved",
		);
		expect(getAnnotationPresentationState(state("resolved", agent), true)).toBe(
			"agent_resolved",
		);
		expect(getAnnotationPresentationState(state("dismissed"), true)).toBe(
			"dismissed",
		);
	});
});

describe("isAgentResolved", () => {
	it("needs both resolved status and an agent resolver", () => {
		expect(isAgentResolved(state("resolved", agent))).toBe(true);
		expect(isAgentResolved(state("open", agent))).toBe(false);
		expect(isAgentResolved(state("resolved", human))).toBe(false);
	});
});

describe("isAnnotationShown", () => {
	it("shows closed ones only with showResolved", () => {
		expect(isAnnotationShown({ status: "open" }, false)).toBe(true);
		expect(isAnnotationShown({ status: "resolved" }, false)).toBe(false);
		expect(isAnnotationShown({ status: "dismissed" }, false)).toBe(false);
		expect(isAnnotationShown({ status: "dismissed" }, true)).toBe(true);
	});
});

describe("compareAnnotationStates", () => {
	it("orders by urgency", () => {
		const order: AnnotationPresentationState[] = [
			"dismissed",
			"draft",
			"open",
			"addressed",
			"needs_input",
			"resolved",
		];
		expect([...order].sort(compareAnnotationStates)).toEqual([
			"needs_input",
			"addressed",
			"open",
			"draft",
			"resolved",
			"dismissed",
		]);
	});
});

describe("groupAnnotationMarker", () => {
	it("is null for no annotations", () => {
		expect(groupAnnotationMarker([])).toBeNull();
	});

	it("counts and picks the most urgent state", () => {
		expect(groupAnnotationMarker(["open", "open"])).toEqual({
			count: 2,
			state: "open",
		});
		expect(
			groupAnnotationMarker(["open", "addressed", "needs_input", "resolved"]),
		).toEqual({ count: 4, state: "needs_input" });
		expect(groupAnnotationMarker(["open", "addressed"])?.state).toBe(
			"addressed",
		);
	});

	it("ranks drafts below open and closed ones last", () => {
		expect(groupAnnotationMarker(["draft", "open"])?.state).toBe("open");
		expect(groupAnnotationMarker(["resolved", "draft"])?.state).toBe("draft");
		expect(groupAnnotationMarker(["dismissed", "resolved"])?.state).toBe(
			"resolved",
		);
		expect(groupAnnotationMarker(["agent_resolved", "resolved"])?.state).toBe(
			"agent_resolved",
		);
	});
});

describe("isSameAnnotationMarker", () => {
	it("compares count and state", () => {
		const marker = { count: 2, state: "open" } as const;
		expect(isSameAnnotationMarker(marker, marker)).toBe(true);
		expect(isSameAnnotationMarker(marker, { count: 2, state: "open" })).toBe(
			true,
		);
		expect(isSameAnnotationMarker(marker, { count: 3, state: "open" })).toBe(
			false,
		);
		expect(
			isSameAnnotationMarker(marker, { count: 2, state: "addressed" }),
		).toBe(false);
	});

	it("treats null and undefined as nothing, but not as a marker", () => {
		expect(isSameAnnotationMarker(null, null)).toBe(true);
		expect(isSameAnnotationMarker(undefined, undefined)).toBe(true);
		expect(isSameAnnotationMarker(null, { count: 1, state: "open" })).toBe(
			false,
		);
		expect(isSameAnnotationMarker({ count: 1, state: "open" }, undefined)).toBe(
			false,
		);
	});
});

describe("formatAcknowledgement", () => {
	const now = Date.parse("2026-10-14T12:00:00.000Z");
	const ago = (ms: number) => new Date(now - ms).toISOString();

	it("says just now under a minute", () => {
		expect(formatAcknowledgement({ at: ago(30_000), active: true }, now)).toBe(
			"Seen by an agent just now",
		);
	});

	it("counts minutes under an hour", () => {
		expect(
			formatAcknowledgement({ at: ago(3 * 60_000), active: true }, now),
		).toBe("Seen by an agent 3 min ago");
		expect(
			formatAcknowledgement(
				{ at: ago(59 * 60_000 + 59_000), active: true },
				now,
			),
		).toBe("Seen by an agent 59 min ago");
	});

	it("counts whole hours after that", () => {
		expect(
			formatAcknowledgement({ at: ago(60 * 60_000), active: true }, now),
		).toBe("Seen by an agent 1 h ago");
		expect(
			formatAcknowledgement({ at: ago(150 * 60_000), active: true }, now),
		).toBe("Seen by an agent 2 h ago");
	});

	it("marks an inactive session as idle", () => {
		expect(
			formatAcknowledgement({ at: ago(5 * 60_000), active: false }, now),
		).toBe("Seen by an agent 5 min ago (session idle)");
	});

	it("does not go negative for clock skew and tolerates bad dates", () => {
		expect(
			formatAcknowledgement(
				{ at: new Date(now + 60_000).toISOString(), active: true },
				now,
			),
		).toBe("Seen by an agent just now");
		expect(formatAcknowledgement({ at: "garbage", active: false }, now)).toBe(
			"Seen by an agent (session idle)",
		);
	});
});

describe("describeAnnotationActor", () => {
	it("names the human You and an agent by short session id", () => {
		expect(describeAnnotationActor(human)).toBe("You");
		expect(describeAnnotationActor(agent)).toBe("Agent session-");
	});
});

describe("annotationTargetKey", () => {
	it("keys design, board and layer targets", () => {
		expect(annotationTargetKey({ kind: "design", designId: "d" })).toBe(
			"design:d",
		);
		expect(
			annotationTargetKey({ kind: "board", designId: "d", boardId: "b" }),
		).toBe("board:d/b");
		expect(
			annotationTargetKey({
				kind: "layer",
				designId: "d",
				boardId: "b",
				elementId: "e",
			}),
		).toBe("layer:d/e");
	});

	it("keys a component node by its path, pinned or not (one draft per node)", () => {
		const base = {
			kind: "componentNode",
			systemId: "s",
			componentId: "c",
			nodePath: "label",
		} as const;
		expect(annotationTargetKey(base)).toBe("node:s/c/label");
		expect(annotationTargetKey({ ...base, variants: {} })).toBe(
			"node:s/c/label",
		);
		expect(
			annotationTargetKey({
				...base,
				variants: { size: "lg", tone: "primary" },
			}),
		).toBe("node:s/c/label");
	});
});

describe("annotationAnchorId", () => {
	it("anchors layers, boards and component nodes, but not the design", () => {
		const targets: AnnotationTarget[] = [
			{ kind: "layer", designId: "d", boardId: "b", elementId: "e" },
			{ kind: "board", designId: "d", boardId: "b" },
			{ kind: "componentNode", systemId: "s", componentId: "c", nodePath: "0" },
			{ kind: "design", designId: "d" },
		];
		expect(targets.map(annotationAnchorId)).toEqual(["e", "b", "0", null]);
	});
});

describe("describeChangeCount", () => {
	it("pluralizes layers", () => {
		expect(describeChangeCount(1)).toBe("Changed 1 layer");
		expect(describeChangeCount(0)).toBe("Changed 0 layers");
		expect(describeChangeCount(3)).toBe("Changed 3 layers");
	});
});
