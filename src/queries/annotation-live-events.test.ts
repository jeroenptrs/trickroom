import { describe, expect, it, vi } from "vitest";
import type { AnnotationFileEvent } from "../services/annotations.types";
import {
	deliverAnnotationEvent,
	deliverAnnotationRoundEvent,
	parseAnnotationFileEvent,
	parseAnnotationRoundEvent,
	requestAnnotationResync,
	subscribeAnnotationEvents,
	subscribeAnnotationResync,
	subscribeAnnotationRound,
} from "./annotation-live-events";

const frame = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		annotationId: "a1",
		container: { kind: "design", designId: "d1" },
		operation: "changed",
		revision: "rev-1",
		...overrides,
	});

describe("parseAnnotationFileEvent", () => {
	it("accepts a design container frame", () => {
		expect(parseAnnotationFileEvent(frame())).toEqual({
			annotationId: "a1",
			container: { kind: "design", designId: "d1" },
			operation: "changed",
			revision: "rev-1",
		});
	});

	it("accepts a component container frame", () => {
		const container = { kind: "component", systemId: "s", componentId: "c" };
		expect(parseAnnotationFileEvent(frame({ container }))?.container).toEqual(
			container,
		);
	});

	it("accepts a deleted frame with a null revision", () => {
		expect(
			parseAnnotationFileEvent(frame({ operation: "deleted", revision: null })),
		).toMatchObject({ operation: "deleted", revision: null });
	});

	it("drops unknown extra fields", () => {
		const event = parseAnnotationFileEvent(frame({ extra: true }));
		expect(event).not.toHaveProperty("extra");
	});

	it.each([
		["invalid JSON", "{nope"],
		["null", "null"],
		["a number", "3"],
		["a missing annotationId", frame({ annotationId: undefined })],
		["a numeric annotationId", frame({ annotationId: 7 })],
		["a missing container", frame({ container: undefined })],
		["a null container", frame({ container: null })],
		["an unknown container kind", frame({ container: { kind: "board" } })],
		[
			"a design container without designId",
			frame({ container: { kind: "design" } }),
		],
		[
			"a component container without componentId",
			frame({ container: { kind: "component", systemId: "s" } }),
		],
		["an unknown operation", frame({ operation: "created" })],
		["a missing revision", frame({ revision: undefined })],
		["a numeric revision", frame({ revision: 3 })],
	])("rejects %s", (_name, data) => {
		expect(parseAnnotationFileEvent(data)).toBeNull();
	});
});

describe("annotation event delivery", () => {
	const event: AnnotationFileEvent = {
		annotationId: "a1",
		container: { kind: "design", designId: "d1" },
		operation: "changed",
		revision: "r1",
	};

	it("reaches every subscriber", () => {
		const first = vi.fn();
		const second = vi.fn();
		const stopFirst = subscribeAnnotationEvents(first);
		const stopSecond = subscribeAnnotationEvents(second);
		deliverAnnotationEvent(event);
		expect(first).toHaveBeenCalledWith(event);
		expect(second).toHaveBeenCalledWith(event);
		stopFirst();
		stopSecond();
	});

	it("stops after unsubscribing", () => {
		const listener = vi.fn();
		const stop = subscribeAnnotationEvents(listener);
		deliverAnnotationEvent(event);
		stop();
		deliverAnnotationEvent(event);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("does nothing without subscribers", () => {
		expect(() => deliverAnnotationEvent(event)).not.toThrow();
	});
});

describe("annotation resync", () => {
	it("reaches subscribers until they unsubscribe", () => {
		const listener = vi.fn();
		const other = vi.fn();
		const stop = subscribeAnnotationResync(listener);
		const stopOther = subscribeAnnotationResync(other);
		requestAnnotationResync();
		stop();
		requestAnnotationResync();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(other).toHaveBeenCalledTimes(2);
		stopOther();
	});

	it("is independent from event subscribers", () => {
		const events = vi.fn();
		const stop = subscribeAnnotationEvents(events);
		requestAnnotationResync();
		expect(events).not.toHaveBeenCalled();
		stop();
	});
});

describe("annotation round events", () => {
	const container = { kind: "design", designId: "d1" };

	it("parses a frame", () => {
		expect(
			parseAnnotationRoundEvent(JSON.stringify({ roundId: "R1", container })),
		).toEqual({ roundId: "R1", container });
	});

	it.each([
		["invalid JSON", "{nope"],
		["null", "null"],
		["a missing roundId", JSON.stringify({ container })],
		["a missing container", JSON.stringify({ roundId: "R1" })],
		[
			"an unknown container kind",
			JSON.stringify({ roundId: "R1", container: { kind: "board" } }),
		],
	])("rejects %s", (_name, data) => {
		expect(parseAnnotationRoundEvent(data)).toBeNull();
	});

	it("reaches subscribers until they unsubscribe", () => {
		const listener = vi.fn();
		const stop = subscribeAnnotationRound(listener);
		const event = { roundId: "R1", container: container as never };
		deliverAnnotationRoundEvent(event);
		stop();
		deliverAnnotationRoundEvent(event);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(event);
	});
});
