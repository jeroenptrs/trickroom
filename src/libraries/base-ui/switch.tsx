import { Switch } from "@base-ui/react/switch";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";

type SwitchRootProps = ComponentPropsWithoutRef<typeof Switch.Root>;
type SwitchThumbProps = ComponentPropsWithoutRef<typeof Switch.Thumb>;

const SwitchRootRenderContext = createContext(false);

export const SwitchRoot = forwardRef<HTMLSpanElement, SwitchRootProps>(
	function SwitchRoot(props, ref) {
		return (
			<SwitchRootRenderContext.Provider value={true}>
				<Switch.Root {...props} ref={ref} />
			</SwitchRootRenderContext.Provider>
		);
	},
);

export const SwitchThumb = forwardRef<HTMLSpanElement, SwitchThumbProps>(
	function SwitchThumb(props, ref) {
		const isInsideSwitchRoot = useContext(SwitchRootRenderContext);

		if (isInsideSwitchRoot) {
			return <Switch.Thumb {...props} ref={ref} />;
		}

		const { render: _render, ...spanProps } = props;

		return (
			<span {...(spanProps as ComponentPropsWithoutRef<"span">)} ref={ref} />
		);
	},
);
