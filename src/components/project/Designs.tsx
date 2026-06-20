import { RiFileAiLine as FileAi } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import {
	designFileQueryOptions,
	designSummariesQueryKey,
	designSummariesQueryOptions,
	getDesignFileForUuid,
	saveDesignFile,
} from "../../queries/design-file";
import type { TrickroomDesign } from "../../types";
import { Button } from "../ui/button";
import { Text } from "../ui/text";

export function Designs() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const designsQuery = useQuery(designSummariesQueryOptions());
	const designsErrorMessage = (designsQuery.error as Error | null)?.message;

	const prefetchDesignFile = (file: string) =>
		queryClient.prefetchQuery(designFileQueryOptions(file));

	// TODO: when creating - add a secondary state requesting a name for the design file

	const createDesignMutation = useMutation({
		mutationFn: async () => {
			const designUuid = crypto.randomUUID();
			const designFile = getDesignFileForUuid(designUuid);
			const design: TrickroomDesign = {
				name: "Untitled Design",
				boards: [
					{
						id: crypto.randomUUID(),
						props: {
							"data-trickroom-name": "Root",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
						},
						children: [],
					},
				],
			};

			await saveDesignFile(designFile, design);
			return designUuid;
		},
		onSuccess: async (designUuid) => {
			await queryClient.invalidateQueries({
				queryKey: designSummariesQueryKey,
			});
			navigate(`/design/${designUuid}`);
		},
	});
	const createErrorMessage = (createDesignMutation.error as Error | null)
		?.message;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-row items-center justify-between">
				<Text variant="subtitle">Designs</Text>
			</div>
			{designsQuery.isPending ? (
				<div className="pointer-events-none bg-gray-500 px-2 py-1 text-xs text-white w-fit">
					Loading designs...
				</div>
			) : null}
			{designsQuery.isError ? (
				<div className="bg-red-500 px-2 py-1 text-xs text-white w-fit">
					Failed to load designs: {designsErrorMessage}
				</div>
			) : null}
			{createDesignMutation.isError ? (
				<div className="bg-red-500 px-2 py-1 text-xs text-white w-fit">
					Failed to create design: {createErrorMessage}
				</div>
			) : null}
			{designsQuery.isSuccess ? (
				<div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
					{designsQuery.data.map((design) => (
						<div
							key={design.file}
							className="flex flex-col inset-shadow-[0_0_0_1px] inset-shadow-gray-200 focus-visible:outline-none focus-within:inset-shadow-blue-200"
						>
							<Link
								to={`/design/${design.uuid}`}
								onMouseEnter={() => prefetchDesignFile(design.file)}
								className="px-3 py-4 hover:bg-gray-100 focus-visible:outline-none"
							>
								<Text className="truncate">{design.name}</Text>
							</Link>
						</div>
					))}
					<Button
						variant="block"
						className="inset-shadow-gray-200 px-3 py-4"
						disabled={createDesignMutation.isPending}
						onClick={() => createDesignMutation.mutate()}
					>
						<span className="flex flex-row gap-1 items-center justify-center">
							<FileAi className="size-4 fill-black" />
							{createDesignMutation.isPending ? "Creating..." : "Create"}
						</span>
					</Button>
				</div>
			) : null}
		</div>
	);
}
