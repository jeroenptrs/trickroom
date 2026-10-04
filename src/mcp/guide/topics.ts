import { z } from "zod";
import { formatDidYouMean, suggestClosest } from "../../utils/suggestions";

/**
 * Progressive disclosure for authoring contracts: a contract returns a short
 * core when called without a topic, and one section per requested topic
 * otherwise. Each topic stands alone, so an agent pays only for what it reads.
 */
export type GuideTopic<Name extends string, Input> = {
	name: Name;
	/** One line: when an agent should fetch this topic. */
	when: string;
	build: (input: Input) => unknown | Promise<unknown>;
};

export class UnknownGuideTopicError extends Error {
	readonly code = "UNKNOWN_TOPIC";
	readonly unknownTopics: string[];
	readonly availableTopics: Record<string, string>;
	constructor(
		unknownTopics: string[],
		availableTopics: Record<string, string>,
	) {
		const valid = Object.keys(availableTopics);
		const hints = unknownTopics
			.map((topic) =>
				formatDidYouMean(suggestClosest(topic, valid, { limit: 1 })),
			)
			.join("");
		super(
			`Unknown topic ${unknownTopics.map((topic) => `"${topic}"`).join(", ")}.${hints} Valid topics: ${valid.join(", ")}.`,
		);
		this.unknownTopics = unknownTopics;
		this.availableTopics = availableTopics;
	}
}

export const listGuideTopics = <Name extends string, Input>(
	topics: readonly GuideTopic<Name, Input>[],
) =>
	Object.fromEntries(topics.map((topic) => [topic.name, topic.when])) as Record<
		Name,
		string
	>;

export const createTopicInputSchema = <Name extends string>(
	names: readonly [Name, ...Name[]],
	description: string,
) => {
	const topicName = z.enum(names);
	return z.union([topicName, z.array(topicName).min(1)]).describe(description);
};

export const normalizeTopicRequest = (
	topic: string | readonly string[] | undefined,
): string[] =>
	topic === undefined
		? []
		: [...new Set(typeof topic === "string" ? [topic] : topic)];

/** Throw UNKNOWN_TOPIC, listing every valid topic, for names not in it. */
export const assertKnownGuideTopics = (
	requested: readonly string[],
	available: Record<string, string>,
) => {
	const unknown = requested.filter((name) => !Object.hasOwn(available, name));
	if (unknown.length > 0) {
		throw new UnknownGuideTopicError(unknown, available);
	}
};

/** Build the requested topics in request order, keyed by topic name. */
export const buildGuideTopics = async <Name extends string, Input>(
	topics: readonly GuideTopic<Name, Input>[],
	requested: readonly string[],
	input: Input,
) => {
	const byName = new Map<string, GuideTopic<Name, Input>>(
		topics.map((topic) => [topic.name, topic]),
	);
	assertKnownGuideTopics(requested, listGuideTopics(topics));

	const sections: Record<string, unknown> = {};
	for (const name of requested) {
		sections[name] = await (byName.get(name) as GuideTopic<Name, Input>).build(
			input,
		);
	}
	return sections;
};
