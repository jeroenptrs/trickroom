import { createDesignGuideInput } from "../guide/design-facts";
import {
	buildDesignGuideCore,
	DESIGN_GUIDE_TOPICS,
	type DesignGuideTopicName,
} from "../guide/design-guide";
import {
	buildSystemComponentGuideCore,
	SYSTEM_COMPONENT_GUIDE_TOPICS,
	type SystemComponentGuideTopicName,
} from "../guide/system-component-guide";
import { buildGuideTopics, normalizeTopicRequest } from "../guide/topics";
import type { TrickroomMcpServerContext } from "../server-types";
import { getProjectReference } from "./project";

/**
 * Authoring contracts are layered: without a topic they return a short core,
 * with one or more topics they return only those sections. Content lives in
 * src/mcp/guide/.
 */
const CONTRACT_SCHEMA_VERSION = 2;

type TopicRequest<Name extends string> = Name | readonly Name[];

export const getAuthoringContractPayload = async (
	context: TrickroomMcpServerContext,
	options: {
		designFileId?: string;
		topic?: TopicRequest<DesignGuideTopicName>;
		library?: string;
		name?: string;
	} = {},
) => {
	const input = createDesignGuideInput(context, options);
	const topics = normalizeTopicRequest(options.topic);
	const header = {
		project: getProjectReference(context),
		contract: "design-authoring",
		schemaVersion: CONTRACT_SCHEMA_VERSION,
	};

	if (topics.length === 0) {
		return { ...header, ...(await buildDesignGuideCore(input)) };
	}
	return {
		...header,
		topics,
		...(await buildGuideTopics(DESIGN_GUIDE_TOPICS, topics, input)),
	};
};

export const getSystemComponentAuthoringContractPayload = async (
	context: TrickroomMcpServerContext,
	options: {
		systemName?: string;
		topic?: TopicRequest<SystemComponentGuideTopicName>;
	} = {},
) => {
	const input = { context, systemName: options.systemName };
	const topics = normalizeTopicRequest(options.topic);
	const header = {
		project: getProjectReference(context),
		contract: "system-component-authoring",
		schemaVersion: CONTRACT_SCHEMA_VERSION,
	};

	if (topics.length === 0) {
		return { ...header, ...(await buildSystemComponentGuideCore(input)) };
	}
	return {
		...header,
		topics,
		...(await buildGuideTopics(SYSTEM_COMPONENT_GUIDE_TOPICS, topics, input)),
	};
};
