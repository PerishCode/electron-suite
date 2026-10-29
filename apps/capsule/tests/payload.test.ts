import { expect, it } from "vitest";
import { activate } from "@";

it("exposes a runnable capsule entry", async () => {
  expect(await activate()).toEqual({ title: "electron-suite fixture" });
});
