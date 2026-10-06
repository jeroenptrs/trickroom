import type { DesignFileVersion } from "./services/design-file-schema";

export type JsonPrimitive = string | number | boolean | null;

export type Role = "branch" | "text" | "leaf";

export type ControlInput =
	| "radio"
	| "select"
	| "switch"
	| "checkbox"
	| "text"
	| "number";

export type ControlValueType = "string" | "number" | "boolean";

export type ControlVisibility = "visible" | "hidden" | "deprecated";

export type ControlOption = {
	label: string;
	value: Exclude<JsonPrimitive, null>;
};

export type ControlDefinition = {
	label: string;
	description?: string;
	input: ControlInput;
	prop: string;
	valueType: ControlValueType;
	options?: ControlOption[];
	visibility?: ControlVisibility;
	deprecationReason?: string;
	defaultValue?: Exclude<JsonPrimitive, null>;
	/**
	 * Marks a discriminator prop (e.g. tab/item/radio value) whose value must
	 * not collide with the same prop on sibling elements. Insert paths suffix
	 * the default value to keep it unique among siblings.
	 */
	uniqueAmongSiblings?: boolean;
};

export type RegistryComponentDefinition = {
	role: Role;
	label: string;
	description?: string;
	baseClassName?: string;
	controls?: Record<string, ControlDefinition>;
	defaultProps?: Record<string, JsonPrimitive | undefined>;
};

export type Registry<ComponentList extends string = string> = Record<
	ComponentList,
	RegistryComponentDefinition
>;

export type RecipeComponentRef = {
	library: string;
	component: string;
};

export type NormalizedRecipeSlotChildRef =
	| {
			kind: "component";
			library: string;
			component: string;
	  }
	| {
			kind: "recipe";
			library: string;
			recipe: string;
	  };

export type RecipeSlotChildRef =
	| {
			library: string;
			kind?: "component";
			component: string;
	  }
	| {
			kind: "recipe";
			library: string;
			recipe: string;
	  };

export type RecipeSlotHistoryMetadata = {
	previousTemplatePath?: string;
	previousTemplateVersion?: string;
};

export type RecipeSlotDefinition = {
	name: string;
	label: string;
	description?: string;
	hostPath: string;
	allowedChildren?: RecipeSlotChildRef[];
	defaultChildren?: RecipeTemplateNode[];
	history?: RecipeSlotHistoryMetadata;
};

export type RecipeControlVisibility = "visible" | "hidden" | "deprecated";

export type RecipeControlDefinition = ControlDefinition & {
	path: string;
	visibility?: RecipeControlVisibility;
	deprecationReason?: string;
};

export type RecipeTemplateNode = RecipeComponentRef & {
	path: string;
	name?: string;
	className?: string;
	props?: Record<string, JsonPrimitive | undefined>;
	text?: string;
	slot?: string;
	children?: RecipeTemplateNode[];
};

export type RecipeTemplateHistoryEntry = {
	version: string;
	root: RecipeTemplateNode;
	slots?: Record<string, RecipeSlotDefinition>;
	controls?: Record<string, RecipeControlDefinition>;
	description?: string;
};

export type RecipeDefinition = {
	id: string;
	label: string;
	description?: string;
	version: 1;
	root: RecipeTemplateNode;
	previousTemplates?: RecipeTemplateHistoryEntry[];
	slots?: Record<string, RecipeSlotDefinition>;
	controls?: Record<string, RecipeControlDefinition>;
};

export type RecipeRegistry<RecipeList extends string = string> = Record<
	RecipeList,
	RecipeDefinition
>;

export type LibraryRegistry<
	ComponentList extends string = string,
	RecipeList extends string = string,
> = {
	components: Registry<ComponentList>;
	recipes: RecipeRegistry<RecipeList>;
};

export type Props = {
	className?: string;
	"data-trickroom-name": string;
	"data-trickroom-library": string;
	"data-trickroom-component": string;
	/**
	 * Optional only for legacy files. New writes should always persist an
	 * explicit branch, text, or leaf role from the registry definition.
	 */
	"data-trickroom-role"?: Role;
} & {
	[prop: string]: JsonPrimitive | undefined;
};

