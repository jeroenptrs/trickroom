import {
	RiArrowLeftLine as ArrowLeft,
	RiFileCheckLine as FileCheck,
	RiFileReduceLine as FileReduce,
	RiFileUploadLine as FileUpload,
} from "@remixicon/react";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router";
import { saveDesignFile } from "../../queries/design-file";
import {
	clearDirty,
	serializeDesign,
	useDesignName,
	useDesignRevision,
	useHasUnsavedChanges,
} from "../../stores/design-store";
import type { TrickroomDesign } from "../../types";
import { useIFrameView } from "../contexts";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { Text } from "../ui/text";
import { Layers } from "./Layers";
import { Properties } from "./Properties";

const AUTOSAVE_DELAY_MS = 1000;

type SaveRequest = {
	design: TrickroomDesign;
	revision: number;
};

type SaveControlProps = {
	designFile: string;
};

type SidebarProps = {
	designFile: string;
};

function Zoom() {
	const view = useIFrameView();
	return (
		<div className="flex flex-row gap-1">
			<div className="text-gray-400">Zoom</div>
			<span className="ml-auto">{Math.round(view.scale * 100)}%</span>
		</div>
	);
}

function SaveControl({ designFile }: SaveControlProps) {
	const hasUnsavedChanges = useHasUnsavedChanges();
	const revision = useDesignRevision();
	const saveMutation = useMutation({
		mutationFn: ({ design }: SaveRequest) => saveDesignFile(designFile, design),
		onSuccess: (_savedDesign, request) => {
			clearDirty(request.revision);
		},
	});
	const saveCurrentDesign = useCallback(() => {
		if (saveMutation.isPending) {
			return;
		}

		saveMutation.mutate({
			design: serializeDesign(),
			revision,
		});
	}, [revision, saveMutation]);

	useEffect(() => {
		if (!hasUnsavedChanges || saveMutation.isPending || saveMutation.isError) {
			return;
		}

		const timeout = window.setTimeout(saveCurrentDesign, AUTOSAVE_DELAY_MS);
		return () => window.clearTimeout(timeout);
	}, [
		hasUnsavedChanges,
		saveCurrentDesign,
		saveMutation.isError,
		saveMutation.isPending,
	]);

	const error =
		saveMutation.error instanceof Error ? saveMutation.error.message : null;

	if (error) {
		return (
			<span className="truncate text-red-500" title={error}>
				{error}
			</span>
		);
	}

	return hasUnsavedChanges ? (
		<Button
			variant="block"
			className="py-1"
			title="Unsaved changes"
			onClick={saveCurrentDesign}
			disabled={!hasUnsavedChanges || saveMutation.isPending}
		>
			<FileReduce className="fill-gray-900 size-4" />
		</Button>
	) : saveMutation.isPending ? (
		<span title="Saving" className="p-1">
			<FileUpload className="fill-gray-900 size-4" />
		</span>
	) : (
		<span title="Saved" className="p-1">
			<FileCheck className="fill-gray-900 size-4" />
		</span>
	);
}

export function Sidebar({ designFile }: SidebarProps) {
	const designName = useDesignName();
	const navigate = useNavigate();

	return (
		<aside className="text-xs pointer-events-auto absolute bottom-0 right-0 top-0 z-20 flex w-64 flex-col border-l border-gray-200 bg-gray-50">
			<div>
				<div className="flex flex-row justify-between items-center">
					<Button
						variant="block"
						className="py-1"
						onClick={() => navigate("/")}
					>
						<ArrowLeft className="size-4 fill-gray-900" />
					</Button>
					<Text variant="subtitle" className="truncate">
						{designName}
					</Text>
					<SaveControl designFile={designFile} />
				</div>
				<Separator />
				<Separator />
				<Layers />
				<Separator />
				<Properties />
			</div>
			<div className="mt-auto flex flex-row justify-between px-1.5 pb-1">
				<div />
				<Zoom />
			</div>
		</aside>
	);
}
