import type { LintRuleFinding, LintRuleKind } from "../types";
import { codeLocation, getCodeAnalysis, moduleVariants } from "./analysis";

/**
 * Rules on the bound wrapper itself: it has to call its variants export,
 * and every slot the generated file emits has to be invoked somewhere in
 * the component's wrappers. Re-exporting modules borrow the styling and
 * are not wrappers, so they are never checked here.
 */

export const wrapperMissingVariantsCallRule: LintRuleKind = {
	id: "code.wrapper-missing-variants-call",
	side: "code",
	defaultSeverity: "error",
	description:
		"A bound wrapper module never calls its component's variants export, so the component renders without the system's styling.",
	run: (context) => {
		const analysis = getCodeAnalysis(context);
		const findings: LintRuleFinding[] = [];
		for (const identity of context.sources.components) {
			const component = analysis.components.get(identity.slug);
			if (!component) continue;
			for (const wrapper of identity.wrappers) {
				const variants = moduleVariants(analysis, wrapper);
				const own = (entry: { slug: string }) => entry.slug === identity.slug;
				if (variants.calls.some(own)) continue;
				const imported = variants.imports.find(own);
				const configured = identity.configuredWrappers.includes(wrapper);
				findings.push({
					component: identity.slug,
					location: codeLocation(wrapper, imported?.position),
					message: imported
						? `${wrapper} is the wrapper of "${identity.slug}" but never calls ${component.exportName}, so the component renders without its styling. Call ${component.exportName}(…) (or a slot of its result) for the classes; if this module only passes the styling on, re-export it with \`export { ${component.exportName} } from\` instead.`
						: configured
							? `${wrapper} is configured as the wrapper of "${identity.slug}" in lint.json but never imports or calls ${component.exportName}. Call it for the component's classes, or point components.${identity.slug}.module at the module that does.`
							: `${wrapper} is the wrapper of "${identity.slug}" but never calls ${component.exportName}. Call it for the component's classes.`,
				});
			}
		}
		return findings;
	},
};

export const slotNotCalledRule: LintRuleKind = {
	id: "code.slot-not-called",
	side: "code",
	defaultSeverity: "warning",
	description:
		"A slot the generated variants file exports is never invoked in the component's wrappers, so that part of the component renders unstyled.",
	run: (context) => {
		const analysis = getCodeAnalysis(context);
		const findings: LintRuleFinding[] = [];
		for (const identity of context.sources.components) {
			const component = analysis.components.get(identity.slug);
			if (!component || component.shape !== "slots") continue;
			if (identity.wrappers.length === 0) continue;
			const invoked = new Set<string>();
			let firstCall: {
				file: string;
				position: { line: number; column: number };
			} | null = null;
			for (const wrapper of identity.wrappers) {
				const variants = moduleVariants(analysis, wrapper);
				for (const entry of variants.calls) {
					if (entry.slug !== identity.slug) continue;
					firstCall ??= { file: wrapper, position: entry.call.position };
				}
				for (const entry of variants.slotCalls) {
					if (entry.slug === identity.slug) invoked.add(entry.slot);
				}
			}
			// A wrapper that never calls the variants export is the other
			// rule's finding; listing every slot on top would be noise.
			if (!firstCall) continue;
			const wrappers = identity.wrappers.join(", ");
			for (const slot of component.slots) {
				if (invoked.has(slot.key)) continue;
				findings.push({
					component: identity.slug,
					location: codeLocation(firstCall.file, firstCall.position),
					message: `Slot "${slot.key}" of "${identity.slug}" (template path "${slot.path}") is never invoked in ${wrappers}, so that part renders without its classes. Call it on the ${component.exportName}(…) result, for example styles.${slot.key}(), and pass the result as the element's className; referencing styles.${slot.key} without calling it does not count.`,
				});
			}
		}
		return findings;
	},
};
