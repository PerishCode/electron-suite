export interface Health {
  ok: boolean;
  pid: number;
}

export type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function endpoint(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "localhost";
  if (url.protocol !== "http:" || !local || !url.port || url.pathname !== "/") {
    throw new TypeError("daemon endpoint must be loopback HTTP origin");
  }
  return url.origin;
}

export class Daemon {
  readonly #endpoint: string;
  readonly #token: string;
  readonly #transport: Transport;

  constructor(value: string, token: string, transport: Transport = fetch) {
    if (!token) throw new TypeError("daemon token is required");
    this.#endpoint = endpoint(value);
    this.#token = token;
    this.#transport = transport;
  }

  health(): Promise<Health> {
    return this.#call("/health") as Promise<Health>;
  }

  read(): Promise<unknown> {
    return this.#call("/state");
  }

  write(value: unknown): Promise<unknown> {
    return this.#call("/state", value);
  }

  async #call(path: string, value?: unknown): Promise<unknown> {
    const response = await this.#transport(`${this.#endpoint}${path}`, {
      body: value === undefined ? undefined : JSON.stringify(value),
      cache: "no-store",
      credentials: "omit",
      headers: {
        authorization: `Bearer ${this.#token}`,
        ...(value === undefined ? {} : { "content-type": "application/json" }),
      },
      method: value === undefined ? "GET" : "PUT",
      mode: "cors",
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`daemon request failed: ${response.status}`);
    return body;
  }
}
