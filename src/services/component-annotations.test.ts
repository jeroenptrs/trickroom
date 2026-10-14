import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { holdForeignAnnotationLock } from "../test-utils/foreign-annotation-lock";
import type { RecipeTemplateNode } from "../types";
import { createDesignSystemStorage } from "../utils/design-system-store";
import {
	readSystemComponentManifest,
	type SystemComponentManifestRead,
} from "../utils/system-component-manifest-service";
import {
	createSystemComponentDraft,
	discardSystemComponentDraft,
	publishSystemComponentDraft,
	type UpdateSystemComponentInput,
	updateSystemComponent,
} from "../utils/system-component-operations";
import type { SystemComponentRecord } from "../utils/system-components";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
} from "../utils/system-components-validation";
import {
	type AnnotationServiceContext,
	createAnnotation,
	listAnnotations,
	moveAnnotationToBranch,
	replyToAnnotation,
	transitionAnnotation,
	validateAddresses,
} from "./annotation-service";
import { AnnotationStore } from "./annotation-store";
import type {
	Annotation,
	AnnotationActor,
	AnnotationChangeRecord,
	AnnotationContainer,
	AnnotationScope,
	AnnotationTarget,
} from "./annotations.types";
import {
	captureComponentChange,
	createComponentAddressesRecorder,
	diffComponentDraftPaths,
	getComponentAnchorTemplate,
	readComponentAnchor,
	resolveAnnotationSystemId,
	revertComponentChange,
} from "./component-annotations";

const human: AnnotationActor = { role: "human" };
const agent: AnnotationActor = { role: "agent", sessionId: "session-a" };
const main: AnnotationScope = { branch: "main", worktreePath: "/repo" };
const feature: AnnotationScope = {
	branch: "feature",
	worktreePath: "/repo-wt",
};

const buttonRoot = (labelClass = "px-4"): RecipeTemplateNode => ({
	path: "root",
	library: "trickroom",
	component: "container",
	name: "Button",
	className: "inline-flex",
	children: [
		{
			path: "label",
			library: "trickroom",
			component: "text",
			name: "Label",
			text: "Click",
			className: labelClass,
		},
		{ path: "icon", library: "trickroom", component: "icon" },
	],
});

const variants = () => ({
	axes: {
		size: {
			label: "Size",
			defaultValue: "sm",
			values: {
				sm: { classesByPath: { label: "text-sm" } },
				lg: { classesByPath: { label: "text-lg" } },
			},
		},
	},
});

