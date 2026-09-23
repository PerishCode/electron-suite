import { channel } from "@perish/protocol";
import { resolve } from "@perish/release";
import { describe, expect, it } from "vitest";

import { plan } from "@";

describe("platform package", () => {
  it("derives install identity only from release identity", () => {
    const value = plan(resolve({}, { channel: channel("beta"), version: "2.1.0-beta.1" }));

    expect(value).toEqual({
      appId: "io.perish.electronsuite.beta",
      executableName: "electronsuite-beta",
      productName: "electron-suite beta",
      version: "2.1.0-beta.1",
    });
  });
});
