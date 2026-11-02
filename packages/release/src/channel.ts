import { type Channel, channel } from "@perishcode/protocol";

export interface ProductIdentity {
  appid: string;
  name: string;
  scheme: string;
}
export interface ChannelDescriptor extends ProductIdentity {
  channel: Channel;
  counted: boolean;
  origin: string;
  storagePrefix: string;
}
/** A publishable channel; local is reserved for development runtimes. */
export function releaseChannel(value: string): Channel {
  const result = channel(value);
  if (result === "local") throw new TypeError("local channel is reserved and cannot be released");
  return result;
}
export function channelDescriptor(value: string, product: ProductIdentity): Readonly<ChannelDescriptor> {
  const lane = releaseChannel(value);
  if (
    typeof product.appid !== "string" ||
    product.appid.trim() !== product.appid ||
    !/^[a-z0-9]+(?:\.[a-z0-9]+)+$/.test(product.appid)
  )
    throw new TypeError("invalid product appid");
  if (typeof product.name !== "string" || !product.name.trim()) throw new TypeError("invalid product name");
  if (
    typeof product.scheme !== "string" ||
    product.scheme.trim() !== product.scheme ||
    !/^[a-z][a-z0-9+.-]*$/.test(product.scheme)
  )
    throw new TypeError("invalid product scheme");
  const counted = lane !== "stable";
  const scheme = counted ? `${product.scheme}-${lane}` : product.scheme;
  return Object.freeze({
    channel: lane,
    counted,
    appid: counted ? `${product.appid}.${lane}` : product.appid,
    name: counted ? `${product.name} ${lane[0]?.toUpperCase()}${lane.slice(1)}` : product.name,
    scheme,
    origin: `${scheme}://carrier`,
    storagePrefix: lane,
  });
}
