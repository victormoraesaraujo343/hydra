import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";

import type {
  InstalledPort,
  PortCatalogueEntry,
} from "../../../types/ports.types.js";
import {
  installPortCore,
  type PortInstallerDeps,
} from "./port-installer-core.js";
import { preservePortUserData } from "./port-user-data.js";

const fixture = async (sameVersion = false) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "port-preservation-"));
  const portsRoot = path.join(root, "Ports");
  const old = path.join(portsRoot, "bloodborne", sameVersion ? "v2" : "v1");
  const executable = path.join(old, "old-wrapper", "Bloodborne.exe");
  const save = path.join(old, "old-wrapper", "user", "savedata", "save.bin");
  const bytes = Buffer.from([0, 255, 1, 42]);
  await fs.mkdir(path.dirname(save), { recursive: true });
  await fs.writeFile(save, bytes);
  await fs.writeFile(executable, "old executable");
  await fs.writeFile(path.join(old, "old-wrapper", "bbport.ini"), "preset=1");
  let record: InstalledPort = {
    portId: "bloodborne",
    version: sameVersion ? "v2" : "v1",
    installPath: old,
    executablePath: executable,
    gameObjectId: "existing-game",
    installedAt: "2026-01-01",
  };
  let libraryPath = executable;
  const port = {
    id: "bloodborne",
    repo: "Supermedo/bloodborne_pc",
    title: "Bloodborne",
    assets: {
      win32: { pattern: ".*", executable: "new-wrapper/Bloodborne.exe" },
    },
  } as PortCatalogueEntry;
  const exists = async (target: string) =>
    fs.access(target).then(
      () => true,
      () => false
    );
  const deps: PortInstallerDeps = {
    preserveUserData: (entry, previous, staging, relativeExe) =>
      preservePortUserData(entry, previous, staging, relativeExe, "win32"),
    removeLibraryGame: async () => {},
    resolveRelease: async () => ({
      ok: true,
      data: {
        tag: "v2",
        fileName: "port.zip",
        downloadUrl: "https://example.invalid",
        htmlUrl: "",
        size: 1,
        sha256: null,
        sha256Url: null,
      },
    }),
    download: async (_url, dest) => {
      await fs.writeFile(dest, "package");
    },
    fetchText: async () => "",
    sha256File: async () => "",
    isArchive: () => true,
    extract: async (_file, out) => {
      await fs.mkdir(path.join(out, "new-wrapper"), { recursive: true });
      await fs.writeFile(
        path.join(out, "new-wrapper", "Bloodborne.exe"),
        "new executable"
      );
      await fs.writeFile(
        path.join(out, "new-wrapper", "bbport.ini"),
        "default"
      );
    },
    pathExists: exists,
    listDir: async (dir) =>
      (await fs.readdir(dir, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      })),
    makeExecutable: async () => {},
    walk: async () => [],
    mkdir: async (dir) => {
      await fs.mkdir(dir, { recursive: true });
    },
    move: (from, to) => fs.rename(from, to),
    remove: async (target) => {
      const relative = path.relative(root, path.resolve(target));
      assert.ok(
        relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      );
      await fs.rm(target, { recursive: true, force: true });
    },
    tempDir: () => fs.mkdtemp(path.join(root, "download-")),
    portsRoot: async () => portsRoot,
    upsertLibraryGame: async (_port, exe) => {
      libraryPath = exe;
      return "existing-game";
    },
    getInstalled: async () => record,
    saveInstalled: async (next) => {
      record = next;
    },
    platform: "win32",
    now: () => new Date(),
    onProgress: () => {},
  };
  return {
    root,
    old,
    save,
    bytes,
    port,
    deps,
    exists,
    record: () => record,
    libraryPath: () => libraryPath,
  };
};

it("preserves save bytes and configuration across a change of archive wrapper", async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const result = await installPortCore(f.port, f.deps);
  assert.equal(result.ok, true);
  const next = path.dirname(f.record().executablePath);
  assert.deepEqual(
    await fs.readFile(path.join(next, "user", "savedata", "save.bin")),
    f.bytes
  );
  assert.equal(
    await fs.readFile(path.join(next, "bbport.ini"), "utf8"),
    "preset=1"
  );
  assert.equal(
    await fs.readFile(f.record().executablePath, "utf8"),
    "new executable"
  );
  assert.equal(f.record().gameObjectId, "existing-game");
});

it("preserves data when reinstalling the same release", async (t) => {
  const f = await fixture(true);
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  assert.equal((await installPortCore(f.port, f.deps)).ok, true);
  assert.deepEqual(
    await fs.readFile(
      path.join(
        path.dirname(f.record().executablePath),
        "user",
        "savedata",
        "save.bin"
      )
    ),
    f.bytes
  );
});

it("does not delete a reinstalled Windows directory with different path casing", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Requires a case-insensitive Windows filesystem");
    return;
  }
  const f = await fixture(true);
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  f.record().installPath = f.record().installPath.toLowerCase();
  assert.equal((await installPortCore(f.port, f.deps)).ok, true);
  assert.deepEqual(
    await fs.readFile(
      path.join(
        path.dirname(f.record().executablePath),
        "user",
        "savedata",
        "save.bin"
      )
    ),
    f.bytes
  );
});

