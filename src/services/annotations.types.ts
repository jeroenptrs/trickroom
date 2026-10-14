import type { Props } from "../types";

/**
 * Annotations: remarks a designer anchors to a design, board, layer or
 * component node, and the agent replies and change records under them. An
 * annotation is the thread, an entry one message in it, the target its
 * anchor. Per-user working state stored under the Trickroom home, never in
 * the project; see docs/project-files.md#annotations.
 */

export const ANNOTATION_FILE_VERSION = 1;

export const ANNOTATION_STATUSES = [
	"open",
	"acknowledged",
	"addressed",
	"needs_input",
	"resolved",
	"dismissed",
] as const;

export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];

/** Resolved and dismissed annotations are closed; every other one is live. */
export const CLOSED_ANNOTATION_STATUSES: ReadonlySet<AnnotationStatus> =
	new Set(["resolved", "dismissed"]);

/**
 * Who wrote an entry or made a transition. The HTTP endpoints record
 * `human`, the MCP tools `agent` with their session id. Nothing else sets it.
 */
export type AnnotationActor =
	| { role: "human" }
	| { role: "agent"; sessionId: string };

export type AnnotationTarget =
	| { kind: "design"; designId: string }
	| { kind: "board"; designId: string; boardId: string }
	| { kind: "layer"; designId: string; boardId: string; elementId: string }
	| {
			kind: "componentNode";
			systemId: string;
			componentId: string;
			nodePath: string;
			/** Variant values the remark is pinned to; absent = every configuration. */
			variants?: Record<string, string>;
	  };

/** The folder an annotation file lives in: one design, or one component. */
export type AnnotationContainer =
	| { kind: "design"; designId: string }
	| { kind: "component"; systemId: string; componentId: string };

/** Where the checkout an annotation belongs to is: its git branch and worktree. */
export type AnnotationScope = {
	/** The checked-out branch, or `"*"` for a detached HEAD or no git. */
	branch: string;
	/** The worktree (or project root without git), absolute. */
	worktreePath: string;
};

/**
 * What the target looked like when the annotation was created, so a
 * detached annotation still says what it was about.
 */
export type AnnotationSnapshot = AnnotationScope & {
	/** Layer, board, design or component node name. */
	layerName?: string;
	/** `library/component` of the layer. */
	component?: string;
	/** Names of the ancestors, board first, nearest parent last. */
	ancestorNames?: string[];
	/** Design (or component) revision the remark was made against. */
	designRevision?: string;
	/** How the designer was looking at it: `canvas` or `responsive`. */
	stageMode?: string;
	/** Width of the responsive view, in CSS pixels. */
	responsiveWidth?: number;
};

/**
 * One layer's own state, without its descendants: its parent, props and
 * either its text or its children's ids in order. Change records keep these
 * for every layer a write touched, which is what revert restores.
 */
export type AnnotationLayerState = {
	/** Null for a board. */
	parentId: string | null;
	props: Props;
	/** Text of a text layer, or the ids of its children in order. */
	children: string | string[];
};

/** Top-level design fields other than boards (name, system link, policy). */
export type AnnotationDesignSettings = Record<string, unknown>;

/** The restorable side of a change record. */
export type AnnotationChangeState<Layer> = {
	/** Every layer the write touched; null when it did not exist. */
	layers: Record<string, Layer | null>;
	/** Board order, when the write changed it. */
	boardOrder?: string[];
	/** Design settings, when the write changed them. */
	settings?: AnnotationDesignSettings;
};

export type AnnotationChangeRecord = {
	revisionBefore: string;
	revisionAfter: string;
	/** Boards the write touched. */
	boards: string[];
	/**
	 * Layers to reveal: changed or added ones, and the parent of each
	 * removed one.
	 */
	layerIds: string[];
	operations: { operation: string; summary: string }[];
	summary: string;
	/**
	 * The touched layers as they were before the write: what "revert this
	 * change" restores. Dropped when the annotation is resolved or dismissed
	 * and when the change is reverted.
	 */
	before?: AnnotationChangeState<AnnotationLayerState>;
	/**
	 * Content hashes of the same layers right after the write (null when the
	 * write removed one). Revert requires every one to still match. Dropped
	 * with `before`.
	 */
	after?: AnnotationChangeState<string>;
};

