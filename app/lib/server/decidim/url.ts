import { isIP } from "node:net";

export type DecidimSpaceKind = "process" | "assembly" | "conference";
export type DecidimResourceKind = "proposal" | "debate";

export type DecidimTarget = Readonly<{
  origin: string;
  spaceKind: DecidimSpaceKind;
  slug: string;
  componentId?: string;
  resource?: Readonly<{ kind: DecidimResourceKind; id: string }>;
  // What a session keeps as its source: no query, fragment or trailing slash.
  canonicalUrl: string;
}>;

const MAX_URL_LENGTH = 2048;

const SPACE_KINDS: Readonly<Record<string, DecidimSpaceKind>> = {
  processes: "process",
  assemblies: "assembly",
  conferences: "conference",
};

const RESOURCE_KINDS: Readonly<Record<string, DecidimResourceKind>> = {
  proposals: "proposal",
  debates: "debate",
};

// /processes/<slug>[/...]
// /processes/<slug>/f/<componentId>[/proposals|debates[/<id>]][/...]
const PATH_RE =
  /^\/(processes|assemblies|conferences)\/([A-Za-z0-9][\w-]*)(?:\/f\/(\d+)(?:\/(proposals|debates)\/(\d+))?(?:\/.*)?|\/.*)?$/;

const INTERNAL_SUFFIXES = [".local", ".localhost", ".internal"];

const isPublicHostname = (hostname: string): boolean =>
  isIP(hostname) === 0 &&
  !hostname.startsWith("[") &&
  hostname.includes(".") &&
  !hostname.endsWith(".") &&
  !INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix));

const parseAbsolute = (raw: string): URL | undefined =>
  URL.canParse(raw) ? new URL(raw) : undefined;

// The server POSTs to whatever host this accepts, so only https on the default
// port with a public-looking name gets through. Name resolution is checked
// again at connect time (./http.ts).
export const parseDecidimUrl = (raw: string): DecidimTarget | undefined => {
  const url =
    raw.length <= MAX_URL_LENGTH ? parseAbsolute(raw.trim()) : undefined;
  const isAllowed =
    url !== undefined &&
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    isPublicHostname(url.hostname);
  const match = isAllowed ? PATH_RE.exec(url.pathname) : null;
  return url !== undefined && match !== null
    ? {
        origin: url.origin,
        spaceKind: SPACE_KINDS[match[1]],
        slug: match[2],
        ...(match[3] ? { componentId: match[3] } : {}),
        ...(match[4] && match[5]
          ? { resource: { kind: RESOURCE_KINDS[match[4]], id: match[5] } }
          : {}),
        canonicalUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`,
      }
    : undefined;
};
