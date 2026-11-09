import { describe, expect, it, vi } from "vitest";
import {
  type DecidimItem,
  readDecidimDiscussion,
  selectForPrompt,
} from "../api";
import type { DecidimPost } from "../http";
import { type DecidimTarget, parseDecidimUrl } from "../url";

const ja = (text: string) => ({ translations: [{ locale: "ja", text }] });

const target = (url: string): DecidimTarget => {
  const parsed = parseDecidimUrl(url);
  if (!parsed) throw new Error(`bad test URL ${url}`);
  return parsed;
};

const proposalsPage = (nodes: readonly unknown[], endCursor?: string) => ({
  data: {
    component: {
      proposals: {
        pageInfo: { hasNextPage: endCursor !== undefined, endCursor },
        edges: nodes.map((node) => ({ node })),
      },
    },
  },
});

const SPACE = {
  data: {
    space: {
      title: ja("<b>駅周辺</b>"),
      shortDescription: ja("<p>概要</p>"),
      // Kakogawa returns null for components it hides.
      components: [
        null,
        { id: "1", __typename: "Blogs" },
        { id: "2", __typename: "Proposals" },
        { id: "3", __typename: "Debates" },
      ],
    },
  },
};

// Answers by what the query asks for; queries are recorded for assertions.
const fakeInstance = (
  respond: (query: string) => unknown,
): DecidimPost & { queries: string[] } => {
  const queries: string[] = [];
  const post: DecidimPost = async (_origin, query) => {
    queries.push(query);
    return { ok: true, body: respond(query) };
  };
  return Object.assign(post, { queries });
};

const URL_P = "https://x.example/processes/env";

