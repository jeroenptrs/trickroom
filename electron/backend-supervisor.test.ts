import { describe, expect, it } from "vitest";
import {
	createBackendEnvironment,
	isBackendReadyMessage,
} from "./backend-supervisor";

describe("backend supervisor helpers", () => {
	it("recognizes structured backend readiness messages", () => {
		expect(
			isBackendReadyMessage({
				type: "trickroom:server-ready",
				version: 1,
				host: "127.0.0.1",
				port: 18100,
				url: "http://127.0.0.1:18100/",
				electronMode: true,
			}),
		).toBe(true);

		expect(
			isBackendReadyMessage({
				type: "trickroom:server-ready",
				version: 1,
				host: "127.0.0.1",
				port: 0,
				url: "http://127.0.0.1:0/",
				electronMode: true,
			}),
		).toBe(false);
	});

	it("creates the Electron backend environment", () => {
		expect(
			createBackendEnvironment({
				initialProjectRoot: "/tmp/project",
				trickroomHome: "/tmp/home",
				sessionToken: "token",
			}),
		).toMatchObject({
			ELECTRON_RUN_AS_NODE: "1",
			TRICKROOM_ELECTRON: "1",
			TRICKROOM_HTTP_HOST: "127.0.0.1",
			TRICKROOM_HTTP_PORT: "0",
			TRICKROOM_READY_JSON: "1",
			TRICKROOM_PROJECT_DIR: "/tmp/project",
			TRICKROOM_HOME: "/tmp/home",
			TRICKROOM_SESSION_TOKEN: "token",
		});
	});
});
