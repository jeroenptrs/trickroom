import type { CSSProperties } from "react";
import { assetIdProp } from "../../utils/resource-props";
import { useDesignSystemRenderContext } from "./render-context";

type AssetProps = {
	className?: string;
	alt?: string;
	objectFit?: CSSProperties["objectFit"];
	objectPosition?: CSSProperties["objectPosition"];
	loading?: "eager" | "lazy";
	decoding?: "async" | "auto" | "sync";
	[assetIdProp]?: string;
};

export function Asset({
	className,
	alt = "",
	objectFit = "cover",
	objectPosition = "center",
	loading = "lazy",
	decoding = "async",
	[assetIdProp]: assetId,
}: AssetProps) {
	const systemName = useDesignSystemRenderContext();
	const normalizedAssetId = assetId?.trim();

	if (!systemName || !normalizedAssetId) {
		return (
			<span
				className={className}
				data-trickroom-missing-resource="asset"
				role="img"
				aria-label={alt || "Missing asset"}
			/>
		);
	}

	return (
		<img
			className={className}
			src={`/api/trickroom/systems/${encodeURIComponent(systemName)}/assets/${encodeURIComponent(normalizedAssetId)}/file`}
			alt={alt}
			loading={loading}
			decoding={decoding}
			style={{ objectFit, objectPosition }}
		/>
	);
}
