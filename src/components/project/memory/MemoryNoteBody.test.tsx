import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryNoteBody } from "./MemoryNoteBody";

describe("MemoryNoteBody", () => {
	it("renders navigable chips when deepLink is present", () => {
		const html = renderToStaticMarkup(
			<MemoryNoteBody
				body="Open {{component:cmp_btn}}."
				references={[
					{
						type: "component",
						id: "cmp_btn",
						raw: "{{component:cmp_btn}}",
						start: 5,
						end: 27,
						status: "valid",
						label: "Button",
						deepLink: "/system/sys_1?component=cmp_btn",
					},
				]}
				onNavigate={() => {}}
			/>,
		);
		expect(html).toContain("Button");
		expect(html).toContain('type="button"');
	});

	it("renders static chips for broken references", () => {
		const html = renderToStaticMarkup(
			<MemoryNoteBody
				body="Missing {{asset:gone}}."
				references={[
					{
						type: "asset",
						id: "gone",
						raw: "{{asset:gone}}",
						start: 8,
						end: 22,
						status: "broken",
					},
				]}
			/>,
		);
		expect(html).toContain("gone");
		expect(html).not.toContain('type="button"');
	});
});
