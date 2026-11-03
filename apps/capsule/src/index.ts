import type { Capsule } from "@perishcode/runtime";

export function create(): Capsule {
  return {
    handlers: {},
    initialize: async () => ({ window: { title: "electron-suite fixture" }, witness: "capsule:fixture" }),
    stop: async () => {},
  };
}
