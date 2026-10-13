import type {
  PortAsset,
  PortChannel,
  PortOs,
  PortRelease,
} from "../../../types/ports.types.js";

export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
  digest?: string | null;
}

export interface GithubRelease {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  assets: GithubReleaseAsset[];
}

const SHA256_DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/i;
const SHA256_TOKEN_PATTERN = /(?<![0-9a-f])([0-9a-f]{64})(?![0-9a-f])/i;
const SHA256_SIDECAR_SUFFIX = ".sha256";

const isPortOs = (platform: string): platform is PortOs =>
  platform === "win32" || platform === "linux" || platform === "darwin";

export const pickPortAsset = (
  assets: Partial<Record<PortOs, PortAsset>>,
  platform: NodeJS.Platform
): PortAsset | null => {
  const exact = isPortOs(platform) ? assets[platform] : undefined;
  if (exact) return exact;
  if (platform === "linux") return assets.win32 ?? null;
  return null;
};

export const parsePortRelease = (
  release: GithubRelease,
  asset: PortAsset
): PortRelease | null => {
  let pattern: RegExp;
  try {
    pattern = new RegExp(asset.pattern, "i");
  } catch {
    return null;
  }

  const main = release.assets.find(
    (candidate) =>
      pattern.test(candidate.name) &&
      !candidate.name.toLowerCase().endsWith(SHA256_SIDECAR_SUFFIX)
  );
  if (!main) return null;

  const digestMatch =
    typeof main.digest === "string"
      ? SHA256_DIGEST_PATTERN.exec(main.digest)
      : null;
  const sha256 = digestMatch ? digestMatch[1].toLowerCase() : null;

  const sidecar = sha256
    ? undefined
    : release.assets.find(
        (candidate) => candidate.name === `${main.name}${SHA256_SIDECAR_SUFFIX}`
      );

  return {
    tag: release.tag_name,
    htmlUrl: release.html_url,
    downloadUrl: main.browser_download_url,
    fileName: main.name,
    size: typeof main.size === "number" ? main.size : null,
    sha256,
    sha256Url: sidecar?.browser_download_url ?? null,
  };
};

export const parseSha256File = (text: string): string | null => {
  const match = SHA256_TOKEN_PATTERN.exec(text);
  return match ? match[1].toLowerCase() : null;
};

export const pickRelease = (
  releases: GithubRelease[],
  channel: PortChannel
): GithubRelease | null => {
  const published = releases.filter((release) => !release.draft);
  const stable = published.find((release) => !release.prerelease) ?? null;

  if (channel === "prerelease") {
    return published.find((release) => release.prerelease) ?? stable;
  }

  return stable;
};
