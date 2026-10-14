import {
	mkdir,
	mkdtemp,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTrickroomApp } from "../server";
import { AnnotationStore } from "../services/annotation-store";
import type {
	Annotation,
	AnnotationContainer,
	AnnotationView,
} from "../services/annotations.types";
import { createComponentAddressesRecorder } from "../services/component-annotations";
import type { RecipeTemplateNode } from "../types";
import { createDesignSystemStorage } from "../utils/design-system-store";
import { readSystemComponentManifest } from "../utils/system-component-manifest-service";
import {
	createSystemComponentDraft,
	type UpdateSystemComponentInput,
	updateSystemComponent,
} from "../utils/system-component-operations";
import { hashSystemComponentTemplate } from "../utils/system-components-validation";

const PROJECT_ID = "proj_component_annotations_routes";

const buttonRoot = (labelClass = "px-4"): RecipeTemplateNode => ({
	path: "root",
	library: "trickroom",
	component: "container",
	name: "Button",
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

type ListBody = {
	scope: { branch: string; worktreePath: string };
	componentRevision?: string;
	componentSource?: "draft" | "published";
	annotations: AnnotationView[];
	problems: unknown[];
};
type WriteBody = { annotation: AnnotationView; written: boolean };
type ErrorBody = {
	error: string;
	code: string;
	details?: Record<string, unknown>;
};

describe("component annotation routes", () => {
	let projectRoot: string;
	let trickroomHome: string;
	let app: ReturnType<typeof createTrickroomApp>;
	let store: AnnotationStore;
	let systemId: string;
	let componentId: string;
	let container: AnnotationContainer & { kind: "component" };

	// The project root must sit outside any git checkout, as in the design
	// annotation route tests.
	beforeEach(async () => {
		projectRoot = await mkdtemp(path.join(os.tmpdir(), "trickroom-cann-proj-"));
		trickroomHome = await mkdtemp(
			path.join(os.tmpdir(), "trickroom-cann-home-"),
		);
		await mkdir(path.join(projectRoot, ".trickroom", "designs"), {
			recursive: true,
		});
		await writeFile(
			path.join(projectRoot, ".trickroom", "config.json"),
			JSON.stringify({ name: "Component Annotations", projectId: PROJECT_ID }),
			"utf8",
		);
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
		await updateDraft({ draft: { root: buttonRoot(), variants: variants() } });
		store = new AnnotationStore({ projectId: PROJECT_ID, trickroomHome });
		app = createTrickroomApp({
			trickroomHome,
			initialProjectRoot: projectRoot,
			registerInitialProject: false,
		});
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
		await rm(trickroomHome, { force: true, recursive: true });
	});

	const base = "/api/trickroom/annotations";

	const request = (method: string, url: string, body?: unknown) =>
		app.request(url, {
			method,
			headers: { "content-type": "application/json" },
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});

	const json = async <T>(response: Response) => (await response.json()) as T;

	const manifest = () => readSystemComponentManifest(projectRoot, systemId);

	const draft = async () => {
		const found = (await manifest()).manifest.components[componentId]?.draft;
		if (!found) throw new Error("draft missing");
		return found;
	};

	const updateDraft = async (
		input: UpdateSystemComponentInput,
		options: {
			aroundWrite?: Parameters<typeof updateSystemComponent>[4]["aroundWrite"];
		} = {},
	) =>
		updateSystemComponent(projectRoot, systemId, componentId, input, {
			expectedRevision: (await manifest()).revision,
			...options,
		});

	const nodeTarget = (
		nodePath = "label",
		options: { systemHandle?: string; pinned?: Record<string, string> } = {},
	) => ({
		kind: "componentNode",
		systemId: options.systemHandle ?? systemId,
		componentId,
		nodePath,
		...(options.pinned ? { variants: options.pinned } : {}),
	});

	const create = async (
		target: unknown = nodeTarget(),
		extra: Record<string, unknown> = {},
	) => {
		const response = await request("POST", base, {
			target,
			body: "Make the label bolder",
			...extra,
		});
		expect(response.status).toBe(201);
		return (await json<WriteBody>(response)).annotation;
	};

	const containerQuery = () =>
		`systemId=${encodeURIComponent(systemId)}&componentId=${encodeURIComponent(componentId)}`;

	const stored = async (id: string): Promise<Annotation> => {
		const read = await store.read(container, id);
		if (!read) throw new Error("annotation not stored");
		return read.annotation;
	};

	describe("create", () => {
		it("creates a componentNode annotation with server-filled names and revision", async () => {
			const revision = (await manifest()).revision;
			const annotation = await create(nodeTarget("label"), {
				snapshot: {
					stageMode: "canvas",
					variants: { size: "lg" },
					// Client-supplied names are replaced by the server's.
					layerName: "Spoofed",
				},
			});

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
				designRevision: revision,
				stageMode: "canvas",
				variants: { size: "lg" },
			});
			expect(annotation.status).toBe("open");
			expect(annotation.entries[0]).toMatchObject({
				kind: "remark",
				by: { role: "human" },
				body: "Make the label bolder",
			});
			expect(annotation.detached).toBe(false);
			expect((await stored(annotation.id)).snapshot.variants).toEqual({
				size: "lg",
			});
		});

		it("stores a system named by its name under the manifest's systemId", async () => {
			const annotation = await create(
				nodeTarget("icon", { systemHandle: "Core" }),
			);
			expect(annotation.target).toMatchObject({ systemId });
			const onDisk = await stored(annotation.id);
			expect(onDisk.target).toMatchObject({ systemId, nodePath: "icon" });
			const listed = await json<ListBody>(
				await request("GET", `${base}?${containerQuery()}`),
			);
			expect(listed.annotations.map((a) => a.id)).toEqual([annotation.id]);
		});

		it("keeps a valid variants pin on the target", async () => {
			const annotation = await create(
				nodeTarget("label", { pinned: { size: "lg" } }),
			);
			expect(annotation.target).toMatchObject({ variants: { size: "lg" } });
		});

		it("refuses a pin to an unknown variant value with 400", async () => {
			const response = await request("POST", base, {
				target: nodeTarget("label", { pinned: { size: "xl" } }),
				body: "x",
			});
			expect(response.status).toBe(400);
			expect((await json<ErrorBody>(response)).code).toBe("INVALID_INPUT");
		});

		it("answers 404 TARGET_NOT_FOUND for a missing node", async () => {
			const response = await request("POST", base, {
				target: nodeTarget("gone"),
				body: "x",
			});
			expect(response.status).toBe(404);
			expect((await json<ErrorBody>(response)).code).toBe("TARGET_NOT_FOUND");
		});

		it("answers 404 TARGET_NOT_FOUND for a missing component or system", async () => {
			const noComponent = await request("POST", base, {
				target: { ...nodeTarget("label"), componentId: "cmp_missing" },
				body: "x",
			});
			expect(noComponent.status).toBe(404);
			expect((await json<ErrorBody>(noComponent)).code).toBe(
				"TARGET_NOT_FOUND",
			);
			const noSystem = await request("POST", base, {
				target: nodeTarget("label", { systemHandle: "Nope" }),
				body: "x",
			});
			expect(noSystem.status).toBe(404);
			expect((await json<ErrorBody>(noSystem)).code).toBe("TARGET_NOT_FOUND");
		});

		it("accepts a node that only the draft has", async () => {
			await updateDraft({
				draft: {
					root: {
						...buttonRoot(),
						children: [
							...(buttonRoot().children ?? []),
							{ path: "badge", library: "trickroom", component: "container" },
						],
					},
				},
			});
			const annotation = await create(nodeTarget("badge"));
			expect(annotation.snapshot.layerName).toBe("container");
		});
	});

	describe("list and get", () => {
		it("returns the component revision and source, and detached for a deleted node", async () => {
			const label = await create(nodeTarget("label"));
			const icon = await create(nodeTarget("icon"));
			const withoutIcon = buttonRoot();
			withoutIcon.children = withoutIcon.children?.slice(0, 1);
			await updateDraft({ draft: { root: withoutIcon } });

			const response = await request("GET", `${base}?${containerQuery()}`);
			expect(response.status).toBe(200);
			const body = await json<ListBody>(response);
			expect(body.componentRevision).toBe((await manifest()).revision);
			expect(body.componentSource).toBe("draft");
			const byId = new Map(body.annotations.map((a) => [a.id, a.detached]));
			expect(byId.get(label.id)).toBe(false);
			expect(byId.get(icon.id)).toBe(true);

			const single = await json<{ annotation: AnnotationView }>(
				await request("GET", `${base}/${icon.id}`),
			);
			expect(single.annotation.detached).toBe(true);
			const hinted = await json<{ annotation: AnnotationView }>(
				await request("GET", `${base}/${label.id}?${containerQuery()}`),
			);
			expect(hinted.annotation.detached).toBe(false);
		});

		it("honours nodePath", async () => {
			const label = await create(nodeTarget("label"));
			await create(nodeTarget("icon"));
			const body = await json<ListBody>(
				await request("GET", `${base}?${containerQuery()}&nodePath=label`),
			);
			expect(body.annotations.map((a) => a.id)).toEqual([label.id]);
			const none = await json<ListBody>(
				await request("GET", `${base}?${containerQuery()}&nodePath=root`),
			);
			expect(none.annotations).toEqual([]);
		});

		it("lists with no component revision when the component is gone", async () => {
			await create(nodeTarget("label"));
			const response = await request(
				"GET",
				`${base}?systemId=${encodeURIComponent(systemId)}&componentId=cmp_missing`,
			);
			expect(response.status).toBe(200);
			const body = await json<ListBody>(response);
			expect(body.componentRevision).toBeUndefined();
			expect(body.annotations).toEqual([]);
		});
	});

	describe("anchor", () => {
		it("re-anchors to another node and keeps the variants pin", async () => {
			const annotation = await create(
				nodeTarget("label", { pinned: { size: "lg" } }),
				{ snapshot: { variants: { size: "lg" } } },
			);
			const response = await request(
				"POST",
				`${base}/${annotation.id}/anchor`,
				{
					target: nodeTarget("icon", { pinned: { size: "lg" } }),
				},
			);
			expect(response.status).toBe(200);
			const body = await json<WriteBody>(response);
			expect(body.annotation.target).toEqual({
				kind: "componentNode",
				systemId,
				componentId,
				nodePath: "icon",
				variants: { size: "lg" },
			});
			expect(body.annotation.snapshot).toMatchObject({
				layerName: "icon",
				ancestorNames: ["Button"],
				variants: { size: "lg" },
			});
			expect(body.annotation.entries.at(-1)).toMatchObject({
				kind: "reanchor",
				from: { nodePath: "label" },
				to: { nodePath: "icon", variants: { size: "lg" } },
			});
			expect((await stored(annotation.id)).target).toMatchObject({
				nodePath: "icon",
				variants: { size: "lg" },
			});
		});

		it("re-anchors without a pin to unpin", async () => {
			const annotation = await create(
				nodeTarget("label", { pinned: { size: "lg" } }),
			);
			const response = await request(
				"POST",
				`${base}/${annotation.id}/anchor`,
				{
					target: nodeTarget("icon"),
				},
			);
			expect(response.status).toBe(200);
			expect(
				(await json<WriteBody>(response)).annotation.target,
			).not.toHaveProperty("variants");
		});

		it("answers 404 for a node that is not in the component", async () => {
			const annotation = await create();
			const response = await request(
				"POST",
				`${base}/${annotation.id}/anchor`,
				{
					target: nodeTarget("gone"),
				},
			);
			expect(response.status).toBe(404);
			expect((await json<ErrorBody>(response)).code).toBe("TARGET_NOT_FOUND");
			expect((await stored(annotation.id)).target).toMatchObject({
				nodePath: "label",
			});
		});
	});

	describe("revert", () => {
		const agent = { role: "agent", sessionId: "s1" } as const;

		/** An agent draft write addressing the annotation, as `component_draft_update` does. */
		const writeAddressing = async (annotationId: string) => {
			const recorder = createComponentAddressesRecorder(
				{ store },
				{
					container,
					addresses: [{ annotationId, reply: "Wider" }],
					by: agent,
					operation: "component_draft_update",
					summary: () => "Widened the label",
					revertible: true,
				},
			);
			await updateDraft(
				{ draft: { root: buttonRoot("px-8") } },
				{ aroundWrite: recorder.aroundWrite },
			);
			const result = recorder.results()[0];
			if (result?.status !== "recorded") throw new Error("not recorded");
			return result.entryId;
		};

		it("restores the draft on a component change record", async () => {
			const annotation = await create();
			const beforeHash = hashSystemComponentTemplate(await draft());
			const entryId = await writeAddressing(annotation.id);
			expect((await stored(annotation.id)).status).toBe("addressed");
			expect(hashSystemComponentTemplate(await draft())).not.toBe(beforeHash);

			const response = await request(
				"POST",
				`${base}/${annotation.id}/revert`,
				{
					entryId,
				},
			);

			expect(response.status).toBe(200);
			const body = await json<{
				annotation: AnnotationView;
				revision: string;
				restoredLayerIds: string[];
			}>(response);
			expect(hashSystemComponentTemplate(await draft())).toBe(beforeHash);
			expect(body.revision).toBe((await manifest()).revision);
			expect(body.restoredLayerIds).toEqual(["label"]);
			expect(body.annotation.status).toBe("open");
			expect(body.annotation.entries.at(-1)).toMatchObject({
				kind: "revert",
				entryId,
				by: { role: "human" },
			});
			expect(body.annotation.detached).toBe(false);
		});

		// Release review round 2: a revert queued behind a lock while another
		// branch is checked out must not revert the draft for the old one.
		it("refuses a revert that waited on the annotation's lock across a checkout", async () => {
			const checkout = async (branch: string) => {
				const gitDirectory = path.join(projectRoot, ".git");
				await mkdir(gitDirectory, { recursive: true });
				await writeFile(
					path.join(gitDirectory, "HEAD.lock"),
					`ref: refs/heads/${branch}\n`,
				);
				await rename(
					path.join(gitDirectory, "HEAD.lock"),
					path.join(gitDirectory, "HEAD"),
				);
			};
			await checkout("a");
			const annotation = await create();
			const entryId = await writeAddressing(annotation.id);
			const draftHash = hashSystemComponentTemplate(await draft());
			const manifestRevision = (await manifest()).revision;

			let release!: () => void;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			let entered!: () => void;
			const held = new Promise<void>((resolve) => {
				entered = resolve;
			});
			const holding = store.update(container, annotation.id, async () => {
				entered();
				await gate;
				return { annotation: null, result: null };
			});
			await held;
			const reverting = request("POST", `${base}/${annotation.id}/revert`, {
				entryId,
				expectedScope: {
					branch: "a",
					worktreePath: await realpath(projectRoot),
				},
			});
			// Inside the manifest lock, waiting on the annotation's.
			await new Promise((resolve) => setTimeout(resolve, 150));
			await checkout("b");
			release();
			await holding;
			const response = await reverting;

			expect(response.status).toBe(409);
			const body = await json<ErrorBody>(response);
			expect(body.code).toBe("SCOPE_CHANGED");
			expect(body.details?.scope).toMatchObject({ branch: "b" });
			expect(hashSystemComponentTemplate(await draft())).toBe(draftHash);
			expect((await manifest()).revision).toBe(manifestRevision);
			const after = await stored(annotation.id);
			expect(after.status).toBe("addressed");
			expect(after.entries.some((entry) => entry.kind === "revert")).toBe(
				false,
			);
		});

		it("refuses a second revert with 400 NOT_REVERTIBLE", async () => {
			const annotation = await create();
			const entryId = await writeAddressing(annotation.id);
			const first = await request("POST", `${base}/${annotation.id}/revert`, {
				entryId,
			});
			expect(first.status).toBe(200);
			const second = await request("POST", `${base}/${annotation.id}/revert`, {
				entryId,
			});
			expect(second.status).toBe(400);
			expect((await json<ErrorBody>(second)).code).toBe("NOT_REVERTIBLE");
		});

		it("answers 409 CHANGED_SINCE after another draft edit", async () => {
			const annotation = await create();
			const entryId = await writeAddressing(annotation.id);
			await updateDraft({ draft: { root: buttonRoot("px-12") } });
			const revision = (await manifest()).revision;

			const response = await request(
				"POST",
				`${base}/${annotation.id}/revert`,
				{
					entryId,
				},
			);

			expect(response.status).toBe(409);
			expect((await json<ErrorBody>(response)).code).toBe("CHANGED_SINCE");
			expect((await manifest()).revision).toBe(revision);
			expect((await stored(annotation.id)).status).toBe("addressed");
		});

		it("honours expectedRevision with 409 ANNOTATION_REVISION_MISMATCH", async () => {
			const annotation = await create();
			const entryId = await writeAddressing(annotation.id);
			const seen = (
				await json<{ annotation: AnnotationView }>(
					await request("GET", `${base}/${annotation.id}`),
				)
			).annotation;
			const hash = hashSystemComponentTemplate(await draft());
			const replied = await request(
				"POST",
				`${base}/${annotation.id}/entries`,
				{
					body: "One more thing",
				},
			);
			expect(replied.status).toBe(200);
			const stale = await request("POST", `${base}/${annotation.id}/revert`, {
				entryId,
				expectedRevision: seen.revision,
			});
			expect(stale.status).toBe(409);
			expect((await json<ErrorBody>(stale)).code).toBe(
				"ANNOTATION_REVISION_MISMATCH",
			);
			expect(hashSystemComponentTemplate(await draft())).toBe(hash);

			const current = (
				await json<{ annotation: AnnotationView }>(
					await request("GET", `${base}/${annotation.id}`),
				)
			).annotation;
			const fresh = await request("POST", `${base}/${annotation.id}/revert`, {
				entryId,
				expectedRevision: current.revision,
			});
			expect(fresh.status).toBe(200);
		});
	});
});
