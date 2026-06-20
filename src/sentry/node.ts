import * as Sentry from "@sentry/node";
import { resolveNodeSentryEnvironment } from "./environment";

export type SentryRuntime = "backend" | "mcp";

let initialized = false;

const readDsn = () =>
	process.env.TRICKROOM_SENTRY_DSN?.trim() || process.env.SENTRY_DSN?.trim();

const readSampleRate = (name: string) => {
	const raw = process.env[name]?.trim();
	if (!raw) return undefined;

	const value = Number(raw);
	return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
};

export const initNodeSentry = (runtime: SentryRuntime) => {
	if (initialized || process.env.VITEST === "true") {
		return initialized;
	}

	const dsn = readDsn();
	if (!dsn) {
		return false;
	}

	Sentry.init({
		dsn,
		environment: resolveNodeSentryEnvironment(),
		release: process.env.SENTRY_RELEASE,
		tracesSampleRate: readSampleRate("SENTRY_TRACES_SAMPLE_RATE"),
		attachStacktrace: true,
		initialScope: {
			tags: {
				runtime,
			},
		},
	});
	initialized = true;
	return true;
};

export const captureNodeException = (
	error: unknown,
	context?: {
		tags?: Record<string, string>;
		extra?: Record<string, unknown>;
	},
) => {
	if (!initialized) {
		return;
	}

	Sentry.withScope((scope) => {
		for (const [key, value] of Object.entries(context?.tags ?? {})) {
			scope.setTag(key, value);
		}
		for (const [key, value] of Object.entries(context?.extra ?? {})) {
			scope.setExtra(key, value);
		}
		Sentry.captureException(error);
	});
};
