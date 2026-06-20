import type { ElementType } from "react";
import {
	AccordionHeader,
	AccordionItem,
	AccordionPanel,
	AccordionRoot,
	AccordionTrigger,
} from "./accordion";
import { AvatarFallback, AvatarImage, AvatarRoot } from "./avatar";
import { Button } from "./button";
import {
	CollapsiblePanel,
	CollapsibleRoot,
	CollapsibleTrigger,
} from "./collapsible";
import type { BaseUiComponents } from "./components";
import { Input } from "./input";
import {
	MenuItem,
	MenuPopup,
	MenuPortal,
	MenuPositioner,
	MenuRoot,
	MenuSeparator,
	MenuTrigger,
} from "./menu";
import { RadioGroup, RadioIndicator, RadioRoot } from "./radio";
import { Separator } from "./separator";
import { SwitchRoot, SwitchThumb } from "./switch";
import { Toggle, ToggleGroup } from "./toggle";

export const baseUiRenderComponents = {
	"accordion.root": AccordionRoot,
	"accordion.item": AccordionItem,
	"accordion.header": AccordionHeader,
	"accordion.trigger": AccordionTrigger,
	"accordion.panel": AccordionPanel,
	"avatar.root": AvatarRoot,
	"avatar.image": AvatarImage,
	"avatar.fallback": AvatarFallback,
	button: Button,
	"collapsible.root": CollapsibleRoot,
	"collapsible.trigger": CollapsibleTrigger,
	"collapsible.panel": CollapsiblePanel,
	input: Input,
	"menu.root": MenuRoot,
	"menu.trigger": MenuTrigger,
	"menu.portal": MenuPortal,
	"menu.positioner": MenuPositioner,
	"menu.popup": MenuPopup,
	"menu.item": MenuItem,
	"menu.separator": MenuSeparator,
	"radio-group": RadioGroup,
	"radio.root": RadioRoot,
	"radio.indicator": RadioIndicator,
	separator: Separator,
	"switch.root": SwitchRoot,
	"switch.thumb": SwitchThumb,
	toggle: Toggle,
	"toggle-group": ToggleGroup,
} satisfies Record<BaseUiComponents, ElementType>;
