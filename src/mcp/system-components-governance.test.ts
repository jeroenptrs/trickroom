import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createAnnotation,
	getAnnotation,
} from "../services/annotation-service";
import { AnnotationStore } from "../services/annotation-store";
import {
	readComponentAnchor,
	resolveAnnotationSystemId,
} from "../services/component-annotations";
import type { RecipeTemplateNode } from "../types";
import { readSystemComponentManifest } from "../utils/system-component-manifest-service";
import {
	createSystemComponentDraft,
	publishSystemComponentDraft,
	updateSystemComponent,
} from "../utils/system-component-operations";
import type { SystemComponentDraftPayload } from "../utils/system-components";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	toolPayload,
} from "./test-support";
import { TOOL } from "./tool-names";

// Component writes take `allowedComponents` with design_apply's semantics:
// a write may not add, change, move or remove a node of a disallowed
// component (in the template or in a slot's default children). What the
// designer authored and the write leaves alone stays allowed. The check runs
// before anything else, `addresses` included, so a refused write records
// nothing on the annotations it names.

const systemName = "Core";
const branch = "main";

const node = (
	nodePath: string,
	component: string,
	extra: Partial<RecipeTemplateNode> = {},
): RecipeTemplateNode => ({
	path: nodePath,
	library: "trickroom",
	component,
	...extra,
});

/** Only `trickroom/container` is allowed; `trickroom/text` is not. */
const card = (rootClass = "p-2", labelText = "Hi"): RecipeTemplateNode =>
	node("root", "container", {
		className: rootClass,
		children: [node("label", "text", { text: labelText })],
	});
const containerOnly = (rootClass = "p-2"): RecipeTemplateNode =>
	node("root", "container", { className: rootClass });

const slotWith = (children: RecipeTemplateNode[]) => ({
	content: { name: "content", hostPath: "root", defaultChildren: children },
});

const variantsOn = (nodePath: string, className: string) => ({
	axes: {
		tone: {
			label: "Tone",
			defaultValue: "plain",
			values: {
				plain: { classesByPath: {} },
				brand: { classesByPath: { [nodePath]: className } },
			},
		},
	},
});

type DraftInput = Partial<SystemComponentDraftPayload> & {
	root: RecipeTemplateNode;
};

