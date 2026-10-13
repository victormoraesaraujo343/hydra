import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parsePortRelease,
  parseSha256File,
  pickPortAsset,
  pickRelease,
  type GithubRelease,
  type GithubReleaseAsset,
} from "./port-release-parse.js";
import type { PortAsset, PortOs } from "../../../types/ports.types.js";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);

const downloadUrl = (name: string) =>
  `https://github.com/example/port/releases/download/v1.0.0/${name}`;

const asset = (
  name: string,
  extra: Partial<GithubReleaseAsset> = {}
): GithubReleaseAsset => ({
  name,
  browser_download_url: downloadUrl(name),
  ...extra,
});

const release = (overrides: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: "v1.0.0",
  html_url: "https://github.com/example/port/releases/tag/v1.0.0",
  prerelease: false,
  draft: false,
  assets: [],
  ...overrides,
});

const linuxAsset: PortAsset = {
  pattern: "linux\\.tar\\.gz$",
  executable: "port-linux",
};

const winAsset: PortAsset = {
  pattern: "win64\\.zip$",
  executable: "port.exe",
};

describe("pickPortAsset", () => {
  it("returns the exact OS entry when present", () => {
    const assets: Partial<Record<PortOs, PortAsset>> = {
      linux: linuxAsset,
      win32: winAsset,
    };
    assert.equal(pickPortAsset(assets, "linux"), linuxAsset);
    assert.equal(pickPortAsset(assets, "win32"), winAsset);
  });

  it("falls back from linux to the win32 entry", () => {
    assert.equal(pickPortAsset({ win32: winAsset }, "linux"), winAsset);
  });

  it("returns null on darwin when only win32 is declared", () => {
    assert.equal(pickPortAsset({ win32: winAsset }, "darwin"), null);
  });

  it("returns null when nothing matches the platform", () => {
    assert.equal(pickPortAsset({}, "linux"), null);
    assert.equal(pickPortAsset({ darwin: linuxAsset }, "linux"), null);
  });
});

describe("parsePortRelease", () => {
  it("uses the digest and ignores the sidecar when a digest exists", () => {
    const parsed = parsePortRelease(
      release({
        assets: [
          asset("port-linux.tar.gz.sha256"),
          asset("port-linux.tar.gz", { digest: `sha256:${HEX_A}` }),
          asset("port-linux.tar.gz.sha256", {
            browser_download_url: downloadUrl("sidecar.sha256"),
          }),
        ],
      }),
      linuxAsset
    );
    assert.ok(parsed);
    assert.equal(parsed.sha256, HEX_A);
    assert.equal(parsed.sha256Url, null);
    assert.equal(parsed.fileName, "port-linux.tar.gz");
  });

  it("uses the .sha256 sidecar URL when no digest is provided", () => {
    const sidecarUrl = downloadUrl("port-linux.tar.gz.sha256");
    const parsed = parsePortRelease(
      release({
        assets: [
          asset("port-linux.tar.gz", { digest: null }),
          asset("port-linux.tar.gz.sha256", {
            browser_download_url: sidecarUrl,
          }),
        ],
      }),
      linuxAsset
    );
    assert.ok(parsed);
    assert.equal(parsed.sha256, null);
    assert.equal(parsed.sha256Url, sidecarUrl);
  });

  it("never picks a .sha256 asset as the main download", () => {
    const parsed = parsePortRelease(
      release({
        assets: [
          asset("port-linux.tar.gz.sha256"),
          asset("port-linux.tar.gz", { digest: `sha256:${HEX_B}` }),
        ],
      }),
      linuxAsset
    );
    assert.ok(parsed);
    assert.equal(parsed.fileName, "port-linux.tar.gz");
    assert.equal(parsed.downloadUrl, downloadUrl("port-linux.tar.gz"));
  });

  it("returns null when no asset matches the pattern", () => {
    assert.equal(
      parsePortRelease(
        release({ assets: [asset("port-win64.zip", { digest: null })] }),
        linuxAsset
      ),
      null
    );
  });

  it("reads size from the asset or returns null", () => {
    const withSize = parsePortRelease(
      release({ assets: [asset("port-linux.tar.gz", { size: 1234 })] }),
      linuxAsset
    );
    const withoutSize = parsePortRelease(
      release({ assets: [asset("port-linux.tar.gz")] }),
      linuxAsset
    );
    assert.equal(withSize?.size, 1234);
    assert.equal(withoutSize?.size, null);
  });

  it("carries the tag and release page URL", () => {
    const parsed = parsePortRelease(
      release({
        tag_name: "v2.3.0",
        html_url: "https://github.com/example/port/releases/tag/v2.3.0",
        assets: [asset("port-linux.tar.gz", { digest: `sha256:${HEX_A}` })],
      }),
      linuxAsset
    );
    assert.ok(parsed);
    assert.equal(parsed.tag, "v2.3.0");
    assert.equal(
      parsed.htmlUrl,
      "https://github.com/example/port/releases/tag/v2.3.0"
    );
  });
});

describe("pickRelease", () => {
  it("skips drafts", () => {
    const stable = release({ tag_name: "v1.0.0" });
    const picked = pickRelease(
      [release({ tag_name: "v1.1.0", draft: true }), stable],
      "latest"
    );
    assert.equal(picked, stable);
  });

  it("latest channel ignores prereleases", () => {
    const stable = release({ tag_name: "v1.0.0" });
    const picked = pickRelease(
      [release({ tag_name: "v1.1.0-rc1", prerelease: true }), stable],
      "latest"
    );
    assert.equal(picked, stable);
  });

  it("prerelease channel prefers the first prerelease", () => {
    const rc = release({ tag_name: "v1.1.0-rc1", prerelease: true });
    const picked = pickRelease(
      [release({ tag_name: "v1.0.0" }), rc],
      "prerelease"
    );
    assert.equal(picked, rc);
  });

  it("prerelease channel falls back to the stable release", () => {
    const stable = release({ tag_name: "v1.0.0" });
    assert.equal(pickRelease([stable], "prerelease"), stable);
  });

  it("returns null when there is no usable release", () => {
    assert.equal(pickRelease([], "latest"), null);
    assert.equal(pickRelease([release({ draft: true })], "prerelease"), null);
  });
});

describe("parseSha256File", () => {
  it("returns the first 64-hex token lowercased", () => {
    const hex = "ABCDEF0123456789".repeat(4);
    assert.equal(
      parseSha256File(`${hex}  port-linux.tar.gz\n`),
      hex.toLowerCase()
    );
  });

  it("returns null when there is no 64-hex token", () => {
    assert.equal(parseSha256File(""), null);
    assert.equal(parseSha256File("not a checksum"), null);
    assert.equal(parseSha256File("a".repeat(63)), null);
  });

  it("ignores hex runs longer than 64 characters", () => {
    assert.equal(parseSha256File("c".repeat(65)), null);
  });
});