describe("component annotations", () => {
	let root: string;
	let projectRoot: string;
	let store: AnnotationStore;
	let context: AnnotationServiceContext;
	let clock: Date;
	let systemId: string;
	let componentId: string;
	let container: AnnotationContainer & { kind: "component" };

	const tick = () => {
		clock = new Date(clock.getTime() + 1000);
	};

	beforeEach(async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "trickroom-comp-ann-"));
		projectRoot = path.join(root, "project");
		await mkdir(path.join(projectRoot, ".trickroom"), { recursive: true });
		clock = new Date("2026-10-14T10:00:00.000Z");
		store = new AnnotationStore({
			projectId: "project-1",
			trickroomHome: path.join(root, "home"),
		});
		context = { store, now: () => clock };
		const storage = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/core.css",
		});
		systemId = storage.systemId;
		const initial = await readSystemComponentManifest(projectRoot, systemId);
		const created = await createSystemComponentDraft(
			projectRoot,
			systemId,
			{ slug: "button", name: "Button" },
			{ expectedRevision: initial.revision },
		);
		componentId = created.componentId;
		container = { kind: "component", systemId, componentId };
		await update({ draft: { root: buttonRoot(), variants: variants() } });
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const manifest = () => readSystemComponentManifest(projectRoot, systemId);

	const record = async (): Promise<SystemComponentRecord> => {
		const read = await manifest();
		const found = read.manifest.components[componentId];
		if (!found) throw new Error("component missing");
		return found;
	};

	const draftOf = async () => {
		const draft = (await record()).draft;
		if (!draft) throw new Error("draft missing");
		return draft;
	};

	const update = async (
		input: UpdateSystemComponentInput,
		options: Parameters<typeof updateSystemComponent>[4] extends infer O
			? Partial<O>
			: never = {},
	) => {
		const read = await manifest();
		return updateSystemComponent(projectRoot, systemId, componentId, input, {
			expectedRevision: read.revision,
			...options,
		});
	};

	const nodeTarget = (
		nodePath = "label",
		pinned?: Record<string, string>,
	): AnnotationTarget => ({
		kind: "componentNode",
		systemId,
		componentId,
		nodePath,
		...(pinned ? { variants: pinned } : {}),
	});

	const readAnchor = async () => {
		const anchor = await readComponentAnchor(
			projectRoot,
			systemId,
			componentId,
		);
		if (!anchor) throw new Error("no anchor");
		return anchor;
	};

	const create = async (
		options: {
			target?: AnnotationTarget;
			scope?: AnnotationScope;
			body?: string;
		} = {},
	) => {
		const anchor = await readAnchor();
		const { annotation } = await createAnnotation(context, {
			target: options.target ?? nodeTarget(),
			body: options.body ?? "Make the label bolder",
			by: human,
			scope: options.scope ?? main,
			component: { template: anchor.template, revision: anchor.revision },
		});
		return annotation;
	};

	const addressing = async (
		annotationIds: string[],
		input: UpdateSystemComponentInput,
		{
			revertible = true,
			expectedRevision,
			knownEntryIds,
			publish = false,
			recordContext = context,
		}: {
			revertible?: boolean;
			expectedRevision?: string;
			knownEntryIds?: string[];
			publish?: boolean;
			/** Records the change with another store (to pause it, say). */
			recordContext?: AnnotationServiceContext;
		} = {},
	) => {
		const read = await manifest();
		const recorder = createComponentAddressesRecorder(recordContext, {
			container,
			addresses: annotationIds.map((annotationId) => ({
				annotationId,
				reply: "Done",
				...(knownEntryIds ? { knownEntryIds } : {}),
			})),
			by: agent,
			operation: publish ? "component_publish" : "component_draft_update",
			summary: () => "Edited the component",
			revertible,
		});
		const options = {
			expectedRevision: expectedRevision ?? read.revision,
			aroundWrite: recorder.aroundWrite,
		};
		const written: SystemComponentManifestRead = publish
			? await publishSystemComponentDraft(
					projectRoot,
					systemId,
					componentId,
					options,
				)
			: await updateSystemComponent(
					projectRoot,
					systemId,
					componentId,
					input,
					options,
				);
		return { read, written, results: recorder.results() };
	};

	const reload = async (annotationId: string) => {
		const stored = await store.read(container, annotationId);
		if (!stored) throw new Error("annotation missing");
		return stored.annotation;
	};

	const changeEntry = (annotation: Annotation) => {
		const entry = annotation.entries.find((item) => item.kind === "change");
		if (entry?.kind !== "change") throw new Error("no change entry");
		return entry;
	};

	describe("createAnnotation with a component", () => {
		it("fills the node names, ancestors and the component revision", async () => {
			const anchor = await readAnchor();
			const annotation = await create({ target: nodeTarget("label") });
			expect(annotation.target).toEqual({
				kind: "componentNode",
				systemId,
				componentId,
				nodePath: "label",
			});
			expect(annotation.snapshot).toMatchObject({
				layerName: "Label",
				component: "trickroom/text",
				ancestorNames: ["Button"],
				designRevision: anchor.revision,
			});
			const icon = await create({ target: nodeTarget("icon") });
			expect(icon.snapshot.layerName).toBe("icon");
			const rootAnnotation = await create({ target: nodeTarget("root") });
			expect(rootAnnotation.snapshot.ancestorNames).toEqual([]);
		});

		it("refuses a missing node path with TARGET_NOT_FOUND", async () => {
			await expect(
				create({ target: nodeTarget("gone") }),
			).rejects.toMatchObject({ code: "TARGET_NOT_FOUND" });
		});

		it("refuses a pin to an unknown axis or value with INVALID_INPUT", async () => {
			await expect(
				create({ target: nodeTarget("label", { shape: "round" }) }),
			).rejects.toMatchObject({ code: "INVALID_INPUT" });
			await expect(
				create({ target: nodeTarget("label", { size: "xl" }) }),
			).rejects.toMatchObject({ code: "INVALID_INPUT" });
		});

		it("keeps a valid pin, sorted", async () => {
			const annotation = await create({
				target: nodeTarget("label", { size: "lg" }),
			});
			expect(annotation.target).toMatchObject({ variants: { size: "lg" } });
		});

		it("stores `variants: {}` as no pin", async () => {
			const annotation = await create({ target: nodeTarget("label", {}) });
			expect(annotation.target).not.toHaveProperty("variants");
			const onDisk = await reload(annotation.id);
			expect(onDisk.target).not.toHaveProperty("variants");
		});
	});

	describe("readComponentAnchor", () => {
		it("anchors to the draft template while there is a draft", async () => {
			const anchor = await readAnchor();
			expect(anchor.source).toBe("draft");
			expect(anchor.template.root.path).toBe("root");
			expect(anchor.systemId).toBe(systemId);
			expect(anchor.componentId).toBe(componentId);
			expect(anchor.name).toBe("Button");
			expect(anchor.revision).toBe((await manifest()).revision);
		});

		it("anchors to the published version without a draft, and the draft otherwise", async () => {
			const published = await publishSystemComponentDraft(
				projectRoot,
				systemId,
				componentId,
				{ expectedRevision: (await manifest()).revision },
			);
			// The draft stays after a publish: the draft wins.
			await update({
				draft: {
					root: {
						...buttonRoot(),
						children: [
							...(buttonRoot().children ?? []),
							{ path: "extra", library: "trickroom", component: "container" },
						],
					},
				},
			});
			expect((await readAnchor()).template.root.children).toHaveLength(3);

			// Strip the draft from the stored record and anchor to published.
			const current = await record();
			const { draft: _draft, ...withoutDraft } = current;
			const anchor = getComponentAnchorTemplate(withoutDraft);
			expect(anchor?.source).toBe("published");
			expect(anchor?.template.root.children).toHaveLength(2);
			expect(published.publishedVersion).toBe("1");
		});

		it("returns null for a missing component or system", async () => {
			expect(
				await readComponentAnchor(projectRoot, systemId, "cmp_missing"),
			).toBeNull();
			expect(
				await readComponentAnchor(projectRoot, "sys_missing", componentId),
			).toBeNull();
		});

		it("getComponentAnchorTemplate is null with neither draft nor published", async () => {
			const { draft: _draft, ...bare } = await record();
			expect(getComponentAnchorTemplate(bare)).toBeNull();
		});
	});

	describe("resolveAnnotationSystemId", () => {
		it("resolves by id and by name to the manifest's systemId", async () => {
			expect(await resolveAnnotationSystemId(projectRoot, systemId)).toBe(
				systemId,
			);
			expect(await resolveAnnotationSystemId(projectRoot, "Core")).toBe(
				systemId,
			);
		});

		it("returns null for an unknown or empty handle", async () => {
			expect(await resolveAnnotationSystemId(projectRoot, "Nope")).toBeNull();
			expect(await resolveAnnotationSystemId(projectRoot, " ")).toBeNull();
		});
	});

	describe("diffComponentDraftPaths", () => {
		const draft = (
			rootNode: RecipeTemplateNode,
			schema?: ReturnType<typeof variants>,
		) => ({ root: rootNode, ...(schema ? { variants: schema } : {}) });

		it("is empty when nothing changed", () => {
			expect(
				diffComponentDraftPaths(
					draft(buttonRoot(), variants()),
					draft(buttonRoot(), variants()),
				),
			).toEqual([]);
		});

		it("marks an added node (and its changed parent)", () => {
			const after = buttonRoot();
			after.children?.push({
				path: "badge",
				library: "trickroom",
				component: "container",
			});
			expect(
				diffComponentDraftPaths(draft(buttonRoot()), draft(after)),
			).toEqual(["root", "badge"]);
		});

		it("marks a node whose className changed", () => {
			expect(
				diffComponentDraftPaths(
					draft(buttonRoot("px-4")),
					draft(buttonRoot("px-8")),
				),
			).toEqual(["label"]);
		});

		it("marks a node whose variant class changed", () => {
			const changed = variants();
			changed.axes.size.values.lg.classesByPath.label = "text-xl";
			expect(
				diffComponentDraftPaths(
					draft(buttonRoot(), variants()),
					draft(buttonRoot(), changed),
				),
			).toEqual(["label"]);
		});

		it("marks a node that gained a variant class", () => {
			const changed = variants();
			(
				changed.axes.size.values.lg.classesByPath as Record<string, string>
			).icon = "size-6";
			expect(
				diffComponentDraftPaths(
					draft(buttonRoot(), variants()),
					draft(buttonRoot(), changed),
				),
			).toEqual(["icon"]);
		});

		it("marks the parent when children are reordered", () => {
			const after = buttonRoot();
			after.children?.reverse();
			expect(
				diffComponentDraftPaths(draft(buttonRoot()), draft(after)),
			).toEqual(["root"]);
		});

		it("marks the parent of a removed node", () => {
			const after = buttonRoot();
			after.children = after.children?.slice(0, 1);
			expect(
				diffComponentDraftPaths(draft(buttonRoot()), draft(after)),
			).toEqual(["root"]);
		});

		it("marks nothing when a side is missing", () => {
			expect(diffComponentDraftPaths(draft(buttonRoot()), undefined)).toEqual(
				[],
			);
			expect(diffComponentDraftPaths(undefined, undefined)).toEqual([]);
		});

		it("does not list a removed node's parent twice", () => {
			const before = buttonRoot();
			const after = buttonRoot();
			after.children = [];
			// root changed (children differ) and both removals have it as parent.
			expect(diffComponentDraftPaths(draft(before), draft(after))).toEqual([
				"root",
			]);
		});
	});

	describe("captureComponentChange", () => {
		it("keeps no revert state when the draft did not change", async () => {
			const current = await record();
			expect(
				captureComponentChange(current, current, { revertible: true }),
			).toEqual({ layerIds: [] });
		});

		it("keeps no revert state when not revertible", async () => {
			const before = await record();
			await update({ draft: { root: buttonRoot("px-8") } });
			const after = await record();
			expect(
				captureComponentChange(before, after, { revertible: false }),
			).toEqual({ layerIds: ["label"] });
		});
	});

	describe("createComponentAddressesRecorder", () => {
		it("records a change on the addressed annotation with the manifest revisions", async () => {
			const annotation = await create();
			tick();
			const before = await draftOf();
			const { read, written, results } = await addressing([annotation.id], {
				draft: { root: buttonRoot("px-8") },
			});

			expect(results).toHaveLength(1);
			expect(results[0]?.status).toBe("recorded");
			const stored = await reload(annotation.id);
			expect(stored.status).toBe("addressed");
			const entry = changeEntry(stored);
			expect(entry.body).toBe("Done");
			expect(entry.change.revisionBefore).toBe(read.revision);
			expect(entry.change.revisionAfter).toBe(written.revision);
			expect(entry.change.revisionAfter).toBe((await manifest()).revision);
			expect(entry.change.layerIds).toEqual(["label"]);
			expect(entry.change.boards).toEqual([]);
			expect(entry.change.summary).toBe("Edited the component");
			expect(entry.change.draftBefore?.root).toEqual(before.root);
			expect(entry.change.draftBefore?.variants).toEqual(before.variants);
			const after = await draftOf();
			expect(entry.change.draftAfter).toEqual({
				templateHash: hashSystemComponentTemplate(after),
				variantSchemaHash: hashSystemComponentVariantSchema(after.variants),
			});
		});

		it("records nothing when the write is refused", async () => {
			const annotation = await create();
			const staleRevision = (await manifest()).revision;
			await update({ draft: { root: buttonRoot("px-2") } });
			const draftBefore = await draftOf();

			const read = await manifest();
			const recorder = createComponentAddressesRecorder(context, {
				container,
				addresses: [{ annotationId: annotation.id }],
				by: agent,
				operation: "component_draft_update",
				summary: () => "x",
				revertible: true,
			});
			await expect(
				updateSystemComponent(
					projectRoot,
					systemId,
					componentId,
					{ draft: { root: buttonRoot("px-9") } },
					{
						expectedRevision: staleRevision,
						aroundWrite: recorder.aroundWrite,
					},
				),
			).rejects.toMatchObject({ code: "STALE_WRITE" });

			expect(recorder.results()).toEqual([]);
			expect((await manifest()).revision).toBe(read.revision);
			expect(await draftOf()).toEqual(draftBefore);
			const stored = await reload(annotation.id);
			expect(stored.status).toBe("open");
			expect(stored.entries).toHaveLength(1);
		});

		it("records a publish without revert state", async () => {
			const annotation = await create();
			const { results } = await addressing(
				[annotation.id],
				{},
				{ publish: true, revertible: false },
			);
			expect(results[0]?.status).toBe("recorded");
			const stored = await reload(annotation.id);
			expect(stored.status).toBe("addressed");
			const { change } = changeEntry(stored);
			expect(change.draftBefore).toBeUndefined();
			expect(change.draftAfter).toBeUndefined();
			expect(change.operations[0]?.operation).toBe("component_publish");
		});

		it("records a non-revertible draft write without revert state", async () => {
			const annotation = await create();
			await addressing(
				[annotation.id],
				{ draft: { root: buttonRoot("px-8") } },
				{ revertible: false },
			);
			const { change } = changeEntry(await reload(annotation.id));
			expect(change.layerIds).toEqual(["label"]);
			expect(change.draftBefore).toBeUndefined();
			expect(change.draftAfter).toBeUndefined();
		});

		it("records no revert state for a metadata-only update", async () => {
			const annotation = await create();
			const { results } = await addressing([annotation.id], {
				metadata: { name: "Renamed Button" },
			});
			expect(results[0]?.status).toBe("recorded");
			const { change } = changeEntry(await reload(annotation.id));
			expect(change.layerIds).toEqual([]);
			expect(change.draftBefore).toBeUndefined();
			expect(change.draftAfter).toBeUndefined();
		});

		it("leaves the annotation open when a designer remark was not seen", async () => {
			const annotation = await create();
			const seen = annotation.entries.map((entry) => entry.id);
			tick();
			const reply = await replyToAnnotation(context, {
				annotationId: annotation.id,
				container,
				by: human,
				body: "Also make it red",
			});
			const lateRemark = reply.annotation.entries.at(-1);
			const { results } = await addressing(
				[annotation.id],
				{ draft: { root: buttonRoot("px-8") } },
				{ knownEntryIds: seen },
			);
			const [result] = results;
			expect(result?.status).toBe("recorded");
			if (result?.status !== "recorded") return;
			expect(result.unseenRemarkIds).toEqual([lateRemark?.id]);
			const stored = await reload(annotation.id);
			expect(stored.status).toBe("open");
			expect(changeEntry(stored).change.draftBefore).toBeDefined();
		});

		it("reports a missing annotation as failed without failing the write", async () => {
			const { results, written } = await addressing(["missing"], {
				draft: { root: buttonRoot("px-8") },
			});
			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({ status: "failed" });
			expect((await manifest()).revision).toBe(written.revision);
		});

		it("records on a branch-checked recorder only for that branch", async () => {
			const onFeature = await create({ scope: feature });
			const read = await manifest();
			const recorder = createComponentAddressesRecorder(context, {
				container,
				addresses: [{ annotationId: onFeature.id }],
				by: agent,
				operation: "component_draft_update",
				summary: () => "x",
				revertible: true,
				branch: "main",
			});
			await updateSystemComponent(
				projectRoot,
				systemId,
				componentId,
				{ draft: { root: buttonRoot("px-8") } },
				{ expectedRevision: read.revision, aroundWrite: recorder.aroundWrite },
			);
			expect(recorder.results()[0]).toMatchObject({
				status: "failed",
				code: "WRONG_BRANCH",
			});
			expect((await reload(onFeature.id)).status).toBe("open");
		});
	});

	describe("revertComponentChange", () => {
		const addressedChange = async (
			input: UpdateSystemComponentInput = {
				draft: { root: buttonRoot("px-8") },
			},
		) => {
			const annotation = await create();
			tick();
			const beforeHash = hashSystemComponentTemplate(await draftOf());
			await addressing([annotation.id], input);
			const entry = changeEntry(await reload(annotation.id));
			return { annotation, entry, beforeHash };
		};

		const revert = (
			annotationId: string,
			entryId: string,
			extra: { expectedRevision?: string } = {},
		) =>
			revertComponentChange(context, {
				annotationId,
				entryId,
				by: human,
				projectRoot,
				container,
				...extra,
			});

		it("restores the draft, records the revert and reopens the annotation", async () => {
			const { annotation, entry, beforeHash } = await addressedChange();
			expect(hashSystemComponentTemplate(await draftOf())).not.toBe(beforeHash);
			tick();

			const result = await revert(annotation.id, entry.id);

			expect(hashSystemComponentTemplate(await draftOf())).toBe(beforeHash);
			expect(result.revision).toBe((await manifest()).revision);
			expect(result.restoredLayerIds).toEqual(["label"]);
			expect(result.annotation.status).toBe("open");
			const stored = await reload(annotation.id);
			expect(stored.status).toBe("open");
			const revertEntry = stored.entries.at(-1);
			expect(revertEntry).toMatchObject({
				kind: "revert",
				entryId: entry.id,
				by: human,
				revisionAfter: result.revision,
			});
			const reverted = changeEntry(stored);
			expect(reverted.revertedBy).toBe(revertEntry?.id);
			expect(reverted.change.draftBefore).toBeUndefined();
			expect(reverted.change.draftAfter).toBeUndefined();
			expect(stored.transitions.at(-1)).toMatchObject({
				from: "addressed",
				to: "open",
			});
		});

		it("reverts a write that addressed several annotations on all of them", async () => {
			const first = await create();
			const second = await create();
			tick();
			const beforeHash = hashSystemComponentTemplate(await draftOf());
			await addressing([first.id, second.id], {
				draft: { root: buttonRoot("px-8") },
			});
			tick();

			const result = await revert(
				first.id,
				changeEntry(await reload(first.id)).id,
			);

			expect(hashSystemComponentTemplate(await draftOf())).toBe(beforeHash);
			expect(result.alsoReverted).toEqual([second.id]);
			const sibling = await reload(second.id);
			expect(sibling.status).toBe("open");
			const revertEntry = sibling.entries.at(-1);
			expect(revertEntry).toMatchObject({
				kind: "revert",
				by: human,
				revisionAfter: result.revision,
			});
			const change = changeEntry(sibling);
			expect(change.revertedBy).toBe(revertEntry?.id);
			expect(change.change.draftBefore).toBeUndefined();
			await expect(revert(second.id, change.id)).rejects.toMatchObject({
				code: "NOT_REVERTIBLE",
			});
		});

		it("refuses before the draft changes when a sibling's lock is held", async () => {
			const first = await create();
			const second = await create();
			await addressing([first.id, second.id], {
				draft: { root: buttonRoot("px-8") },
			});
			const revision = (await manifest()).revision;
			const secondBefore = await reload(second.id);
			const lockFile = await holdForeignAnnotationLock(
				path.join(root, "home"),
				store.getAnnotationPath(container, second.id),
			);
			const impatient = new AnnotationStore({
				projectId: "project-1",
				trickroomHome: path.join(root, "home"),
				lock: { acquireTimeoutMs: 200, retryDelayMs: 20 },
			});
			try {
				await expect(
					revertComponentChange(
						{ store: impatient, now: () => clock },
						{
							annotationId: first.id,
							entryId: changeEntry(await reload(first.id)).id,
							by: human,
							projectRoot,
							container,
						},
					),
				).rejects.toMatchObject({
					code: "ANNOTATION_LOCKED",
					details: { annotationId: second.id },
				});
			} finally {
				await rm(lockFile, { force: true });
			}
			expect((await manifest()).revision).toBe(revision);
			expect((await reload(first.id)).status).toBe("addressed");
			expect(await reload(second.id)).toEqual(secondBefore);
		});

		it("leaves a sibling on another branch alone, to its own checkout's draft", async () => {
			const first = await create();
			const second = await create();
			await addressing([first.id, second.id], {
				draft: { root: buttonRoot("px-8") },
			});
			// The feature worktree has its own copy of the project, with the write.
			const featureRoot = path.join(root, "feature-project");
			await cp(projectRoot, featureRoot, { recursive: true });
			await moveAnnotationToBranch(context, {
				annotationId: second.id,
				by: human,
				scope: feature,
			});
			const secondBefore = await reload(second.id);

			const result = await revertComponentChange(context, {
				annotationId: first.id,
				entryId: changeEntry(await reload(first.id)).id,
				by: human,
				projectRoot,
				container,
				scope: main,
			});
			expect(result.alsoReverted).toEqual([]);
			expect(await reload(second.id)).toEqual(secondBefore);

			// That checkout's draft still has the write: the revert works there.
			const onFeature = await revertComponentChange(context, {
				annotationId: second.id,
				entryId: changeEntry(secondBefore).id,
				by: human,
				projectRoot: featureRoot,
				container,
				scope: feature,
			});
			expect(onFeature.annotation.status).toBe("open");
		});

		it("refuses to revert another branch's annotation, with nothing written", async () => {
			const first = await create();
			await addressing([first.id], { draft: { root: buttonRoot("px-8") } });
			await moveAnnotationToBranch(context, {
				annotationId: first.id,
				by: human,
				scope: feature,
			});
			const revision = (await manifest()).revision;
			const before = await reload(first.id);
			const stored = await store.read(container, first.id);
			await expect(
				revertComponentChange(context, {
					annotationId: first.id,
					entryId: changeEntry(before).id,
					by: human,
					projectRoot,
					container,
					scope: main,
					...(stored ? { expectedRevision: stored.revision } : {}),
				}),
			).rejects.toMatchObject({
				code: "WRONG_BRANCH",
				details: { annotationId: first.id, branch: "feature" },
			});
			expect((await manifest()).revision).toBe(revision);
			expect(await reload(first.id)).toEqual(before);
		});

		it("sees all of an addresses batch or none, from another checkout on the branch", async () => {
			const first = await create();
			const second = await create();
			let firstWritten = () => {};
			const reached = new Promise<void>((resolve) => {
				firstWritten = resolve;
			});
			let release = () => {};
			const released = new Promise<void>((resolve) => {
				release = resolve;
			});
			// The draft write in this checkout records the batch under all its
			// locks and pauses after the first file, before the second.
			class Pausing extends AnnotationStore {
				protected override async writeLocked(
					target: AnnotationContainer,
					annotation: Annotation,
					lock: Parameters<AnnotationStore["writeLocked"]>[2],
				) {
					await super.writeLocked(target, annotation, lock);
					if (annotation.id === first.id) {
						firstWritten();
						await released;
					}
				}
			}
			const writing = addressing(
				[first.id, second.id],
				{ draft: { root: buttonRoot("px-8") } },
				{
					recordContext: {
						store: new Pausing({
							projectId: "project-1",
							trickroomHome: path.join(root, "home"),
						}),
						now: () => clock,
					},
				},
			);
			await reached;
			// A second checkout of the branch (a clone): its own manifest with
			// the write, and its own manifest lock.
			const otherRoot = path.join(root, "other-checkout");
			await cp(projectRoot, otherRoot, { recursive: true });
			const reverting = revertComponentChange(context, {
				annotationId: first.id,
				entryId: changeEntry(await reload(first.id)).id,
				by: human,
				projectRoot: otherRoot,
				container,
				scope: main,
			});
			await new Promise((resolve) => setTimeout(resolve, 100));
			release();
			await writing;
			const result = await reverting;
			expect(result.alsoReverted).toEqual([second.id]);
			const sibling = await reload(second.id);
			expect(sibling.status).toBe("open");
			expect(sibling.entries.at(-1)).toMatchObject({ kind: "revert" });
		});

		it("restores the variant schema and slots as well", async () => {
			const annotation = await create();
			const original = await draftOf();
			const changed = variants();
			changed.axes.size.values.lg.classesByPath.label = "text-2xl";
			await addressing([annotation.id], {
				draft: { variants: changed, slots: null },
			});
			expect((await draftOf()).variants).toEqual(changed);
			await revert(annotation.id, changeEntry(await reload(annotation.id)).id);
			expect((await draftOf()).variants).toEqual(original.variants);
		});

		it("refuses a second revert with NOT_REVERTIBLE", async () => {
			const { annotation, entry } = await addressedChange();
			await revert(annotation.id, entry.id);
			const revision = (await manifest()).revision;
			await expect(revert(annotation.id, entry.id)).rejects.toMatchObject({
				code: "NOT_REVERTIBLE",
			});
			expect((await manifest()).revision).toBe(revision);
		});

		it("refuses with CHANGED_SINCE after another draft edit and writes nothing", async () => {
			const { annotation, entry } = await addressedChange();
			await update({ draft: { root: buttonRoot("px-12") } });
			const revision = (await manifest()).revision;
			const draft = await draftOf();
			const annotationBefore = await reload(annotation.id);

			await expect(revert(annotation.id, entry.id)).rejects.toMatchObject({
				code: "CHANGED_SINCE",
			});

			expect((await manifest()).revision).toBe(revision);
			expect(await draftOf()).toEqual(draft);
			expect(await reload(annotation.id)).toEqual(annotationBefore);
			expect(annotationBefore.status).toBe("addressed");
		});

		it("refuses with CHANGED_SINCE when the draft is gone", async () => {
			const { annotation, entry } = await addressedChange();
			await publishSystemComponentDraft(projectRoot, systemId, componentId, {
				expectedRevision: (await manifest()).revision,
			});
			await discardSystemComponentDraft(projectRoot, systemId, componentId, {
				expectedRevision: (await manifest()).revision,
			});
			expect((await record()).draft).toBeUndefined();
			const revision = (await manifest()).revision;
			await expect(revert(annotation.id, entry.id)).rejects.toMatchObject({
				code: "CHANGED_SINCE",
			});
			expect((await manifest()).revision).toBe(revision);
		});

		it("still reverts after a publish, which leaves the draft as it was", async () => {
			const { annotation, entry } = await addressedChange();
			await publishSystemComponentDraft(projectRoot, systemId, componentId, {
				expectedRevision: (await manifest()).revision,
			});
			await expect(revert(annotation.id, entry.id)).resolves.toMatchObject({
				annotation: { status: "open" },
			});
		});

		it("refuses a publish record with NOT_REVERTIBLE", async () => {
			const annotation = await create();
			await addressing(
				[annotation.id],
				{},
				{ publish: true, revertible: false },
			);
			const entry = changeEntry(await reload(annotation.id));
			await expect(revert(annotation.id, entry.id)).rejects.toMatchObject({
				code: "NOT_REVERTIBLE",
			});
		});

		it("refuses an entry that is not a change record", async () => {
			const annotation = await create();
			const remark = annotation.entries[0];
			await expect(
				revert(annotation.id, remark?.id ?? ""),
			).rejects.toMatchObject({ code: "NOT_REVERTIBLE" });
			await expect(revert(annotation.id, "missing")).rejects.toMatchObject({
				code: "NOT_REVERTIBLE",
			});
		});

		it("refuses an unknown annotation", async () => {
			await expect(revert("missing", "x")).rejects.toMatchObject({
				code: "ANNOTATION_NOT_FOUND",
			});
		});

		it("refuses a stale expectedRevision and leaves the draft", async () => {
			const { annotation, entry } = await addressedChange();
			const seen = await store.read(container, annotation.id);
			tick();
			await replyToAnnotation(context, {
				annotationId: annotation.id,
				container,
				by: agent,
				body: "Also changed the weight",
			});
			const draft = await draftOf();
			await expect(
				revert(annotation.id, entry.id, {
					expectedRevision: seen?.revision ?? "",
				}),
			).rejects.toMatchObject({ code: "ANNOTATION_REVISION_MISMATCH" });
			expect(await draftOf()).toEqual(draft);

			const fresh = await store.read(container, annotation.id);
			await expect(
				revert(annotation.id, entry.id, { expectedRevision: fresh?.revision }),
			).resolves.toMatchObject({ annotation: { status: "open" } });
		});

		it("rejects an invalid actor", async () => {
			const { annotation, entry } = await addressedChange();
			await expect(
				revertComponentChange(context, {
					annotationId: annotation.id,
					entryId: entry.id,
					by: { role: "agent", sessionId: "" },
					projectRoot,
					container,
				}),
			).rejects.toMatchObject({ code: "INVALID_INPUT" });
		});

		it("resolving the annotation prunes the revert state", async () => {
			const { annotation, entry } = await addressedChange();
			expect(entry.change.draftBefore).toBeDefined();
			await transitionAnnotation(context, {
				annotationId: annotation.id,
				container,
				by: human,
				to: "resolved",
			});
			const { change } = changeEntry(await reload(annotation.id));
			expect(change.draftBefore).toBeUndefined();
			expect(change.draftAfter).toBeUndefined();
			await expect(revert(annotation.id, entry.id)).rejects.toMatchObject({
				code: "NOT_REVERTIBLE",
			});
		});

		it("a change recorded on an annotation closed meanwhile has no revert state", async () => {
			const annotation = await create();
			await transitionAnnotation(context, {
				annotationId: annotation.id,
				container,
				by: human,
				to: "dismissed",
				reason: "No",
			});
			await addressing([annotation.id], {
				draft: { root: buttonRoot("px-8") },
			});
			const stored = await reload(annotation.id);
			expect(stored.status).toBe("dismissed");
			const change: AnnotationChangeRecord = changeEntry(stored).change;
			expect(change.draftBefore).toBeUndefined();
			expect(change.draftAfter).toBeUndefined();
		});
	});

	describe("validateAddresses with a component container", () => {
		it("refuses an annotation of another component with WRONG_COMPONENT", async () => {
			const mine = await create();
			const read = await manifest();
			const other = await createSystemComponentDraft(
				projectRoot,
				systemId,
				{ slug: "card", name: "Card" },
				{ expectedRevision: read.revision },
			);
			const otherAnchor = await readComponentAnchor(
				projectRoot,
				systemId,
				other.componentId,
			);
			if (!otherAnchor) throw new Error("no anchor");
			const { annotation: foreign } = await createAnnotation(context, {
				target: {
					kind: "componentNode",
					systemId,
					componentId: other.componentId,
					nodePath: "root",
				},
				body: "Card remark",
				by: human,
				scope: main,
				component: {
					template: otherAnchor.template,
					revision: otherAnchor.revision,
				},
			});

			const problems = await validateAddresses(context, {
				container,
				addresses: [
					{ annotationId: mine.id },
					{ annotationId: foreign.id },
					{ annotationId: "missing" },
				],
			});
			expect(
				problems.map(({ annotationId, code }) => ({ annotationId, code })),
			).toEqual([
				{ annotationId: foreign.id, code: "WRONG_COMPONENT" },
				{ annotationId: "missing", code: "ANNOTATION_NOT_FOUND" },
			]);
			expect(problems[0]?.message).toContain(componentId);
		});

		it("refuses a closed annotation with ANNOTATION_CLOSED", async () => {
			const annotation = await create();
			await transitionAnnotation(context, {
				annotationId: annotation.id,
				container,
				by: human,
				to: "dismissed",
				reason: "No",
			});
			const problems = await validateAddresses(context, {
				container,
				addresses: [{ annotationId: annotation.id }],
			});
			expect(problems).toMatchObject([
				{ annotationId: annotation.id, code: "ANNOTATION_CLOSED" },
			]);
		});

		it("refuses an annotation on another branch with WRONG_BRANCH", async () => {
			const annotation = await create({ scope: feature });
			const problems = await validateAddresses(context, {
				container,
				addresses: [{ annotationId: annotation.id }],
				branch: "main",
			});
			expect(problems).toMatchObject([
				{
					annotationId: annotation.id,
					code: "WRONG_BRANCH",
					branch: "feature",
				},
			]);
			expect(
				await validateAddresses(context, {
					container,
					addresses: [{ annotationId: annotation.id }],
					branch: "feature",
				}),
			).toEqual([]);
		});
	});

	describe("listAnnotations with a component", () => {
		it("derives detached for a path deleted from the draft", async () => {
			const label = await create({ target: nodeTarget("label") });
			const icon = await create({ target: nodeTarget("icon") });
			const withoutIcon = buttonRoot();
			withoutIcon.children = withoutIcon.children?.slice(0, 1);
			await update({ draft: { root: withoutIcon } });

			const listed = await listAnnotations(context, {
				container,
				scope: main,
				component: (await readAnchor()).template,
			});
			const byId = new Map(
				listed.annotations.map((item) => [item.id, item.detached]),
			);
			expect(byId.get(label.id)).toBe(false);
			expect(byId.get(icon.id)).toBe(true);
		});

		it("does not derive detached without the component", async () => {
			await create();
			const listed = await listAnnotations(context, { container, scope: main });
			expect(listed.annotations[0]?.detached).toBeUndefined();
		});

		it("a pin to a removed variant value is detached, and reattaches", async () => {
			const pinned = await create({
				target: nodeTarget("label", { size: "lg" }),
			});
			const withoutLg = variants();
			delete (withoutLg.axes.size.values as Record<string, unknown>).lg;
			await update({ draft: { variants: withoutLg } });
			const detached = await listAnnotations(context, {
				container,
				scope: main,
				component: (await readAnchor()).template,
			});
			expect(
				detached.annotations.find((a) => a.id === pinned.id)?.detached,
			).toBe(true);
			await update({ draft: { variants: variants() } });
			const again = await listAnnotations(context, {
				container,
				scope: main,
				component: (await readAnchor()).template,
			});
			expect(again.annotations.find((a) => a.id === pinned.id)?.detached).toBe(
				false,
			);
		});

		it("filters by nodePath", async () => {
			const label = await create({ target: nodeTarget("label") });
			const label2 = await create({
				target: nodeTarget("label", { size: "sm" }),
			});
			await create({ target: nodeTarget("icon") });
			const listed = await listAnnotations(context, {
				container,
				scope: main,
				nodePath: "label",
			});
			expect(listed.annotations.map((a) => a.id).sort()).toEqual(
				[label.id, label2.id].sort(),
			);
			const none = await listAnnotations(context, {
				container,
				scope: main,
				nodePath: "root",
			});
			expect(none.annotations).toEqual([]);
		});
	});
});
