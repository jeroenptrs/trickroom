import { BrowserRouter } from "react-router";
import { AppDialogHost } from "./components/AppDialogHost";
import { Root } from "./components/Root";

export default function App() {
	return (
		<BrowserRouter>
			<AppDialogHost />
			<Root />
		</BrowserRouter>
	);
}
