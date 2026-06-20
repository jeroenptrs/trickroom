import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ProjectQueryScope } from "../../queries/project-scope";
import { storedTailwindTokensQueryOptions } from "../../queries/tailwind-sync-tokens";
import { TAILWIND_TOKEN_DOMAINS } from "../../utils/tailwind-token-domains";
import {
	deriveTokenDomainPills,
	filterAndGroupTokenRowsByDomain,
	TokenDomainPills,
	TokenDomainSectionList,
	TokenFilterInput,
} from "../project/SystemTokenRows";

export function SystemEditorTokensPanel({
	systemId,
	projectScope,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
}) {
	const storedTokensQuery = useQuery(
		storedTailwindTokensQueryOptions(systemId, projectScope),
	);
	const [tokenFilter, setTokenFilter] = useState("");
	const [activeTokenDomains, setActiveTokenDomains] = useState<string[]>([]);
	const [collapsedTokenDomains, setCollapsedTokenDomains] = useState<
		readonly string[]
	>([]);

	const syncedTokens = useMemo(() => {
		const domains = storedTokensQuery.data?.domains;
		if (!domains) {
			return [];
		}

		return Object.entries(domains).flatMap(([domain, storage]) =>
			Object.entries(storage.tokens).map(([name, value]) => ({
				name,
				value,
				domain,
			})),
		);
	}, [storedTokensQuery.data?.domains]);

	const allTokenSections = useMemo(
		() =>
			filterAndGroupTokenRowsByDomain(
				syncedTokens,
				(token) => ({
					name: token.name,
					value: token.value,
				}),
				{
					domainOrder: [...TAILWIND_TOKEN_DOMAINS],
					getDomainLabel: (domain) => domain,
				},
			),
		[syncedTokens],
	);

	const filteredTokenSections = useMemo(
		() =>
			filterAndGroupTokenRowsByDomain(
				syncedTokens,
				(token) => ({
					name: token.name,
					value: token.value,
				}),
				{
					filter: tokenFilter,
					domainFilter: activeTokenDomains,
					domainOrder: [...TAILWIND_TOKEN_DOMAINS],
					getDomainLabel: (domain) => domain,
				},
			),
		[activeTokenDomains, syncedTokens, tokenFilter],
	);

	const tokenDomainPills = useMemo(
		() =>
			deriveTokenDomainPills({
				sections: allTokenSections,
				activeDomains: activeTokenDomains,
			}),
		[activeTokenDomains, allTokenSections],
	);

	const tokenCount = syncedTokens.length;
	const filteredTokenCount = filteredTokenSections.reduce(
		(count, section) => count + section.rows.length,
		0,
	);

	if (storedTokensQuery.isPending) {
		return (
		<div className="flex min-h-0 flex-1 flex-col px-5 py-4">
				<p className="text-sm text-slate-500">Loading stored tokens...</p>
			</div>
		);
	}

	if (storedTokensQuery.isError) {
		return (
		<div className="flex min-h-0 flex-1 flex-col px-5 py-4" role="alert">
				<p className="text-sm font-medium text-red-950">Failed to load tokens</p>
				<p className="mt-1 text-xs text-red-700">
					{(storedTokensQuery.error as Error).message}
				</p>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
			<p className="text-xs text-slate-500">
				Read-only review of stored token domains. Source definitions are edited in
				the project theme, not here.
			</p>
			{tokenCount === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
					<p className="text-sm font-medium text-slate-900">No stored tokens</p>
					<p className="mt-1 max-w-sm text-sm text-slate-500">
						Sync this system from the project view to populate token domains for
						review.
					</p>
				</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col border border-slate-200 bg-white">
					<div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
						<div className="min-w-[12rem] flex-1">
							<TokenFilterInput
								filter={tokenFilter}
								onFilterChange={setTokenFilter}
								onClear={() => setTokenFilter("")}
							/>
						</div>
						<TokenDomainPills
							pills={tokenDomainPills}
							onToggle={(domain) => {
								setActiveTokenDomains((domains) =>
									domains.includes(domain)
										? domains.filter((entry) => entry !== domain)
										: [...domains, domain],
								);
							}}
							onClearAll={() => setActiveTokenDomains([])}
						/>
						{filteredTokenCount !== tokenCount ? (
							<span className="shrink-0 font-mono text-[10px] text-slate-500">
								{filteredTokenCount.toLocaleString()} /{" "}
								{tokenCount.toLocaleString()}
							</span>
						) : (
							<span className="shrink-0 font-mono text-[10px] text-slate-500">
								{tokenCount.toLocaleString()} tokens
							</span>
						)}
					</div>
					<div className="min-h-0 flex-1">
						{filteredTokenSections.length === 0 ? (
							<p className="px-4 py-6 text-sm text-slate-500">
								No tokens match the current filters.
							</p>
						) : (
							filteredTokenSections.map((section) => (
								<TokenDomainSectionList
									key={section.domain}
									section={section}
									emptyMessage="No tokens in this domain."
									isCollapsed={collapsedTokenDomains.includes(section.domain)}
									onToggle={() => {
										setCollapsedTokenDomains((domains) =>
											domains.includes(section.domain)
												? domains.filter((entry) => entry !== section.domain)
												: [...domains, section.domain],
										);
									}}
								/>
							))
						)}
					</div>
				</div>
			)}
		</div>
	);
}
