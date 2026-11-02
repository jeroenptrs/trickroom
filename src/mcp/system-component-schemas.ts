import { z } from "zod";
import type { SystemComponentInstanceOverrides } from "../utils/system-component-markers";

const OVERRIDE_KEYS = [
	"className",
	"text",
	"data-trickroom-icon-id",
	"data-trickroom-asset-id",
	"props",
] as const;

/**
 * Reject keys an override entry does not have. Zod would strip them, so a
 * prop written next to className (`{ value: "x" }`) used to vanish without a
 * warning. Element props go under `props`.
 */
export const systemComponentInstanceOverrideSchema = z.strictObject(
	{
		className: z.string().optional(),
		text: z.string().optional(),
		"data-trickroom-icon-id": z.string().optional(),
		"data-trickroom-asset-id": z.string().optional(),
		props: z
			.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
			.optional(),
	},
	{
		error: (issue) =>
			issue.code === "unrecognized_keys"
				? `unknown override key ${issue.keys
						.map((key) => `"${key}"`)
						.join(
							", ",
						)}. An override entry takes ${OVERRIDE_KEYS.join(", ")}; element props go under props, e.g. props: { ${issue.keys[0]}: … }`
				: undefined,
	},
);

export const systemComponentInstanceOverridesSchema: z.ZodType<SystemComponentInstanceOverrides> =
	z.record(z.string(), systemComponentInstanceOverrideSchema);
