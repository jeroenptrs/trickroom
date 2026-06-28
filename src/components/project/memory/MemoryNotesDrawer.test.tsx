import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemoryNotesDrawer } from "./MemoryNotesDrawer";

vi.mock("../../ui/sheet", () => ({
	Sheet: ({
		open,
		children,
	}: {
		open: boolean;
		children: ReactNode;
	}) => (open ? <div data-slot="sheet">{children}</div> : null),
	SheetClose: ({ render }: { render: ReactElement }) => render,
	SheetContent: ({
		children,
		...props
	}: {
		children: ReactNode;
		"aria-label"?: string;
	}) => <div {...props}>{children}</div>,
}));

vi.mock("./MemoryNotesPanel", () => ({
	MemoryNotesPanel: () => <div data-testid="memory-notes-panel">panel</div>,
}));

describe("MemoryNotesDrawer", () => {
	it("renders the drawer header and panel when open", () => {
		const html = renderToStaticMarkup(
			<MemoryNotesDrawer
				open
				onOpenChange={() => {}}
				scope={{ kind: "project" }}
				title="Project notes"
				subtitle="proj_test"
			/>,
		);
		expect(html).toContain("Project notes");
		expect(html).toContain("memory-notes-panel");
		expect(html).toContain("Close memory drawer");
	});
});
