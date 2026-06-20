import { createContext, useContext } from "react";

export const DesignSystemRenderContext = createContext<string | null>(null);

export function useDesignSystemRenderContext() {
	return useContext(DesignSystemRenderContext);
}
