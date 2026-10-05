import { readFile, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSystemComponentManifest } from "../utils/system-component-manifest-service";
import { discardSystemComponentDraft } from "../utils/system-component-operations";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	toolPayload,
} from "./test-support";

const textRoot = (text = "Primary") => ({
	path: "root",
	library: "trickroom",
	component: "text",
	text,
});

type Payload = Record<string, unknown>;

describe("component_draft_update metadata (name, group, description)", () => {
	let fixture: TrickroomMcpProjectFixture;
	let session: TrickroomMcpClientSession;

	const call = async (name: string, args: Payload) => {
		const result = await session.client.callTool({ name, arguments: args });
		return {
			isError: result.isError === true,
			payload: (toolPayload(result) ?? {}) as Payload,
		};
	};

	const read = (args: Payload = {}) =>
		call("component_read", { systemName: "Core", ...args });

	/** A published component whose draft matches version 1. */
	const createPublished = async () => {
		const initial = await read();
		const created = await call("component_draft_create", {
			systemName: "Core",
			expectedRevision: initial.payload.revision,
			slug: "sidebar-item",
			name: "Sidebar Item",
			group: "molecules",
			description: "One entry in the sidebar.",
			draft: { root: textRoot() },
		});
		const componentId = String(created.payload.componentId);
		const published = await call("component_publish", {
			systemName: "Core",
			componentId,
			expectedRevision: created.payload.revision,
		});
		expect(published.isError).toBe(false);
		return {
			componentId,
			revision: String(published.payload.revision),
			published: published.payload.published,
			systemId: String(published.payload.systemId),
		};
	};

	beforeEach(async () => {
		fixture = await createTrickroomMcpProjectFixture();
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
	});

	afterEach(async () => {
		await session.close();
		await fixture.cleanup();
	});

	it("changes name, group and description at once, without touching the draft or versions", async () => {
		const { componentId, revision, published } = await createPublished();
		const before = await read({
			componentId,
			include: ["record"],
			versions: "all",
		});

		const updated = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: revision,
			name: "Nav Item",
			group: "organisms/sidebar",
			description: "A link in the sidebar navigation.",
		});

		expect(updated.isError).toBe(false);
		expect(updated.payload).toMatchObject({
			status: "success",
			componentId,
			slug: "sidebar-item",
			changes: {
				metadata: {
					name: { from: "Sidebar Item", to: "Nav Item" },
					group: { from: "molecules", to: "organisms/sidebar" },
					description: "changed",
				},
			},
			published,
		});
		expect(updated.payload.changes).not.toHaveProperty("replaced");
		expect(updated.payload).not.toHaveProperty("draftState");
		expect(updated.payload.revision).not.toBe(revision);

		const after = await read({
			componentId,
			include: ["record"],
			versions: "all",
		});
		expect(after.payload).toMatchObject({
			componentId,
			slug: "sidebar-item",
			name: "Nav Item",
			group: "organisms/sidebar",
			description: "A link in the sidebar navigation.",
			currentVersion: "1",
			draftTemplateHash: before.payload.draftTemplateHash,
			draftVariantSchemaHash: before.payload.draftVariantSchemaHash,
		});
		expect(after.payload).not.toHaveProperty("draftState");
		const beforeRecord = before.payload.record as Payload;
		const afterRecord = after.payload.record as Payload;
		expect(afterRecord.componentId).toBe(beforeRecord.componentId);
		expect(afterRecord.draft).toEqual(beforeRecord.draft);
		expect(afterRecord.published).toEqual(beforeRecord.published);

		const index = await read();
		expect(index.payload).toMatchObject({
			revision: updated.payload.revision,
			components: [
				{
					componentId,
					slug: "sidebar-item",
					name: "Nav Item",
					group: "organisms/sidebar",
					description: "A link in the sidebar navigation.",
				},
			],
		});
		expect(
			(await read({ group: "organisms/sidebar" })).payload.components,
		).toHaveLength(1);

		// Nothing to migrate: no published version or hash changed.
		const stale = await read({ view: "stale" });
		expect(stale.payload).toMatchObject({
			statusCounts: { stale: 0, "hash-mismatch": 0 },
		});
	});

	it("clears group and description with null", async () => {
		const { componentId, revision } = await createPublished();

		const updated = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: revision,
			group: null,
			description: null,
		});

		expect(updated.payload.changes).toEqual({
			metadata: {
				group: { from: "molecules", to: null },
				description: "cleared",
			},
		});
		const after = await read({ componentId });
		expect(after.payload).not.toHaveProperty("group");
		expect(after.payload).not.toHaveProperty("description");
		expect(after.payload.name).toBe("Sidebar Item");
	});

	it("does not create a draft for a component that has none", async () => {
		const { componentId, revision, systemId } = await createPublished();
		const discarded = await discardSystemComponentDraft(
			fixture.projectRoot,
			systemId,
			componentId,
			{ expectedRevision: revision },
		);

		const updated = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: discarded.revision,
			group: "organisms/sidebar",
		});

		expect(updated.isError).toBe(false);
		expect(updated.payload).not.toHaveProperty("draftTemplateHash");
		expect(updated.payload).not.toHaveProperty("draftState");
		const record = (
			await read({ componentId, include: ["record"], versions: "all" })
		).payload.record as Payload;
		expect(record).not.toHaveProperty("draft");
		expect(record.group).toBe("organisms/sidebar");
	});

	it("combines metadata with a template update in one write", async () => {
		const { componentId, revision, published } = await createPublished();

		const updated = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: revision,
			name: "Nav Item",
			root: textRoot("Changed"),
		});

		expect(updated.isError).toBe(false);
		expect(updated.payload).toMatchObject({
			draftState: "changed",
			published,
			changes: {
				replaced: ["root"],
				metadata: { name: { from: "Sidebar Item", to: "Nav Item" } },
			},
		});
		const after = await read({ componentId, source: "draft" });
		expect(after.payload).toMatchObject({
			name: "Nav Item",
			revision: updated.payload.revision,
			draftState: "changed",
		});
	});

	it("rejects a stale expectedRevision and writes nothing", async () => {
		const { componentId, revision } = await createPublished();
		const first = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: revision,
			name: "First",
		});
		expect(first.isError).toBe(false);

		const stale = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: revision,
			name: "Second",
		});

		expect(stale.isError).toBe(true);
		expect(stale.payload).toMatchObject({ code: "STALE_WRITE" });
		expect((await read({ componentId })).payload.name).toBe("First");
	});

	it("explains invalid names, groups and descriptions before writing", async () => {
		const { componentId, revision } = await createPublished();

		const invalid = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: revision,
			name: "   ",
			group: "organisms//sidebar/",
			description: "x".repeat(4001),
		});

		expect(invalid.isError).toBe(true);
		expect(invalid.payload).toMatchObject({
			code: "VALIDATION_FAILED",
			diagnostics: [
				{
					code: "INVALID_SYSTEM_COMPONENT_METADATA",
					path: "name",
					message: "name must not be empty.",
				},
				{
					path: "group",
					message: expect.stringContaining('like "organisms/sidebar"'),
				},
				{
					path: "description",
					message: "description is 4001 characters; the limit is 4000.",
				},
			],
		});

		const emptyGroup = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: revision,
			group: "",
		});
		expect(emptyGroup.payload).toMatchObject({
			code: "VALIDATION_FAILED",
			diagnostics: [
				{ message: "group must not be empty; pass null to clear it." },
			],
		});

		const longName = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: revision,
			name: "n".repeat(81),
		});
		expect(longName.payload).toMatchObject({
			diagnostics: [{ message: "name is 81 characters; the limit is 80." }],
		});

		const nothing = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: revision,
		});
		expect(nothing.payload).toMatchObject({
			code: "INVALID_OPERATION_PARAMETERS",
		});

		// Nothing was written.
		expect((await read()).payload.revision).toBe(revision);
	});
	it("accepts stored values that predate the rules when they are resent unchanged", async () => {
		const { componentId, systemId } = await createPublished();
		// Written by hand or before the rules: over the description limit and
		// with spaces around the group's slash.
		const legacyDescription = "Long prose. ".repeat(375).trim();
		const { path: manifestPath } = await readSystemComponentManifest(
			fixture.projectRoot,
			systemId,
		);
		const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
		manifest.components[componentId].description = legacyDescription;
		manifest.components[componentId].group = "Inputs / Text";
		await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
		const revision = (await read()).payload.revision;

		const renamed = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: revision,
			name: "Text Input",
			group: "Inputs / Text",
			description: legacyDescription,
		});
		expect(renamed.isError).toBe(false);
		expect(renamed.payload.changes).toEqual({
			metadata: { name: { from: "Sidebar Item", to: "Text Input" } },
		});

		const regrouped = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: renamed.payload.revision,
			group: "atoms/inputs",
			description: legacyDescription,
		});
		expect(regrouped.isError).toBe(false);
		expect(regrouped.payload.changes).toEqual({
			metadata: { group: { from: "Inputs / Text", to: "atoms/inputs" } },
		});

		const changedDescription = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: regrouped.payload.revision,
			description: `${legacyDescription} More.`,
		});
		expect(changedDescription.payload).toMatchObject({
			code: "VALIDATION_FAILED",
			diagnostics: [
				{
					path: "description",
					message: `description is ${legacyDescription.length + 6} characters; the limit is 4000.`,
				},
			],
		});
		const backToLegacyGroup = await call("component_draft_update", {
			systemName: "Core",
			componentId,
			expectedRevision: regrouped.payload.revision,
			group: "Inputs / Text",
		});
		expect(backToLegacyGroup.payload).toMatchObject({
			code: "VALIDATION_FAILED",
		});
	});

	it("validates name, group and description at creation", async () => {
		const initial = await read();
		const badGroup = await call("component_draft_create", {
			systemName: "Core",
			expectedRevision: initial.payload.revision,
			slug: "bad-group",
			name: "Bad Group",
			group: "a//b",
		});
		expect(badGroup.payload).toMatchObject({
			code: "VALIDATION_FAILED",
			diagnostics: [
				{
					code: "INVALID_SYSTEM_COMPONENT_METADATA",
					path: "group",
					message: expect.stringContaining('like "organisms/sidebar"'),
				},
			],
		});
		const badName = await call("component_draft_create", {
			systemName: "Core",
			expectedRevision: initial.payload.revision,
			slug: "bad-name",
			name: "n".repeat(81),
		});
		expect(badName.payload).toMatchObject({
			diagnostics: [{ path: "name" }],
		});
		expect((await read()).payload.revision).toBe(initial.payload.revision);
	});
});
