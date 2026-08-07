import { describe, expect, it } from "vitest";
import { getDesignSyncDecision } from "./design-live-sync";

const revisionA = `sha256:${"a".repeat(64)}` as const;
const revisionB = `sha256:${"b".repeat(64)}` as const;

describe("design live-sync decisions", () => {
	it("hot reloads an external revision when the store is clean", () => {
		expect(
			getDesignSyncDecision({
				snapshotRevision: revisionB,
				persistedRevision: revisionA,
				hasUnsavedChanges: false,
				savePending: false,
			}),
		).toBe("reload");
	});

	it("opens the conflict path instead of clobbering a dirty store", () => {
		expect(
			getDesignSyncDecision({
				snapshotRevision: revisionB,
				persistedRevision: revisionA,
				hasUnsavedChanges: true,
				savePending: false,
			}),
		).toBe("conflict");
	});

	it("ignores the persisted revision and defers while saving", () => {
		expect(
			getDesignSyncDecision({
				snapshotRevision: revisionA,
				persistedRevision: revisionA,
				hasUnsavedChanges: true,
				savePending: false,
			}),
		).toBe("ignore");
		expect(
			getDesignSyncDecision({
				snapshotRevision: revisionB,
				persistedRevision: revisionA,
				hasUnsavedChanges: true,
				savePending: true,
			}),
		).toBe("ignore");
	});
});
