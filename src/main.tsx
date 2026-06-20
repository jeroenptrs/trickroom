import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";
import { initRendererSentry } from "./sentry/renderer";

initRendererSentry();

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<App />
			<Toaster
				toastOptions={{
					classNames: {
						toast: "!rounded-none !border-slate-200 !bg-white !text-slate-950",
					},
				}}
			/>
		</QueryClientProvider>
	</React.StrictMode>,
);
