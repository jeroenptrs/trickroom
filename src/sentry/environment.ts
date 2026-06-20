export type SentryEnvironment = "development" | "production" | "test" | "smoke";

const explicitEnvironment = (value: string | undefined) => {
	const normalized = value?.trim();
	return normalized && normalized.length > 0 ? normalized : undefined;
};

export const resolveNodeSentryEnvironment = (
	fallback: SentryEnvironment = "development",
) =>
	explicitEnvironment(process.env.SENTRY_ENVIRONMENT) ??
	explicitEnvironment(process.env.TRICKROOM_RUNTIME_ENV) ??
	(process.env.VITEST === "true"
		? "test"
		: process.env.TRICKROOM_ELECTRON_SMOKE === "1"
			? "smoke"
			: process.env.NODE_ENV === "production"
				? "production"
				: fallback);
