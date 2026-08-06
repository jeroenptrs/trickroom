import { Terminal, X } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { CopyButton } from "./ui/copy-button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
} from "./ui/dialog";
import { Separator } from "./ui/separator";
import { Text } from "./ui/text";

const MCP_COMMAND = "trickroom mcp";

type Agent = {
	id: string;
	name: string;
	description: string;
	installCommand: string;
	removeCommand: string;
};

function buildAgents(mcpCommand: string): Agent[] {
	return [
		{
			id: "codex",
			name: "Codex CLI",
			description:
				"Run this in your terminal to register the Trickroom MCP server with the Codex CLI.",
			installCommand: `codex mcp add trickroom -- ${mcpCommand}`,
			removeCommand: "codex mcp remove trickroom",
		},
		{
			id: "claude-code",
			name: "Claude Code",
			description:
				"Run this in your terminal to register the Trickroom MCP server with Claude Code.",
			installCommand: `claude mcp add --scope user --transport stdio trickroom -- ${mcpCommand}`,
			removeCommand: "claude mcp remove --scope user trickroom",
		},
		{
			id: "amp",
			name: "Amp",
			description:
				"Run this in your terminal to register the Trickroom MCP server with Amp.",
			installCommand: `amp mcp add trickroom -- ${mcpCommand}`,
			removeCommand: "amp mcp remove trickroom",
		},
		{
			id: "gemini",
			name: "Gemini CLI",
			description:
				"Run this in your terminal to register the Trickroom MCP server with the Gemini CLI.",
			installCommand: `gemini mcp add --scope user trickroom ${mcpCommand}`,
			removeCommand: "gemini mcp remove --scope user trickroom",
		},
		{
			id: "opencode",
			name: "OpenCode",
			description:
				"Run this in your terminal to register the Trickroom MCP server with OpenCode.",
			installCommand: `opencode mcp add trickroom -- ${mcpCommand}`,
			removeCommand: "opencode mcp remove trickroom",
		},
		{
			id: "copilot",
			name: "Copilot CLI",
			description:
				"Run this in your terminal to register the Trickroom MCP server with the Copilot CLI.",
			installCommand: `copilot mcp add trickroom -- ${mcpCommand}`,
			removeCommand: "copilot mcp remove trickroom",
		},
	];
}

type MCPSetupDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export function MCPSetupDialog({ open, onOpenChange }: MCPSetupDialogProps) {
	const [selectedId, setSelectedId] = useState("codex");
	const agents = buildAgents(MCP_COMMAND);
	const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogOverlay />
				<DialogContent
					className="w-2xl max-w-[calc(100vw-2rem)] md:max-w-2xl"
					initialFocus={false}
				>
					<div className="flex flex-row items-center justify-between px-4 py-3">
						<DialogTitle className="p-0 text-sm font-medium text-slate-900">
							MCP Setup
						</DialogTitle>
						<DialogClose
							aria-label="Close"
							className="inline-flex size-6 items-center justify-center text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
						>
							<X className="size-4" aria-hidden="true" />
						</DialogClose>
					</div>
					<div
						className="flex flex-row flex-wrap px-4 pb-3"
						role="tablist"
						aria-label="Coding agent"
					>
						{agents.map((agent) => {
							const isActive = agent.id === selected.id;
							return (
								<Button
									key={agent.id}
									type="button"
									variant="block"
									isSelected={isActive}
									role="tab"
									aria-selected={isActive}
									onClick={() => setSelectedId(agent.id)}
								>
									{agent.name}
								</Button>
							);
						})}
					</div>

					<Separator />

					<div className="flex flex-col gap-3 p-5">
						<Text render={<p />} tone="muted" className="text-xs">
							{selected.description}
						</Text>

						<div className="flex flex-row items-stretch bg-slate-900">
							<Terminal
								className="ml-3 size-3.5 shrink-0 self-center text-slate-100"
								aria-hidden="true"
							/>
							<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2 py-2.5 font-mono text-[11px] text-slate-100 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
								{selected.installCommand}
							</code>
							<Separator orientation="vertical" className="bg-slate-700" />
							<CopyButton
								key={selected.id}
								variant="blockDark"
								value={selected.installCommand}
								subject="install command"
								labels={{ idle: "Copy", copied: "Copied" }}
							/>
						</div>

						<Text
							render={<p />}
							tone="muted"
							className="text-[11px] leading-relaxed"
						>
							To unregister later, run{" "}
							<code className="font-mono text-cyan-900">
								{selected.removeCommand}
							</code>
							.
						</Text>
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	);
}
