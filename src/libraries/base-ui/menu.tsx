import { Menu } from "@base-ui/react/menu";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	type Ref,
	useContext,
} from "react";
import { useFrame } from "react-frame-component";

type MenuRootProps = ComponentPropsWithoutRef<typeof Menu.Root>;
type MenuTriggerProps = ComponentPropsWithoutRef<typeof Menu.Trigger>;
type MenuPortalProps = ComponentPropsWithoutRef<typeof Menu.Portal>;
type MenuPositionerProps = ComponentPropsWithoutRef<typeof Menu.Positioner>;
type MenuPopupProps = ComponentPropsWithoutRef<typeof Menu.Popup>;
type MenuItemProps = ComponentPropsWithoutRef<typeof Menu.Item>;
type MenuSeparatorProps = ComponentPropsWithoutRef<typeof Menu.Separator>;

const MenuRootRenderContext = createContext(false);
const MenuPortalRenderContext = createContext(false);
const MenuPositionerRenderContext = createContext(false);
const MenuPopupRenderContext = createContext(false);

export const MenuRoot = forwardRef<HTMLDivElement, MenuRootProps>(
	function MenuRoot({ children, ...props }, _ref) {
		return (
			<MenuRootRenderContext.Provider value={true}>
				<Menu.Root {...props}>{children}</Menu.Root>
			</MenuRootRenderContext.Provider>
		);
	},
);

export const MenuTrigger = forwardRef<HTMLElement, MenuTriggerProps>(
	function MenuTrigger(props, ref) {
		const isInsideMenuRoot = useContext(MenuRootRenderContext);

		if (isInsideMenuRoot) {
			return <Menu.Trigger {...props} ref={ref} />;
		}

		const {
			closeDelay: _closeDelay,
			delay: _delay,
			handle: _handle,
			openOnHover: _openOnHover,
			payload: _payload,
			render: _render,
			...buttonProps
		} = props;

		return (
			<button
				{...(buttonProps as ComponentPropsWithoutRef<"button">)}
				ref={ref as Ref<HTMLButtonElement>}
			/>
		);
	},
);

export const MenuPortal = forwardRef<HTMLDivElement, MenuPortalProps>(
	function MenuPortal({ children, ...props }, ref) {
		const isInsideMenuRoot = useContext(MenuRootRenderContext);
		const { document: frameDocument } = useFrame();

		if (isInsideMenuRoot) {
			const { container, ...portalProps } = props;
			const resolvedContainer =
				container === undefined ? frameDocument?.body : container;

			return (
				<MenuPortalRenderContext.Provider value={true}>
					<Menu.Portal {...portalProps} container={resolvedContainer} ref={ref}>
						{children}
					</Menu.Portal>
				</MenuPortalRenderContext.Provider>
			);
		}

		const { container: _container, keepMounted: _keepMounted } = props;

		return (
			<MenuPortalRenderContext.Provider value={true}>
				<div ref={ref} data-trickroom-menu-portal="">
					{children}
				</div>
			</MenuPortalRenderContext.Provider>
		);
	},
);

export const MenuPositioner = forwardRef<HTMLDivElement, MenuPositionerProps>(
	function MenuPositioner(props, ref) {
		const isInsideMenuPortal = useContext(MenuPortalRenderContext);

		if (isInsideMenuPortal) {
			return (
				<MenuPositionerRenderContext.Provider value={true}>
					<Menu.Positioner {...props} ref={ref} />
				</MenuPositionerRenderContext.Provider>
			);
		}

		const {
			align: _align,
			alignItemWithTrigger: _alignItemWithTrigger,
			anchor: _anchor,
			arrowPadding: _arrowPadding,
			avoidCollisions: _avoidCollisions,
			collisionBoundary: _collisionBoundary,
			collisionPadding: _collisionPadding,
			hideWhenDetached: _hideWhenDetached,
			positionMethod: _positionMethod,
			render: _render,
			side: _side,
			sideOffset: _sideOffset,
			sticky: _sticky,
			trackAnchor: _trackAnchor,
			...divProps
		} = props;

		return (
			<MenuPositionerRenderContext.Provider value={true}>
				<div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />
			</MenuPositionerRenderContext.Provider>
		);
	},
);

export const MenuPopup = forwardRef<HTMLDivElement, MenuPopupProps>(
	function MenuPopup(props, ref) {
		const isInsideMenuRoot = useContext(MenuRootRenderContext);
		const isInsideMenuPositioner = useContext(MenuPositionerRenderContext);

		if (isInsideMenuRoot && isInsideMenuPositioner) {
			return (
				<MenuPopupRenderContext.Provider value={true}>
					<Menu.Popup {...props} ref={ref} />
				</MenuPopupRenderContext.Provider>
			);
		}

		const { finalFocus: _finalFocus, render: _render, ...divProps } = props;

		return (
			<MenuPopupRenderContext.Provider value={true}>
				<div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />
			</MenuPopupRenderContext.Provider>
		);
	},
);

export const MenuItem = forwardRef<HTMLElement, MenuItemProps>(
	function MenuItem(props, ref) {
		const isInsideMenuRoot = useContext(MenuRootRenderContext);
		const isInsideMenuPopup = useContext(MenuPopupRenderContext);

		if (isInsideMenuRoot && isInsideMenuPopup) {
			return <Menu.Item {...props} ref={ref} />;
		}

		const {
			closeOnClick: _closeOnClick,
			label: _label,
			render: _render,
			...divProps
		} = props;

		return (
			<div
				{...(divProps as ComponentPropsWithoutRef<"div">)}
				ref={ref as Ref<HTMLDivElement>}
			/>
		);
	},
);

export const MenuSeparator = forwardRef<HTMLDivElement, MenuSeparatorProps>(
	function MenuSeparator(props, ref) {
		const isInsideMenuRoot = useContext(MenuRootRenderContext);
		const isInsideMenuPopup = useContext(MenuPopupRenderContext);

		if (isInsideMenuRoot && isInsideMenuPopup) {
			return <Menu.Separator {...props} ref={ref} />;
		}

		const { render: _render, orientation = "horizontal", ...divProps } = props;

		return (
			<div
				{...(divProps as ComponentPropsWithoutRef<"div">)}
				ref={ref}
				data-orientation={orientation}
			/>
		);
	},
);
