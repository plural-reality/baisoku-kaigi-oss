import { describe, expect, it } from "vitest";
import { parseDecidimUrl } from "../url";

describe("parseDecidimUrl", () => {
  it("reads a participatory process URL", () => {
    expect(
      parseDecidimUrl("https://kakogawa.diycities.jp/processes/Env"),
    ).toEqual({
      origin: "https://kakogawa.diycities.jp",
      spaceKind: "process",
      slug: "Env",
      canonicalUrl: "https://kakogawa.diycities.jp/processes/Env",
    });
  });

  it("reads a component and a resource, and canonicalizes the URL", () => {
    expect(
      parseDecidimUrl(
        "https://kakogawa.diycities.jp/processes/Env/f/1077/proposals/1390/?commentId=1#comment_1",
      ),
    ).toEqual({
      origin: "https://kakogawa.diycities.jp",
      spaceKind: "process",
      slug: "Env",
      componentId: "1077",
      resource: { kind: "proposal", id: "1390" },
      canonicalUrl:
        "https://kakogawa.diycities.jp/processes/Env/f/1077/proposals/1390",
    });
    expect(
      parseDecidimUrl("https://x.example/assemblies/a/f/9/debates"),
    ).toMatchObject({ spaceKind: "assembly", componentId: "9" });
    expect(
      parseDecidimUrl("https://x.example/conferences/c/f/9/debates/5"),
    ).toMatchObject({
      spaceKind: "conference",
      resource: { kind: "debate", id: "5" },
    });
    expect(
      parseDecidimUrl("https://x.example/processes/p/about"),
    ).toMatchObject({ slug: "p" });
  });

  it.each([
    ["the instance root", "https://kakogawa.diycities.jp/"],
    ["the process list", "https://kakogawa.diycities.jp/processes"],
    ["http", "http://kakogawa.diycities.jp/processes/Env"],
    ["another scheme", "javascript:alert(1)//processes/x"],
    ["a port", "https://x.example:8443/processes/p"],
    ["credentials", "https://u:p@x.example/processes/p"],
    ["localhost", "https://localhost/processes/p"],
    ["an IPv4 literal", "https://127.0.0.1/processes/p"],
    ["a decimal IPv4 literal", "https://2130706433/processes/p"],
    ["an IPv6 literal", "https://[::1]/processes/p"],
    ["metadata IP", "https://169.254.169.254/processes/p"],
    ["an internal name", "https://db.internal/processes/p"],
    ["an mDNS name", "https://mini.local/processes/p"],
    ["a bad slug", "https://x.example/processes/%22%7D"],
    ["not a URL", "processes/p"],
    ["an oversized URL", `https://x.example/processes/${"a".repeat(3000)}`],
  ])("rejects %s", (_, url) => {
    expect(parseDecidimUrl(url)).toBeUndefined();
  });
});
