import { createDesignGuideInput } from "../guide/design-facts";
import {
	buildDesignGuideCore,
	DESIGN_GUIDE_TOPICS,
	type DesignGuideTopicName,
} from "../guide/design-guide";
import {
	buildSystemComponentGuideCore,
	SYSTEM_COMPONENT_GUIDE_TOPICS,
	type SystemComponentGuideInput,
	type SystemComponentGuideTopicName,
} from "../guide/system-component-guide";
import {
	assertKnownGuideTopics,
	buildGuideTopics,
	type GuideTopic,
	listGuideTopics,
	normalizeTopicRequest,
} from "../guide/topics";
import type { TrickroomMcpServerContext } from "../server-types";
import { getProjectReference } from "./project";

/**
 * The guide is layered: without a topic it returns a short core for design
 * work, with one or more topics only those sections. Design topics and the
 * component-authoring topics share one namespace; content lives in
 * src/mcp/guide/.
 */
const GUIDE_SCHEMA_VERSION = 3;

const COMPONENT_TOPIC_PREFIX = "component-";

type ComponentGuideTopicName =
	| "component-authoring"
	| `component-${SystemComponentGuideTopicName}`;

export type GuideTopicName = DesignGuideTopicName | ComponentGuideTopicName;

/**
 * Component-authoring topics as guide topics: the component guide's core
 * becomes "component-authoring", each of its topics gets the prefix.
 */
const COMPONENT_GUIDE_TOPICS: readonly GuideTopic<
	ComponentGuideTopicName,
	SystemComponentGuideInput
>[] = [
	{
		name: "component-authoring",
		when: "Creating, changing or publishing design system components: the model, rules and workflow.",
		build: buildSystemComponentGuideCore,
	},
	...SYSTEM_COMPONENT_GUIDE_TOPICS.map((topic) => ({
		...topic,
		name: `${COMPONENT_TOPIC_PREFIX}${topic.name}` as ComponentGuideTopicName,
	})),
];

export const GUIDE_TOPIC_NAMES = [
	...DESIGN_GUIDE_TOPICS.map((topic) => topic.name),
	...COMPONENT_GUIDE_TOPICS.map((topic) => topic.name),
] as [GuideTopicName, ...GuideTopicName[]];

/** Every topic with its one-line "when", for the core and error hints. */
export const listAllGuideTopics = () => ({
	...listGuideTopics(DESIGN_GUIDE_TOPICS),
	...listGuideTopics(COMPONENT_GUIDE_TOPICS),
});

export const getGuidePayload = async (
	context: TrickroomMcpServerContext,
	options: {
		topic?: GuideTopicName | readonly GuideTopicName[];
		designFileId?: string;
		systemName?: string;
		library?: string;
		name?: string;
	} = {},
) => {
	const designInput = createDesignGuideInput(context, options);
	const header = {
		project: getProjectReference(context),
		schemaVersion: GUIDE_SCHEMA_VERSION,
	};
	const topics = normalizeTopicRequest(options.topic);
	if (topics.length === 0) {
		return { ...header, ...(await buildDesignGuideCore(designInput)) };
	}

	// Check every name against the whole namespace before building any.
	assertKnownGuideTopics(topics, listAllGuideTopics());
	const componentInput = { context, systemName: options.systemName };
	const [designSections, componentSections] = await Promise.all([
		buildGuideTopics(
			DESIGN_GUIDE_TOPICS,
			topics.filter((topic) => !topic.startsWith(COMPONENT_TOPIC_PREFIX)),
			designInput,
		),
		buildGuideTopics(
			COMPONENT_GUIDE_TOPICS,
			topics.filter((topic) => topic.startsWith(COMPONENT_TOPIC_PREFIX)),
			componentInput,
		),
	]);
	const sections: Record<string, unknown> = {
		...designSections,
		...componentSections,
	};
	return {
		...header,
		topics,
		...Object.fromEntries(topics.map((topic) => [topic, sections[topic]])),
	};
};
