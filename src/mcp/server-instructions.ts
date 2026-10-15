import { TOOL } from "./tool-names";

/**
 * Sent once at initialize: a map of the tool families and the loop agents
 * follow. Clients truncate instructions beyond 2,048 characters (a test
 * checks the length); details live in the guide.
 */
export const TRICKROOM_MCP_SERVER_INSTRUCTIONS = `Trickroom is a code-native design tool: designs are JSON trees of React and Tailwind elements in the project's .trickroom.

Tools:
- project_*: the project this session works in. ${TOOL.projectList} shows it and every registered one; ${TOOL.projectSelect} switches, or registers a path.
- ${TOOL.guide}: rules, operations, recipes, components, tokens. Read the core once per session, topics as a task needs them.
- design_*: ${TOOL.designList}, ${TOOL.designRead}, ${TOOL.designApply} (the one write tool: ordered operations in one batch), ${TOOL.designValidate} (checks or dry-runs), ${TOOL.designCreate}, ${TOOL.designScreenshot}, ${TOOL.designExport}.
- editor_*: what the human has open and selected (${TOOL.editorContext}); moving their view (${TOOL.editorFocus}).
- memory_*: durable notes on intent, conventions and decisions, per project, system or design.
- system_* and component_*: design system tokens, assets, icons, and system components.

Session start: ${TOOL.projectList} (or ${TOOL.projectSelect}), then ${TOOL.memoryRead}({ designFileId }) for the design you work on, then ${TOOL.guide}({ designFileId }).

Loop: ${TOOL.designRead} the area you change (view "outline" for ids, elementId for detail); ${TOOL.designApply} one batch with expectedRevision from your last read or write; fix the warnings it returns; ${TOOL.designScreenshot} the changed boards at several viewports in one call and look; ${TOOL.designValidate} before handing off; ${TOOL.editorFocus} to show the human what changed. When the human says "this", call ${TOOL.editorContext}. On REVISION_MISMATCH, re-read only the boards it names and retry.

Annotations are the designer's remarks for you. When a result has \`annotations\`, pass addresses: [{ annotationId, reply }] to the write that makes the change (unrelated ones in separate writes), or ask with ${TOOL.annotationReply}; resolve only when asked. Rounds: loop on ${TOOL.annotationWatch} round: true until "closed".

A board is one responsive screen or state, reviewed at several widths: never one board per breakpoint.

When a Trickroom tool blocked or misled you, or lacked a capability, report it with ${TOOL.feedbackSubmit} (not for design content or annotations).`;
