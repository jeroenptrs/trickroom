import { Accordion } from "@base-ui/react/accordion";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	type Ref,
	useContext,
} from "react";

type AccordionRootProps = ComponentPropsWithoutRef<typeof Accordion.Root>;
type AccordionItemProps = ComponentPropsWithoutRef<typeof Accordion.Item>;
type AccordionHeaderProps = ComponentPropsWithoutRef<typeof Accordion.Header>;
type AccordionTriggerProps = ComponentPropsWithoutRef<typeof Accordion.Trigger>;
type AccordionPanelProps = ComponentPropsWithoutRef<typeof Accordion.Panel>;

const AccordionRootRenderContext = createContext(false);
const AccordionItemRenderContext = createContext(false);

export const AccordionRoot = forwardRef<HTMLDivElement, AccordionRootProps>(
	function AccordionRoot(props, ref) {
		return (
			<AccordionRootRenderContext.Provider value={true}>
				<Accordion.Root {...props} ref={ref} />
			</AccordionRootRenderContext.Provider>
		);
	},
);

export const AccordionItem = forwardRef<HTMLDivElement, AccordionItemProps>(
	function AccordionItem(props, ref) {
		const isInsideAccordionRoot = useContext(AccordionRootRenderContext);

		if (isInsideAccordionRoot) {
			return (
				<AccordionItemRenderContext.Provider value={true}>
					<Accordion.Item {...props} ref={ref} />
				</AccordionItemRenderContext.Provider>
			);
		}

		const { render: _render, ...divProps } = props;

		return <div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />;
	},
);

export const AccordionHeader = forwardRef<
	HTMLHeadingElement,
	AccordionHeaderProps
>(function AccordionHeader(props, ref) {
	const isInsideAccordionItem = useContext(AccordionItemRenderContext);

	if (isInsideAccordionItem) {
		return <Accordion.Header {...props} ref={ref} />;
	}

	const { render: _render, ...headingProps } = props;

	return (
		<h3
			{...(headingProps as ComponentPropsWithoutRef<"h3">)}
			ref={ref as Ref<HTMLHeadingElement>}
		/>
	);
});

export const AccordionTrigger = forwardRef<HTMLElement, AccordionTriggerProps>(
	function AccordionTrigger(props, ref) {
		const isInsideAccordionItem = useContext(AccordionItemRenderContext);

		if (isInsideAccordionItem) {
			return <Accordion.Trigger {...props} ref={ref} />;
		}

		const { render: _render, ...buttonProps } = props;

		return (
			<button
				{...(buttonProps as ComponentPropsWithoutRef<"button">)}
				ref={ref as Ref<HTMLButtonElement>}
			/>
		);
	},
);

export const AccordionPanel = forwardRef<HTMLDivElement, AccordionPanelProps>(
	function AccordionPanel(props, ref) {
		const isInsideAccordionItem = useContext(AccordionItemRenderContext);

		if (isInsideAccordionItem) {
			return <Accordion.Panel {...props} ref={ref} />;
		}

		const { render: _render, ...divProps } = props;

		return <div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />;
	},
);
