import { OTPFieldPreview as OTPField } from "@base-ui/react/otp-field";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";

type OTPFieldRootProps = ComponentPropsWithoutRef<typeof OTPField.Root>;
type OTPFieldInputProps = ComponentPropsWithoutRef<typeof OTPField.Input>;

const OTPFieldRootRenderContext = createContext(false);

export const OTPFieldRoot = forwardRef<HTMLDivElement, OTPFieldRootProps>(
	function OTPFieldRoot(props, ref) {
		return (
			<OTPFieldRootRenderContext.Provider value={true}>
				<OTPField.Root {...props} ref={ref} />
			</OTPFieldRootRenderContext.Provider>
		);
	},
);

export const OTPFieldInput = forwardRef<HTMLInputElement, OTPFieldInputProps>(
	function OTPFieldInput(props, ref) {
		const isInsideOTPFieldRoot = useContext(OTPFieldRootRenderContext);

		if (isInsideOTPFieldRoot) {
			return <OTPField.Input {...props} ref={ref} />;
		}

		const { render: _render, ...inputProps } = props;

		return (
			<input
				{...(inputProps as ComponentPropsWithoutRef<"input">)}
				ref={ref}
				maxLength={1}
			/>
		);
	},
);
