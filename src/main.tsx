import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { CreateProject } from "./components/CreateProject";
import { Design } from "./components/Design";
import { Project } from "./components/Project";
import { Root } from "./components/Root";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<Routes>
					<Route path="/" element={<Root />}>
						<Route index element={<Project />} />
						<Route path="/design/:uuid" element={<Design />} />
					</Route>
					<Route path="/new" element={<CreateProject />} />
				</Routes>
			</BrowserRouter>
			<Toaster
				toastOptions={{
					classNames: {
						toast: "!rounded-none !border-gray-200",
					},
				}}
			/>
		</QueryClientProvider>
	</React.StrictMode>,
);
