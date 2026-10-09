import { parentPort } from "node:worker_threads";
import {
	type CanonicalizedClass,
	type ContextCheck,
	type ContextVerdict,
	canonicalizeAndVerifyTailwindCandidate,
	type StylesheetFacts,
	scanStylesheetFacts,
	verifyCanonicalInContext,
} from "./tailwind-canonical-equivalence.ts";
import { createCanonicalizeCache } from "./tailwind-canonicalize-cache.ts";
import {
	fileStampsAreFresh,
	loadTrackedTailwindDesignSystem,
	resolveTailwindCssPath,
	type TailwindDesignSystem,
} from "./tailwind-design-system-loader.ts";
import { canonicalizeTailwindCandidate } from "./tailwind-utility-inspector.ts";

/**
 * Canonicalizes classes off the main thread. The first canonicalization on a
 * compiled system builds Tailwind's lookup tables, seconds of synchronous
 * work, which would stall every request of the server. A canonical form that
 * differs from the class is verified here too, by compiling both
 * (`tailwind-canonical-equivalence.ts`), and cached with it. Compiled systems and
 * their results live in a bounded cache (`tailwind-canonicalize-cache.ts`):
 * a few warm systems by stylesheet content, shared by every path that reads
 * the same text, and per path the stamps of the files it read, so a CSS
 * change loads again.
 *
 * Runs bundled (`dist/tailwind-canonicalize-worker.js`) or from source under
 * Node's type stripping, so it imports only `.ts` modules that need nothing
 * else. The client is `tailwind-canonicalize-client.ts`.
 */

/**
 * Canonicalize classes (`candidates`), or check canonical forms among the
 * classes next to them (`checks`, see `verifyCanonicalInContext`).
 */
export type CanonicalizeRequest = {
	id: number;
	projectRoot: string;
	cssPath: string;
} & (
	| { kind?: "canonicalize"; candidates: string[] }
	| { kind: "context"; checks: ContextCheck[] }
);

export type CanonicalizeResponse =
	| { id: number; ok: true; results: CanonicalizedClass[] | ContextVerdict[] }
	| { id: number; ok: false; message: string };

/**
 * A compiled system with what its stylesheets set outside `@theme`, which
 * verification needs: both come from the same loaded text, so systems that
 * share a warm entry (same text) share both.
 */
type VerifiableSystem = {
	designSystem: TailwindDesignSystem;
	stylesheet: StylesheetFacts;
};

const cache = createCanonicalizeCache<
	VerifiableSystem,
	CanonicalizedClass,
	ContextVerdict
>({
	warmSystems: 4,
	paths: 32,
	load: async (rootPath) => {
		// Already resolved inside its project by the handler below.
		const loaded = await loadTrackedTailwindDesignSystem({
			projectRoot: rootPath,
			cssPath: rootPath,
		});
		return {
			system: {
				designSystem: loaded.designSystem,
				stylesheet: scanStylesheetFacts(loaded.cssSource),
			},
			cssSource: loaded.cssSource,
			fileStamps: loaded.fileStamps,
		};
	},
	isFresh: fileStampsAreFresh,
	canonicalize: (system, candidate) =>
		canonicalizeAndVerifyTailwindCandidate(
			system,
			candidate,
			canonicalizeTailwindCandidate,
		),
	contextual: (system, check) =>
		verifyCanonicalInContext(system.designSystem, check),
});

parentPort?.on("message", (request: CanonicalizeRequest) => {
	new Promise<string>((resolve) =>
		resolve(resolveTailwindCssPath(request.projectRoot, request.cssPath)),
	)
		.then(
			(rootPath): Promise<CanonicalizedClass[] | ContextVerdict[]> =>
				request.kind === "context"
					? cache.contextual(rootPath, request.checks)
					: cache.canonicalize(rootPath, request.candidates),
		)
		.then(
			(results) =>
				parentPort?.postMessage({
					id: request.id,
					ok: true,
					results,
				} satisfies CanonicalizeResponse),
			(error: unknown) =>
				parentPort?.postMessage({
					id: request.id,
					ok: false,
					message: error instanceof Error ? error.message : String(error),
				} satisfies CanonicalizeResponse),
		);
});
