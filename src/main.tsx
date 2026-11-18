import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

// Capture pages are what design_screenshot and design_export photograph.
// The screenshot service opens them directly, so no toast may paint into
// the image (for example the system sync attention toasts).
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
								"!rounded-none !border-slate-200 !bg-white !text-slate-950 !font-sans",
							title: "!font-medium",
							description: "!text-slate-700",
							error:
								"[&_[data-title]]:!text-red-900 [&_[data-icon]]:!text-red-700",
							warning:
								"[&_[data-title]]:!text-amber-900 [&_[data-icon]]:!text-amber-700",
							success:
								"[&_[data-title]]:!text-emerald-900 [&_[data-icon]]:!text-emerald-700",
							info: "[&_[data-title]]:!text-cyan-900 [&_[data-icon]]:!text-cyan-700",
							actionButton: "!rounded-none !bg-slate-950 !text-slate-50",
							cancelButton: "!rounded-none",
						},
					}}
				/>
			)}
		</QueryClientProvider>
	</React.StrictMode>,
);
