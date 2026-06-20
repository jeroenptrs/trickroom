import type { Props, Registry } from "../types";
import type { TrickRoomComponents } from "./trickroom/components";
import trickroomRegistry from "./trickroom/registry";

export const availableRegistries = ["trickroom"];

type LibraryRegistries = {
	trickroom: Registry<TrickRoomComponents>;
};

const registries = {
	trickroom: trickroomRegistry,
} satisfies LibraryRegistries;

export function getLibraryComponent<Library extends keyof LibraryRegistries>(
	library: Library,
	component: Props["data-trickroom-component"],
) {
	return (registries[library] as LibraryRegistries[Library])[
		component as keyof LibraryRegistries[Library]
	];
}

export { registries };
