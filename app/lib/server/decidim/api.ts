import type { DecidimPost } from "./http";
import { toPlainText, truncate } from "./text";
import type { DecidimTarget } from "./url";

// Reads a participatory space through Decidim's public GraphQL API.
//
// Instances run different versions and many disable introspection, so the schema
// cannot be read up front. Queries start with every field worth having; when an
// instance rejects a field, the query is rebuilt without it (or, for fields that
// are plain strings on old versions, without the translation selection).
// Fields in REQUIRED_FIELDS cannot be dropped.

const PAGE_SIZE = 25;
const MAX_PAGES_PER_COMPONENT = 2;
const MAX_COMPONENTS = 6;
const MAX_SCHEMA_RETRIES = 6;
const READ_BUDGET_MS = 40_000;

const MAX_TITLE_CHARS = 300;
const MAX_DESCRIPTION_CHARS = 3000;
const MAX_ITEM_BODY_CHARS = 1000;
const MAX_COMMENT_CHARS = 400;
const MAX_COMMENTS_PER_ITEM = 15;
const MAX_TOTAL_CHARS = 30_000;

const REQUIRED_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "title",
  "body",
  "component",
  "components",
  "edges",
  "node",
  "participatoryProcess",
  "proposal",
  "proposals",
  "debate",
  "debates",
  "assemblies",
  "assembly",
  "conferences",
  "conference",
  "slug",
]);

export type DecidimComment = Readonly<{
  text: string;
  alignment: number;
  upVotes: number;
}>;

export type DecidimItem = Readonly<{
  kind: "proposal" | "debate";
  title: string;
  body: string;
  voteCount: number;
  comments: readonly DecidimComment[];
}>;

export type DecidimDiscussion = Readonly<{
  spaceTitle: string;
  spaceDescription: string;
  items: readonly DecidimItem[];
  // More was available than was read or kept.
  truncated: boolean;
}>;

export type DecidimFailure =
  | "unavailable"
  | "notFound"
  | "unsupported"
  | "noContent";

export type DecidimReadResult =
  | Readonly<{ ok: true; discussion: DecidimDiscussion }>
  | Readonly<{ ok: false; reason: DecidimFailure }>;

type Schema = Readonly<{
  omitted: ReadonlySet<string>;
  scalars: ReadonlySet<string>;
}>;

type QueryResult =
  | Readonly<{ ok: true; data: Record<string, unknown>; schema: Schema }>
  | Readonly<{ ok: false; reason: DecidimFailure; schema: Schema }>;

type Json = Record<string, unknown>;

const asJson = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
const asArray = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];
const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
// Ids are inlined into later queries, and an instance's response decides them.
const asId = (value: unknown): string =>
  (typeof value === "string" || typeof value === "number") &&
  /^\d+$/.test(String(value))
    ? String(value)
    : "";

// --- query text -------------------------------------------------------------

const translated = (schema: Schema, field: string): string =>
  schema.omitted.has(field)
    ? ""
    : schema.scalars.has(field)
      ? field
      : `${field} { translations { locale text } }`;

const plain = (schema: Schema, field: string): string =>
  schema.omitted.has(field) ? "" : field;

const commentFields = (schema: Schema): string =>
  ["id", "body", "alignment", "upVotes"]
    .map((field) => plain(schema, field))
    .join(" ");

const commentsSelection = (schema: Schema): string =>
  schema.omitted.has("comments")
    ? ""
    : `comments { ${commentFields(schema)} comments { ${commentFields(schema)} } }`;

const proposalFields = (schema: Schema): string =>
  `id ${translated(schema, "title")} ${translated(schema, "body")} ${plain(schema, "voteCount")} ${commentsSelection(schema)}`;

const debateFields = (schema: Schema): string =>
  `id ${translated(schema, "title")} ${translated(schema, "description")} ${commentsSelection(schema)}`;

const spaceFields = (schema: Schema): string =>
  `${translated(schema, "title")} ${translated(schema, "subtitle")} ${translated(schema, "shortDescription")} ${translated(schema, "description")} components { id __typename }`;

// Values are inlined rather than sent as variables because the declared
// argument types differ between Decidim versions. They are digits, or a slug
// and an API cursor passed through JSON.stringify.
const pageArgs = (after: string | undefined): string =>
  `first: ${PAGE_SIZE}${after ? `, after: ${JSON.stringify(after)}` : ""}`;

