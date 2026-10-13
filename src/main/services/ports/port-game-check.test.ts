import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { parseParamSfo } from "../emulators/param-sfo.js";
import type {
  PortGameCheckResult,
  PortGameRequirement,
} from "../../../types/ports.types.js";
import { checkPortGameFolder } from "./port-game-check.js";

// Minimal PARAM.SFO with one key TITLE_ID (utf8 string).
const buildSfo = (titleId: string): Buffer => {
  const key = Buffer.from("TITLE_ID\0");
  const value = Buffer.alloc(16);
  value.write(titleId, "utf8");
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46535000, 0); // "\0PSF"
  header.writeUInt32LE(0x00000101, 4);
  const keyTableStart = 20 + 16;
  header.writeUInt32LE(keyTableStart, 8);
  header.writeUInt32LE(keyTableStart + key.length, 12);
  header.writeUInt32LE(1, 16);
  const entry = Buffer.alloc(16);
  entry.writeUInt16LE(0, 0); // key offset
  entry.writeUInt16LE(0x0204, 2); // utf8 string
  entry.writeUInt32LE(titleId.length + 1, 4);
  entry.writeUInt32LE(16, 8);
  entry.writeUInt32LE(0, 12); // data offset
  return Buffer.concat([header, entry, key, value]);
};

const requirement = (
  overrides: Partial<PortGameRequirement> = {}
): PortGameRequirement => ({
  format: "folder",
  requiredFiles: ["eboot.bin"],
  titleIds: ["CUSA-01623"],
  notes: null,
  ...overrides,
});

const okResult = (titleId: string | null): PortGameCheckResult => ({
  ok: true,
  titleId,
  missingFiles: [],
  reason: "ok",
});

describe("port game folder check", () => {
  let root: string;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "port-check-"));
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const makeFolder = (name: string, files: Record<string, Buffer | string>) => {
    const folder = path.join(root, name);
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(folder, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    fs.mkdirSync(folder, { recursive: true });
    return folder;
  };

  it("builds an SFO that the real parseParamSfo reads", () => {
    assert.equal(parseParamSfo(buildSfo("CUSA01623")), "CUSA-01623");
  });

  it("accepts a folder with the required files and matching title ID", async () => {
    const folder = makeFolder("match", {
      "eboot.bin": "",
      "sce_sys/param.sfo": buildSfo("CUSA01623"),
    });
    assert.deepEqual(
      await checkPortGameFolder(requirement(), folder),
      okResult("CUSA-01623")
    );
  });

  it("rejects a folder with another region's title ID", async () => {
    const folder = makeFolder("wrong-id", {
      "eboot.bin": "",
      "sce_sys/param.sfo": buildSfo("CUSA99999"),
    });
    assert.deepEqual(await checkPortGameFolder(requirement(), folder), {
      ok: false,
      titleId: "CUSA-99999",
      missingFiles: [],
      reason: "wrong_title_id",
    });
  });

  it("lists the required files that are missing", async () => {
    const folder = makeFolder("missing-eboot", {
      "sce_sys/param.sfo": buildSfo("CUSA01623"),
    });
    assert.deepEqual(await checkPortGameFolder(requirement(), folder), {
      ok: false,
      titleId: "CUSA-01623",
      missingFiles: ["eboot.bin"],
      reason: "missing_files",
    });
  });

  it("reports a path that does not exist as not_found", async () => {
    assert.deepEqual(
      await checkPortGameFolder(requirement(), path.join(root, "nope")),
      { ok: false, titleId: null, missingFiles: [], reason: "not_found" }
    );
  });

  it("accepts an .iso file when the format allows ISOs, without a title check", async () => {
    const iso = path.join(root, "game.ISO");
    fs.writeFileSync(iso, "");
    assert.deepEqual(
      await checkPortGameFolder(requirement({ format: "folder-or-iso" }), iso),
      okResult(null)
    );
    assert.deepEqual(
      await checkPortGameFolder(requirement({ format: "iso" }), iso),
      okResult(null)
    );
  });

  it("rejects an .iso file when the format is folder only", async () => {
    const iso = path.join(root, "folder-only.iso");
    fs.writeFileSync(iso, "");
    assert.deepEqual(
      await checkPortGameFolder(requirement({ format: "folder" }), iso),
      { ok: false, titleId: null, missingFiles: [], reason: "wrong_format" }
    );
  });

  it("rejects a non-ISO file as wrong_format", async () => {
    const file = path.join(root, "game.bin");
    fs.writeFileSync(file, "");
    assert.deepEqual(
      await checkPortGameFolder(requirement({ format: "folder-or-iso" }), file),
      { ok: false, titleId: null, missingFiles: [], reason: "wrong_format" }
    );
  });

  it("rejects a folder when the port needs an ISO", async () => {
    const folder = makeFolder("iso-only", { "eboot.bin": "" });
    assert.deepEqual(
      await checkPortGameFolder(requirement({ format: "iso" }), folder),
      { ok: false, titleId: null, missingFiles: [], reason: "wrong_format" }
    );
  });

  it("accepts a folder without any SFO when the files are present", async () => {
    const folder = makeFolder("no-sfo", { "eboot.bin": "" });
    assert.deepEqual(
      await checkPortGameFolder(requirement(), folder),
      okResult(null)
    );
  });

  it("falls back to PS3_GAME/PARAM.SFO for the title ID", async () => {
    const folder = makeFolder("ps3-layout", {
      "eboot.bin": "",
      "PS3_GAME/PARAM.SFO": buildSfo("CUSA99999"),
    });
    assert.deepEqual(await checkPortGameFolder(requirement(), folder), {
      ok: false,
      titleId: "CUSA-99999",
      missingFiles: [],
      reason: "wrong_title_id",
    });
  });
});
