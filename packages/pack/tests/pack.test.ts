import { join } from "node:path";
import { channel } from "@perishcode/protocol";
import { resolve } from "@perishcode/release";
import { describe, expect, it } from "vitest";

import { layout, plan, target } from "@";

describe("platform package", () => {
  it("derives install identity only from release identity", () => {
    const value = plan(resolve({}, { channel: channel("beta"), version: "2.1.0-beta.1" }));

    expect(value).toEqual({
      appId: "io.perish.electronsuite.beta",
      executableName: "electronsuite-beta",
      productName: "electron-suite Beta",
      version: "2.1.0-beta.1",
    });
  });
});

it("plans native package paths for the supported platform/architecture pairs", () => {
  expect(layout("/out", "probe", "mac", "x64").app).toBe(join("/out", "mac", "probe.app"));
  expect(layout("/out", "probe", "linux", "arm64").executable).toBe(join("/out", "linux-arm64-unpacked", "probe"));
  expect(layout("/out", "probe", "win", "x64").executable).toBe(join("/out", "win-unpacked", "probe.exe"));
  expect(() => target("unknown", "x64")).toThrow("unsupported");
  expect(() => target("mac", "ia32")).toThrow("unsupported");
});