const pageQuery = (
  schema: Schema,
  componentId: string,
  collection: "proposals" | "debates",
  after: string | undefined,
): string => {
  const typeName = collection === "proposals" ? "Proposals" : "Debates";
  const fields =
    collection === "proposals" ? proposalFields(schema) : debateFields(schema);
  return `{ component(id: ${componentId}) { ... on ${typeName} { ${collection}(${pageArgs(after)}) { pageInfo { hasNextPage endCursor } edges { node { ${fields} } } } } } }`;
};

const resourceQuery = (
  schema: Schema,
  componentId: string,
  resource: NonNullable<DecidimTarget["resource"]>,
): string =>
  resource.kind === "proposal"
    ? `{ component(id: ${componentId}) { ... on Proposals { proposal(id: ${resource.id}) { ${proposalFields(schema)} } } } }`
    : `{ component(id: ${componentId}) { ... on Debates { debate(id: ${resource.id}) { ${debateFields(schema)} } } } }`;

// --- running a query against an unknown schema ------------------------------

const errorMessages = (errors: readonly unknown[]): readonly string[] =>
  errors.flatMap((error) => {
    const message = asJson(error)?.message;
    return typeof message === "string" ? [message] : [];
  });

const namesMatching = (
  messages: readonly string[],
  pattern: RegExp,
): readonly string[] =>
  messages.flatMap((message) => {
    const name = pattern.exec(message)?.[1];
    return name ? [name] : [];
  });

const widen = (
  set: ReadonlySet<string>,
  names: readonly string[],
): ReadonlySet<string> => new Set([...set, ...names]);

