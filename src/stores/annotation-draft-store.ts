import { createStore, shallow, useSelector } from "@tanstack/react-store";
import { isAnnotationTarget } from "../services/annotation-model";
import type { AnnotationTarget } from "../services/annotations.types";
import { annotationTargetKey } from "../utils/annotation-presentation";

// Annotations the designer is still writing: a new annotation per target,
// and a reply per annotation. Nothing here reaches disk until Send; once an
// annotation is on disk it is in front of a working agent within one tool
// call, so a half-written remark must never be. Kept in the browser's
// `sessionStorage` per project, so a reload of the tab keeps them.

export type AnnotationDraft = {
	/** `annotationTargetKey(target)`. */
	key: string;
	target: AnnotationTarget;
	body: string;
	updatedAt: number;
};

export type AnnotationDraftState = {
	/** The project the drafts belong to; null before one is open. */
	projectScope: string | null;
	/** New annotations, by target key. */
	drafts: Record<string, AnnotationDraft>;
	/** Replies, by annotation id. */
	replies: Record<string, string>;
	/**
	 * This tab's storage holds drafts in a newer format than this version
	 * reads. They are left untouched, and drafting is off in this tab.
	 */
	unsupported?: { version: number };
};

const STORAGE_PREFIX = "trickroom:annotation-drafts:";
const STORAGE_VERSION = 1;

export const annotationDraftStorageKey = (projectScope: string) =>
	`${STORAGE_PREFIX}${projectScope}`;

// Keyed by target keys and annotation ids: no prototype to collide with.
const idRecord = <Value>() => Object.create(null) as Record<string, Value>;

