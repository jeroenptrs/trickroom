import * as Sentry from "@sentry/electron/main";
import { app } from "electron";
import { resolveNodeSentryEnvironment } from "../src/sentry/environment";

const readDsn = () =>
	process.env.TRICKROOM_SENTRY_DSN?.trim() || process.env.SENTRY_DSN?.trim();

const readSampleRate = (name: string) => {
	const raw = process.env[name]?.trim();
	if (!raw) return undefined;

	const value = Number(raw);
	return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
};

export const initElectronMainSentry = () => {
	if (process.env.VITEST === "true") {
		return false;
	}

	const dsn = readDsn();
	if (!dsn) {
		return false;
	}

	Sentry.init({
		dsn,
		environment: resolveNodeSentryEnvironment(
			app.isPackaged ? "production" : "development",
		),
		release: process.env.SENTRY_RELEASE,
		tracesSampleRate: readSampleRate("SENTRY_TRACES_SAMPLE_RATE"),
		attachStacktrace: true,
		initialScope: {
			tags: {
				runtime: "electron-main",
			},
		},
	});
	return true;
};
