import { Avatar } from "@base-ui/react/avatar";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { assetIdProp } from "../../utils/resource-props";
import { useDesignSystemRenderContext } from "../trickroom/render-context";

type AvatarRootProps = ComponentPropsWithoutRef<typeof Avatar.Root>;
type AvatarImageProps = ComponentPropsWithoutRef<typeof Avatar.Image> & {
	[assetIdProp]?: string;
};
type AvatarFallbackProps = ComponentPropsWithoutRef<typeof Avatar.Fallback>;

const AvatarRootRenderContext = createContext(false);

export const AvatarRoot = forwardRef<HTMLSpanElement, AvatarRootProps>(
	function AvatarRoot(props, ref) {
		return (
			<AvatarRootRenderContext.Provider value={true}>
				<Avatar.Root {...props} ref={ref} />
			</AvatarRootRenderContext.Provider>
		);
	},
);

export const AvatarFallback = forwardRef<HTMLSpanElement, AvatarFallbackProps>(
	function AvatarFallback(props, ref) {
		const isInsideAvatarRoot = useContext(AvatarRootRenderContext);

		if (isInsideAvatarRoot) {
			return <Avatar.Fallback {...props} ref={ref} />;
		}

		const { delay: _delay, render: _render, ...spanProps } = props;

		return (
			<span {...(spanProps as ComponentPropsWithoutRef<"span">)} ref={ref} />
		);
	},
);

export const AvatarImage = forwardRef<HTMLImageElement, AvatarImageProps>(
	function AvatarImage({ [assetIdProp]: assetId, alt = "", ...props }, ref) {
		const systemName = useDesignSystemRenderContext();
		const isInsideAvatarRoot = useContext(AvatarRootRenderContext);
		const normalizedAssetId = assetId?.trim();
		const src =
			systemName && normalizedAssetId
				? `/api/trickroom/systems/${encodeURIComponent(systemName)}/assets/${encodeURIComponent(normalizedAssetId)}/file`
				: undefined;

		if (isInsideAvatarRoot) {
			return <Avatar.Image {...props} ref={ref} src={src} alt={alt} />;
		}

		const {
			onLoadingStatusChange: _onLoadingStatusChange,
			render: _render,
			...imgProps
		} = props;

		return (
			<img
				{...(imgProps as ComponentPropsWithoutRef<"img">)}
				ref={ref}
				src={src}
				alt={alt}
			/>
		);
	},
);
