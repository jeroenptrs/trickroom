import type { Registry } from "../../types";
import type { TrickRoomComponents } from "./components";
import { Container } from "./container";
import { Text } from "./text";

export default {
	container: {
		component: Container,
	},
	text: {
		component: Text,
		role: "text",
	},
} satisfies Registry<TrickRoomComponents>;
