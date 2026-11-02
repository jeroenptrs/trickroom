import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

// Capture pages are what design_screenshot and design_export photograph.
// The screenshot service opens them directly, so no toast may paint into
// the image (for example the "Your systems need attention" toast).
const isCaptureRoute = window.location.pathname.startsWith("/capture/");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<App />
			{!isCaptureRoute && (
				<Toaster
					toastOptions={{
						classNames: {
							toast:
								"!rounded-none !border-slate-200 !bg-white !text-slate-950",
						},
					}}
				/>
			)}
		</QueryClientProvider>
	</React.StrictMode>,
);