const emptyState = (projectScope: string | null): AnnotationDraftState => ({
	projectScope,
	drafts: idRecord(),
	replies: idRecord(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const getSessionStorage = () => {
	try {
		return typeof window === "undefined" ? null : window.sessionStorage;
	} catch {
		return null;
	}
};

/** Reads what a project's drafts were, keeping whatever entries are valid. */
export function readStoredAnnotationDrafts(
	projectScope: string,
): AnnotationDraftState {
	const state = emptyState(projectScope);
	try {
		const raw = getSessionStorage()?.getItem(
			annotationDraftStorageKey(projectScope),
		);
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (
			isRecord(parsed) &&
			typeof parsed.version === "number" &&
			parsed.version > STORAGE_VERSION
		) {
			// Written by a newer Trickroom: never overwrite or remove it.
			console.warn(
				`[Trickroom] Annotation drafts in this tab are stored in format version ${parsed.version}; this version reads ${STORAGE_VERSION}. Drafting is off in this tab so they are not lost.`,
			);
			return { ...state, unsupported: { version: parsed.version } };
		}
		if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
			return state;
		}
		if (Array.isArray(parsed.drafts)) {
			for (const entry of parsed.drafts) {
				if (
					!isRecord(entry) ||
					!isAnnotationTarget(entry.target) ||
					typeof entry.body !== "string" ||
					entry.body.trim() === ""
				) {
					continue;
				}
				const key = annotationTargetKey(entry.target);
				state.drafts[key] = {
					key,
					target: entry.target,
					body: entry.body,
					updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
				};
			}
		}
		if (isRecord(parsed.replies)) {
			for (const [annotationId, body] of Object.entries(parsed.replies)) {
				if (typeof body === "string" && body.trim() !== "") {
					state.replies[annotationId] = body;
				}
			}
		}
	} catch {
		// Unreadable storage or JSON starts without drafts.
	}
	return state;
}

function persist(state: AnnotationDraftState) {
	if (!state.projectScope || state.unsupported) {
		return;
	}
	try {
		const storage = getSessionStorage();
		if (!storage) return;
		const key = annotationDraftStorageKey(state.projectScope);
		const drafts = Object.values(state.drafts);
		const replies = Object.entries(state.replies);
		if (drafts.length === 0 && replies.length === 0) {
			storage.removeItem(key);
			return;
		}
		storage.setItem(
			key,
			JSON.stringify({
				version: STORAGE_VERSION,
				drafts: drafts.map(({ target, body, updatedAt }) => ({
					target,
					body,
					updatedAt,
				})),
				replies: state.replies,
			}),
		);
	} catch {
		// A full or unavailable storage only loses the copy, not the drafts.
	}
}

export const annotationDraftStore = createStore<AnnotationDraftState>(
	emptyState(null),
);

annotationDraftStore.subscribe((state) => persist(state));

const copyRecord = <Value>(record: Record<string, Value>) =>
	Object.assign(idRecord<Value>(), record);

/** Who a draft belongs to when it is sent: its project and its text. */
export type SentDraft = { projectScope: string | null; body: string };

/** The draft as Send submits it, to clear exactly that version afterwards. */
export function captureSentDraft(body: string): SentDraft {
	return { projectScope: annotationDraftStore.get().projectScope, body };
}

/**
 * Clears what was sent once the write succeeded, and nothing typed since:
 * only while the draft still holds the submitted text, in the project it
 * was written in (that project's stored copy, when the tab moved on).
 */
function clearSent(
	sent: SentDraft,
	update: (state: AnnotationDraftState) => AnnotationDraftState,
) {
	if (!sent.projectScope) return;
	if (annotationDraftStore.get().projectScope === sent.projectScope) {
		annotationDraftStore.setState(update);
		return;
	}
	const stored = readStoredAnnotationDrafts(sent.projectScope);
	const next = update(stored);
	if (next !== stored) persist(next);
}

export function clearSentAnnotationDraft(key: string, sent: SentDraft) {
	clearSent(sent, (state) => {
		if (state.unsupported || state.drafts[key]?.body !== sent.body) {
			return state;
		}
		const drafts = copyRecord(state.drafts);
		delete drafts[key];
		return { ...state, drafts };
	});
}

export function clearSentReplyDraft(annotationId: string, sent: SentDraft) {
	clearSent(sent, (state) => {
		if (state.unsupported || state.replies[annotationId] !== sent.body) {
			return state;
		}
		const replies = copyRecord(state.replies);
		delete replies[annotationId];
		return { ...state, replies };
	});
}

/** Drafting is off in this tab (its stored drafts are a newer format). */
export function useAnnotationDraftsUnsupported() {
	return useSelector(annotationDraftStore, (state) =>
		Boolean(state.unsupported),
	);
}

/** Switches to a project's drafts (what this tab kept for it). */
export function loadAnnotationDrafts(projectScope: string | null) {
	if (annotationDraftStore.get().projectScope === projectScope) {
		return;
	}
	annotationDraftStore.setState(() =>
		projectScope ? readStoredAnnotationDrafts(projectScope) : emptyState(null),
	);
}

/** Writes a new annotation's draft; an empty body discards it. */
export function setAnnotationDraft(target: AnnotationTarget, body: string) {
	const key = annotationTargetKey(target);
	annotationDraftStore.setState((state) => {
		if (state.unsupported) return state;
		const drafts = copyRecord(state.drafts);
		if (body.trim() === "") {
			if (!drafts[key]) return state;
			delete drafts[key];
		} else {
			drafts[key] = { key, target, body, updatedAt: Date.now() };
		}
		return { ...state, drafts };
	});
}

export function discardAnnotationDrafts(keys: readonly string[]) {
	annotationDraftStore.setState((state) => {
		if (!keys.some((key) => state.drafts[key])) return state;
		const drafts = copyRecord(state.drafts);
		for (const key of keys) delete drafts[key];
		return { ...state, drafts };
	});
}

export function setReplyDraft(annotationId: string, body: string) {
	annotationDraftStore.setState((state) => {
		if (state.unsupported) return state;
		const replies = copyRecord(state.replies);
		if (body.trim() === "") {
			if (!(annotationId in replies)) return state;
			delete replies[annotationId];
		} else {
			replies[annotationId] = body;
		}
		return { ...state, replies };
	});
}

export function getAnnotationDrafts() {
	return Object.values(annotationDraftStore.get().drafts);
}

export function useAnnotationDraft(targetKey: string | null) {
	return useSelector(annotationDraftStore, (state) =>
		targetKey ? (state.drafts[targetKey] ?? null) : null,
	);
}

export function useReplyDraft(annotationId: string) {
	return useSelector(
		annotationDraftStore,
		(state) => state.replies[annotationId] ?? "",
	);
}

/** Drafts whose target passes `filter`, oldest first. */
export function useAnnotationDrafts(
	filter: (draft: AnnotationDraft) => boolean,
) {
	return useSelector(
		annotationDraftStore,
		(state) =>
			Object.values(state.drafts)
				.filter(filter)
				.sort((a, b) => a.updatedAt - b.updatedAt),
		{ compare: shallow },
	);
}