describe("readDecidimDiscussion", () => {
  it("reads proposals, debates and nested comments as sanitized text", async () => {
    const post = fakeInstance((query) =>
      query.includes("participatoryProcess")
        ? SPACE
        : query.includes("Proposals")
          ? proposalsPage([
              {
                id: "10",
                title: ja("芝生<script>alert(1)</script>広場"),
                body: ja("<p>本文</p>"),
                voteCount: 2,
                comments: [
                  {
                    id: "c1",
                    body: "<img src=x onerror=alert(1)>賛成",
                    alignment: 1,
                    upVotes: 3,
                    comments: [{ id: "c2", body: "返信", alignment: -1 }],
                  },
                ],
              },
            ])
          : {
              data: {
                component: {
                  debates: {
                    pageInfo: { hasNextPage: false },
                    edges: [
                      {
                        node: {
                          id: "20",
                          title: ja("論点"),
                          description: ja("<p>説明</p>"),
                          comments: [],
                        },
                      },
                    ],
                  },
                },
              },
            },
    );

    const result = await readDecidimDiscussion(post, target(URL_P), "ja");

    expect(result).toEqual({
      ok: true,
      discussion: {
        spaceTitle: "駅周辺",
        spaceDescription: "概要",
        items: [
          {
            kind: "proposal",
            title: "芝生広場",
            body: "本文",
            voteCount: 2,
            comments: [
              { text: "賛成", alignment: 1, upVotes: 3 },
              { text: "返信", alignment: -1, upVotes: 0 },
            ],
          },
          {
            kind: "debate",
            title: "論点",
            body: "説明",
            voteCount: 0,
            comments: [],
          },
        ],
        truncated: false,
      },
    });
    // Author names are never requested, and nothing here can write.
    expect(post.queries.join(" ")).not.toMatch(/author|mutation/i);
  });

  it("drops a field the instance does not have and retries", async () => {
    const post = fakeInstance((query) =>
      query.includes("voteCount")
        ? {
            errors: [
              {
                message: "Field 'voteCount' doesn't exist on type 'Proposal'",
                extensions: { code: "undefinedField" },
              },
            ],
          }
        : query.includes("participatoryProcess")
          ? SPACE
          : query.includes("Proposals")
            ? proposalsPage([{ id: "10", title: ja("提案"), body: ja("本文") }])
            : { data: { component: { debates: { edges: [] } } } },
    );

    const result = await readDecidimDiscussion(post, target(URL_P), "ja");

    expect(result.ok).toBe(true);
    // Learned once; later queries are not rejected again.
    expect(post.queries.filter((q) => q.includes("voteCount"))).toHaveLength(1);
  });

  it("reads fields that are plain strings on old versions", async () => {
    const post = fakeInstance((query) =>
      query.includes("participatoryProcess")
        ? SPACE
        : /title \{/.test(query)
          ? {
              errors: [
                {
                  message:
                    "Selections can't be made on scalars (field 'title' returns String but has selections [translations])",
                },
              ],
            }
          : query.includes("Proposals")
            ? proposalsPage([{ id: "10", title: "<i>題</i>", body: "本文" }])
            : { data: { component: { debates: { edges: [] } } } },
    );

    const result = await readDecidimDiscussion(
      post,
      target(`${URL_P}/f/2/proposals`),
      "ja",
    );

    expect(result).toMatchObject({
      ok: true,
      discussion: { items: [{ title: "題", body: "本文" }] },
    });
  });

  it("gives up on an instance without a required field", async () => {
    const post = fakeInstance(() => ({
      errors: [{ message: "Field 'components' doesn't exist on type 'X'" }],
    }));

    expect(await readDecidimDiscussion(post, target(URL_P), "ja")).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(post.queries).toHaveLength(1);
  });

  it("prefers the session language and falls back to what exists", async () => {
    const both = {
      translations: [
        { locale: "es", text: null },
        { locale: "ca", text: "català" },
        { locale: "en", text: "english" },
      ],
    };
    const post = fakeInstance((query) =>
      query.includes("participatoryProcess")
        ? {
            data: {
              space: { title: both, components: SPACE.data.space.components },
            },
          }
        : query.includes("Proposals")
          ? proposalsPage([{ id: "1", title: both, body: both }])
          : { data: { component: { debates: { edges: [] } } } },
    );

    const english = await readDecidimDiscussion(post, target(URL_P), "en");
    const japanese = await readDecidimDiscussion(post, target(URL_P), "ja");

    expect(english).toMatchObject({ discussion: { spaceTitle: "english" } });
    expect(japanese).toMatchObject({ discussion: { spaceTitle: "català" } });
  });

  it("reads only the component in the URL", async () => {
    const post = fakeInstance((query) =>
      query.includes("participatoryProcess")
        ? SPACE
        : proposalsPage([{ id: "1", title: ja("提案"), body: ja("本文") }]),
    );

    await readDecidimDiscussion(post, target(`${URL_P}/f/2/proposals`), "ja");

    expect(post.queries).toHaveLength(2);
    expect(post.queries[1]).toContain("component(id: 2)");
  });

  it("refuses a component that belongs to another space", async () => {
    const post = fakeInstance(() => SPACE);

    expect(
      await readDecidimDiscussion(
        post,
        target(`${URL_P}/f/999/proposals/1`),
        "ja",
      ),
    ).toEqual({ ok: false, reason: "noContent" });
    expect(post.queries).toHaveLength(1);
  });

  it("reads a single proposal from its URL", async () => {
    const post = fakeInstance((query) =>
      query.includes("participatoryProcess")
        ? SPACE
        : {
            data: {
              component: {
                proposal: { id: "7", title: ja("単体"), body: ja("本文") },
              },
            },
          },
    );

    const result = await readDecidimDiscussion(
      post,
      target(`${URL_P}/f/2/proposals/7`),
      "ja",
    );

    expect(post.queries[1]).toContain("proposal(id: 7)");
    expect(result).toMatchObject({
      discussion: { items: [{ title: "単体" }], truncated: false },
    });
  });

  it("stops paging at the limit and says so", async () => {
    const post = fakeInstance((query) =>
      query.includes("participatoryProcess")
        ? SPACE
        : proposalsPage(
            [{ id: "1", title: ja("提案"), body: ja("本文") }],
            "next",
          ),
    );

    const result = await readDecidimDiscussion(
      post,
      target(`${URL_P}/f/2/proposals`),
      "ja",
    );

    expect(post.queries).toHaveLength(3);
    expect(post.queries[2]).toContain('after: "next"');
    expect(result).toMatchObject({ discussion: { truncated: true } });
  });

  it("stops reading when the time budget runs out", async () => {
    const post = fakeInstance((query) =>
      query.includes("participatoryProcess")
        ? SPACE
        : proposalsPage(
            [{ id: "1", title: ja("提案"), body: ja("本文") }],
            "next",
          ),
    );
    const clock = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(60_000);

    const result = await readDecidimDiscussion(
      post,
      target(URL_P),
      "ja",
      clock,
    );

    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(post.queries).toHaveLength(1);
  });

  it("reports an unreachable instance, an unknown space and an empty one", async () => {
    const down: DecidimPost = async () => ({ ok: false });
    const html = fakeInstance(() => "<html>403</html>");
    const unknown = fakeInstance(() => ({ data: { space: null } }));
    const empty = fakeInstance(() => ({
      data: { space: { title: ja("空"), components: [] } },
    }));

    expect(await readDecidimDiscussion(down, target(URL_P), "ja")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await readDecidimDiscussion(html, target(URL_P), "ja")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await readDecidimDiscussion(unknown, target(URL_P), "ja")).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(await readDecidimDiscussion(empty, target(URL_P), "ja")).toEqual({
      ok: false,
      reason: "noContent",
    });
  });

  it("flags a page that lost an edge to a field error", async () => {
    const post = fakeInstance((query) =>
      query.includes("participatoryProcess")
        ? SPACE
        : {
            errors: [{ message: "Cannot return null for non-nullable field" }],
            data: {
              component: {
                proposals: {
                  pageInfo: { hasNextPage: false },
                  edges: [
                    {
                      node: { id: "1", title: ja("残った"), body: ja("本文") },
                    },
                    null,
                  ],
                },
              },
            },
          },
    );

    const result = await readDecidimDiscussion(
      post,
      target(`${URL_P}/f/2/proposals`),
      "ja",
    );

    expect(result).toMatchObject({
      discussion: { items: [{ title: "残った" }], truncated: true },
    });
  });

  it.each([
    ["a null component", { component: null }],
    ["a null connection", { component: { proposals: null } }],
    ["null edges", { component: { proposals: { edges: null } } }],
  ])("flags %s reported with errors", async (_, data) => {
    const post = fakeInstance((query) =>
      query.includes("Debates")
        ? {
            data: {
              component: {
                debates: {
                  edges: [{ node: { id: "1", title: ja("残った") } }],
                },
              },
            },
          }
        : query.includes("participatoryProcess")
          ? SPACE
          : { errors: [{ message: "boom" }], data },
    );

    const result = await readDecidimDiscussion(post, target(URL_P), "ja");

    expect(result).toMatchObject({ discussion: { truncated: true } });
  });

  it("reports nulls that came with errors as unavailable", async () => {
    const errored = (data: unknown) =>
      fakeInstance(() => ({ errors: [{ message: "boom" }], data }));

    expect(
      await readDecidimDiscussion(
        errored({ space: null }),
        target(URL_P),
        "ja",
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(
      await readDecidimDiscussion(
        errored({ assemblies: null }),
        target("https://x.example/assemblies/town"),
        "ja",
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("does not spend time on a page far longer than requested", async () => {
    const post = fakeInstance((query) =>
      query.includes("participatoryProcess")
        ? SPACE
        : proposalsPage(
            Array.from({ length: 200_000 }, () => ({ title: "a" })),
          ),
    );
    const start = Date.now();

    const result = await readDecidimDiscussion(
      post,
      target(`${URL_P}/f/2/proposals`),
      "ja",
    );

    expect(Date.now() - start).toBeLessThan(2000);
    expect(result).toMatchObject({ discussion: { items: { length: 25 } } });
  });

  it("stops schema retries when the time budget runs out", async () => {
    const post = fakeInstance(() => ({
      errors: [{ message: "Field 'voteCount' doesn't exist on type 'X'" }],
    }));
    const clock = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(60_000);

    await readDecidimDiscussion(post, target(URL_P), "ja", clock);

    expect(post.queries).toHaveLength(1);
  });

  it("reports a failed single resource as unavailable, not empty", async () => {
    const post: DecidimPost = async (_origin, query) =>
      query.includes("participatoryProcess")
        ? { ok: true, body: SPACE }
        : { ok: false };

    expect(
      await readDecidimDiscussion(
        post,
        target(`${URL_P}/f/2/proposals/7`),
        "ja",
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports a failed assembly list as unavailable, not missing", async () => {
    const down: DecidimPost = async () => ({ ok: false });

    expect(
      await readDecidimDiscussion(
        down,
        target("https://x.example/assemblies/town"),
        "ja",
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("never inlines an id that is not digits", async () => {
    const post = fakeInstance((query) =>
      query.includes("participatoryProcess")
        ? {
            data: {
              space: {
                title: ja("空間"),
                components: [
                  { id: "1){a}} mutation M{b", __typename: "Proposals" },
                ],
              },
            },
          }
        : proposalsPage([]),
    );

    await readDecidimDiscussion(post, target(URL_P), "ja");

    expect(post.queries).toHaveLength(1);
  });

  it("caps a huge space title and ignores comments nested past the query", async () => {
    const deep = (depth: number): unknown =>
      depth === 0 ? [] : [{ body: `d${depth}`, comments: deep(depth - 1) }];
    const post = fakeInstance((query) =>
      query.includes("participatoryProcess")
        ? {
            data: {
              space: {
                title: ja("x".repeat(50_000)),
                components: [{ id: "2", __typename: "Proposals" }],
              },
            },
          }
        : proposalsPage([
            { id: "1", title: ja("提案"), body: ja("本文"), comments: deep(5) },
          ]),
    );

    const result = await readDecidimDiscussion(post, target(URL_P), "ja");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.discussion.spaceTitle.length).toBeLessThanOrEqual(301);
      expect(result.discussion.items[0].comments).toHaveLength(2);
    }
  });

  it("finds assemblies by slug because they have no slug argument", async () => {
    const post = fakeInstance((query) =>
      query.includes("assemblies")
        ? { data: { assemblies: [{ id: "4", slug: "town" }] } }
        : query.includes("assembly(id: 4)")
          ? SPACE
          : query.includes("Proposals")
            ? proposalsPage([{ id: "1", title: ja("提案"), body: ja("本文") }])
            : { data: { component: { debates: { edges: [] } } } },
    );

    const result = await readDecidimDiscussion(
      post,
      target("https://x.example/assemblies/town"),
      "ja",
    );

    expect(result.ok).toBe(true);
  });

  it("keeps the query parseable with a hostile cursor", async () => {
    const post = fakeInstance((query) =>
      query.includes("participatoryProcess")
        ? SPACE
        : query.includes("after:")
          ? proposalsPage([])
          : proposalsPage(
              [{ id: "1", title: ja("提案"), body: ja("本文") }],
              '") { mutation }',
            ),
    );

    await readDecidimDiscussion(post, target(`${URL_P}/f/2/proposals`), "ja");

    expect(post.queries[2]).toContain('after: "\\") { mutation }"');
  });
});

describe("selectForPrompt", () => {
  const item = (overrides: Partial<DecidimItem>): DecidimItem => ({
    kind: "proposal",
    title: "t",
    body: "",
    voteCount: 0,
    comments: [],
    ...overrides,
  });

  it("puts the most active items first", () => {
    const { items } = selectForPrompt([
      item({ title: "quiet" }),
      item({ title: "loud", voteCount: 5 }),
    ]);
    expect(items.map(({ title }) => title)).toEqual(["loud", "quiet"]);
  });

  it("keeps the most supported comments up to the limit", () => {
    const comments = Array.from({ length: 20 }, (_, upVotes) => ({
      text: `c${upVotes}`,
      alignment: 0,
      upVotes,
    }));
    const { items, dropped } = selectForPrompt([item({ comments })]);
    expect(items[0].comments).toHaveLength(15);
    expect(items[0].comments[0].text).toBe("c19");
    expect(dropped).toBe(true);
  });

  it("caps the total size and reports what was dropped", () => {
    const big = item({ body: "x".repeat(1000), comments: [] });
    const { items, dropped } = selectForPrompt(
      Array.from({ length: 40 }, () => big),
    );
    expect(items.length).toBeLessThan(40);
    expect(dropped).toBe(true);
  });
});
