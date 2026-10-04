import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createServerDiscoveryPublisher,
	getServerDiscoveryRecordPath,
	listServerDiscoveryRecords,
	parseServerDiscoveryRecord,
	resolveLoopbackServerUrl,
	resolveRuntimeServersDir,
} from "./runtime-servers";

describe("server discovery records", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots
				.splice(0)
				.map((root) => rm(root, { force: true, recursive: true })),
		);
	});

	const tempHome = async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "trickroom-runtime-"));
		tempRoots.push(root);
		return root;
	};

	it("dials wildcard binds through 127.0.0.1 and brackets IPv6", () => {
		expect(resolveLoopbackServerUrl("0.0.0.0", 18100)).toBe(
			"http://127.0.0.1:18100/",
		);
		expect(resolveLoopbackServerUrl("::", 4000)).toBe("http://127.0.0.1:4000/");
		expect(resolveLoopbackServerUrl("::1", 4000)).toBe("http://[::1]:4000/");
		expect(resolveLoopbackServerUrl("127.0.0.1", 4000)).toBe(
			"http://127.0.0.1:4000/",
		);
	});

	it("writes a private record, follows the project and removes it on dispose", async () => {
		const home = await tempHome();
		const publisher = createServerDiscoveryPublisher({
			home,
			pid: 4242,
			url: "http://127.0.0.1:18100/",
			token: "secret",
			startedAt: new Date("2026-10-04T10:00:00.000Z"),
			handleProcessExit: false,
		});
		const recordPath = getServerDiscoveryRecordPath(home, 4242);
		expect(publisher.recordPath).toBe(recordPath);

		const read = async () => JSON.parse(await readFile(recordPath, "utf8"));
		expect(await read()).toEqual({
			version: 1,
			pid: 4242,
			url: "http://127.0.0.1:18100/",
			token: "secret",
			projectId: null,
			projectRoot: null,
			startedAt: "2026-10-04T10:00:00.000Z",
		});
		if (process.platform !== "win32") {
			expect((await stat(recordPath)).mode & 0o777).toBe(0o600);
			expect((await stat(resolveRuntimeServersDir(home))).mode & 0o777).toBe(
				0o700,
			);
		}

		publisher.setProject({ projectId: "proj_1", projectRoot: "/work/app" });
		expect(await read()).toMatchObject({
			projectId: "proj_1",
			projectRoot: "/work/app",
		});

		publisher.dispose();
		await expect(stat(recordPath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("leaves a record written by a newer server in the same process", async () => {
		const home = await tempHome();
		const first = createServerDiscoveryPublisher({
			home,
			pid: 7,
			url: "http://127.0.0.1:1/",
			token: null,
			startedAt: new Date(1_000),
			handleProcessExit: false,
		});
		const second = createServerDiscoveryPublisher({
			home,
			pid: 7,
			url: "http://127.0.0.1:2/",
			token: null,
			startedAt: new Date(2_000),
			handleProcessExit: false,
		});

		first.dispose();
		const entries = await listServerDiscoveryRecords(home);
		expect(entries.map((entry) => entry.record?.url)).toEqual([
			"http://127.0.0.1:2/",
		]);
		second.dispose();
		expect(await listServerDiscoveryRecords(home)).toEqual([]);
	});

	it("lists records and reports unreadable ones as null", async () => {
		const home = await tempHome();
		createServerDiscoveryPublisher({
			home,
			pid: 11,
			url: "http://127.0.0.1:3/",
			token: null,
			handleProcessExit: false,
		});
		await writeFile(
			path.join(resolveRuntimeServersDir(home), "12.json"),
			"{not json",
		);
		await writeFile(
			path.join(resolveRuntimeServersDir(home), "notes.txt"),
			"ignored",
		);

		const entries = await listServerDiscoveryRecords(home);
		expect(
			entries
				.map((entry) => [path.basename(entry.path), entry.record?.pid ?? null])
				.sort(),
		).toEqual([
			["11.json", 11],
			["12.json", null],
		]);
	});

	it("returns no records when the runtime directory does not exist", async () => {
		expect(await listServerDiscoveryRecords(await tempHome())).toEqual([]);
	});

	it("rejects malformed records", () => {
		const valid = {
			version: 1,
			pid: 1,
			url: "http://127.0.0.1:1/",
			token: null,
			projectId: null,
			projectRoot: null,
			startedAt: "2026-01-01T00:00:00.000Z",
		};
		expect(parseServerDiscoveryRecord(valid)).toEqual(valid);
		expect(parseServerDiscoveryRecord({ ...valid, version: 2 })).toBeNull();
		expect(parseServerDiscoveryRecord({ ...valid, pid: -1 })).toBeNull();
		expect(parseServerDiscoveryRecord({ ...valid, url: "nope" })).toBeNull();
		expect(parseServerDiscoveryRecord({ ...valid, token: 3 })).toBeNull();
	});
});
