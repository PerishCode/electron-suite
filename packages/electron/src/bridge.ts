// Browser-safe contracts: this module has no runtime Node imports.
export interface Bootstrap {
  generation: string;
  nonce: string;
  version: string;
  daemon?: { generation?: string; nonce?: string; unit?: string; version?: string };
  web?: { unit?: string; version?: string };
}
export interface Bridge {
  bootstrap: Bootstrap;
  health(): Promise<Record<string, unknown>>;
  read(): Promise<Record<string, unknown>>;
  write(value: Record<string, unknown>): Promise<Record<string, unknown>>;
}
