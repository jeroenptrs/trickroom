import { BrowserRouter } from "react-router";
import { AppDialogHost } from "./components/AppDialogHost";
import { Root } from "./components/Root";
import { tabBasename } from "./utils/tab-location";

export default function App() {
	return (
		// A tab pinned to a checkout routes under `/p/<locationId>`, so every
		// link and navigation in the app stays inside that checkout.
		<BrowserRouter basename={tabBasename}>
			<AppDialogHost />
			<Root />
		</BrowserRouter>
	);
}
