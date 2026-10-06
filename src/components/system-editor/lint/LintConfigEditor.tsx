import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
	LintConfig,
	LintCoverageThresholds,
	LintSeverity,
	LintSourceConfig,
} from "../../../lint/config";
import type {
	LintRuleKindSummary,
	LintRuleOptionSpec,
} from "../../../lint/rule-catalogue";
import type { ProjectQueryScope } from "../../../queries/project-scope";
import { systemComponentsQueryOptions } from "../../../queries/system-components";
import {
	type SystemLintConfigResponse,
	SystemLintRequestError,
	saveSystemLintConfig,
	systemLintConfigQueryKey,
} from "../../../queries/system-lint";
import { Alert } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import { Text } from "../../ui/text";
import { SectionHeading } from "./LintParts";
import {
	componentModules,
	editLintConfigSession,
	formatListText,
	isLintConfigSessionConflicted,
	isLintConfigSessionDirty,
	type LintConfigEditSession,
	type LintThresholdPath,
	lintConfigSessionAfterFileChange,
	lintConfigSessionAfterSave,
	optionValueMatchesSpec,
	parseCountText,
	parseListText,
	readComponentMap,
	readThreshold,
	setComponentModules,
	setRuleEnabled,
	setRuleOption,
	setRuleSeverity,
	setSourceList,
	setThreshold,
	undocumentedRuleOptions,
} from "./lint-config-draft";
import { LINT_COVERAGE_STATES } from "./lint-dashboard-model";

const SEVERITIES: LintSeverity[] = ["error", "warning", "info"];

const selectClassName =
	"min-w-0 border-none bg-white px-2 py-1.5 text-xs text-slate-950 inset-shadow-[0_0_0_1px_#e2e8f0] focus:outline-none focus:inset-shadow-[0_0_0_1px_#06b6d4]";

const textareaClassName =
	"min-h-16 w-full resize-y border-none bg-white px-2 py-1.5 font-mono text-[11px] leading-4 text-slate-950 inset-shadow-[0_0_0_1px_#e2e8f0] placeholder:text-slate-400 focus:outline-none focus:inset-shadow-[0_0_0_1px_#06b6d4]";

const sameList = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length &&
	left.every((entry, index) => entry === right[index]);

/** One entry per line; keeps what is being typed until it parses differently. */
function ListTextarea({
	value,
	onChange,
	placeholder,
	label,
}: {
	value: readonly string[] | undefined;
	onChange: (next: string[] | undefined) => void;
	placeholder?: string;
	label: string;
}) {
	const [text, setText] = useState(formatListText(value));
	useEffect(() => {
		setText((current) =>
			sameList(parseListText(current), value ?? [])
				? current
				: formatListText(value),
		);
	}, [value]);
	return (
		<textarea
			aria-label={label}
			className={textareaClassName}
			value={text}
			placeholder={placeholder}
			rows={Math.max(2, Math.min(8, text.split("\n").length))}
			onChange={(event) => {
				setText(event.target.value);
				const list = parseListText(event.target.value);
				onChange(list.length > 0 ? list : undefined);
			}}
		/>
	);
}

/** A non-negative count; empty clears it. The server checks the value. */
function CountInput({
	value,
	onChange,
	label,
	placeholder = "—",
}: {
	value: number | undefined;
	onChange: (next: number | undefined) => void;
	label: string;
	placeholder?: string;
}) {
	const [text, setText] = useState(value === undefined ? "" : String(value));
	useEffect(() => {
		setText((current) =>
			parseCountText(current) === value
				? current
				: value === undefined
					? ""
					: String(value),
		);
	}, [value]);
	return (
		<Input
			variant="formCompact"
			type="number"
			min={0}
			step={1}
			inputMode="numeric"
			className="w-20 font-mono text-xs"
			aria-label={label}
			placeholder={placeholder}
			value={text}
			onChange={(event) => {
				setText(event.target.value);
				onChange(parseCountText(event.target.value));
			}}
		/>
	);
}

