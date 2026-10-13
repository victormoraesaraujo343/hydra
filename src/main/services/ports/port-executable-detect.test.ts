import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectPortExecutable,
  type PortFileEntry,
} from "./port-executable-detect.js";

const file = (
  relativePath: string,
  options: Partial<Omit<PortFileEntry, "relativePath" | "isDirectory">> = {}
): PortFileEntry => ({
  relativePath,
  size: 1000,
  isExecutable: false,
  isDirectory: false,
  ...options,
});

const dir = (relativePath: string): PortFileEntry => ({
  relativePath,
  size: 0,
  isExecutable: false,
  isDirectory: true,
});

describe("detectPortExecutable", () => {
  it("never picks the probe from a GoW3-like zip", () => {
    const entries = [
      file("God of War III.exe"),
      file("Play God of War III.exe"),
      file("gow3-probe.exe"),
      file("tools/x.exe"),
    ];

    const result = detectPortExecutable(
      entries,
      "win32",
      "win32",
      "God of War III"
    );

    assert.equal(result, "Play God of War III.exe");
  });

  it("prefers the launcher inside a single nested folder and skips redistributables", () => {
    const entries = [
      file("PinyonShift/PinyonShiftLauncher.exe"),
      file("PinyonShift/vc_redist.x64.exe"),
      file("PinyonShift/PinyonShift.exe"),
    ];

    const result = detectPortExecutable(
      entries,
      "win32",
      "win32",
      "Pinyon Shift"
    );

    assert.equal(result, "PinyonShift/PinyonShiftLauncher.exe");
  });

  it("excludes uninstallers and installers", () => {
    assert.equal(
      detectPortExecutable(
        [file("Game/uninstall.exe"), file("Game/Game.exe")],
        "win32",
        "win32",
        "Game"
      ),
      "Game/Game.exe"
    );
    assert.equal(
      detectPortExecutable(
        [file("unins000.exe"), file("setup.exe"), file("installer.exe")],
        "win32",
        "win32",
        "Game"
      ),
      null
    );
  });

  it("ignores executables in redistributable folders", () => {
    const result = detectPortExecutable(
      [file("redist/Game.exe")],
      "win32",
      "win32",
      "Game"
    );

    assert.equal(result, null);
  });

  it("prefers a shallower path over a deeper one", () => {
    const result = detectPortExecutable(
      [file("deep/nested/Game.exe", { size: 99999 }), file("Game.exe")],
      "win32",
      "win32",
      "Game"
    );

    assert.equal(result, "Game.exe");
  });

  it("breaks ties by the larger file", () => {
    const result = detectPortExecutable(
      [file("alpha.exe", { size: 10 }), file("beta.exe", { size: 20 })],
      "win32",
      "win32",
      "Gamma"
    );

    assert.equal(result, "beta.exe");
  });

  it("picks an AppImage on Linux before bare executables", () => {
    const result = detectPortExecutable(
      [
        file("Game-x86_64", { isExecutable: true, size: 5000 }),
        file("Game.AppImage", { size: 100 }),
      ],
      "linux",
      "linux",
      "Game"
    );

    assert.equal(result, "Game.AppImage");
  });

  it("picks a bare Linux executable and never a shared library", () => {
    const result = detectPortExecutable(
      [
        file("libgame.so", { isExecutable: true, size: 9999 }),
        file("libgame.so.1", { isExecutable: true, size: 9999 }),
        file("game-bin", { isExecutable: true, size: 10 }),
        file("readme.txt", { isExecutable: true }),
      ],
      "linux",
      "linux",
      "Game"
    );

    assert.equal(result, "game-bin");
  });

  it("requires the executable bit for bare Linux files", () => {
    const result = detectPortExecutable(
      [file("Game", { isExecutable: false })],
      "linux",
      "linux",
      "Game"
    );

    assert.equal(result, null);
  });

  it("picks the top-most .app bundle on macOS and ignores nested ones", () => {
    const result = detectPortExecutable(
      [
        dir("Game.app"),
        file("Game.app/Contents/MacOS/game", { isExecutable: true }),
        dir("Game.app/Contents/Frameworks/Helper.app"),
        file("Game.app/Contents/Frameworks/Helper.app/Contents/MacOS/h", {
          isExecutable: true,
        }),
      ],
      "darwin",
      "darwin",
      "Game"
    );

    assert.equal(result, "Game.app");
  });

  it("returns null when nothing is runnable", () => {
    assert.equal(
      detectPortExecutable(
        [file("readme.txt"), file("data.pak")],
        "win32",
        "win32",
        "Game"
      ),
      null
    );
    assert.equal(detectPortExecutable([], "linux", "linux", "Game"), null);
    assert.equal(detectPortExecutable([], "darwin", "darwin", "Game"), null);
  });
});
