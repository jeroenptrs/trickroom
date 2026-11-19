import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	listAuthSessions,
	redeemPairingCode,
} from "../app-state/auth-sessions";
import { main, parseSessionDays } from "./auth";

describe("trickroom pair and sessions", () => {
	let home: string;
	let out: string[];
	let err: string[];
	const run = (command: "pair" | "sessions", ...args: string[]) =>
		main(command, args, {
			trickroomHome: home,
			output: { out: (line) => out.push(line), err: (line) => err.push(line) },
		});

	beforeEach(async () => {
		home = await mkdtemp(path.join(os.tmpdir(), "trickroom-auth-cli-"));
		out = [];
		err = [];
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	it("prints a code that pairs a browser for the days asked", async () => {
		expect(await run("pair", "--days", "7", "--json")).toBe(0);
		const printed = JSON.parse(out[0] ?? "{}") as {
			code: string;
			sessionDays: number;
		};

		const redeemed = await redeemPairingCode({
			trickroomHome: home,
			code: printed.code,
		});

		expect(printed.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u);
		expect(printed.sessionDays).toBe(7);
		expect(redeemed?.session.sessionDays).toBe(7);
	});

	it("says so when no server is running", async () => {
		expect(await run("pair")).toBe(0);

		expect(out[0]).toMatch(/^Pairing code: /u);
		expect(out[1]).toContain("30 days");
		expect(err.join("\n")).toContain("No Trickroom server is running");
	});

	it("refuses a session length it cannot use", async () => {
		expect(await run("pair", "--days", "0")).toBe(1);
		expect(err[0]).toContain("from 1 to 365");
		expect(parseSessionDays(undefined, { TRICKROOM_SESSION_DAYS: "3" })).toBe(
			3,
		);
		expect(parseSessionDays(undefined, {})).toBe(30);
	});

	it("lists sessions and signs them out by id", async () => {
		await run("pair", "--json");
		const { code } = JSON.parse(out[0] ?? "{}") as { code: string };
		const redeemed = await redeemPairingCode({
			trickroomHome: home,
			code,
			userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/130.0",
		});
		const id = redeemed?.session.id ?? "";
		out = [];

		expect(await run("sessions")).toBe(0);
		expect(out[0]).toContain(id);
		expect(out[0]).toContain("Chrome on macOS");
		expect(await run("sessions", "revoke", "nope")).toBe(1);
		expect(await run("sessions", "revoke", id.slice(0, 5))).toBe(0);

		expect(out.at(-1)).toBe(`Signed out ${id} (Chrome on macOS)`);
		expect(await listAuthSessions(home)).toEqual([]);
	});

	it("has nothing to list before a browser pairs", async () => {
		expect(await run("sessions")).toBe(0);
		expect(out[0]).toContain("No browser is signed in");
		expect(await run("sessions", "revoke", "--all")).toBe(0);
	});
});
