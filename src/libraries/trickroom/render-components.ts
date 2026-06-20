import type { ElementType } from "react";
import { Asset } from "./asset";
import type { TrickRoomComponents } from "./components";
import { Container } from "./container";
import { Icon } from "./icon";
import { Text } from "./text";

export const trickroomRenderComponents = {
	asset: Asset,
	container: Container,
	icon: Icon,
	text: Text,
} satisfies Record<TrickRoomComponents, ElementType>;
