import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { systemIconSvgQueryKey } from "../../queries/system-icons";
import { iconIdProp } from "../../utils/resource-props";
import { Icon } from "./icon";
import { DesignSystemRenderContext } from "./render-context";

type FakeAttribute = {
	name: string;
	value: string;
};

class FakeDOMParser {
	parseFromString(svgText: string) {
		const trimmed = svgText.trim();
		const match = /^<([a-zA-Z][\w:-]*)([^>]*)>([\s\S]*)<\/\1>\s*$/u.exec(
			trimmed,
		);
		const localName = match?.[1] ?? "parsererror";
		const rawAttributes = match?.[2] ?? "";
		const attributes: FakeAttribute[] = [];
		const attributePattern = /([^\s=]+)="([^"]*)"/gu;

		for (const attrMatch of rawAttributes.matchAll(attributePattern)) {
			attributes.push({ name: attrMatch[1], value: attrMatch[2] });
		}

		return {
			documentElement: {
				localName,
				attributes,
				innerHTML: match?.[3] ?? "",
			},
			getElementsByTagName: (tagName: string) =>
				trimmed.includes(`<${tagName}`) ? [{}] : [],
		};
	}
}

type RenderIconOptions = {
	ariaLabel?: string;
	className?: string;
};

const renderIcon = (
	svg: string | null | undefined,
	options: RenderIconOptions = {},
) => {
	const { ariaLabel = "Search" } = options;
	const className =
		"className" in options ? options.className : "size-4 text-cyan-600";
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	if (svg !== undefined) {
		queryClient.setQueryData(systemIconSvgQueryKey("Core", "src/search"), svg);
	}

	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<DesignSystemRenderContext.Provider value="Core">
				<Icon
					className={className}
					aria-label={ariaLabel}
					{...{ [iconIdProp]: "src/search" }}
				/>
			</DesignSystemRenderContext.Provider>
		</QueryClientProvider>,
	);
};

describe("Icon render output", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders fetched SVG content as the root element with injected Trickroom props", () => {
		vi.stubGlobal("DOMParser", FakeDOMParser);

		const markup = renderIcon(
			'<svg viewBox="0 0 24 24" class="from-svg" role="presentation" aria-label="From SVG" data-trickroom-icon-id="wrong" data-trickroom-extra="stale"><path d="M4 12h16" stroke="currentColor" stroke-width="2"/></svg>',
			{ ariaLabel: "Search icon" },
		);

		expect(markup).toMatch(/^<svg\b/u);
		expect(markup).toContain('viewBox="0 0 24 24"');
		expect(markup).toContain('class="size-4 text-cyan-600"');
		expect(markup).toContain('data-trickroom-icon-id="src/search"');
		expect(markup).toContain('role="img"');
		expect(markup).toContain('aria-label="Search icon"');
		expect(markup).toContain("<path");
		expect(markup).not.toContain("<span");
		expect(markup).not.toContain("data-trickroom-missing-resource");
		expect(markup).not.toContain("data-trickroom-extra");
	});

	it("preserves the source SVG class when no className prop is provided", () => {
		vi.stubGlobal("DOMParser", FakeDOMParser);

		const markup = renderIcon(
			'<svg viewBox="0 0 24 24" class="from-svg"><path d="M4 12h16"/></svg>',
			{ className: undefined },
		);

		expect(markup).toMatch(/^<svg\b/u);
		expect(markup).toContain('class="from-svg"');
	});

	it("keeps the span fallback when SVG parsing fails", () => {
		vi.stubGlobal("DOMParser", FakeDOMParser);

		const markup = renderIcon("<not-svg><path /></not-svg>");

		expect(markup).toMatch(/^<span\b/u);
		expect(markup).toContain('data-trickroom-missing-resource="icon"');
		expect(markup).not.toContain("<path");
	});

	it("keeps the span fallback for missing SVG content", () => {
		const markup = renderIcon(null);

		expect(markup).toMatch(/^<span\b/u);
		expect(markup).toContain('data-trickroom-icon-id="src/search"');
		expect(markup).toContain('data-trickroom-missing-resource="icon"');
		expect(markup).toContain('role="img"');
		expect(markup).toContain('aria-label="Search"');
	});
});
