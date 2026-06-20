import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrickroomDesign } from "../types";
import * as designFileServiceModule from "../services/design-file-service";
import {
  createDesignFileService,
  DesignFileServiceError,
} from "../services/design-file-service";
import {
  assertCanUseSystemComponentInstanceSubtree,
} from "../mcp/design-operations";
import { getMcpPolicy } from "../mcp/governance";
import {
  bulkMigrateDesignSystemComponentInstances,
  bulkMigrateProjectSystemComponentInstances,
} from "./system-component-bulk-migration";
import { createDesignSystemStorage } from "./design-system-store";
import { expandResolvedSystemComponent } from "./system-component-expansion";
import {
  getSystemComponentMarkerProps,
  getSystemComponentStructuralMetadata,
} from "./system-component-markers";
import {
  createFixtureManifest,
  FIXTURE_COMPONENT_ID,
} from "./system-component-test-fixtures";
import {
  hashSystemComponentTemplate,
  hashSystemComponentVariantSchema,
} from "./system-components-validation";
import {
  SYSTEM_COMPONENT_MANIFEST_FILE_NAME,
  type PublishedSystemComponentVersion,
  type SystemComponentRecord,
} from "./system-components";

const designWithAttachedComponent = (
  systemId: string,
  componentId: string,
  version: string,
  instanceId: string,
  hashes: { templateHash?: string; variantSchemaHash?: string } = {},
): TrickroomDesign => ({
  name: "Bulk Migration Design",
  systemId,
  systemName: "Core",
  boards: [
    {
      id: "board",
      props: {
        "data-trickroom-name": "Board",
        "data-trickroom-library": "trickroom",
        "data-trickroom-component": "container",
        "data-trickroom-role": "branch",
      },
      children: [
        {
          id: "attached-root",
          props: {
            "data-trickroom-name": "Primary Button",
            "data-trickroom-library": "trickroom",
            "data-trickroom-component": "container",
            "data-trickroom-role": "branch",
            ...getSystemComponentMarkerProps({
              systemId,
              componentId,
              instanceId,
              version,
              path: "root",
              isRoot: true,
              ...hashes,
            }),
          },
          children: [],
        },
      ],
    },
  ],
});

const createPublishedV1V2Record = (): SystemComponentRecord => {
  const v1Root = {
    path: "root",
    library: "trickroom",
    component: "container",
    children: [],
  };
  const v1Variants = {
    axes: {
      tone: {
        label: "Tone",
        defaultValue: "neutral",
        values: {
          brand: { classesByPath: { root: "tone-brand" } },
          neutral: { classesByPath: { root: "tone-neutral" } },
        },
      },
    },
  };
  const v1Slots = {
    default: {
      name: "default",
      hostPath: "root",
    },
  };
  const v1Draft = { root: v1Root, variants: v1Variants, slots: v1Slots };
  const v1: PublishedSystemComponentVersion = {
    ...v1Draft,
    version: "1",
    publishedAt: "2026-05-26T12:00:00.000Z",
    templateHash: hashSystemComponentTemplate(v1Draft),
    variantSchemaHash: hashSystemComponentVariantSchema(v1Variants),
  };

  const v2Root = {
    path: "root",
    library: "trickroom",
    component: "container",
    className: "card-v2",
    children: [],
  };
  const v2Variants = v1Variants;
  const v2Draft = { root: v2Root, variants: v2Variants, slots: v1Slots };
  const v2: PublishedSystemComponentVersion = {
    ...v2Draft,
    version: "2",
    previousVersion: "1",
    publishedAt: "2026-05-26T13:00:00.000Z",
    templateHash: hashSystemComponentTemplate(v2Draft),
    variantSchemaHash: hashSystemComponentVariantSchema(v2Variants),
  };

  return {
    componentId: FIXTURE_COMPONENT_ID,
    slug: "primary-button",
    name: "Primary Button",
    createdAt: "2026-05-26T12:00:00.000Z",
    updatedAt: "2026-05-26T13:00:00.000Z",
    draft: v2Draft,
    published: {
      currentVersion: "2",
      versions: { "1": v1, "2": v2 },
    },
  };
};

