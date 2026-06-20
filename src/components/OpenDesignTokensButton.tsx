import { SwatchBook } from "lucide-react";
import { getTrickroomDesktopApi } from "../desktop-api";
import { Button } from "./ui/button";

const getTokenReferenceUrl = (systemId: string) =>
	`/api/trickroom/tailwind/systems/${encodeURIComponent(systemId)}/tokens.html`;

export function OpenDesignTokensButton({
	systemId,
	className,
	iconClassName = "size-4 text-slate-500",
	title = "Open design tokens",
}: {
	systemId: string | null | undefined;
	className?: string;
	iconClassName?: string;
	title?: string;
}) {
	const normalizedSystemId = systemId?.trim();
	if (!normalizedSystemId) {
		return null;
	}

	const openTokens = () => {
		const desktopApi = getTrickroomDesktopApi();
		if (desktopApi) {
			void desktopApi.openDesignTokens(normalizedSystemId);
			return;
		}

		window.open(getTokenReferenceUrl(normalizedSystemId), "_blank", "noopener");
	};

	return (
		<Button
			type="button"
			variant="block"
			className={
				className ?? "flex size-7 shrink-0 items-center justify-center p-0"
			}
			onClick={openTokens}
			title={title}
			aria-label={title}
		>
			<SwatchBook className={iconClassName} aria-hidden="true" />
		</Button>
	);
}
