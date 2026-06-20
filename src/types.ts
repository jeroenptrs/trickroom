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

export type Node = {
	id: string;
	props: Props;
	children: string | Node[];
};

export type TrickroomConfig = {
	schemaVersion?: 1;
	projectId?: string;
	name: string;
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
};

export type TrickroomSystemSummary = {
	systemId: string;
	systemName: string;
	cssPath?: string;
	iconFolderPaths?: string[];
};

export type ProjectRoot = {
	projectRoot: string;
};

export type TrickroomDesign = {
	name: string;
	systemId?: string | null;
	/**
	 * Legacy design link. New writes should persist `systemId`; responses may
	 * still include a derived `systemName` for display.
	 */
	systemName?: string | null;
	componentMigrationPolicy?: "inherit" | "manual" | "auto";
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
	modifiedAt: string;
};
