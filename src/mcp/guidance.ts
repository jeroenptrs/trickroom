import { TOOL } from "./tool-names";

// Agents tend to create one board per breakpoint. Boards are not breakpoints:
// one board is responsive and is reviewed at different viewport widths.
export const BOARD_GUIDANCE = `One board is one responsive screen: build it once with responsive Tailwind variants (sm:, md:, lg:) and review it at different viewport widths (${TOOL.designScreenshot} viewport mobile/tablet/desktop). Do not create separate boards per breakpoint (no desktop board + mobile board). Use separate boards for distinct views or interaction states, e.g. a page, the same page with a sheet open, or with a dialog open.`;
