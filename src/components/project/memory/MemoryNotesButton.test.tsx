import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryQueryOptions } from "../../../queries/memory";
import { MemoryNotesButton } from "./MemoryNotesButton";

vi.mock("./MemoryNotesDrawer", () => ({
	MemoryNotesDrawer: () => null,
}));

describe("MemoryNotesButton", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					scope: { kind: "project" },
					revision: "sha256:test",
					exists: true,
					summary: { noteCount: 2, categories: ["intent"] },
					notes: [],
				}),
			),
		);
	});

	it("shows the note count badge and accessible label", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		await queryClient.prefetchQuery(
			memoryQueryOptions({ kind: "project" }),
		);
		const html = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<MemoryNotesButton
					scope={{ kind: "project" }}
					title="Project notes"
					label="Notes"
				/>
			</QueryClientProvider>,
		);
		expect(html).toContain("Notes");
		expect(html).toContain(">2<");
		expect(html).toContain('aria-label="Notes (2)"');
	});
});
