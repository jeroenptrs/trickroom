import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	createDesignFile,
	designSummariesQueryKey,
} from "../../queries/design-file";
import type { TrickroomDesign } from "../../types";
import { markDesignOpened } from "../../utils/design-activity";
import { useProjectScope } from "../contexts";

/** Creates an "Untitled" design and hands its id to `onCreated`. */
export function useCreateDesign(onCreated: (designUuid: string) => void) {
	const queryClient = useQueryClient();
	const projectScope = useProjectScope();

	// TODO: when creating - add a secondary state requesting a name for the design file
	return useMutation({
		mutationFn: async () => {
			const designUuid = crypto.randomUUID();
			const design: TrickroomDesign = {
				name: "Untitled",
				boards: [],
			};

			await createDesignFile(designUuid, design);
			return designUuid;
		},
		onSuccess: async (designUuid) => {
			markDesignOpened(projectScope, designUuid);
			await queryClient.invalidateQueries({
				queryKey: designSummariesQueryKey,
			});
			onCreated(designUuid);
		},
	});
}