function JsonBlock({ value }: { value: unknown }) {
	return (
		<pre className="overflow-x-auto bg-slate-50 px-2 py-1.5 font-mono text-[11px] leading-4 text-slate-700 inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
			{JSON.stringify(value, null, 2)}
		</pre>
	);
}

function ComponentMapField({
	value,
	onChange,
	slugs,
	label,
	placeholder,
}: {
	value: unknown;
	onChange: (next: Record<string, string[]> | undefined) => void;
	slugs: readonly string[];
	label: string;
	placeholder?: string;
}) {
	const map = readComponentMap(value);
	const [adding, setAdding] = useState("");
	const available = slugs.filter((slug) => !(slug in map));
	const write = (next: Record<string, string[]>) =>
		onChange(Object.keys(next).length > 0 ? next : undefined);
	return (
		<div className="flex flex-col gap-2">
			{Object.entries(map).map(([slug, entries]) => (
				<div key={slug} className="flex items-start gap-2">
					<span className="w-32 shrink-0 truncate pt-1.5 font-mono text-[11px] text-slate-900">
						{slug}
					</span>
					<div className="min-w-0 flex-1">
						<ListTextarea
							label={`${label}: ${slug}`}
							value={entries}
							placeholder={placeholder}
							onChange={(list) => write({ ...map, [slug]: list ?? [] })}
						/>
					</div>
					<Button
						type="button"
						variant="ghost"
						className="flex size-7 shrink-0 items-center justify-center p-0"
						title={`Remove ${slug}`}
						onClick={() => {
							const { [slug]: _removed, ...rest } = map;
							write(rest);
						}}
					>
						<Trash2 className="size-3.5" aria-hidden="true" />
					</Button>
				</div>
			))}
			<div className="flex items-center gap-2">
				<select
					aria-label={`${label}: add a component`}
					className={selectClassName}
					value={adding}
					onChange={(event) => setAdding(event.target.value)}
				>
					<option value="">Add a component…</option>
					{available.map((slug) => (
						<option key={slug} value={slug}>
							{slug}
						</option>
					))}
				</select>
				<Button
					type="button"
					variant="outlined"
					className="flex items-center gap-1 px-2 py-1 text-xs"
					disabled={!adding}
					onClick={() => {
						write({ ...map, [adding]: [] });
						setAdding("");
					}}
				>
					<Plus className="size-3" aria-hidden="true" />
					Add
				</Button>
			</div>
		</div>
	);
}

function OptionField({
	spec,
	value,
	onChange,
	slugs,
}: {
	spec: LintRuleOptionSpec;
	value: unknown;
	onChange: (next: unknown) => void;
	slugs: readonly string[];
}) {
	let control: React.ReactNode;
	if (!optionValueMatchesSpec(spec, value)) {
		control = (
			<div className="flex flex-col gap-1">
				<Text tone="faint" className="text-[11px]">
					The stored value does not have the documented shape; it is kept as is.
				</Text>
				<JsonBlock value={value} />
			</div>
		);
	} else if (spec.type === "boolean") {
		control = (
			<select
				aria-label={spec.label}
				className={selectClassName}
				value={value === undefined ? "" : String(value)}
				onChange={(event) =>
					onChange(
						event.target.value === ""
							? undefined
							: event.target.value === "true",
					)
				}
			>
				<option value="">Default</option>
				<option value="true">On</option>
				<option value="false">Off</option>
			</select>
		);
	} else if (spec.type === "number") {
		control = (
			<CountInput
				label={spec.label}
				value={value as number | undefined}
				onChange={onChange}
			/>
		);
	} else if (spec.type === "string") {
		control = (
			<Input
				variant="formCompact"
				className="w-full font-mono text-xs"
				aria-label={spec.label}
				placeholder={spec.placeholder}
				value={(value as string | undefined) ?? ""}
				onChange={(event) => onChange(event.target.value || undefined)}
			/>
		);
	} else if (spec.type === "string-list") {
		control = (
			<ListTextarea
				label={spec.label}
				value={value as string[] | undefined}
				placeholder={spec.placeholder}
				onChange={onChange}
			/>
		);
	} else {
		control = (
			<ComponentMapField
				label={spec.label}
				value={value}
				slugs={slugs}
				placeholder={spec.placeholder}
				onChange={onChange}
			/>
		);
	}
	return (
		<div className="flex flex-col gap-1" data-lint-option={spec.key}>
			<div className="flex items-baseline gap-2">
				<span className="text-xs font-semibold text-slate-900">
					{spec.label}
				</span>
				<span className="font-mono text-[10px] text-slate-400">{spec.key}</span>
			</div>
			<Text tone="faint" className="text-[11px]">
				{spec.description}
			</Text>
			{control}
		</div>
	);
}

