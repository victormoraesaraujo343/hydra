import type {
  LocalizedList,
  LocalizedText,
  PortAsset,
  PortCatalogueEntry,
  PortChannel,
  PortGameFormat,
  PortGameRequirement,
  PortOs,
  PortPlatform,
  PortStatus,
} from "../../../types/ports.types.js";
import { isSafePreservationPath } from "./port-user-data.js";

export interface PortsCatalogueSkip {
  index: number;
  reason: string;
}

export interface PortsCatalogueValidation {
  ports: PortCatalogueEntry[];
  skipped: PortsCatalogueSkip[];
}

type EntryParse =
  | { ok: true; entry: PortCatalogueEntry }
  | { ok: false; reason: string };

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const PLATFORMS: readonly PortPlatform[] = [
  "ps4",
  "ps3",
  "ps2",
  "ps1",
  "psp",
  "xbox360",
  "xbox",
  "n64",
  "gamecube",
  "wii",
  "switch",
  "nes",
  "snes",
  "gb",
  "gbc",
  "gba",
  "ds",
  "3ds",
  "wiiu",
  "genesis",
  "saturn",
  "dreamcast",
  "arcade",
  "other",
];
const STATUSES: readonly PortStatus[] = ["playable", "partial", "experimental"];
const CHANNELS: readonly PortChannel[] = ["latest", "prerelease"];
const FORMATS: readonly PortGameFormat[] = ["folder", "iso", "folder-or-iso"];
const OSES: readonly PortOs[] = ["win32", "linux", "darwin"];
const SOURCE_AUTO = "auto";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOneOf = <T extends string>(
  allowed: readonly T[],
  value: unknown
): value is T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value);

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const httpsUrlOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.startsWith("https://") ? value : null;

const parseLocalizedText = (value: unknown): LocalizedText | null => {
  if (!isRecord(value) || typeof value.en !== "string") return null;
  const result: Record<string, string> = {};
  for (const [locale, text] of Object.entries(value)) {
    if (typeof text === "string") result[locale] = text;
  }
  return result as LocalizedText;
};

const parseLocalizedList = (value: unknown): LocalizedList | null => {
  if (!isRecord(value) || !Array.isArray(value.en)) return null;
  const result: Record<string, string[]> = {};
  for (const [locale, list] of Object.entries(value)) {
    if (Array.isArray(list)) result[locale] = stringArray(list);
  }
  return result as LocalizedList;
};

const isSafeExecutable = (executable: string): boolean =>
  executable.length > 0 &&
  !executable.startsWith("/") &&
  !executable.startsWith("\\") &&
  !/^[A-Za-z]:/.test(executable) &&
  !executable.split(/[\\/]/).includes("..");

const compilesAsRegExp = (pattern: string): boolean => {
  try {
    return new RegExp(pattern, "i") !== null;
  } catch {
    return false;
  }
};

const parseAsset = (value: unknown): PortAsset | null => {
  if (!isRecord(value)) return null;
  const { pattern, executable } = value;
  const preservePaths = value.preservePaths;
  if (
    preservePaths !== undefined &&
    (!Array.isArray(preservePaths) ||
      preservePaths.length > 32 ||
      !preservePaths.every(
        (entry: unknown) =>
          typeof entry === "string" && isSafePreservationPath(entry)
      ))
  )
    return null;
  const preservation =
    preservePaths === undefined
      ? {}
      : { preservePaths: preservePaths as string[] };
  if (typeof pattern !== "string" || pattern.length === 0) return null;
  if (!compilesAsRegExp(pattern)) return null;

  // A missing or null executable means "detect it after extraction".
  if (executable === undefined || executable === null) {
    return { pattern, executable: null, ...preservation };
  }
  if (typeof executable !== "string" || !isSafeExecutable(executable)) {
    return null;
  }
  return { pattern, executable, ...preservation };
};