it("leaves old files and library usable when record persistence fails", async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const saveInstalled = f.deps.saveInstalled;
  f.deps.saveInstalled = async (record) => {
    if (record.version === "v2") throw new Error("Database unavailable");
    await saveInstalled(record);
  };
  assert.equal((await installPortCore(f.port, f.deps)).ok, false);
  assert.deepEqual(await fs.readFile(f.save), f.bytes);
  assert.equal(await f.exists(f.libraryPath()), true);
});

it("rejects traversal and absolute preservation paths", async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  for (const entry of [
    "../outside",
    "C:\\outside",
    "\\\\server\\share",
    "/tmp",
    "user/../file",
    ".. /outside",
    "user./save",
    "user:stream",
    "user\u0000file",
  ]) {
    const port = {
      ...f.port,
      assets: { win32: { ...f.port.assets.win32!, preservePaths: [entry] } },
    };
    await assert.rejects(
      preservePortUserData(
        port,
        f.record(),
        f.old,
        "old-wrapper/Bloodborne.exe",
        "win32"
      )
    );
  }
});

it("rejects source directory junctions without copying external files", async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  await fs.symlink(
    outside,
    path.join(f.old, "old-wrapper", "linked"),
    "junction"
  );
  const port = {
    ...f.port,
    assets: { win32: { ...f.port.assets.win32!, preservePaths: ["linked"] } },
  };
  await assert.rejects(
    preservePortUserData(
      port,
      f.record(),
      f.old,
      "old-wrapper/Bloodborne.exe",
      "win32"
    )
  );
});

it("rejects destination junctions before overwriting external data", async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const staging = path.join(f.root, "staging");
  const outside = path.join(f.root, "external");
  await fs.mkdir(path.join(staging, "new-wrapper"), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "sentinel"), "untouched");
  await fs.symlink(
    outside,
    path.join(staging, "new-wrapper", "user"),
    "junction"
  );
  await assert.rejects(
    preservePortUserData(
      f.port,
      f.record(),
      staging,
      "new-wrapper/Bloodborne.exe",
      "win32"
    )
  );
  assert.equal(
    await fs.readFile(path.join(outside, "sentinel"), "utf8"),
    "untouched"
  );
});

it("leaves the previous installation untouched if migration fails", async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  f.deps.preserveUserData = async () => {
    throw new Error("File is locked");
  };
  assert.equal((await installPortCore(f.port, f.deps)).ok, false);
  assert.deepEqual(await fs.readFile(f.save), f.bytes);
  assert.equal(await fs.readFile(f.libraryPath(), "utf8"), "old executable");
  assert.equal(f.record().version, "v1");
});

it("restores a same-release installation after a partial move fails", async (t) => {
  const f = await fixture(true);
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const move = f.deps.move;
  f.deps.move = async (from, to) => {
    if (path.basename(from).startsWith(".staging-")) {
      await fs.mkdir(to, { recursive: true });
      throw new Error("Move failed");
    }
    await move(from, to);
  };
  assert.equal((await installPortCore(f.port, f.deps)).ok, false);
  assert.deepEqual(await fs.readFile(f.save), f.bytes);
  assert.equal(await fs.readFile(f.libraryPath(), "utf8"), "old executable");
});

it("restores old files after same-release record persistence fails", async (t) => {
  const f = await fixture(true);
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  let firstWrite = true;
  const save = f.deps.saveInstalled;
  f.deps.saveInstalled = async (record) => {
    if (firstWrite) {
      firstWrite = false;
      throw new Error("Write failed");
    }
    await save(record);
  };
  assert.equal((await installPortCore(f.port, f.deps)).ok, false);
  assert.deepEqual(await fs.readFile(f.save), f.bytes);
  assert.equal(await fs.readFile(f.libraryPath(), "utf8"), "old executable");
});

it("keeps both versions recoverable if metadata rollback also fails", async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  f.deps.saveInstalled = async () => {
    throw new Error("Database offline");
  };
  assert.equal((await installPortCore(f.port, f.deps)).ok, false);
  assert.deepEqual(await fs.readFile(f.save), f.bytes);
  assert.equal(await f.exists(f.libraryPath()), true);
  assert.equal(
    await f.exists(
      path.join(f.old, "..", "v2", "new-wrapper", "Bloodborne.exe")
    ),
    true
  );
});

it("allows a fresh installation with no previous user data", async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  f.deps.getInstalled = async () => null;
  assert.equal((await installPortCore(f.port, f.deps)).ok, true);
});

it("allows missing optional paths and preserves package defaults", async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  f.port.assets.win32!.preservePaths = ["optional-settings.ini"];
  assert.equal((await installPortCore(f.port, f.deps)).ok, true);
  assert.equal(
    await fs.readFile(
      path.join(path.dirname(f.record().executablePath), "bbport.ini"),
      "utf8"
    ),
    "default"
  );
});

it("does not preserve a path containing the new executable", async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  f.port.assets.win32!.preservePaths = ["Bloodborne.exe"];
  assert.equal((await installPortCore(f.port, f.deps)).ok, false);
  assert.deepEqual(await fs.readFile(f.save), f.bytes);
});
