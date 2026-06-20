import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckboxGroup, CheckboxIndicator, CheckboxRoot } from "./checkbox";
import {
	ComboboxInput,
	ComboboxItem,
	ComboboxLabel,
	ComboboxList,
	ComboboxPopup,
	ComboboxPortal,
	ComboboxPositioner,
	ComboboxRoot,
	ComboboxTrigger,
} from "./combobox";
import {
	DrawerBackdrop,
	DrawerClose,
	DrawerContent,
	DrawerPopup,
	DrawerPortal,
	DrawerRoot,
	DrawerTitle,
	DrawerTrigger,
	DrawerViewport,
} from "./drawer";
import { MeterIndicator, MeterLabel, MeterRoot, MeterTrack } from "./meter";
import {
	ScrollAreaContent,
	ScrollAreaRoot,
	ScrollAreaScrollbar,
	ScrollAreaThumb,
	ScrollAreaViewport,
} from "./scroll-area";
import {
	SelectItem,
	SelectItemText,
	SelectList,
	SelectPopup,
	SelectPortal,
	SelectPositioner,
	SelectRoot,
	SelectTrigger,
	SelectValue,
} from "./select";
import {
	SliderControl,
	SliderIndicator,
	SliderRoot,
	SliderThumb,
	SliderTrack,
} from "./slider";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "./tabs";

