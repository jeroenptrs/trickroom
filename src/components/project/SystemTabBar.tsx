import { Image, Library } from "lucide-react";
import { TabsList, TabsTab } from "../ui/tabs";

export type SystemTab = "overview" | "tokens" | "assets" | "icons" | "settings";

export function SystemTabBar() {
	return (
		<TabsList className="border-b border-slate-200">
			<TabsTab value="overview">Overview</TabsTab>
			<TabsTab value="tokens">Tokens</TabsTab>
			<TabsTab value="assets">
				<Image className="mr-1 size-3.5" aria-hidden="true" />
				Assets
			</TabsTab>
			<TabsTab value="icons">
				<Library className="mr-1 size-3.5" aria-hidden="true" />
				Icon libraries
			</TabsTab>
			<TabsTab value="settings">Settings</TabsTab>
		</TabsList>
	);
}
