import { z } from "zod";
import type { SystemComponentInstanceOverrides } from "../utils/system-component-markers";

export const systemComponentInstanceOverrideSchema = z.object({
	className: z.string().optional(),
	text: z.string().optional(),
	"data-trickroom-icon-id": z.string().optional(),
	"data-trickroom-asset-id": z.string().optional(),
	props: z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
		.optional(),
});

export const systemComponentInstanceOverridesSchema: z.ZodType<SystemComponentInstanceOverrides> =
	z.record(z.string(), systemComponentInstanceOverrideSchema);
