import type { ElementType } from "react";
import { AvatarFallback, AvatarImage, AvatarRoot } from "./avatar";
import type { BaseUiComponents } from "./components";
import {
	MenuItem,
	MenuPopup,
	MenuPortal,
	MenuPositioner,
	MenuRoot,
	MenuSeparator,
	MenuTrigger,
} from "./menu";
import { Separator } from "./separator";

export const baseUiRenderComponents = {
	"avatar.root": AvatarRoot,
	"avatar.image": AvatarImage,
	"avatar.fallback": AvatarFallback,
	"menu.root": MenuRoot,
	"menu.trigger": MenuTrigger,
	"menu.portal": MenuPortal,
	"menu.positioner": MenuPositioner,
	"menu.popup": MenuPopup,
	"menu.item": MenuItem,
	"menu.separator": MenuSeparator,
	separator: Separator,
} satisfies Record<BaseUiComponents, ElementType>;