function RuleEditor({
	kind,
	config,
	onChange,
	slugs,
}: {
	kind: LintRuleKindSummary;
	config: LintConfig;
	onChange: (next: LintConfig) => void;
	slugs: readonly string[];
}) {
	const rule = config.rules?.[kind.id];
	const enabled = rule?.enabled ?? true;
	const undocumented = undocumentedRuleOptions(config, kind.id, kind.options);
	return (
		<div
			className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
			data-lint-rule-config={kind.id}
		>
			<div className="flex flex-wrap items-center gap-3">
				<Switch
					checked={enabled}
					onCheckedChange={(checked) =>
						onChange(setRuleEnabled(config, kind.id, checked))
					}
					aria-label={`Enable ${kind.id}`}
				/>
				<span
					className={`min-w-0 flex-1 truncate font-mono text-xs ${enabled ? "text-slate-900" : "text-slate-400"}`}
				>
					{kind.id}
				</span>
				<label className="flex items-center gap-1.5 text-[11px] text-slate-500">
					severity
					<select
						aria-label={`Severity of ${kind.id}`}
						className={selectClassName}
						value={rule?.severity ?? ""}
						disabled={!enabled}
						onChange={(event) =>
							onChange(
								setRuleSeverity(
									config,
									kind.id,
									(event.target.value || null) as LintSeverity | null,
								),
							)
						}
					>
						<option value="">Default ({kind.defaultSeverity})</option>
						{SEVERITIES.map((severity) => (
							<option key={severity} value={severity}>
								{severity}
							</option>
						))}
					</select>
				</label>
				<span className="flex items-center gap-1.5 text-[11px] text-slate-500">
					max findings
					<CountInput
						label={`Maximum findings of ${kind.id}`}
						value={readThreshold(config, `rule.${kind.id}`)}
						onChange={(value) =>
							onChange(setThreshold(config, `rule.${kind.id}`, value))
						}
					/>
				</span>
			</div>
			<Text tone="muted" className="text-xs">
				{kind.description}
			</Text>
			{kind.options.length > 0 ? (
				<div className="flex flex-col gap-3 border-l-2 border-slate-200 pl-3">
					{kind.options.map((spec) => (
						<OptionField
							key={spec.key}
							spec={spec}
							value={rule?.options?.[spec.key]}
							slugs={slugs}
							onChange={(value) =>
								onChange(setRuleOption(config, kind.id, spec.key, value))
							}
						/>
					))}
				</div>
			) : null}
			{Object.keys(undocumented).length > 0 ? (
				<div className="flex flex-col gap-1">
					<Text variant="section-header">other options (read-only)</Text>
					<JsonBlock value={undocumented} />
				</div>
			) : null}
		</div>
	);
}

function ThresholdField({
	label,
	path,
	config,
	onChange,
}: {
	label: string;
	path: LintThresholdPath;
	config: LintConfig;
	onChange: (next: LintConfig) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 text-xs text-slate-700">
			<span>{label}</span>
			<CountInput
				label={label}
				value={readThreshold(config, path)}
				onChange={(value) => onChange(setThreshold(config, path, value))}
			/>
		</div>
	);
}

