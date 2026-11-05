import type { Capsule } from "@perishcode/runtime";

export function create(): Capsule {
  return {
    handlers: {},
    ready: async () => {},
    initialize: async () => ({
      loading: "Loading",
      window: { title: "electron-suite fixture" },
      witness: "capsule:fixture",
    }),
    stop: async () => {},
  };
}