const query = async (
  post: DecidimPost,
  origin: string,
  build: (schema: Schema) => string,
  schema: Schema,
  retriesLeft: number = MAX_SCHEMA_RETRIES,
): Promise<QueryResult> => {
  const response = await post(origin, build(schema));
  const body = response.ok ? asJson(response.body) : undefined;
  if (body === undefined) {
    return { ok: false, reason: "unavailable", schema };
  }
  const messages = errorMessages(asArray(body.errors));
  const missing = namesMatching(messages, /Field '(\w+)' doesn't exist/);
  const scalars = namesMatching(messages, /field '(\w+)' returns /);
  const rejected = [...missing, ...scalars];
  if (rejected.length > 0) {
    const next: Schema = {
      omitted: widen(schema.omitted, missing),
      scalars: widen(schema.scalars, scalars),
    };
    const stuck =
      retriesLeft <= 0 ||
      missing.some((name) => REQUIRED_FIELDS.has(name)) ||
      (next.omitted.size === schema.omitted.size &&
        next.scalars.size === schema.scalars.size);
    return stuck
      ? { ok: false, reason: "unsupported", schema }
      : query(post, origin, build, next, retriesLeft - 1);
  }
  // Errors on individual fields leave the rest of `data` usable.
  const data = asJson(body.data);
  return data
    ? { ok: true, data, schema }
    : {
        ok: false,
        reason: messages.length > 0 ? "unsupported" : "unavailable",
        schema,
      };
};

// --- decoding ---------------------------------------------------------------

const pickTranslation = (value: unknown, language: string): string => {
  const candidates = asArray(asJson(value)?.translations).flatMap((entry) => {
    const json = asJson(entry);
    return typeof json?.text === "string" && json.text.trim().length > 0
      ? [{ locale: json.locale, text: json.text }]
      : [];
  });
  const raw =
    typeof value === "string"
      ? value
      : ((
          candidates.find((entry) => entry.locale === language) ?? candidates[0]
        )?.text ?? "");
  return toPlainText(raw);
};

// The query asks for one level of replies; a response nested deeper is ignored.
const decodeComments = (
  value: unknown,
  depthLeft: number = 1,
): readonly DecidimComment[] =>
  asArray(value).flatMap((entry) => {
    const json = asJson(entry);
    if (!json) return [];
    const text = typeof json.body === "string" ? toPlainText(json.body) : "";
    const replies =
      depthLeft > 0 ? decodeComments(json.comments, depthLeft - 1) : [];
    return text.length > 0
      ? [
          {
            text,
            alignment: asNumber(json.alignment),
            upVotes: asNumber(json.upVotes),
          },
          ...replies,
        ]
      : replies;
  });

const decodeItem = (
  kind: DecidimItem["kind"],
  node: unknown,
  language: string,
): readonly DecidimItem[] => {
  const json = asJson(node);
  const title = json ? pickTranslation(json.title, language) : "";
  return json && title.length > 0
    ? [
        {
          kind,
          title,
          body: pickTranslation(
            kind === "proposal" ? json.body : json.description,
            language,
          ),
          voteCount: asNumber(json.voteCount),
          comments: decodeComments(json.comments),
        },
      ]
    : [];
};

const engagement = (item: DecidimItem): number =>
  item.comments.length + item.voteCount;

// Pure: the most discussed items and most supported comments, cut to what one
// prompt should carry.
export const selectForPrompt = (
  items: readonly DecidimItem[],
): Readonly<{ items: readonly DecidimItem[]; dropped: boolean }> => {
  const trimmed = [...items]
    .sort((a, b) => engagement(b) - engagement(a))
    .map((item) => ({
      ...item,
      title: truncate(item.title, MAX_TITLE_CHARS),
      body: truncate(item.body, MAX_ITEM_BODY_CHARS),
      comments: [...item.comments]
        .sort((a, b) => b.upVotes - a.upVotes)
        .slice(0, MAX_COMMENTS_PER_ITEM)
        .map((comment) => ({
          ...comment,
          text: truncate(comment.text, MAX_COMMENT_CHARS),
        })),
    }));
  const sizes = trimmed.map(
    (item) =>
      item.title.length +
      item.body.length +
      item.comments.reduce((sum, comment) => sum + comment.text.length, 0),
  );
  const fitting = sizes.map((_, index) =>
    sizes.slice(0, index + 1).reduce((sum, size) => sum + size, 0),
  );
  const kept = trimmed.filter((_, index) => fitting[index] <= MAX_TOTAL_CHARS);
  return {
    items: kept,
    dropped:
      kept.length < items.length ||
      items.some((item) => item.comments.length > MAX_COMMENTS_PER_ITEM),
  };
};

// --- reading a space --------------------------------------------------------

const readSpace = async (
  post: DecidimPost,
  target: DecidimTarget,
  schema: Schema,
): Promise<QueryResult> => {
  if (target.spaceKind === "process") {
    return query(
      post,
      target.origin,
      (s) =>
        `{ space: participatoryProcess(slug: ${JSON.stringify(target.slug)}) { ${spaceFields(s)} } }`,
      schema,
    );
  }
  // Assemblies and conferences have no slug argument.
  const collection =
    target.spaceKind === "assembly" ? "assemblies" : "conferences";
  const list = await query(
    post,
    target.origin,
    () => `{ ${collection} { id slug } }`,
    schema,
  );
  if (!list.ok) {
    return list;
  }
  const id = asId(
    asJson(
      asArray(list.data[collection]).find(
        (entry) => asJson(entry)?.slug === target.slug,
      ),
    )?.id,
  );
  return id === ""
    ? { ok: false, reason: "notFound", schema }
    : query(
        post,
        target.origin,
        (s) =>
          `{ space: ${target.spaceKind}(id: ${id}) { ${spaceFields(s)} } }`,
        schema,
      );
};

type Collected = Readonly<{
  items: readonly DecidimItem[];
  more: boolean;
  schema: Schema;
}>;

type Reader = Readonly<{
  post: DecidimPost;
  origin: string;
  language: string;
  isOverBudget: () => boolean;
}>;

const readComponentPages = async (
  reader: Reader,
  componentId: string,
  collection: "proposals" | "debates",
  schema: Schema,
  after: string | undefined = undefined,
  pagesLeft: number = MAX_PAGES_PER_COMPONENT,
): Promise<Collected> => {
  const result = await query(
    reader.post,
    reader.origin,
    (s) => pageQuery(s, componentId, collection, after),
    schema,
  );
  if (!result.ok) {
    return { items: [], more: true, schema: result.schema };
  }
  const connection = asJson(asJson(result.data.component)?.[collection]);
  const pageInfo = asJson(connection?.pageInfo);
  const edges = asArray(connection?.edges);
  // A field error nulls out its edge and leaves the rest of the page usable.
  const lostEdge = edges.some((edge) => !asJson(asJson(edge)?.node));
  const items = edges.flatMap((edge) =>
    decodeItem(
      collection === "proposals" ? "proposal" : "debate",
      asJson(edge)?.node,
      reader.language,
    ),
  );
  const cursor =
    pageInfo?.hasNextPage === true && typeof pageInfo.endCursor === "string"
      ? pageInfo.endCursor
      : undefined;
  if (cursor === undefined) {
    return { items, more: lostEdge, schema: result.schema };
  }
  if (pagesLeft <= 1 || reader.isOverBudget()) {
    return { items, more: true, schema: result.schema };
  }
  const rest = await readComponentPages(
    reader,
    componentId,
    collection,
    result.schema,
    cursor,
    pagesLeft - 1,
  );
  return {
    ...rest,
    items: [...items, ...rest.items],
    more: rest.more || lostEdge,
  };
};

type Component = Readonly<{
  id: string;
  collection: "proposals" | "debates";
}>;

const readComponents = (
  reader: Reader,
  components: readonly Component[],
  schema: Schema,
): Promise<Collected> =>
  components.reduce<Promise<Collected>>(
    (previous, component) =>
      previous.then((collected) =>
        reader.isOverBudget()
          ? { ...collected, more: true }
          : readComponentPages(
              reader,
              component.id,
              component.collection,
              collected.schema,
            ).then((page) => ({
              items: [...collected.items, ...page.items],
              more: collected.more || page.more,
              schema: page.schema,
            })),
      ),
    Promise.resolve({ items: [], more: false, schema }),
  );

const readResource = async (
  reader: Reader,
  componentId: string,
  resource: NonNullable<DecidimTarget["resource"]>,
  schema: Schema,
): Promise<Collected> => {
  const result = await query(
    reader.post,
    reader.origin,
    (s) => resourceQuery(s, componentId, resource),
    schema,
  );
  const node = result.ok
    ? asJson(result.data.component)?.[resource.kind]
    : undefined;
  return {
    items: decodeItem(resource.kind, node, reader.language),
    more: !result.ok,
    schema: result.schema,
  };
};

const toComponents = (value: unknown): readonly Component[] =>
  asArray(value).flatMap<Component>((entry) => {
    const json = asJson(entry);
    const id = asId(json?.id);
    return id && json?.__typename === "Proposals"
      ? [{ id, collection: "proposals" }]
      : id && json?.__typename === "Debates"
        ? [{ id, collection: "debates" }]
        : [];
  });

const INITIAL_SCHEMA: Schema = { omitted: new Set(), scalars: new Set() };

export const readDecidimDiscussion = async (
  post: DecidimPost,
  target: DecidimTarget,
  language: string,
  now: () => number = Date.now,
): Promise<DecidimReadResult> => {
  const deadline = now() + READ_BUDGET_MS;
  const space = await readSpace(post, target, INITIAL_SCHEMA);
  if (!space.ok) {
    return { ok: false, reason: space.reason };
  }
  const spaceJson = asJson(space.data.space);
  if (!spaceJson) {
    return { ok: false, reason: "notFound" };
  }
  // The URL names a component of this space, so one from elsewhere on the
  // instance is a wrong URL rather than something to read.
  const components = toComponents(spaceJson.components).filter(
    (component) =>
      target.componentId === undefined || component.id === target.componentId,
  );
  const reader: Reader = {
    post,
    origin: target.origin,
    language,
    isOverBudget: () => now() > deadline,
  };
  const collected =
    target.componentId !== undefined && target.resource !== undefined
      ? components.length > 0
        ? await readResource(
            reader,
            target.componentId,
            target.resource,
            space.schema,
          )
        : { items: [], more: false, schema: space.schema }
      : await readComponents(
          reader,
          components.slice(0, MAX_COMPONENTS),
          space.schema,
        );
  const selected = selectForPrompt(collected.items);
  if (selected.items.length === 0) {
    return {
      ok: false,
      reason: collected.more ? "unavailable" : "noContent",
    };
  }
  const descriptionParts = [
    spaceJson.subtitle,
    spaceJson.shortDescription,
    spaceJson.description,
  ].map((part) => pickTranslation(part, language));
  return {
    ok: true,
    discussion: {
      spaceTitle: truncate(
        pickTranslation(spaceJson.title, language),
        MAX_TITLE_CHARS,
      ),
      spaceDescription: truncate(
        descriptionParts.filter((part) => part.length > 0).join("\n\n"),
        MAX_DESCRIPTION_CHARS,
      ),
      items: selected.items,
      truncated:
        collected.more ||
        selected.dropped ||
        (target.resource === undefined && components.length > MAX_COMPONENTS),
    },
  };
};
