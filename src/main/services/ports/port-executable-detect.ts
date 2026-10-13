import type { PortOs } from "../../../types/ports.types.js";
import { isRedistributablePath } from "../../helpers/game-executable-ranking.js";

export interface PortFileEntry {
  /** Path relative to the extracted folder, "/" separated. */
  relativePath: string;
  size: number;
  isExecutable: boolean;
  isDirectory: boolean;
}

const EXCLUDED_NAME_PATTERN =
  /(^|[^a-z])(unins\w*|uninstall\w*|setup|installer|vc_?redist|vcredist|dxsetup|dxwebsetup|crashpad\w*|crash_?handler|crashreport\w*|updater|update|helper|probe|test|tests|dedicated|server)([^a-z]|$)/i;
const UNIX_EXTENSIONS = new Set(["", ".x86_64", ".sh", ".bin"]);
const SHARED_OBJECT_PATTERN = /\.so(\.|$)/i;

const segmentsOf = (relativePath: string): string[] =>
  relativePath.split(/[\\/]+/).filter(Boolean);

const nameOf = (relativePath: string): string =>
  segmentsOf(relativePath).at(-1) ?? "";

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
};

const isInside = (child: string, parent: string): boolean => {
  const childSegments = segmentsOf(child);
  const parentSegments = segmentsOf(parent);
  if (childSegments.length <= parentSegments.length) return false;
  return parentSegments.every(
    (segment, index) => segment === childSegments[index]
  );
};

const isExcluded = (entry: PortFileEntry): boolean =>
  isRedistributablePath(entry.relativePath) ||
  EXCLUDED_NAME_PATTERN.test(nameOf(entry.relativePath));

const titleTokens = (title: string): string[] =>
  title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3);

const candidatesFor = (
  entries: PortFileEntry[],
  platform: NodeJS.Platform,
  assetOs: PortOs
): PortFileEntry[] => {
  if (assetOs === "darwin") {
    const bundles = entries.filter(
      (entry) =>
        entry.isDirectory && extensionOf(nameOf(entry.relativePath)) === ".app"
    );
    return bundles.filter(
      (bundle) =>
        !isExcluded(bundle) &&
        !bundles.some((other) =>
          isInside(bundle.relativePath, other.relativePath)
        )
    );
  }

  const files = entries.filter(
    (entry) => !entry.isDirectory && !isExcluded(entry)
  );

  if (assetOs === "win32") {
    return files.filter(
      (entry) => extensionOf(nameOf(entry.relativePath)) === ".exe"
    );
  }

  const appImages = files.filter(
    (entry) => extensionOf(nameOf(entry.relativePath)) === ".appimage"
  );
  if (appImages.length > 0) return appImages;

  // Windows has no execute bit to check, so there the extension decides.
  const hasExecuteBit = (entry: PortFileEntry) =>
    platform === "win32" || entry.isExecutable;

  return files.filter((entry) => {
    const name = nameOf(entry.relativePath);
    return (
      hasExecuteBit(entry) &&
      UNIX_EXTENSIONS.has(extensionOf(name)) &&
      !SHARED_OBJECT_PATTERN.test(name)
    );
  });
};

/**
 * Picks the most likely launch file from an extracted port folder. Pure: the
 * caller lists the folder. Returns the chosen relativePath, or null. The
 * candidate rules follow assetOs; platform only decides whether the execute
 * bit can be trusted (it cannot on Windows).
 *
 * Order: fewer path segments first, then name bonuses (title word +3,
 * "launcher"/"play" +2), then the larger file.
 */
export const detectPortExecutable = (
  entries: PortFileEntry[],
  platform: NodeJS.Platform,
  assetOs: PortOs,
  title: string
): string | null => {
  const tokens = titleTokens(title);
  const ranked = candidatesFor(entries, platform, assetOs).map((entry) => {
    const name = nameOf(entry.relativePath).toLowerCase();
    const bonus =
      (tokens.some((token) => name.includes(token)) ? 3 : 0) +
      (name.includes("launcher") || name.includes("play") ? 2 : 0);
    return {
      entry,
      depth: segmentsOf(entry.relativePath).length,
      bonus,
    };
  });

  ranked.sort(
    (a, b) =>
      a.depth - b.depth ||
      b.bonus - a.bonus ||
      b.entry.size - a.entry.size ||
      a.entry.relativePath.localeCompare(b.entry.relativePath)
  );

  return ranked[0]?.entry.relativePath ?? null;
};
