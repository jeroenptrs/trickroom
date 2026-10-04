import { useMatch } from "react-router";
import { useEditorContextReporter } from "../hooks/useEditorContextReporter";
import { useEditorFocusRequests } from "../hooks/useEditorFocusRequests";

/**
 * Connects this tab to the editor channel: agents can read what it shows and
 * point it at a design, board or layer. Kept in its own component so route
 * changes do not re-render the project root.
 */
export function EditorChannel({
	enabled,
	projectId,
}: {
	enabled: boolean;
	projectId: string | null;
}) {
	const designFileId = useMatch("/design/:uuid")?.params.uuid ?? null;
	useEditorContextReporter({ enabled, projectId, designFileId });
	useEditorFocusRequests({ enabled, projectId });
	return null;
}
