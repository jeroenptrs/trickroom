import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Outlet } from "react-router";
import { toast } from "sonner";
import { useTailwindSyncController } from "../hooks/useTailwindSyncController";
import {
	ProjectConfigContext,
	TailwindSyncControllerContext,
} from "./contexts";
import "../index.css";
import { configFileQueryOptions } from "../queries/config-file";
import { HttpError } from "../utils/readJsonOrThrow";

export function Root() {
	const configQuery = useQuery(configFileQueryOptions());
	const syncController = useTailwindSyncController(configQuery.data);
	const syncControllerHasIssues = Object.entries(syncController.results)
		.map(([key, value]) => (value.status === "error" ? key : undefined))
		.filter(Boolean);
	const syncControllerNeedsReview = Object.entries(syncController.results)
		.map(([key, value]) => (value.data?.reviewRequired ? key : undefined))
		.filter(Boolean);

	useEffect(() => {
		if (syncControllerHasIssues.length) {
			toast.warning("Your systems need attention", {
				description:
					syncControllerHasIssues.length === 1
						? `${syncControllerHasIssues[0]} has issues syncing tokens`
						: "Some design systems have issues syncing tokens",
			});
		}
	}, [syncControllerHasIssues]);

	useEffect(() => {
		if (syncControllerNeedsReview.length) {
			toast.info("Your systems need attention", {
				description:
					syncControllerNeedsReview.length === 1
						? `${syncControllerNeedsReview[0]} has token changes to review`
						: "Some design systems have token changes to review",
			});
		}
	}, [syncControllerNeedsReview]);

	if (configQuery.isPending) {
		return (
			<div className="pointer-events-none absolute left-3 top-3 z-30 bg-gray-500 px-2 py-1 text-xs text-white">
				Loading project data...
			</div>
		);
	}

	if (configQuery.isError) {
		if (
			configQuery.error instanceof HttpError &&
			configQuery.error.status === 404
		) {
			return <Navigate to="/new" replace />;
		}

		const errorMessage = (configQuery.error as Error | null)?.message;
		return (
			<div className="absolute left-3 top-3 z-30 bg-red-500 px-2 py-1 text-xs text-white">
				Failed to load project data: {errorMessage}
			</div>
		);
	}

	return (
		<ProjectConfigContext.Provider value={configQuery.data}>
			<TailwindSyncControllerContext.Provider value={syncController}>
				<main
					className="isolate relative h-screen w-screen overflow-hidden bg-white text-black"
					data-project-name={configQuery.data.name}
				>
					<Outlet />
				</main>
			</TailwindSyncControllerContext.Provider>
		</ProjectConfigContext.Provider>
	);
}
