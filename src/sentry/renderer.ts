import * as Sentry from "@sentry/electron/renderer";

const readSampleRate = (value: string | undefined) => {
	if (!value) return undefined;

	const sampleRate = Number(value);
	return Number.isFinite(sampleRate) && sampleRate >= 0 && sampleRate <= 1
		? sampleRate
		: undefined;
};

const resolveRendererSentryEnvironment = () =>
	import.meta.env.VITE_SENTRY_ENVIRONMENT ??
	import.meta.env.VITE_TRICKROOM_RUNTIME_ENV ??
	(import.meta.env.MODE === "test"
		? "test"
		: import.meta.env.PROD
			? "production"
			: "development");

export const initRendererSentry = () => {
	const dsn = (
		__TRICKROOM_SENTRY_DSN__ ?? import.meta.env.VITE_SENTRY_DSN
	)?.trim();
	if (!dsn) {
		return false;
	}

	Sentry.init({
		dsn,
		environment: resolveRendererSentryEnvironment(),
		release: import.meta.env.VITE_SENTRY_RELEASE,
		tracesSampleRate: readSampleRate(
			import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
		),
		attachStacktrace: true,
		initialScope: {
			tags: {
				runtime: "renderer",
			},
		},
	});
	return true;
};