const createPublishedRecordWithRenamedRootPath = (): SystemComponentRecord => {
  const v1Root = {
    path: "root",
    library: "trickroom",
    component: "container",
    children: [],
  };
  const v1Draft = { root: v1Root, slots: {}, variants: { axes: {} } };
  const v1: PublishedSystemComponentVersion = {
    ...v1Draft,
    version: "1",
    publishedAt: "2026-05-26T12:00:00.000Z",
    templateHash: hashSystemComponentTemplate(v1Draft),
    variantSchemaHash: hashSystemComponentVariantSchema({ axes: {} }),
  };

  const v2Root = {
    path: "card",
    library: "trickroom",
    component: "container",
    children: [],
  };
  const v2Draft = { root: v2Root, slots: {}, variants: { axes: {} } };
  const v2: PublishedSystemComponentVersion = {
    ...v2Draft,
    version: "2",
    previousVersion: "1",
    publishedAt: "2026-05-26T13:00:00.000Z",
    templateHash: hashSystemComponentTemplate(v2Draft),
    variantSchemaHash: hashSystemComponentVariantSchema({ axes: {} }),
  };

  return {
    componentId: FIXTURE_COMPONENT_ID,
    slug: "card",
    name: "Card",
    createdAt: "2026-05-26T12:00:00.000Z",
    updatedAt: "2026-05-26T13:00:00.000Z",
    draft: v2Draft,
    published: {
      currentVersion: "2",
      versions: { "1": v1, "2": v2 },
    },
  };
};

const createPublishedRecordWithDefaultSlotFallback = (): SystemComponentRecord => {
  const v1Root = {
    path: "root",
    library: "trickroom",
    component: "container",
    children: [
      {
        path: "body",
        library: "trickroom",
        component: "container",
        slot: "default",
        children: [],
      },
    ],
  };
  const v1Variants = {
    axes: {
      tone: {
        label: "Tone",
        defaultValue: "neutral",
        values: {
          brand: { classesByPath: { root: "tone-brand" } },
          neutral: { classesByPath: { root: "tone-neutral" } },
        },
      },
    },
  };
  const v1Slots = {
    default: {
      name: "default",
      hostPath: "body",
    },
  };
  const v1Draft = { root: v1Root, slots: v1Slots, variants: v1Variants };
  const v1: PublishedSystemComponentVersion = {
    ...v1Draft,
    version: "1",
    publishedAt: "2026-05-26T12:00:00.000Z",
    templateHash: hashSystemComponentTemplate(v1Draft),
    variantSchemaHash: hashSystemComponentVariantSchema(v1Variants),
  };

  const v2Variants = {
    axes: {
      appearance: {
        label: "Appearance",
        defaultValue: "subtle",
        values: {
          emphasis: { classesByPath: { root: "appearance-emphasis" } },
          subtle: { classesByPath: { root: "appearance-subtle" } },
        },
      },
    },
    defaultValues: { appearance: "subtle" },
  };
  const v2Slots = {
    default: {
      name: "default",
      hostPath: "body",
      defaultChildren: [
        {
          path: "fallback",
          library: "trickroom",
          component: "text",
          text: "Fallback",
        },
      ],
    },
  };
  const v2Draft = {
    root: v1Root,
    slots: v2Slots,
    variants: v2Variants,
  };
  const v2: PublishedSystemComponentVersion = {
    ...v2Draft,
    version: "2",
    previousVersion: "1",
    publishedAt: "2026-05-26T13:00:00.000Z",
    templateHash: hashSystemComponentTemplate(v2Draft),
    variantSchemaHash: hashSystemComponentVariantSchema(v2Variants),
  };

  return {
    componentId: FIXTURE_COMPONENT_ID,
    slug: "primary-button",
    name: "Primary Button",
    createdAt: "2026-05-26T12:00:00.000Z",
    updatedAt: "2026-05-26T13:00:00.000Z",
    draft: v2Draft,
    published: {
      currentVersion: "2",
      versions: { "1": v1, "2": v2 },
    },
  };
};

const containerOnlyPolicy = getMcpPolicy({
  name: "Bulk Policy Test",
  systems: {},
  mcp: {
    enabled: true,
    allowedComponents: ["trickroom/container"],
  },
});

