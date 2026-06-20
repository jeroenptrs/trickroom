// biome-ignore-all lint/security/noDangerouslySetInnerHtml: SVG content is fetched from the sanitized system icon route.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProjectScope } from "../../components/contexts";
import { systemIconSvgQueryOptions } from "../../queries/system-icons";
import { iconIdProp } from "../../utils/resource-props";
import { parseSvgRoot } from "./parse-svg";
import { useDesignSystemRenderContext } from "./render-context";

type IconProps = {
	className?: string;
	[iconIdProp]?: string;
	"aria-label"?: string;
};

export function Icon({
	className,
	[iconIdProp]: iconId,
	"aria-label": ariaLabel,
}: IconProps) {
	const systemName = useDesignSystemRenderContext();
	const projectScope = useProjectScope();
	const normalizedIconId = iconId?.trim();
	const enabled = Boolean(systemName && normalizedIconId);
	const { data: svg } = useQuery({
		...systemIconSvgQueryOptions(
			systemName ?? "",
			normalizedIconId ?? "",
			projectScope,
		),
		enabled,
	});
	const parsed = useMemo(() => (svg ? parseSvgRoot(svg) : null), [svg]);

	if (!parsed) {
		return (
			<span
				className={className}
				data-trickroom-icon-id={normalizedIconId}
				data-trickroom-missing-resource="icon"
				role="img"
				aria-label={ariaLabel || normalizedIconId || "Icon"}
			/>
		);
	}

	return (
		<svg
			{...parsed.attrs}
			className={className ?? parsed.attrs.className}
			data-trickroom-icon-id={normalizedIconId}
			data-trickroom-missing-resource={undefined}
			role="img"
			aria-label={ariaLabel || normalizedIconId || "Icon"}
			dangerouslySetInnerHTML={{ __html: parsed.innerHTML }}
		/>
	);
}
