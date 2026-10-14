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
import { createSystemComponentDraft } from "../utils/system-component-operations";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	toolPayload,
} from "./test-support";
import { TOOL } from "./tool-names";

// Component writes take `allowedComponents` like design writes: what a
// draft holds (or a publish puts in a version) is what designs place. The
// check runs before anything else, `addresses` included, so a refused write
// records nothing on the annotations it names.

const systemName = "Core";
const branch = "main";

const textOnly: RecipeTemplateNode = {
	path: "root",
	library: "trickroom",
	component: "text",
	text: "Label",
};
const withContainer: RecipeTemplateNode = {
	path: "root",
	library: "trickroom",
	component: "container",
	children: [
		{ path: "label", library: "trickroom", component: "text", text: "Hi" },
	],
};

describe("allowedComponents on component writes", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	/** A project that allows only `trickroom/text`, with a component whose draft is `root`. */
	const open = async (root: RecipeTemplateNode) => {
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-cmp-gov-"));
		cleanups.push(() => rm(home, { recursive: true, force: true }));
		const fixture = await createTrickroomMcpProjectFixture({
			config: {
				mcp: {
					enabled: true,
					mode: "read-write",
					allowedComponents: ["trickroom/text"],
				},
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
		const componentId = (
			await createSystemComponentDraft(
				fixture.projectRoot,
				systemName,
				{ slug: "button", name: "Button", draft: { root } },
				{ expectedRevision: (await manifest()).revision },
			)
		).componentId;
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
		return { call, manifest, componentId, annotation, changeEntries };
	};

	const denied = {
		status: "POLICY_DENIED",
		code: "MCP_COMPONENT_NOT_ALLOWED",
	};

	it("component_draft_create refuses a draft root, or the default root, with a component not allowed", async () => {
		const { call, manifest } = await open(textOnly);
		for (const draft of [{ root: withContainer }, undefined]) {
			const before = (await manifest()).revision;
			const result = await call(TOOL.componentDraftCreate, {
				systemName,
				expectedRevision: before,
				slug: "card",
				name: "Card",
				...(draft ? { draft } : {}),
			});
			expect(result.isError).toBe(true);
			expect(result.payload).toMatchObject(denied);
			expect((await manifest()).revision).toBe(before);
		}
	});

	for (const withAddresses of [false, true]) {
		const label = withAddresses ? "with addresses" : "without addresses";

		it(`component_draft_update refuses a root with a component not allowed, ${label}`, async () => {
			const { call, manifest, componentId, annotation, changeEntries } =
				await open(textOnly);
			const before = (await manifest()).revision;
			const result = await call(TOOL.componentDraftUpdate, {
				systemName,
				componentId,
				expectedRevision: before,
				root: withContainer,
				...(withAddresses
					? {
							addresses: [{ annotationId: annotation.id, reply: "Wrapped it" }],
						}
					: {}),
			});
			expect(result.isError).toBe(true);
			expect(result.payload).toMatchObject(denied);
			expect((await manifest()).revision).toBe(before);
			expect(await changeEntries()).toEqual([]);
		});

		it(`component_publish refuses a draft with a component not allowed, ${label}`, async () => {
			const { call, manifest, componentId, annotation, changeEntries } =
				await open(withContainer);
			const before = await manifest();
			const result = await call(TOOL.componentPublish, {
				systemName,
				componentId,
				expectedRevision: before.revision,
				...(withAddresses
					? {
							addresses: [{ annotationId: annotation.id, reply: "Published" }],
						}
					: {}),
			});
			expect(result.isError).toBe(true);
			expect(result.payload).toMatchObject(denied);
			const after = await manifest();
			expect(after.revision).toBe(before.revision);
			expect(after.manifest.components[componentId]?.published).toBeUndefined();
			expect(await changeEntries()).toEqual([]);
		});

		it(`allowed templates still write, ${label}`, async () => {
			const { call, manifest, componentId, annotation, changeEntries } =
				await open(textOnly);
			const addresses = (reply: string) =>
				withAddresses
					? { addresses: [{ annotationId: annotation.id, reply }] }
					: {};
			const updated = await call(TOOL.componentDraftUpdate, {
				systemName,
				componentId,
				expectedRevision: (await manifest()).revision,
				root: { ...textOnly, text: "Updated" },
				...addresses("Updated the label"),
			});
			expect(updated.isError).toBe(false);
			const published = await call(TOOL.componentPublish, {
				systemName,
				componentId,
				expectedRevision: (await manifest()).revision,
				...addresses("Published it"),
			});
			expect(published.isError).toBe(false);
			expect(await changeEntries()).toHaveLength(withAddresses ? 2 : 0);
		});
	}
});
