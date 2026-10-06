import { resolveCodegenConfig } from "../codegen/config";
import { readProjectConfigReadOnly } from "../project";
import type { DesignSystemRecord } from "../utils/design-system-store";
import { readSystemComponentManifest } from "../utils/system-component-manifest-service";
import { readDomainTokensReadonly } from "../utils/tailwind-token-store";
import { buildSystemContract } from "./contract";

/**
 * The hash of the contract a lint run would check against right now, so the
 * dashboard can tell a report is stale (its `contract.hash` differs). Reads
 * the same inputs as `runLint` steps 1 to 4, read-only, without scanning
 * sources or running rules. Null when an input cannot be read; the run itself
 * reports why.
 */
export async function readCurrentContractHash(
	projectRoot: string,
	system: Pick<DesignSystemRecord, "manifest">,
): Promise<string | null> {
	try {
		const { config } = await readProjectConfigReadOnly(projectRoot);
		const systemId = system.manifest.systemId;
		const [manifestRead, tokens] = await Promise.all([
			readSystemComponentManifest(projectRoot, systemId, { readOnly: true }),
			readDomainTokensReadonly(projectRoot, systemId),
		]);
		return buildSystemContract({
			system: {
				id: systemId,
				name: system.manifest.systemName,
				cssPath: system.manifest.cssPath ?? null,
			},
			manifest: manifestRead.manifest,
			tokens,
			codegen: resolveCodegenConfig(config),
		}).hash;
	} catch {
		return null;
	}
}
