import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryQueryOptions } from "../../../queries/memory";
import { MemoryNotesPanel } from "./MemoryNotesPanel";

const sampleNote = {
	noteId: "note_1",
	body: "Use {{design:11111111-1111-4111-8111-111111111111}} for the hero.",
	category: "intent" as const,
	createdAt: "2026-06-24T00:00:00.000Z",
	updatedAt: "2026-06-24T00:00:00.000Z",
	author: { kind: "user" as const },
	references: [
		{
			type: "design" as const,
			id: "11111111-1111-4111-8111-111111111111",
			raw: "{{design:11111111-1111-4111-8111-111111111111}}",
			start: 4,
			end: 52,
			status: "valid" as const,
			label: "Hero",
			deepLink: "/design/11111111-1111-4111-8111-111111111111",
		},
	],
};

async function renderPanel() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await queryClient.prefetchQuery(
		memoryQueryOptions({ kind: "project" }, undefined, {
			resolveReferences: true,
		}),
	);
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<RouterProvider
				router={createMemoryRouter([
					{ path: "/", element: <MemoryNotesPanel scope={{ kind: "project" }} /> },
				])}
			/>
		</QueryClientProvider>,
	);
}

describe("MemoryNotesPanel", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.includes("/api/trickroom/memory?resolveReferences=true")) {
					return new Response(
						JSON.stringify({
							scope: { kind: "project" },
							revision: "sha256:test",
							exists: true,
							summary: { noteCount: 1, categories: ["intent"] },
							notes: [sampleNote],
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				return new Response("not found", { status: 404 });
			}),
		);
	});

	it("renders resolved reference chips in note cards", async () => {
		const html = await renderPanel();
		expect(html).toContain("Hero");
		expect(html).toContain("1 note");
	});

	it("shows the empty state when there are no notes", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					scope: { kind: "project" },
					revision: "sha256:empty",
					exists: false,
					summary: { noteCount: 0, categories: [] },
					notes: [],
				}),
			),
		);
		const html = await renderPanel();
		expect(html).toContain("No notes yet");
	});
});