describe("expanded Base UI rendering", () => {
	it("renders checkbox parts and checkbox groups", () => {
		const markup = renderToStaticMarkup(
			<CheckboxGroup className="checkbox-group">
				<CheckboxRoot className="checkbox-root" defaultChecked value="terms">
					<CheckboxIndicator className="checkbox-indicator">
						Check
					</CheckboxIndicator>
					Terms
				</CheckboxRoot>
			</CheckboxGroup>,
		);

		expect(markup).toContain('class="checkbox-group"');
		expect(markup).toContain('class="checkbox-root"');

		const fallbackMarkup = renderToStaticMarkup(
			<CheckboxIndicator className="checkbox-indicator">
				Check
			</CheckboxIndicator>,
		);

		expect(fallbackMarkup).toContain('class="checkbox-indicator"');
	});

	it("renders a select hierarchy and standalone item fallbacks", () => {
		const markup = renderToStaticMarkup(
			<SelectRoot defaultOpen defaultValue="one">
				<SelectTrigger className="select-trigger">
					<SelectValue />
				</SelectTrigger>
				<SelectPortal>
					<SelectPositioner>
						<SelectPopup className="select-popup">
							<SelectList>
								<SelectItem className="select-item" value="one">
									<SelectItemText>One</SelectItemText>
								</SelectItem>
							</SelectList>
						</SelectPopup>
					</SelectPositioner>
				</SelectPortal>
			</SelectRoot>,
		);

		expect(markup).toContain('class="select-trigger"');

		const fallbackMarkup = renderToStaticMarkup(
			<SelectPopup className="select-popup">
				<SelectItem className="select-item" value="two">
					<SelectItemText>Two</SelectItemText>
				</SelectItem>
			</SelectPopup>,
		);

		expect(fallbackMarkup).toContain('class="select-popup"');
		expect(fallbackMarkup).toContain('class="select-item"');
		expect(fallbackMarkup).toContain("Two");
	});

	it("renders a combobox hierarchy and standalone item fallbacks", () => {
		const markup = renderToStaticMarkup(
			<ComboboxRoot defaultOpen>
				<ComboboxLabel className="combobox-label">Search</ComboboxLabel>
				<ComboboxInput className="combobox-input" />
				<ComboboxTrigger className="combobox-trigger">Open</ComboboxTrigger>
				<ComboboxPortal>
					<ComboboxPositioner>
						<ComboboxPopup className="combobox-popup">
							<ComboboxList>
								<ComboboxItem className="combobox-item" value="one">
									One
								</ComboboxItem>
							</ComboboxList>
						</ComboboxPopup>
					</ComboboxPositioner>
				</ComboboxPortal>
			</ComboboxRoot>,
		);

		expect(markup).toContain('class="combobox-label"');
		expect(markup).toContain('class="combobox-input"');

		const fallbackMarkup = renderToStaticMarkup(
			<ComboboxPopup className="combobox-popup">
				<ComboboxItem className="combobox-item" value="two">
					Two
				</ComboboxItem>
			</ComboboxPopup>,
		);

		expect(fallbackMarkup).toContain('class="combobox-popup"');
		expect(fallbackMarkup).toContain('class="combobox-item"');
		expect(fallbackMarkup).toContain("Two");
	});

	it("renders drawer parts through a root and standalone trigger fallbacks", () => {
		const markup = renderToStaticMarkup(
			<DrawerRoot defaultOpen>
				<DrawerTrigger className="drawer-trigger">Open</DrawerTrigger>
				<DrawerPortal>
					<DrawerBackdrop className="drawer-backdrop" />
					<DrawerViewport>
						<DrawerPopup className="drawer-popup">
							<DrawerContent>
								<DrawerTitle>Drawer</DrawerTitle>
								<DrawerClose>Close</DrawerClose>
							</DrawerContent>
						</DrawerPopup>
					</DrawerViewport>
				</DrawerPortal>
			</DrawerRoot>,
		);

		expect(markup).toContain('class="drawer-trigger"');

		const fallbackMarkup = renderToStaticMarkup(
			<>
				<DrawerTrigger className="drawer-trigger">Open</DrawerTrigger>
				<DrawerBackdrop className="drawer-backdrop" />
				<DrawerPopup className="drawer-popup">
					<DrawerTitle>Drawer</DrawerTitle>
				</DrawerPopup>
			</>,
		);
		expect(fallbackMarkup).toContain('class="drawer-trigger"');
		expect(fallbackMarkup).toContain('class="drawer-backdrop"');
		expect(fallbackMarkup).toContain('class="drawer-popup"');
		expect(fallbackMarkup).toContain("Drawer");
	});

	it("renders meter, scroll area, slider, and tabs hierarchies", () => {
		const markup = renderToStaticMarkup(
			<>
				<MeterRoot className="meter-root" value={50}>
					<MeterLabel>Usage</MeterLabel>
					<MeterTrack>
						<MeterIndicator className="meter-indicator" />
					</MeterTrack>
				</MeterRoot>
				<ScrollAreaRoot className="scroll-root">
					<ScrollAreaViewport>
						<ScrollAreaContent>Content</ScrollAreaContent>
					</ScrollAreaViewport>
					<ScrollAreaScrollbar>
						<ScrollAreaThumb className="scroll-thumb" />
					</ScrollAreaScrollbar>
				</ScrollAreaRoot>
				<SliderRoot className="slider-root" defaultValue={50}>
					<SliderControl>
						<SliderTrack>
							<SliderIndicator className="slider-indicator" />
							<SliderThumb className="slider-thumb" />
						</SliderTrack>
					</SliderControl>
				</SliderRoot>
				<TabsRoot className="tabs-root" defaultValue="one">
					<TabsList>
						<TabsTab value="one">One</TabsTab>
					</TabsList>
					<TabsPanel value="one">Panel</TabsPanel>
				</TabsRoot>
			</>,
		);

		expect(markup).toContain('class="meter-root"');
		expect(markup).toContain('class="meter-indicator"');
		expect(markup).toContain('class="scroll-root"');
		expect(markup).toContain('class="slider-root"');
		expect(markup).toContain('class="slider-thumb"');
		expect(markup).toContain('class="tabs-root"');
		expect(markup).toContain("Panel");

		const fallbackMarkup = renderToStaticMarkup(
			<ScrollAreaThumb className="scroll-thumb" />,
		);
		expect(fallbackMarkup).toContain('class="scroll-thumb"');
	});
});
