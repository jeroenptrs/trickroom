export type ClassLayerSource =
	| "registry-base"
	| "system-template"
	| "system-variant"
	| "system-compound-variant"
	| "instance-override"
	| "authored"
	| "materialized-snapshot";

export type ClassLayerMetadata = {
	library?: string;
	component?: string;
	recipeId?: string;
	systemId?: string;
	componentId?: string;
	instanceId?: string;
	path?: string;
	slotName?: string;
	axis?: string;
	value?: string;
	compoundIndex?: number;
	prop?: string;
};

export type ClassLayer = {
	source: ClassLayerSource;
	className: string;
	metadata?: ClassLayerMetadata;
};

export const persistedClassNameOutputPolicy = {
	normalizesPersistedOutput: false,
	reason:
		"Class resolution explains render composition; persisted className strings keep authored order and unknown tokens until an explicit migration or editor policy exists.",
} as const;

export const shouldNormalizePersistedClassNameOutput = () =>
	persistedClassNameOutputPolicy.normalizesPersistedOutput;

export type ClassLayerInput =
	| ClassLayer
	| {
			source: ClassLayerSource;
			className?: string | null;
			metadata?: ClassLayerMetadata;
	  };

export const splitClassLayerTokens = (
	className: string | null | undefined,
): string[] => className?.trim().split(/\s+/u).filter(Boolean) ?? [];

export const createClassLayer = (
	source: ClassLayerSource,
	className: string | null | undefined,
	metadata?: ClassLayerMetadata,
): ClassLayer | null => {
	const tokens = splitClassLayerTokens(className);
	if (tokens.length === 0) {
		return null;
	}

	return {
		source,
		className: tokens.join(" "),
		...(metadata === undefined ? {} : { metadata }),
	};
};

export const createClassLayers = (
	inputs: readonly ClassLayerInput[],
): ClassLayer[] =>
	inputs.flatMap((input) => {
		const layer = createClassLayer(
			input.source,
			input.className,
			input.metadata,
		);
		return layer ? [layer] : [];
	});

export const flattenClassLayers = (
	layers: readonly Pick<ClassLayer, "className">[],
): string | undefined => {
	const className = layers
		.flatMap((layer) => splitClassLayerTokens(layer.className))
		.join(" ");

	return className.length > 0 ? className : undefined;
};
