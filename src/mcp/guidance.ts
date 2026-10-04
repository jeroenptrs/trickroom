// Agents tend to create one board per breakpoint. Boards are not breakpoints:
// one board is responsive and is reviewed at different viewport widths.
export const BOARD_GUIDANCE =
	"One board is one responsive screen: build it once with responsive Tailwind variants (sm:, md:, lg:) and review it at different viewport widths (screenshotBoard viewport mobile/tablet/desktop). Do not create separate boards per breakpoint (no desktop board + mobile board). Use separate boards for distinct views or interaction states, e.g. a page, the same page with a sheet open, or with a dialog open.";

export const STEP_REFERENCE_GUIDANCE =
	"Element id parameters (elementId, parentId, targetParentId, sourceElementId, instanceId, rootElementId) may reference earlier steps: $step:N (changed element), $step:N:rootElementId, $step:N:tempId:<tempId> (a node from an earlier addSubtree; for copySubtree, a source element id), $step:N:slot:<slotName> (the slot host of the recipe step N inserted, e.g. a dialog's popup content), and $step:N:tempId:<recipeTempId>:slot:<slotName> when a step inserted several recipes.";
