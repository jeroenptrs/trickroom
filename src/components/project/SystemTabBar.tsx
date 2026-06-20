import { TabsList, TabsTab } from "../ui/tabs";

export type SystemTab = "overview" | "tokens" | "settings";

export function SystemTabBar() {
	return (
		<TabsList className="border-b border-slate-200">
			<TabsTab value="overview">Overview</TabsTab>
			<TabsTab value="tokens">Tokens</TabsTab>
			<TabsTab value="settings">Settings</TabsTab>
		</TabsList>
	);
}
