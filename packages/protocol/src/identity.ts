declare const channelmark: unique symbol;
declare const namespacemark: unique symbol;

export type Channel = string & { readonly [channelmark]: true };
export type Namespace = string & { readonly [namespacemark]: true };

const pattern = /^[a-z][a-z0-9]*$/;

function identity(value: string, name: string): string {
  if (!pattern.test(value)) {
    throw new TypeError(`${name} must be a single word`);
  }

  return value;
}

export function channel(value: string): Channel {
  return identity(value, "channel") as Channel;
}

export function namespace(value: string): Namespace {
  return identity(value, "namespace") as Namespace;
}
