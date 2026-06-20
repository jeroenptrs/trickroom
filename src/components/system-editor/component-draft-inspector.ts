import type { ComponentDraftEntity } from "../../stores/component-draft-store";
import type { DesignEntity } from "../../stores/design-store";

export function toDraftInspectableEntity(
	entity: ComponentDraftEntity,
): DesignEntity {
	return {
		id: entity.path,
		parentId: entity.parentPath,
		role: entity.role,
		childIds: entity.childPaths,
		text: entity.text,
		props: {
			...(entity.props ?? {}),
			className: entity.className,
			"data-trickroom-name": entity.name ?? entity.component,
			"data-trickroom-library": entity.library,
			"data-trickroom-component": entity.component,
			"data-trickroom-role": entity.role,
		},
	};
}