describe("allowedComponents on component writes", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	/**
	 * A project whose MCP allows only `allowed`, with a component the
	 * designer authored (draft `draft`, after publishing `published` first).
	 */
	const open = async ({
		draft,
		published,
		allowed = ["trickroom/container"],
	}: {
		draft: DraftInput;
		published?: DraftInput;
		allowed?: string[];
	}) => {
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-cmp-gov-"));
		cleanups.push(() => rm(home, { recursive: true, force: true }));
		const fixture = await createTrickroomMcpProjectFixture({
			config: {
				mcp: { enabled: true, mode: "read-write", allowedComponents: allowed },
			},
		});
		cleanups.push(() => fixture.cleanup());
		await mkdir(path.join(fixture.projectRoot, ".git"), { recursive: true });
		await writeFile(
			path.join(fixture.projectRoot, ".git", "HEAD"),
			`ref: refs/heads/${branch}\n`,
		);
		const session = await createTrickroomMcpTestClient({
			...(await fixture.readMcpContext()),
			trickroomHome: home,
		});
		cleanups.push(() => session.close());
		const manifest = () =>
			readSystemComponentManifest(fixture.projectRoot, systemName);
		const systemId = (await resolveAnnotationSystemId(
			fixture.projectRoot,
			systemName,
		)) as string;
		// The designer's authoring, through the operations the app uses.
		const created = await createSystemComponentDraft(
			fixture.projectRoot,
			systemId,
			{ slug: "card", name: "Card", draft: published ?? draft },
			{ expectedRevision: (await manifest()).revision },
		);
		const componentId = created.componentId;
		if (published) {
			const done = await publishSystemComponentDraft(
				fixture.projectRoot,
				systemId,
				componentId,
				{ expectedRevision: created.revision },
			);
			await updateSystemComponent(
				fixture.projectRoot,
				systemId,
				componentId,
				{
					draft: {
						root: draft.root,
						slots: draft.slots ?? null,
						variants: draft.variants ?? null,
					},
				},
				{ expectedRevision: done.revision },
			);
		}
		const service = {
			store: new AnnotationStore({
				projectId: fixture.config.projectId as string,
				trickroomHome: home,
			}),
		};
		const anchor = await readComponentAnchor(
			fixture.projectRoot,
			systemId,
			componentId,
		);
		if (!anchor) throw new Error("component has no template");
		const annotation = (
			await createAnnotation(service, {
				target: {
					kind: "componentNode",
					systemId,
					componentId,
					nodePath: "root",
				},
				body: "Make it bolder",
				by: { role: "human" },
				scope: { branch, worktreePath: fixture.projectRoot },
				component: { template: anchor.template, revision: anchor.revision },
			})
		).annotation;
		const call = async (name: string, args: Record<string, unknown>) => {
			const result = await session.client.callTool({ name, arguments: args });
			return { isError: result.isError === true, payload: toolPayload(result) };
		};
		const changeEntries = async () =>
			(
				await getAnnotation(service, { annotationId: annotation.id })
			).entries.filter((entry) => entry.kind === "change");
		const addressesFor = (withAddresses: boolean, reply: string) =>
			withAddresses
				? { addresses: [{ annotationId: annotation.id, reply }] }
				: {};
		const update = async (
			patch: Record<string, unknown>,
			withAddresses: boolean,
		) =>
			call(TOOL.componentDraftUpdate, {
				systemName,
				componentId,
				expectedRevision: (await manifest()).revision,
				...patch,
				...addressesFor(withAddresses, "Updated it"),
			});
		const publish = async (withAddresses: boolean) =>
			call(TOOL.componentPublish, {
				systemName,
				componentId,
				expectedRevision: (await manifest()).revision,
				...addressesFor(withAddresses, "Published it"),
			});
		return { call, manifest, componentId, changeEntries, update, publish };
	};

	const denied = {
		status: "POLICY_DENIED",
		code: "MCP_COMPONENT_NOT_ALLOWED",
	};

	describe("component_draft_create", () => {
		const create = async (
			draft: Record<string, unknown> | undefined,
			allowed?: string[],
		) => {
			const { call, manifest } = await open({
				draft: { root: containerOnly() },
				...(allowed ? { allowed } : {}),
			});
			const before = (await manifest()).revision;
			const result = await call(TOOL.componentDraftCreate, {
				systemName,
				expectedRevision: before,
				slug: "new-one",
				name: "New one",
				...(draft ? { draft } : {}),
			});
			return { result, before, after: (await manifest()).revision };
		};

		it("allows a template of allowed components", async () => {
			const { result } = await create({ root: containerOnly() });
			expect(result.isError).toBe(false);
		});

		it("refuses a disallowed component in the template", async () => {
			const { result, before, after } = await create({ root: card() });
			expect(result.payload).toMatchObject(denied);
			expect(after).toBe(before);
		});

		it("refuses a disallowed component in a slot's default children", async () => {
			const { result, before, after } = await create({
				root: containerOnly(),
				slots: slotWith([node("slot-label", "text", { text: "Hi" })]),
			});
			expect(result.payload).toMatchObject(denied);
			expect(String(result.payload.message)).toContain('slot "content"');
			expect(after).toBe(before);
		});

		it("refuses the default root when its component is not allowed", async () => {
			const { result, before, after } = await create(undefined, [
				"trickroom/text",
			]);
			expect(result.payload).toMatchObject(denied);
			expect(after).toBe(before);
		});
	});

	for (const withAddresses of [false, true]) {
		const label = withAddresses ? "with addresses" : "without addresses";

		describe(`component_draft_update, ${label}`, () => {
			it("allows a variants-only update that leaves the designer's disallowed node alone", async () => {
				const { update, changeEntries } = await open({
					draft: { root: card() },
				});
				const result = await update(
					{ variants: variantsOn("root", "bg-cyan-500") },
					withAddresses,
				);
				expect(result.isError).toBe(false);
				expect(await changeEntries()).toHaveLength(withAddresses ? 1 : 0);
			});

			it("allows changing an allowed node while a disallowed one is present", async () => {
				const { update, changeEntries } = await open({
					draft: { root: card() },
				});
				const result = await update({ root: card("p-4") }, withAddresses);
				expect(result.isError).toBe(false);
				expect(await changeEntries()).toHaveLength(withAddresses ? 1 : 0);
			});

			it("refuses introducing a disallowed component as a slot default child", async () => {
				const { update, manifest, changeEntries } = await open({
					draft: { root: containerOnly() },
				});
				const before = (await manifest()).revision;
				const result = await update(
					{ slots: slotWith([node("slot-label", "text", { text: "Hi" })]) },
					withAddresses,
				);
				expect(result.payload).toMatchObject(denied);
				expect((await manifest()).revision).toBe(before);
				expect(await changeEntries()).toEqual([]);
			});

			it("refuses introducing a disallowed component in the template", async () => {
				const { update, manifest, changeEntries } = await open({
					draft: { root: containerOnly() },
				});
				const before = (await manifest()).revision;
				const result = await update({ root: card() }, withAddresses);
				expect(result.payload).toMatchObject(denied);
				expect((await manifest()).revision).toBe(before);
				expect(await changeEntries()).toEqual([]);
			});

			it("refuses changing or removing the designer's disallowed node, as design_apply refuses updating or deleting it", async () => {
				const { update, manifest, changeEntries } = await open({
					draft: { root: card() },
				});
				const before = (await manifest()).revision;
				const text = await update({ root: card("p-2", "Bye") }, withAddresses);
				expect(text.payload).toMatchObject(denied);
				const classes = await update(
					{ variants: variantsOn("label", "font-bold") },
					withAddresses,
				);
				expect(classes.payload).toMatchObject(denied);
				const removed = await update({ root: containerOnly() }, withAddresses);
				expect(removed.payload).toMatchObject(denied);
				expect((await manifest()).revision).toBe(before);
				expect(await changeEntries()).toEqual([]);
			});
		});

		describe(`component_publish, ${label}`, () => {
			it("allows publishing a draft whose disallowed node the published version already has", async () => {
				const { publish, manifest, componentId, changeEntries } = await open({
					published: { root: card() },
					draft: { root: card("p-4") },
				});
				const result = await publish(withAddresses);
				expect(result.isError).toBe(false);
				expect(
					(await manifest()).manifest.components[componentId]?.published
						?.currentVersion,
				).toBe("2");
				expect(await changeEntries()).toHaveLength(withAddresses ? 1 : 0);
			});

			it("refuses publishing a slot default child the draft introduced", async () => {
				const { publish, manifest, componentId, changeEntries } = await open({
					published: { root: containerOnly() },
					draft: {
						root: containerOnly(),
						slots: slotWith([node("slot-label", "text", { text: "Hi" })]),
					},
				});
				const before = (await manifest()).revision;
				const result = await publish(withAddresses);
				expect(result.payload).toMatchObject(denied);
				expect((await manifest()).revision).toBe(before);
				expect(
					(await manifest()).manifest.components[componentId]?.published
						?.currentVersion,
				).toBe("1");
				expect(await changeEntries()).toEqual([]);
			});

			it("refuses a first publish of a draft with a disallowed component", async () => {
				const { publish, manifest, componentId, changeEntries } = await open({
					draft: { root: card() },
				});
				const before = (await manifest()).revision;
				const result = await publish(withAddresses);
				expect(result.payload).toMatchObject(denied);
				expect((await manifest()).revision).toBe(before);
				expect(
					(await manifest()).manifest.components[componentId]?.published,
				).toBeUndefined();
				expect(await changeEntries()).toEqual([]);
			});
		});
	}
});