type EntryBase = {
	id: string;
	at: string;
	by: AnnotationActor;
};

/**
 * - `remark`: the designer's text (the first entry, and every human reply).
 * - `reply`: an agent's text.
 * - `question`: an agent asks; the annotation needs input.
 * - `dismissal`: not doing this, with a reason.
 * - `resolution`: resolved, with an optional summary.
 * - `change`: a design write made for this annotation.
 * - `revert`: a change record undone.
 * - `reanchor`: the target moved to another layer, board or design level.
 * - `move`: the annotation moved to another branch.
 */
export type AnnotationEntry =
	| (EntryBase & { kind: "remark"; body: string })
	| (EntryBase & { kind: "reply"; body: string })
	| (EntryBase & { kind: "question"; body: string })
	| (EntryBase & { kind: "dismissal"; reason: string })
	| (EntryBase & { kind: "resolution"; summary?: string })
	| (EntryBase & {
			kind: "change";
			/** The agent's reply describing the change. */
			body?: string;
			change: AnnotationChangeRecord;
			/** Set once the change has been reverted, to the revert entry's id. */
			revertedBy?: string;
	  })
	| (EntryBase & {
			kind: "revert";
			/** The change entry that was reverted. */
			entryId: string;
			revisionBefore: string;
			revisionAfter: string;
	  })
	| (EntryBase & {
			kind: "reanchor";
			from: AnnotationTarget;
			to: AnnotationTarget;
	  })
	| (EntryBase & {
			kind: "move";
			from: AnnotationScope;
			to: AnnotationScope;
	  });

export type AnnotationEntryKind = AnnotationEntry["kind"];

/** One status change, kept in order. */
export type AnnotationTransition = {
	from: AnnotationStatus | null;
	to: AnnotationStatus;
	at: string;
	by: AnnotationActor;
};

/** An annotation as stored, one file per annotation. */
export type Annotation = {
	version: typeof ANNOTATION_FILE_VERSION;
	id: string;
	projectId: string;
	target: AnnotationTarget;
	/** The checkout's branch it belongs to; `"*"` is the unscoped bucket. */
	branch: string;
	worktreePath: string;
	snapshot: AnnotationSnapshot;
	status: AnnotationStatus;
	/**
	 * The last agent session that saw it, while the status is `acknowledged`
	 * (advisory, never blocks). Cleared when the annotation reopens.
	 */
	acknowledged?: { sessionId: string; at: string };
	createdAt: string;
	updatedAt: string;
	entries: AnnotationEntry[];
	transitions: AnnotationTransition[];
};

/** An annotation as reads return it, with what is derived on read. */
export type AnnotationView = Annotation & {
	/** Content revision; writes may pass it back as `expectedRevision`. */
	revision: string;
	/** Who made the last transition to `resolved`, while resolved. */
	resolvedBy?: AnnotationActor;
	/**
	 * The acknowledgement with its expiry: active while the acknowledging
	 * session has made a tool call within the last 15 minutes. Set while the
	 * status is `acknowledged`.
	 */
	acknowledgement?: { sessionId: string; at: string; active: boolean };
	/**
	 * The target no longer exists in the design read alongside. Absent when
	 * no design was checked.
	 */
	detached?: boolean;
};

/** Per-session MCP state on disk: when the session last made a tool call. */
export type AnnotationSessionFile = {
	version: 1;
	sessionId: string;
	lastCallAt: string;
};

/** Emitted on `/api/trickroom/events` as `annotation` events. */
export type AnnotationFileEvent = {
	annotationId: string;
	container: AnnotationContainer;
	operation: "changed" | "deleted";
	/** The annotation's revision, null when deleted or unreadable. */
	revision: string | null;
};