describe("system-component-bulk-migration", () => {
  let tempProjectRoot: string;

  beforeEach(async () => {
    tempProjectRoot = await mkdtemp(
      path.join(process.cwd(), ".tmp-trickroom-component-bulk-migration-"),
    );
    await writeFile(
      path.join(tempProjectRoot, "trickroom.config.json"),
      JSON.stringify({
        name: "Test Project",
        systems: { Core: "src/index.css" },
      }),
      "utf8",
    );
    await mkdir(path.join(tempProjectRoot, "src"), { recursive: true });
    await writeFile(
      path.join(tempProjectRoot, "src", "index.css"),
      "@import 'tailwindcss';\n",
      "utf8",
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempProjectRoot, { force: true, recursive: true });
  });

  const writeDesign = async (uuid: string, design: TrickroomDesign) => {
    await mkdir(path.join(tempProjectRoot, ".trickroom", "designs"), {
      recursive: true,
    });
    await writeFile(
      path.join(tempProjectRoot, ".trickroom", "designs", `${uuid}.json`),
      JSON.stringify(design),
      "utf8",
    );
  };

  const setupCoreSystem = async (
    components: Record<string, SystemComponentRecord>,
    options: { autoMigrateComponents?: boolean } = {},
  ) => {
    const storage = await createDesignSystemStorage(tempProjectRoot, {
      systemName: "Core",
      cssPath: "src/index.css",
    });
    const manifest = createFixtureManifest(components);
    manifest.settings.autoMigrateComponents =
      options.autoMigrateComponents ?? false;
    await writeFile(
      path.join(
        tempProjectRoot,
        ".trickroom",
        "systems",
        "core",
        SYSTEM_COMPONENT_MANIFEST_FILE_NAME,
      ),
      JSON.stringify(manifest),
      "utf8",
    );
    return storage.systemId;
  };

  it("migrates safe stale instances within one design and reports review-required separately", async () => {
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: createPublishedV1V2Record(),
    });
    const manifest = createFixtureManifest({
      [FIXTURE_COMPONENT_ID]: createPublishedV1V2Record(),
    });

    const safeDesign = designWithAttachedComponent(
      systemId,
      FIXTURE_COMPONENT_ID,
      "1",
      "safe-instance",
      {
        templateHash:
          createPublishedV1V2Record().published?.versions["1"].templateHash,
        variantSchemaHash:
          createPublishedV1V2Record().published?.versions["1"]
            .variantSchemaHash,
      },
    );

    const reviewRecord: SystemComponentRecord = {
      ...createPublishedV1V2Record(),
      published: {
        currentVersion: "2",
        versions: {
          "1": createPublishedV1V2Record().published!.versions["1"],
          "2": {
            ...createPublishedV1V2Record().published!.versions["2"],
            slots: {},
          },
        },
      },
    };
    const reviewManifest = createFixtureManifest({
      [FIXTURE_COMPONENT_ID]: reviewRecord,
    });
    const reviewV1 = reviewRecord.published!.versions["1"];
    const reviewDesign = designWithAttachedComponent(
      systemId,
      FIXTURE_COMPONENT_ID,
      "1",
      "review-instance",
      {
        templateHash: reviewV1.templateHash,
        variantSchemaHash: reviewV1.variantSchemaHash,
      },
    );

    const safeResult = bulkMigrateDesignSystemComponentInstances(
      safeDesign,
      {
        designFileId: "design-safe",
        designFile: "design-safe.json",
        designName: "Safe",
        systemId,
      },
      manifest,
    );

    expect(safeResult.report.changed).toHaveLength(1);
    expect(safeResult.report.changed[0]).toMatchObject({
      instanceId: "safe-instance",
      fromVersion: "1",
      toVersion: "2",
      componentId: FIXTURE_COMPONENT_ID,
      designFileId: "design-safe",
    });
    expect(
      safeResult.design.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("2");

    const reviewResult = bulkMigrateDesignSystemComponentInstances(
      reviewDesign,
      {
        designFileId: "design-review",
        designFile: "design-review.json",
        designName: "Review",
        systemId,
      },
      reviewManifest,
    );

    expect(reviewResult.report.changed).toHaveLength(0);
    expect(reviewResult.report.reviewRequired).toHaveLength(1);
    expect(reviewResult.report.reviewRequired[0]).toMatchObject({
      instanceId: "review-instance",
      componentId: FIXTURE_COMPONENT_ID,
      designFileId: "design-review",
    });
    expect(
      reviewResult.design.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("1");
  });

  it("reports migrated root element ids when target template renames the root path", async () => {
    const record = createPublishedRecordWithRenamedRootPath();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const manifest = createFixtureManifest({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const sourceVersion = record.published!.versions["1"];
    const expansion = expandResolvedSystemComponent(
      {
        systemId,
        componentId: FIXTURE_COMPONENT_ID,
        record,
        version: sourceVersion,
      },
      {
        createInstanceId: () => "renamed-root-instance",
        createElementId: () => crypto.randomUUID(),
      },
    );
    const staleRootId = expansion.root.id;
    const design: TrickroomDesign = {
      name: "Renamed Root Path",
      systemId,
      systemName: "Core",
      boards: [
        {
          id: "board",
          props: {
            "data-trickroom-name": "Board",
            "data-trickroom-library": "trickroom",
            "data-trickroom-component": "container",
            "data-trickroom-role": "branch",
          },
          children: [expansion.root],
        },
      ],
    };

    const result = bulkMigrateDesignSystemComponentInstances(
      design,
      {
        designFileId: "design-renamed-root",
        designFile: "design-renamed-root.json",
        designName: "Renamed Root Path",
        systemId,
      },
      manifest,
    );

    expect(result.report.changed).toHaveLength(1);
    expect(result.report.changed[0]?.elementId).not.toBe(staleRootId);
    const migratedRoot = result.design.boards[0]?.children?.find(
      (child) => child.id === result.report.changed[0]?.elementId,
    );
    expect(migratedRoot).toBeDefined();
    expect(getSystemComponentStructuralMetadata(migratedRoot!.props)).toMatchObject(
      {
        instanceId: "renamed-root-instance",
        version: "2",
        path: "card",
        isRoot: true,
      },
    );
    expect(
      result.design.boards[0]?.children?.some((child) => child.id === staleRootId),
    ).toBe(false);
  });

  it("skips hash-mismatch and non-stale instances without mutating the design", async () => {
    const record = createPublishedV1V2Record();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const manifest = createFixtureManifest({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const v1 = record.published!.versions["1"];

    const design = designWithAttachedComponent(
      systemId,
      FIXTURE_COMPONENT_ID,
      "2",
      "current-instance",
      {
        templateHash: "sha256:wrong",
        variantSchemaHash: "sha256:wrong",
      },
    );

    const result = bulkMigrateDesignSystemComponentInstances(
      design,
      {
        designFileId: "design-1",
        designFile: "design-1.json",
        designName: "Design",
        systemId,
      },
      manifest,
    );

    expect(result.report.changed).toHaveLength(0);
    expect(result.report.skipped).toHaveLength(1);
    expect(result.report.skipped[0]).toMatchObject({
      instanceId: "current-instance",
      reason: "hash-mismatch",
    });
    expect(
      result.design.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("2");

    const staleDesign = designWithAttachedComponent(
      systemId,
      FIXTURE_COMPONENT_ID,
      "1",
      "stale-instance",
      {
        templateHash: v1.templateHash,
        variantSchemaHash: v1.variantSchemaHash,
      },
    );
    const staleResult = bulkMigrateDesignSystemComponentInstances(
      staleDesign,
      {
        designFileId: "design-2",
        designFile: "design-2.json",
        designName: "Design 2",
        systemId,
      },
      manifest,
      { dryRun: true },
    );

    expect(staleResult.report.changed).toHaveLength(1);
    expect(staleResult.report.applied).toBe(false);
    expect(
      staleResult.design.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("1");
  });

  it("bulk migrates stale instances across project designs and persists atomically per design file", async () => {
    const record = createPublishedV1V2Record();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const v1 = record.published!.versions["1"];

    await writeDesign(
      "00000000-0000-4000-8000-000000000001",
      designWithAttachedComponent(
        systemId,
        FIXTURE_COMPONENT_ID,
        "1",
        "instance-a",
        {
          templateHash: v1.templateHash,
          variantSchemaHash: v1.variantSchemaHash,
        },
      ),
    );
    await writeDesign(
      "00000000-0000-4000-8000-000000000002",
      designWithAttachedComponent(
        systemId,
        FIXTURE_COMPONENT_ID,
        "1",
        "instance-b",
        {
          templateHash: v1.templateHash,
          variantSchemaHash: v1.variantSchemaHash,
        },
      ),
    );

    const report = await bulkMigrateProjectSystemComponentInstances(
      tempProjectRoot,
      {
        systemHandle: systemId,
        componentId: FIXTURE_COMPONENT_ID,
      },
    );

    expect(report.changedCount).toBe(2);
    expect(report.designs).toHaveLength(2);
    expect(report.failures).toHaveLength(0);
    expect(report.reviewRequired).toHaveLength(0);
    expect(report.changed.map((entry) => entry.instanceId).sort()).toEqual([
      "instance-a",
      "instance-b",
    ]);

    const designA = JSON.parse(
      await readFile(
        path.join(
          tempProjectRoot,
          ".trickroom",
          "designs",
          "00000000-0000-4000-8000-000000000001.json",
        ),
        "utf8",
      ),
    ) as TrickroomDesign;
    const designB = JSON.parse(
      await readFile(
        path.join(
          tempProjectRoot,
          ".trickroom",
          "designs",
          "00000000-0000-4000-8000-000000000002.json",
        ),
        "utf8",
      ),
    ) as TrickroomDesign;

    expect(
      designA.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("2");
    expect(
      designB.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("2");
  });

  it("automatic migration skips stale instances when system auto migration is off", async () => {
    const record = createPublishedV1V2Record();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const v1 = record.published!.versions["1"];
    const designUuid = "00000000-0000-4000-8000-000000000030";

    await writeDesign(designUuid, {
      ...designWithAttachedComponent(
        systemId,
        FIXTURE_COMPONENT_ID,
        "1",
        "system-off-instance",
        {
          templateHash: v1.templateHash,
          variantSchemaHash: v1.variantSchemaHash,
        },
      ),
      componentMigrationPolicy: "auto",
    });

    const report = await bulkMigrateProjectSystemComponentInstances(
      tempProjectRoot,
      {
        systemHandle: systemId,
        componentId: FIXTURE_COMPONENT_ID,
        designFileId: designUuid,
        automatic: true,
      },
    );

    expect(report.changedCount).toBe(0);
    expect(report.skipped).toEqual([
      expect.objectContaining({
        instanceId: "system-off-instance",
        reason: "policy-manual",
        message: expect.stringContaining(
          "autoMigrateComponents setting is off",
        ),
      }),
    ]);

    const design = JSON.parse(
      await readFile(
        path.join(
          tempProjectRoot,
          ".trickroom",
          "designs",
          `${designUuid}.json`,
        ),
        "utf8",
      ),
    ) as TrickroomDesign;
    expect(
      design.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("1");
  });

  it("policy-blocked automatic migration still reports review-only instance statuses", async () => {
    const record = createPublishedV1V2Record();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const v1 = record.published!.versions["1"];
    const designUuid = "00000000-0000-4000-8000-000000000031";

    await writeDesign(designUuid, {
      ...designWithAttachedComponent(
        systemId,
        FIXTURE_COMPONENT_ID,
        "1",
        "hash-mismatch-instance",
        {
          templateHash: "sha256:wrong-template",
          variantSchemaHash: v1.variantSchemaHash,
        },
      ),
      componentMigrationPolicy: "manual",
    });

    const report = await bulkMigrateProjectSystemComponentInstances(
      tempProjectRoot,
      {
        systemHandle: systemId,
        componentId: FIXTURE_COMPONENT_ID,
        designFileId: designUuid,
        automatic: true,
      },
    );

    expect(report.changedCount).toBe(0);
    expect(report.skipped).toEqual([
      expect.objectContaining({
        instanceId: "hash-mismatch-instance",
        reason: "hash-mismatch",
      }),
    ]);
  });

  it("automatic migration applies inherited safe updates and leaves unsafe changes reviewable", async () => {
    const safeRecord = createPublishedV1V2Record();
    const reviewRecord: SystemComponentRecord = {
      ...createPublishedV1V2Record(),
      componentId: "cmp_00000000-0000-4000-8000-000000000475",
      published: {
        currentVersion: "2",
        versions: {
          "1": createPublishedV1V2Record().published!.versions["1"],
          "2": {
            ...createPublishedV1V2Record().published!.versions["2"],
            slots: {},
          },
        },
      },
    };
    const systemId = await setupCoreSystem(
      {
        [FIXTURE_COMPONENT_ID]: safeRecord,
        [reviewRecord.componentId]: reviewRecord,
      },
      { autoMigrateComponents: true },
    );
    const safeV1 = safeRecord.published!.versions["1"];
    const reviewV1 = reviewRecord.published!.versions["1"];
    const safeDesignUuid = "00000000-0000-4000-8000-000000000031";
    const reviewDesignUuid = "00000000-0000-4000-8000-000000000032";

    await writeDesign(
      safeDesignUuid,
      designWithAttachedComponent(
        systemId,
        FIXTURE_COMPONENT_ID,
        "1",
        "safe-auto-instance",
        {
          templateHash: safeV1.templateHash,
          variantSchemaHash: safeV1.variantSchemaHash,
        },
      ),
    );
    await writeDesign(
      reviewDesignUuid,
      designWithAttachedComponent(
        systemId,
        reviewRecord.componentId,
        "1",
        "unsafe-auto-instance",
        {
          templateHash: reviewV1.templateHash,
          variantSchemaHash: reviewV1.variantSchemaHash,
        },
      ),
    );

    const report = await bulkMigrateProjectSystemComponentInstances(
      tempProjectRoot,
      {
        systemHandle: systemId,
        automatic: true,
        onlySafe: false,
      },
    );

    expect(report.changed).toEqual([
      expect.objectContaining({
        instanceId: "safe-auto-instance",
        fromVersion: "1",
        toVersion: "2",
      }),
    ]);
    expect(report.reviewRequired).toEqual([
      expect.objectContaining({
        instanceId: "unsafe-auto-instance",
        componentId: reviewRecord.componentId,
      }),
    ]);

    const reviewDesign = JSON.parse(
      await readFile(
        path.join(
          tempProjectRoot,
          ".trickroom",
          "designs",
          `${reviewDesignUuid}.json`,
        ),
        "utf8",
      ),
    ) as TrickroomDesign;
    expect(
      reviewDesign.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("1");
  });

  it("scopes component-level bulk migration to one design file when requested", async () => {
    const record = createPublishedV1V2Record();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const v1 = record.published!.versions["1"];

    await writeDesign(
      "00000000-0000-4000-8000-000000000010",
      designWithAttachedComponent(
        systemId,
        FIXTURE_COMPONENT_ID,
        "1",
        "scoped-instance",
        {
          templateHash: v1.templateHash,
          variantSchemaHash: v1.variantSchemaHash,
        },
      ),
    );
    await writeDesign(
      "00000000-0000-4000-8000-000000000011",
      designWithAttachedComponent(
        systemId,
        FIXTURE_COMPONENT_ID,
        "1",
        "other-instance",
        {
          templateHash: v1.templateHash,
          variantSchemaHash: v1.variantSchemaHash,
        },
      ),
    );

    const report = await bulkMigrateProjectSystemComponentInstances(
      tempProjectRoot,
      {
        systemHandle: systemId,
        componentId: FIXTURE_COMPONENT_ID,
        designFileId: "00000000-0000-4000-8000-000000000010",
      },
    );

    expect(report.changedCount).toBe(1);
    expect(report.changed[0]?.instanceId).toBe("scoped-instance");

    const scopedDesign = JSON.parse(
      await readFile(
        path.join(
          tempProjectRoot,
          ".trickroom",
          "designs",
          "00000000-0000-4000-8000-000000000010.json",
        ),
        "utf8",
      ),
    ) as TrickroomDesign;
    const otherDesign = JSON.parse(
      await readFile(
        path.join(
          tempProjectRoot,
          ".trickroom",
          "designs",
          "00000000-0000-4000-8000-000000000011.json",
        ),
        "utf8",
      ),
    ) as TrickroomDesign;

    expect(
      scopedDesign.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("2");
    expect(
      otherDesign.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("1");
  });

  it("does not list every design summary when bulk migration is scoped to one design file", async () => {
    const record = createPublishedV1V2Record();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const v1 = record.published!.versions["1"];
    const allowedUuid = "00000000-0000-4000-8000-000000000040";
    const disallowedUuid = "00000000-0000-4000-8000-000000000041";

    await writeDesign(
      allowedUuid,
      designWithAttachedComponent(
        systemId,
        FIXTURE_COMPONENT_ID,
        "1",
        "allowed-instance",
        {
          templateHash: v1.templateHash,
          variantSchemaHash: v1.variantSchemaHash,
        },
      ),
    );
    await mkdir(path.join(tempProjectRoot, ".trickroom", "designs"), {
      recursive: true,
    });
    await writeFile(
      path.join(
        tempProjectRoot,
        ".trickroom",
        "designs",
        `${disallowedUuid}.json`,
      ),
      "{ this is not valid trickroom design json",
      "utf8",
    );

    const service = designFileServiceModule.createDesignFileService(
      tempProjectRoot,
    );
    const listSpy = vi.spyOn(service, "listDesignSummaries");
    vi.spyOn(designFileServiceModule, "createDesignFileService").mockReturnValue(
      service,
    );

    const report = await bulkMigrateProjectSystemComponentInstances(
      tempProjectRoot,
      {
        systemHandle: systemId,
        componentId: FIXTURE_COMPONENT_ID,
        designFileId: allowedUuid,
      },
    );

    expect(listSpy).not.toHaveBeenCalled();
    expect(report.scannedDesignCount).toBe(1);
    expect(report.changedCount).toBe(1);
    expect(
      report.failures.some((entry) => entry.designFileId === disallowedUuid),
    ).toBe(false);
    expect(
      report.designs.some((entry) => entry.designFileId === disallowedUuid),
    ).toBe(false);
  });

  it("reports component-not-allowed when migrated target subtrees introduce unmarked disallowed components", async () => {
    const record = createPublishedRecordWithDefaultSlotFallback();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const manifest = createFixtureManifest({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const v1 = record.published!.versions["1"];
    const design = designWithAttachedComponent(
      systemId,
      FIXTURE_COMPONENT_ID,
      "1",
      "default-slot-instance",
      {
        templateHash: v1.templateHash,
        variantSchemaHash: v1.variantSchemaHash,
      },
    );

    const result = bulkMigrateDesignSystemComponentInstances(
      design,
      {
        designFileId: "design-policy-target",
        designFile: "design-policy-target.json",
        designName: "Policy Target",
        systemId,
      },
      manifest,
      {
        assertInstanceSubtreeAllowed: (nextDesign, elementId) => {
          assertCanUseSystemComponentInstanceSubtree(
            containerOnlyPolicy,
            nextDesign,
            elementId,
          );
        },
      },
    );

    expect(result.report.changed).toHaveLength(0);
    expect(result.report.reviewRequired).toHaveLength(0);
    expect(result.report.skipped).toEqual([
      expect.objectContaining({
        instanceId: "default-slot-instance",
        reason: "component-not-allowed",
      }),
    ]);
    expect(
      result.design.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("1");
  });

  it("prefers component-not-allowed over review-required when post-migration policy blocks the subtree", async () => {
    const record = createPublishedRecordWithDefaultSlotFallback();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const manifest = createFixtureManifest({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const v1 = record.published!.versions["1"];
    const design = designWithAttachedComponent(
      systemId,
      FIXTURE_COMPONENT_ID,
      "1",
      "review-policy-instance",
      {
        templateHash: v1.templateHash,
        variantSchemaHash: v1.variantSchemaHash,
      },
    );
    const attachedRoot = design.boards[0]?.children?.[0];
    if (attachedRoot) {
      attachedRoot.props = {
        ...attachedRoot.props,
        ...getSystemComponentMarkerProps({
          systemId,
          componentId: FIXTURE_COMPONENT_ID,
          instanceId: "review-policy-instance",
          version: "1",
          path: "root",
          isRoot: true,
          templateHash: v1.templateHash,
          variantSchemaHash: v1.variantSchemaHash,
          variantValues: { tone: "neutral" },
        }),
      };
    }

    const result = bulkMigrateDesignSystemComponentInstances(
      design,
      {
        designFileId: "design-review-policy",
        designFile: "design-review-policy.json",
        designName: "Review Policy",
        systemId,
      },
      manifest,
      {
        assertInstanceSubtreeAllowed: (nextDesign, elementId) => {
          assertCanUseSystemComponentInstanceSubtree(
            containerOnlyPolicy,
            nextDesign,
            elementId,
          );
        },
      },
    );

    expect(result.report.changed).toHaveLength(0);
    expect(result.report.reviewRequired).toHaveLength(0);
    expect(result.report.skipped).toEqual([
      expect.objectContaining({
        instanceId: "review-policy-instance",
        reason: "component-not-allowed",
      }),
    ]);
  });

  it("skips instances whose subtree violates assertInstanceSubtreeAllowed", async () => {
    const record = createPublishedV1V2Record();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const v1 = record.published!.versions["1"];
    const designUuid = "00000000-0000-4000-8000-000000000042";

    await writeDesign(
      designUuid,
      designWithAttachedComponent(
        systemId,
        FIXTURE_COMPONENT_ID,
        "1",
        "policy-blocked-instance",
        {
          templateHash: v1.templateHash,
          variantSchemaHash: v1.variantSchemaHash,
        },
      ),
    );

    const report = await bulkMigrateProjectSystemComponentInstances(
      tempProjectRoot,
      {
        systemHandle: systemId,
        componentId: FIXTURE_COMPONENT_ID,
        designFileId: designUuid,
        assertInstanceSubtreeAllowed: () => {
          throw new Error(
            'MCP access to component "trickroom/container" is not allowed by project policy.',
          );
        },
      },
    );

    expect(report.changedCount).toBe(0);
    expect(report.skipped).toEqual([
      expect.objectContaining({
        instanceId: "policy-blocked-instance",
        reason: "component-not-allowed",
      }),
    ]);

    const design = JSON.parse(
      await readFile(
        path.join(
          tempProjectRoot,
          ".trickroom",
          "designs",
          `${designUuid}.json`,
        ),
        "utf8",
      ),
    ) as TrickroomDesign;
    expect(
      design.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("1");
  });

  it("surfaces scan design read diagnostics when no instances are migrated", async () => {
    const record = createPublishedV1V2Record();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });

    await mkdir(path.join(tempProjectRoot, ".trickroom", "designs"), {
      recursive: true,
    });
    await writeFile(
      path.join(
        tempProjectRoot,
        ".trickroom",
        "designs",
        "00000000-0000-4000-8000-000000000099.json",
      ),
      "{ not-a-design",
      "utf8",
    );

    const report = await bulkMigrateProjectSystemComponentInstances(
      tempProjectRoot,
      {
        systemHandle: systemId,
        componentId: FIXTURE_COMPONENT_ID,
        designFileId: "00000000-0000-4000-8000-000000000099",
      },
    );

    expect(report.changedCount).toBe(0);
    expect(report.failureCount).toBeGreaterThan(0);
    expect(report.failures).toEqual([
      expect.objectContaining({
        code: "DESIGN_READ_FAILED",
        designFileId: "00000000-0000-4000-8000-000000000099",
      }),
    ]);
    expect(report.designs).toEqual([
      expect.objectContaining({
        designFileId: "00000000-0000-4000-8000-000000000099",
        failures: [
          expect.objectContaining({
            code: "DESIGN_READ_FAILED",
          }),
        ],
      }),
    ]);
  });

  it("reports the read revision used for persist, not a stale summary revision", async () => {
    const record = createPublishedV1V2Record();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const v1 = record.published!.versions["1"];
    const designUuid = "00000000-0000-4000-8000-000000000020";

    await writeDesign(
      designUuid,
      designWithAttachedComponent(
        systemId,
        FIXTURE_COMPONENT_ID,
        "1",
        "persist-revision-instance",
        {
          templateHash: v1.templateHash,
          variantSchemaHash: v1.variantSchemaHash,
        },
      ),
    );

    const service = createDesignFileService(tempProjectRoot);
    const designPath = path.join(
      tempProjectRoot,
      ".trickroom",
      "designs",
      `${designUuid}.json`,
    );
    const staleSummaries = await service.listDesignSummaries();
    const staleSummary = staleSummaries.find(
      (entry) => entry.uuid === designUuid,
    );
    expect(staleSummary).toBeDefined();

    const raw = JSON.parse(
      await readFile(designPath, "utf8"),
    ) as TrickroomDesign & { revisionBump?: string };
    raw.revisionBump = "between-list-and-read";
    await writeFile(designPath, JSON.stringify(raw), "utf8");

    const readAfterBump = await service.readDesignFile(`${designUuid}.json`);
    expect(readAfterBump.revision).not.toBe(staleSummary!.revision);

    vi.spyOn(
      designFileServiceModule,
      "createDesignFileService",
    ).mockReturnValue(service);
    vi.spyOn(service, "listDesignSummaries").mockResolvedValue(staleSummaries);

    const report = await bulkMigrateProjectSystemComponentInstances(
      tempProjectRoot,
      {
        systemHandle: systemId,
        componentId: FIXTURE_COMPONENT_ID,
        designFileId: designUuid,
      },
    );

    const designReport = report.designs.find(
      (entry) => entry.designFileId === designUuid,
    );
    expect(designReport?.persisted).toBe(true);
    expect(designReport?.revision).toBe(readAfterBump.revision);
    expect(designReport?.revision).not.toBe(staleSummary!.revision);

    const readAfterPersist = await createDesignFileService(
      tempProjectRoot,
    ).readDesignFile(`${designUuid}.json`);
    expect(designReport?.nextRevision).toBe(readAfterPersist.revision);
    expect(designReport?.revision).not.toBe(designReport?.nextRevision);
  });

  it("reports the read revision used as the write guard when persist fails", async () => {
    const record = createPublishedV1V2Record();
    const systemId = await setupCoreSystem({
      [FIXTURE_COMPONENT_ID]: record,
    });
    const v1 = record.published!.versions["1"];
    const designUuid = "00000000-0000-4000-8000-000000000021";

    await writeDesign(
      designUuid,
      designWithAttachedComponent(
        systemId,
        FIXTURE_COMPONENT_ID,
        "1",
        "persist-failure-instance",
        {
          templateHash: v1.templateHash,
          variantSchemaHash: v1.variantSchemaHash,
        },
      ),
    );

    const service = createDesignFileService(tempProjectRoot);
    const readBeforeMigrate = await service.readDesignFile(
      `${designUuid}.json`,
    );

    vi.spyOn(
      designFileServiceModule,
      "createDesignFileService",
    ).mockReturnValue(service);
    vi.spyOn(service, "writeDesignFile").mockRejectedValue(
      new DesignFileServiceError(
        "REVISION_MISMATCH",
        "Design file revision does not match the expected revision",
      ),
    );

    const report = await bulkMigrateProjectSystemComponentInstances(
      tempProjectRoot,
      {
        systemHandle: systemId,
        componentId: FIXTURE_COMPONENT_ID,
        designFileId: designUuid,
      },
    );

    const designReport = report.designs.find(
      (entry) => entry.designFileId === designUuid,
    );
    expect(designReport).toMatchObject({
      applied: false,
      persisted: false,
      revision: readBeforeMigrate.revision,
    });
    expect(designReport?.nextRevision).toBeUndefined();
    expect(report.changedCount).toBe(0);
    expect(report.failures).toEqual([
      expect.objectContaining({
        code: "REVISION_MISMATCH",
        instanceId: "persist-failure-instance",
        designFileId: designUuid,
      }),
    ]);

    const readAfterFailure = await createDesignFileService(
      tempProjectRoot,
    ).readDesignFile(`${designUuid}.json`);
    expect(
      readAfterFailure.design.boards[0]?.children?.[0]?.props?.[
        "data-trickroom-system-component-version"
      ],
    ).toBe("1");
  });
});