const parseAssets = (value: unknown): Partial<Record<PortOs, PortAsset>> => {
  const assets: Partial<Record<PortOs, PortAsset>> = {};
  if (!isRecord(value)) return assets;
  for (const os of OSES) {
    const asset = parseAsset(value[os]);
    if (asset) assets[os] = asset;
  }
  return assets;
};

const parseGame = (value: unknown): PortGameRequirement | null => {
  if (!isRecord(value)) return null;
  return {
    format: isOneOf(FORMATS, value.format) ? value.format : "folder",
    requiredFiles: stringArray(value.requiredFiles).filter(
      (file) => file.length > 0 && !file.includes("..")
    ),
    titleIds: stringArray(value.titleIds),
    notes: parseLocalizedText(value.notes),
  };
};

const parseStats = (value: unknown): PortCatalogueEntry["stats"] => {
  if (
    !isRecord(value) ||
    typeof value.stars !== "number" ||
    !Number.isFinite(value.stars) ||
    value.stars < 0 ||
    typeof value.pushedAt !== "string"
  ) {
    return null;
  }
  return { stars: value.stars, pushedAt: value.pushedAt };
};

const parseEntry = (raw: unknown): EntryParse => {
  if (!isRecord(raw)) return { ok: false, reason: "invalid_entry" };

  const { id, title, repo } = raw;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    return { ok: false, reason: "invalid_id" };
  }
  if (typeof title !== "string" || title.trim().length === 0) {
    return { ok: false, reason: "invalid_title" };
  }
  if (typeof repo !== "string" || !REPO_PATTERN.test(repo)) {
    return { ok: false, reason: "invalid_repo" };
  }

  const description = parseLocalizedText(raw.description);
  if (!description) return { ok: false, reason: "missing_description" };

  const assets = parseAssets(raw.assets);
  if (Object.keys(assets).length === 0) {
    return { ok: false, reason: "no_assets" };
  }

  const game = parseGame(raw.game);
  if (!game) return { ok: false, reason: "missing_game" };

  return {
    ok: true,
    entry: {
      id,
      title,
      platform: isOneOf(PLATFORMS, raw.platform) ? raw.platform : "other",
      repo,
      authors: stringArray(raw.authors),
      description,
      coverImageUrl: httpsUrlOrNull(raw.coverImageUrl),
      heroImageUrl: httpsUrlOrNull(raw.heroImageUrl),
      status: isOneOf(STATUSES, raw.status) ? raw.status : "experimental",
      tested: typeof raw.tested === "boolean" ? raw.tested : false,
      channel: isOneOf(CHANNELS, raw.channel) ? raw.channel : "latest",
      source: raw.source === SOURCE_AUTO ? "auto" : "curated",
      assets,
      game,
      requirements: parseLocalizedList(raw.requirements),
      setupHint: parseLocalizedText(raw.setupHint),
      stats: parseStats(raw.stats),
    },
  };
};

/**
 * Validates an untrusted catalogue payload entry by entry. An invalid entry is
 * reported in `skipped` and never stops the rest of the catalogue from loading.
 */
export const validatePortsCatalogue = (
  raw: unknown
): PortsCatalogueValidation => {
  if (!isRecord(raw) || !Array.isArray(raw.ports)) {
    return { ports: [], skipped: [{ index: -1, reason: "invalid_root" }] };
  }

  const items: unknown[] = raw.ports;
  const ports: PortCatalogueEntry[] = [];
  const skipped: PortsCatalogueSkip[] = [];
  const seenIds = new Set<string>();

  items.forEach((item, index) => {
    const parsed = parseEntry(item);
    if (!parsed.ok) {
      skipped.push({ index, reason: parsed.reason });
      return;
    }
    if (seenIds.has(parsed.entry.id)) {
      skipped.push({ index, reason: "duplicate_id" });
      return;
    }
    seenIds.add(parsed.entry.id);
    ports.push(parsed.entry);
  });

  return { ports, skipped };
};
