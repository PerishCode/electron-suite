import { Daemon, type Transport } from "./api.js";

export interface Config {
  daemon: string;
  token: string;
}

export function mount(
  root: HTMLElement,
  config: Config,
  transport: Transport = (input, init) => fetch(input, init),
): Daemon {
  const daemon = new Daemon(config.daemon, config.token, transport);
  const status = document.createElement("output");
  const refresh = document.createElement("button");
  const input = document.createElement("input");
  const save = document.createElement("button");
  refresh.textContent = "Refresh";
  save.textContent = "Save";
  input.setAttribute("aria-label", "State");
  status.setAttribute("aria-live", "polite");
  root.replaceChildren(status, refresh, input, save);

  refresh.addEventListener("click", () => {
    status.textContent = "loading";
    void daemon.read().then(
      (value) => status.textContent = JSON.stringify(value),
      (fault: Error) => status.textContent = fault.message,
    );
  });
  save.addEventListener("click", () => {
    status.textContent = "saving";
    void daemon.write({ value: input.value }).then(
      (value) => status.textContent = JSON.stringify(value),
      (fault: Error) => status.textContent = fault.message,
    );
  });
  void daemon.health().then(
    () => status.textContent = "ready",
    (fault: Error) => status.textContent = fault.message,
  );
  return daemon;
}
