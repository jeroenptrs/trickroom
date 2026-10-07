import { queryOptions } from "@tanstack/react-query";
import type { DesignFileLintResponse } from "../lint/design-lint";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

/**
 * The design-side lint findings of a saved design, from the same rules and
 * `lint.json` as `design_validate` and `trickroom lint` (docs/lint.md).
 * File events on designs and system files refresh it, so it follows
 * autosave rather than every keystroke.
 */

export type { DesignFileLintResponse };

export const DESIGN_LINT_QUERY_PREFIX = "trickroom-design-lint";

export const designLintQueryOptions = (
	designId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: withProjectQueryScope(
			[DESIGN_LINT_QUERY_PREFIX, designId],
			projectScope,
		),
		queryFn: async () => {
			const response = await fetch(
				`/api/trickroom/design/lint?id=${encodeURIComponent(designId)}`,
			);
			return readJsonOrThrow<DesignFileLintResponse>(response);
		},
		retry: false,
	});
