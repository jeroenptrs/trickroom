import { useMatch } from "react-router";
import { useEditorContextReporter } from "../hooks/useEditorContextReporter";

/**
 * Connects this tab to the editor channel: agents can read what it shows. Kept
 * in its own component so route changes do not re-render the project root.
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
	return null;
}
