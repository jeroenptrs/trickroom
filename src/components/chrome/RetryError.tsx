import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Text } from "../ui/text";

/**
 * A failed request in the design editor: what failed, the reason when there
 * is one, and a Retry button. Every failed load keeps a way to try again.
 */
export function RetryError({
	message,
	reason,
	onRetry,
	retrying = false,
	className,
}: {
	message: string;
	reason?: string;
	onRetry: () => void;
	retrying?: boolean;
	className?: string;
}) {
	return (
		<div className={`flex items-start gap-2 ${className ?? ""}`}>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<Alert variant="inline" tone="danger" className="text-xs">
					{message}
				</Alert>
				{reason ? (
					<Text variant="meta" className="wrap-break-word">
						{reason}
					</Text>
				) : null}
			</div>
			<Button
				variant="outlined"
				className="shrink-0 px-2 py-0.5 text-xs"
				disabled={retrying}
				onClick={onRetry}
			>
				Retry
			</Button>
		</div>
	);
}

/** The message of a failed query, for the reason line. */
export function errorReason(error: unknown) {
	return error instanceof Error && error.message ? error.message : undefined;
}