function ComponentModulesEditor({
	config,
	onChange,
	slugs,
}: {
	config: LintConfig;
	onChange: (next: LintConfig) => void;
	slugs: readonly string[];
}) {
	const [adding, setAdding] = useState("");
	const configured = Object.keys(config.components ?? {}).sort();
	const available = slugs.filter((slug) => !configured.includes(slug));
	return (
		<div className="flex flex-col gap-3 px-4 py-3">
			{configured.length === 0 ? (
				<Text tone="faint" className="text-xs">
					No overrides: the module that imports a component's variants file is
					its wrapper.
				</Text>
			) : null}
			{configured.map((slug) => (
				<div
					key={slug}
					className="flex items-start gap-2"
					data-lint-component-module={slug}
				>
					<span className="w-32 shrink-0 truncate pt-1.5 font-mono text-[11px] text-slate-900">
						{slug}
					</span>
					<div className="min-w-0 flex-1">
						<ListTextarea
							label={`Wrapper modules of ${slug}`}
							value={componentModules(config, slug)}
							placeholder="src/components/ui/button.tsx"
							onChange={(list) =>
								onChange(setComponentModules(config, slug, list ?? []))
							}
						/>
					</div>
					<Button
						type="button"
						variant="ghost"
						className="flex size-7 shrink-0 items-center justify-center p-0"
						title={`Remove the override of ${slug}`}
						onClick={() => onChange(setComponentModules(config, slug, null))}
					>
						<Trash2 className="size-3.5" aria-hidden="true" />
					</Button>
				</div>
			))}
			<div className="flex items-center gap-2">
				<select
					aria-label="Add a wrapper override"
					className={selectClassName}
					value={adding}
					onChange={(event) => setAdding(event.target.value)}
				>
					<option value="">Add a component…</option>
					{available.map((slug) => (
						<option key={slug} value={slug}>
							{slug}
						</option>
					))}
				</select>
				<Button
					type="button"
					variant="outlined"
					className="flex items-center gap-1 px-2 py-1 text-xs"
					disabled={!adding}
					onClick={() => {
						onChange(setComponentModules(config, adding, []));
						setAdding("");
					}}
				>
					<Plus className="size-3" aria-hidden="true" />
					Add
				</Button>
			</div>
		</div>
	);
}

const SOURCE_FIELDS: Array<{
	key: keyof LintSourceConfig;
	label: string;
	description: string;
}> = [
	{
		key: "include",
		label: "Include",
		description: "Globs of the source files to scan, relative to the project.",
	},
	{
		key: "exclude",
		label: "Exclude",
		description: "Globs to leave out.",
	},
	{
		key: "classCalls",
		label: "Class calls",
		description: "Calls whose string arguments are class strings.",
	},
];

/**
 * The `lint.json` editor: every rule kind of the catalogue with its enabled
 * state, severity, per-kind threshold and documented options, the wrapper
 * overrides, the source globs and the thresholds. Edits stay in a draft
 * until saved; the server validates with the engine's issues and writes the
 * file with `serializeLintConfig`.
 */
