export type PortPlatform =
  | "ps4"
  | "ps3"
  | "ps2"
  | "ps1"
  | "psp"
  | "xbox360"
  | "xbox"
  | "n64"
  | "gamecube"
  | "wii"
  | "switch"
  | "nes"
  | "snes"
  | "gb"
  | "gbc"
  | "gba"
  | "ds"
  | "3ds"
  | "wiiu"
  | "genesis"
  | "saturn"
  | "dreamcast"
  | "arcade"
  | "other";

export type PortStatus = "playable" | "partial" | "experimental";
export type PortChannel = "latest" | "prerelease";
export type PortGameFormat = "folder" | "iso" | "folder-or-iso";
export type PortOs = "win32" | "linux" | "darwin";

/** Map of locale -> text. "en" is always present after validation. */
export type LocalizedText = { en: string } & Record<string, string>;
export type LocalizedList = { en: string[] } & Record<string, string[]>;

export interface PortAsset {
  /** User data paths relative to the executable directory, preserved on update. */
  preservePaths?: string[];
  /** RegExp source matched against the release asset name (case-insensitive). */
  pattern: string;
  /**
   * Path relative to the extracted folder (or the bare asset file name).
   * null means the installer detects the executable from the extracted files.
   */
  executable: string | null;
}

export interface PortGameRequirement {
  format: PortGameFormat;
  requiredFiles: string[];
  titleIds: string[];
  notes: LocalizedText | null;
}

export interface PortCatalogueEntry {
  id: string;
  title: string;
  platform: PortPlatform;
  repo: string;
  authors: string[];
  description: LocalizedText;
  coverImageUrl: string | null;
  heroImageUrl: string | null;
  status: PortStatus;
  tested: boolean;
  channel: PortChannel;
  /** "auto" entries are imported from an external list; missing means "curated". */
  source: "curated" | "auto";
  assets: Partial<Record<PortOs, PortAsset>>;
  game: PortGameRequirement;
  requirements: LocalizedList | null;
  setupHint: LocalizedText | null;
  stats: { stars: number; pushedAt: string } | null;
}

export interface PortsCatalogue {
  sourceUrl: string;
  fetchedAt: string;
  ports: PortCatalogueEntry[];
}

export interface PortRelease {
  tag: string;
  htmlUrl: string;
  downloadUrl: string;
  fileName: string;
  size: number | null;
  /** Lowercase hex sha256 from the asset digest, if GitHub provided one. */
  sha256: string | null;
  /** URL of a "<asset>.sha256" sidecar, used only when sha256 is null. */
  sha256Url: string | null;
}

/** Cover and hero art for a port, from the catalogue or SteamGridDB. */
export interface PortCovers {
  cover: string | null;
  hero: string | null;
}

/** One row of the covers cache, keyed by port id. */
export interface PortCoversCacheEntry extends PortCovers {
  checkedAt: string;
}

export interface InstalledPort {
  portId: string;
  version: string;
  installPath: string;
  executablePath: string;
  gameObjectId: string;
  installedAt: string;
}

export type PortErrorCode =
  | "catalogue_unavailable"
  | "no_covers_key"
  | "invalid_covers_key"
  | "port_not_found"
  | "no_asset_for_platform"
  | "release_unavailable"
  | "download_failed"
  | "checksum_mismatch"
  | "extract_failed"
  | "executable_not_found"
  | "not_installed"
  | "already_installing";

export type PortResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: PortErrorCode };

export interface PortInstallProgress {
  portId: string;
  phase:
    | "resolving"
    | "downloading"
    | "verifying"
    | "extracting"
    | "finalizing"
    | "done"
    | "error";
  loaded?: number;
  total?: number;
  error?: PortErrorCode;
}

export interface PortGameCheckResult {
  ok: boolean;
  /** Normalized title ID found (e.g. "CUSA-01623"), or null if none could be read. */
  titleId: string | null;
  missingFiles: string[];
  reason:
    | "ok"
    | "not_found"
    | "missing_files"
    | "wrong_title_id"
    | "wrong_format";
}
