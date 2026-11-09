import { lookup as dnsLookup } from "node:dns";
import { Agent } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import axios from "axios";

// The host of a Decidim URL comes from the user, which makes this an SSRF
// surface. Connections are limited to public addresses (checked on the address
// actually dialled, so DNS rebinding does not get around it), redirects are not
// followed, and the response size and duration are capped.

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const USER_AGENT =
  "BaisokuKaigi-DecidimImport (+https://github.com/plural-reality/baisoku-kaigi-oss)";

const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const BLOCKED_V6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const blockList = ((list: BlockList) => {
  BLOCKED_V4.forEach(([net, prefix]) => {
    list.addSubnet(net, prefix, "ipv4");
  });
  BLOCKED_V6.forEach(([net, prefix]) => {
    list.addSubnet(net, prefix, "ipv6");
  });
  return list;
})(new BlockList());

// DNS64 resolvers answer with 64:ff9b::<IPv4> on IPv6-only networks. The address
// that matters is the embedded one, or every site would be refused there and
// 64:ff9b::7f00:1 would reach loopback through the gateway if it were not.
const NAT64_RE = /^\[64:ff9b::(?:([0-9a-f]{1,4}):)?([0-9a-f]{1,4})\]$/;

const embeddedNat64Ipv4 = (address: string): string | undefined => {
  const match = NAT64_RE.exec(new URL(`http://[${address}]`).hostname);
  const bits = match
    ? (Number.parseInt(match[1] ?? "0", 16) * 0x10000 +
        Number.parseInt(match[2], 16)) >>>
      0
    : undefined;
  return bits === undefined
    ? undefined
    : [bits >>> 24, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255].join(
        ".",
      );
};

export const isBlockedAddress = (address: string): boolean => {
  const family = isIP(address);
  const embedded = family === 6 ? embeddedNat64Ipv4(address) : undefined;
  return embedded !== undefined
    ? blockList.check(embedded, "ipv4")
    : family === 0 || blockList.check(address, family === 6 ? "ipv6" : "ipv4");
};

export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    const blocked = error
      ? undefined
      : addresses.find(({ address }) => isBlockedAddress(address));
    const failure =
      error ??
      (blocked || addresses.length === 0
        ? Object.assign(new Error(`Refused address for ${hostname}`), {
            code: "EBLOCKEDADDRESS",
          })
        : null);
    if (failure) {
      callback(failure, "", 0);
    } else if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  });
};

const agent = new Agent({ lookup: guardedLookup });

export type DecidimPost = (
  origin: string,
  query: string,
) => Promise<Readonly<{ ok: true; body: unknown }> | Readonly<{ ok: false }>>;

// Read-only by construction: the only thing this module sends is the query
// built in ./api.ts, and that never contains a mutation.
export const postToDecidim: DecidimPost = (origin, query) =>
  axios
    .post(
      `${origin}/api`,
      { query },
      {
        httpsAgent: agent,
        // An env proxy would resolve the name itself and skip guardedLookup.
        proxy: false,
        maxRedirects: 0,
        timeout: REQUEST_TIMEOUT_MS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        maxContentLength: MAX_RESPONSE_BYTES,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        validateStatus: (status) => status >= 200 && status < 300,
      },
    )
    .then(
      (response) => ({ ok: true as const, body: response.data as unknown }),
      () => ({ ok: false as const }),
    );