/**
 * Any element prop record, such as a partial `Props`. Readers that only look
 * at their own keys (structural markers) accept this.
 */
export type PropRecord = Readonly<Record<string, JsonPrimitive | undefined>>;

export type Node = {
	id: string;
	props: Props;
	children: string | Node[];
};

export type TrickroomConfig = {
	schemaVersion?: 1;
	projectId?: string;
	name: string;
	/** Stable system id used when new designs omit an explicit system link. */
	defaultSystemId?: string;
	/**
	 * Creation/migration helper resolved to `defaultSystemId` and omitted from
	 * persisted config after legacy `systems` manifests are written.
	 */
	defaultSystemName?: string;
	/**
	 * Legacy input only. New writes migrate configured systems to
	 * `.trickroom/systems/<initial-safe-name>/system.json`.
	 */
	systems?: Record<string, string>;
	mcp?: {
		enabled: boolean;
		mode?: "read-only" | "read-write";
		allowedDesignFileIds?: string[];
		allowedComponents?: string[];
		auditLog?: boolean;
	};
	/** Optional, additive: absent unless the project configures codegen. */
	codegen?: TrickroomCodegenConfig;
};

/**
 * Where and how published system Components are emitted as
 * tailwind-variants files. Validated and defaulted in `src/codegen/config.ts`.
 */
export type TrickroomCodegenConfig = {
	/** The block's own migration boundary, independent of `schemaVersion`. */
	version: 1;
	/** System id, name or storage key; defaults to the project default system. */
	system?: string;
	/** Relative to the project root, without `..` segments. */
	outDir: string;
	/** Contains `{slug}`, has no path separator, ends in `.ts`. */
	fileName?: string;
	tvImport?: string;
	shape?: "auto" | "slots";
	/** Exact component slugs. */
	include?: string[];
	exclude?: string[];
	/** Run without a shell from the project root; `{file}` is the output path. */
	formatter?: {
		command: string;
		args?: string[];
	};
};

export type TrickroomDesign = {
	/**
	 * Design file schema version, a storage concern: the design file service
	 * stamps the current version on every write and omits it from designs it
	 * returns, which are always in the current shape. Writers may omit it.
	 */
	version?: DesignFileVersion;
	name: string;
	systemId?: string | null;
	/**
	 * Legacy design link. New writes should persist `systemId`; responses may
	 * still include a derived `systemName` for display.
	 */
	systemName?: string | null;
	componentMigrationPolicy?: "inherit" | "manual" | "auto";
	/**
	 * When the design was last changed (ISO 8601), owned by the server: the
	 * design file service sets it on every write that changes a board, the
	 * board order or a top-level field, and ignores whatever a writer sends.
	 * Absent on designs never written since the field was introduced. Not
	 * part of the design's revision.
	 */
	updatedAt?: string;
	boards: Node[];
};

export type TrickroomDesignSummary = {
	uuid: string;
	file: string;
	name: string;
	systemId?: string | null;
	systemName?: string | null;
	boardsCount: number;
	layersCount: number;
	/**
	 * When the design last changed: the manifest's `updatedAt` when it has
	 * one, otherwise the latest modification time of its files (which a git
	 * checkout resets).
	 */
	modifiedAt: string;
	/**
	 * Set when the file exists but cannot be opened, for example because a
	 * newer Trickroom wrote it. Counts are then best-effort.
	 */
	diagnostic?: DesignFileDiagnostic;
	/** Storage problems that do not stop the design from opening. */
	warnings?: DesignStorageWarning[];
};

export type DesignStorageWarning = {
	/**
	 * `LEGACY_DESIGN_FILE_PRESENT`: both the design folder and an older
	 * single-file copy exist; the folder is used until `trickroom migrate`
	 * reconciles them.
	 */
	code: "LEGACY_DESIGN_FILE_PRESENT";
	message: string;
};

export type DesignFileDiagnostic = {
	code:
		| "UNSUPPORTED_DESIGN_VERSION"
		| "INVALID_DESIGN_PAYLOAD"
		| "INVALID_DESIGN_JSON";
	message: string;
	/** Stored version, when the file declares one. */
	version?: number;
};