export function LintConfigEditor({
	systemId,
	projectScope,
	data,
	componentSlugs: extraSlugs = [],
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
	data: SystemLintConfigResponse;
	/** Slugs known from the report, merged with the system's components. */
	componentSlugs?: readonly string[];
}) {
	const queryClient = useQueryClient();
	const componentsQuery = useQuery(
		systemComponentsQueryOptions(systemId, projectScope),
	);
	const slugs = useMemo(
		() =>
			[
				...new Set([
					...(componentsQuery.data?.components ?? []).map(
						(component) => component.slug,
					),
					...extraSlugs,
				]),
			].sort(),
		[componentsQuery.data, extraSlugs],
	);
	const [draft, setDraft] = useState<LintConfigEditSession | null>(null);
	const config = draft?.config ?? data.config;
	const isDirty = isLintConfigSessionDirty(draft);
	const changedOnDisk = isLintConfigSessionConflicted(draft, data.revision);

	useEffect(() => {
		setDraft((current) =>
			lintConfigSessionAfterFileChange(current, data.revision),
		);
	}, [data.revision]);

	const change = (next: LintConfig) =>
		setDraft((current) => editLintConfigSession(current, data, next));

	const saveMutation = useMutation({
		mutationFn: (input: { config: LintConfig; revision: string | null }) =>
			saveSystemLintConfig(systemId, input),
		onSuccess: (response, submitted) => {
			queryClient.setQueryData(
				systemLintConfigQueryKey(systemId, projectScope),
				response,
			);
			// Edits made while the save was in flight stay.
			setDraft((current) =>
				lintConfigSessionAfterSave(current, submitted.config, response),
			);
		},
		onError: (error) => {
			if (
				error instanceof SystemLintRequestError &&
				error.code === "LINT_CONFIG_CONFLICT"
			) {
				void queryClient.invalidateQueries({
					queryKey: systemLintConfigQueryKey(systemId, projectScope),
				});
			}
		},
	});
	const saveError =
		saveMutation.error instanceof SystemLintRequestError
			? saveMutation.error
			: null;
	const isConflict =
		changedOnDisk || saveError?.code === "LINT_CONFIG_CONFLICT";

	const ruleKindsBySide = (side: "code" | "design") =>
		data.ruleKinds.filter((kind) => kind.side === side);

	return (
		<div className="flex flex-col gap-6" data-lint-view="config">
			<Card edge="inset" className="flex flex-col gap-2 px-4 py-3">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-mono text-xs text-slate-900">{data.path}</span>
					{data.present ? (
						<Badge tone="neutral" edge="stamped">
							present
						</Badge>
					) : (
						<Badge tone="info" edge="stamped">
							defaults
						</Badge>
					)}
				</div>
				<Text tone="muted" className="text-xs">
					{data.present
						? "Changes are written to this file when you save. Run lint afterwards to see their effect."
						: "No lint.json yet: every rule kind runs at its default severity with the default source globs. Saving creates the file."}
				</Text>
				{data.issues.length > 0 ? (
					<div className="flex flex-col gap-2">
						<Alert tone="danger">
							The stored lint.json is invalid, so lint runs fail until it is
							fixed. The form starts from the defaults; saving replaces the
							file.
						</Alert>
						<ul className="flex flex-col gap-1 font-mono text-[11px] text-red-800">
							{data.issues.map((issue) => (
								<li key={issue}>{issue}</li>
							))}
						</ul>
						{data.text !== null ? (
							<pre className="max-h-48 overflow-auto bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-700 inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
								{data.text}
							</pre>
						) : null}
					</div>
				) : null}
			</Card>

			{(["code", "design"] as const).map((side) => {
				const kinds = ruleKindsBySide(side);
				return (
					<section
						key={side}
						className="flex flex-col gap-2"
						aria-label={`${side} rule kinds`}
					>
						<SectionHeading
							title={`${side} rules`}
							detail={
								kinds.length === 0
									? "No rule kinds ship for this side yet."
									: undefined
							}
						/>
						{kinds.length > 0 ? (
							<Card edge="inset" className="flex flex-col">
								{kinds.map((kind) => (
									<RuleEditor
										key={kind.id}
										kind={kind}
										config={config}
										onChange={change}
										slugs={slugs}
									/>
								))}
							</Card>
						) : null}
					</section>
				);
			})}

			<section className="flex flex-col gap-2" aria-label="Thresholds">
				<SectionHeading
					title="thresholds"
					detail="A run fails when a number goes past its threshold, on top of the ratchet against the baseline. Empty means no threshold."
				/>
				<div className="flex flex-row flex-wrap gap-4">
					{(["code", "design"] as const).map((side) => (
						<Card
							key={side}
							edge="inset"
							className="flex min-w-56 flex-1 flex-col gap-2 px-4 py-3"
						>
							<Text variant="section-header">{side} maxima</Text>
							<ThresholdField
								label="Errors"
								path={`${side}.errors`}
								config={config}
								onChange={change}
							/>
							<ThresholdField
								label="Warnings"
								path={`${side}.warnings`}
								config={config}
								onChange={change}
							/>
						</Card>
					))}
					<Card
						edge="inset"
						className="flex min-w-56 flex-1 flex-col gap-2 px-4 py-3"
					>
						<Text variant="section-header">coverage minima</Text>
						{LINT_COVERAGE_STATES.map((state) => (
							<ThresholdField
								key={state.key}
								label={state.label}
								path={`coverage.${state.key as keyof LintCoverageThresholds}`}
								config={config}
								onChange={change}
							/>
						))}
					</Card>
				</div>
			</section>

			<section className="flex flex-col gap-2" aria-label="Wrapper modules">
				<SectionHeading
					title="wrapper modules"
					detail="Name a component's bound wrapper when it is not the module importing the variants file (a barrel, a renamed wrapper). One project-relative path per line."
				/>
				<Card edge="inset" className="flex flex-col">
					<ComponentModulesEditor
						config={config}
						onChange={change}
						slugs={slugs}
					/>
				</Card>
			</section>

			<section className="flex flex-col gap-2" aria-label="Sources">
				<SectionHeading
					title="sources"
					detail="Empty fields use the defaults shown as placeholders."
				/>
				<Card edge="inset" className="flex flex-col gap-3 px-4 py-3">
					{SOURCE_FIELDS.map((field) => (
						<div key={field.key} className="flex flex-col gap-1">
							<span className="text-xs font-semibold text-slate-900">
								{field.label}
							</span>
							<Text tone="faint" className="text-[11px]">
								{field.description}
							</Text>
							<ListTextarea
								label={`Source ${field.label.toLowerCase()}`}
								value={config.source?.[field.key]}
								placeholder={data.defaults.source[field.key].join("\n")}
								onChange={(list) =>
									change(setSourceList(config, field.key, list))
								}
							/>
						</div>
					))}
				</Card>
			</section>

			<div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-slate-200 bg-slate-100 py-3">
				{isConflict ? (
					<div className="flex flex-wrap items-center gap-2">
						<Alert tone="warning" className="flex-1">
							lint.json changed on disk since you started editing. Discard your
							edits to load it, or overwrite it with yours.
						</Alert>
						<Button
							type="button"
							variant="outlined"
							flavor="warning"
							className="px-3 py-1.5 text-xs"
							disabled={saveMutation.isPending}
							onClick={() =>
								saveMutation.mutate({ config, revision: data.revision })
							}
						>
							Overwrite
						</Button>
					</div>
				) : null}
				{saveError && saveError.code !== "LINT_CONFIG_CONFLICT" ? (
					<div className="flex flex-col gap-1">
						<Alert tone="danger">
							{saveError.issues.length > 0
								? `Not saved: lint.json would be invalid (${saveError.issues.length} ${saveError.issues.length === 1 ? "problem" : "problems"}).`
								: saveError.message}
						</Alert>
						{saveError.issues.length > 0 ? (
							<ul
								className="flex flex-col gap-1 font-mono text-[11px] text-red-800"
								aria-label="Config issues"
							>
								{saveError.issues.map((issue) => (
									<li key={issue}>{issue}</li>
								))}
							</ul>
						) : null}
					</div>
				) : saveMutation.error && !saveError ? (
					<Alert tone="danger">{saveMutation.error.message}</Alert>
				) : null}
				<div className="flex items-center justify-end gap-2">
					<Text tone="faint" className="mr-auto text-xs">
						{saveMutation.isPending
							? "Saving…"
							: isDirty
								? "Unsaved changes"
								: saveMutation.isSuccess
									? "Saved"
									: "No changes"}
					</Text>
					<Button
						type="button"
						variant="outlined"
						className="px-3 py-1.5"
						disabled={!isDirty && !changedOnDisk}
						onClick={() => {
							setDraft(null);
							saveMutation.reset();
						}}
					>
						Discard
					</Button>
					<Button
						type="button"
						variant="filled"
						className="px-3 py-1.5"
						disabled={!isDirty || isConflict || saveMutation.isPending}
						onClick={() =>
							saveMutation.mutate({
								config,
								revision: draft ? draft.revision : data.revision,
							})
						}
					>
						Save lint.json
					</Button>
				</div>
			</div>
		</div>
	);
}
