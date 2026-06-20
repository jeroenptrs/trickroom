import {
	type ClassLayer,
	type ClassLayerMetadata,
	type ClassLayerSource,
	splitClassLayerTokens,
} from "./class-layers";
import {
	type ClassifyContext,
	classifyParsedClass,
	type KnownUtilityIntent,
	type ParseClassNameOptions,
	type ParsedClass,
	parseClassName,
} from "./tailwind-classname";
import {
	getUtilityConflictScope,
	type UtilityConflictScope,
} from "./tailwind-classname/scope";

export type ResolvedClassTokenStatus = "active" | "shadowed" | "unknown";

export type ResolvedClassTokenLayer = {
	source: ClassLayerSource;
	index: number;
	tokenIndex: number;
	metadata?: ClassLayerMetadata;
};

export type ResolvedClassToken = {
	classToken: string;
	parsed: ParsedClass;
	layer: ResolvedClassTokenLayer;
	index: number;
	status: ResolvedClassTokenStatus;
	intent?: KnownUtilityIntent;
	conflictScope?: UtilityConflictScope;
	shadowedBy?: number;
};

export type ClassResolution = {
	tokens: ResolvedClassToken[];
	active: ResolvedClassToken[];
	shadowed: ResolvedClassToken[];
	unknown: ResolvedClassToken[];
};

export type ResolveClassLayersOptions = ParseClassNameOptions & ClassifyContext;

export function resolveClassLayers(
	layers: readonly ClassLayer[],
	options: ResolveClassLayersOptions,
): ClassResolution {
	const tokens: ResolvedClassToken[] = [];
	const latestByScope = new Map<string, number>();

	layers.forEach((layer, layerIndex) => {
		splitClassLayerTokens(layer.className).forEach((classToken, tokenIndex) => {
			const parsed = parseClassName(classToken, options)[0];
			if (!parsed) return;

			const index = tokens.length;
			const intent = classifyParsedClass(parsed, {
				colorTokens: options.colorTokens,
				customFunctionalUtilityRoots: options.customFunctionalUtilityRoots,
				customStaticUtilityRoots: options.customStaticUtilityRoots,
			});
			const tokenLayer: ResolvedClassTokenLayer = {
				source: layer.source,
				index: layerIndex,
				tokenIndex,
				...(layer.metadata === undefined ? {} : { metadata: layer.metadata }),
			};

			if (intent.kind === "unknown") {
				tokens.push({
					classToken,
					parsed,
					layer: tokenLayer,
					index,
					status: "unknown",
				});
				return;
			}

			const conflictScope = getUtilityConflictScope(parsed, intent);
			const previousIndex = latestByScope.get(conflictScope.key);
			if (previousIndex !== undefined) {
				tokens[previousIndex] = {
					...tokens[previousIndex],
					status: "shadowed",
					shadowedBy: index,
				};
			}
			latestByScope.set(conflictScope.key, index);

			tokens.push({
				classToken,
				parsed,
				layer: tokenLayer,
				index,
				status: "active",
				intent,
				conflictScope,
			});
		});
	});

	return {
		tokens,
		active: tokens.filter((token) => token.status === "active"),
		shadowed: tokens.filter((token) => token.status === "shadowed"),
		unknown: tokens.filter((token) => token.status === "unknown"),
	};
}
