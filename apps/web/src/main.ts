import { mount } from "./view.js";

const root = document.querySelector<HTMLElement>("#app");
if (!root || !globalThis.perish) throw new Error("web bootstrap is required");
mount(root, globalThis.perish);
