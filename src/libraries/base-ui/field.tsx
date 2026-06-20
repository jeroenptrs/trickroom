import { Field } from "@base-ui/react/field";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	type Ref,
	useContext,
} from "react";

type FieldRootProps = ComponentPropsWithoutRef<typeof Field.Root>;
type FieldLabelProps = ComponentPropsWithoutRef<typeof Field.Label>;
type FieldControlProps = ComponentPropsWithoutRef<typeof Field.Control>;
type FieldDescriptionProps = ComponentPropsWithoutRef<typeof Field.Description>;
type FieldItemProps = ComponentPropsWithoutRef<typeof Field.Item>;
type FieldErrorProps = ComponentPropsWithoutRef<typeof Field.Error>;

const FieldRootRenderContext = createContext(false);

export const FieldRoot = forwardRef<HTMLDivElement, FieldRootProps>(
	function FieldRoot(props, ref) {
		return (
			<FieldRootRenderContext.Provider value={true}>
				<Field.Root {...props} ref={ref} />
			</FieldRootRenderContext.Provider>
		);
	},
);

export const FieldLabel = forwardRef<HTMLElement, FieldLabelProps>(
	function FieldLabel(props, ref) {
		const isInsideFieldRoot = useContext(FieldRootRenderContext);

		if (isInsideFieldRoot) {
			return <Field.Label {...props} ref={ref} />;
		}

		const { nativeLabel: _nativeLabel, render: _render, ...labelProps } = props;

		return (
			<span
				{...(labelProps as ComponentPropsWithoutRef<"span">)}
				ref={ref as Ref<HTMLSpanElement>}
			/>
		);
	},
);

export const FieldControl = forwardRef<HTMLElement, FieldControlProps>(
	function FieldControl(props, ref) {
		return <Field.Control {...props} ref={ref} />;
	},
);

export const FieldDescription = forwardRef<
	HTMLDivElement,
	FieldDescriptionProps
>(function FieldDescription(props, ref) {
	const isInsideFieldRoot = useContext(FieldRootRenderContext);

	if (isInsideFieldRoot) {
		return <Field.Description {...props} ref={ref} />;
	}

	const { render: _render, ...divProps } = props;

	return <div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />;
});

export const FieldItem = forwardRef<HTMLDivElement, FieldItemProps>(
	function FieldItem(props, ref) {
		const isInsideFieldRoot = useContext(FieldRootRenderContext);

		if (isInsideFieldRoot) {
			return <Field.Item {...props} ref={ref} />;
		}

		const { disabled, render: _render, ...divProps } = props;

		return (
			<div
				{...(divProps as ComponentPropsWithoutRef<"div">)}
				ref={ref}
				{...(disabled ? { "data-disabled": "" } : {})}
			/>
		);
	},
);

export const FieldError = forwardRef<HTMLDivElement, FieldErrorProps>(
	function FieldError(props, ref) {
		const isInsideFieldRoot = useContext(FieldRootRenderContext);

		if (isInsideFieldRoot) {
			return <Field.Error {...props} ref={ref} />;
		}

		const { match: _match, render: _render, ...divProps } = props;

		return <div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />;
	},
);
