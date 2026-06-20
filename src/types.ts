import type { ElementType } from "react";
import type { TrickRoomComponents } from "./libraries/trickroom/components";

export type Role = "text";

export type Registry<ComponentList extends string> = Record<
	ComponentList,
	{
		component: ElementType;
		role?: Role;
	}
>;

export type Props = {
	className?: string;
	"data-trickroom-name": string;
	"data-trickroom-role"?: Role;
} & {
	// trickroom library
	"data-trickroom-library": "trickroom"; // TODO - future: base ui, radix, headless ui, ...
	"data-trickroom-component": TrickRoomComponents;
};

export type Node = {
	id: string;
	props: Props;
	children: string | Node[];
};

export type TrickroomConfig = {
	name: string;
	systems?: Record<string, string>;
	mcp?: {
		enabled: boolean;
	};
};

export type ProjectRoot = {
	projectRoot: string;
};

export type TrickroomDesign = {
	name: string;
	systemName?: string | null;
	boards: Node[];
};

export type TrickroomDesignSummary = {
	uuid: string;
	file: string;
	name: string;
	systemName?: string | null;
};
