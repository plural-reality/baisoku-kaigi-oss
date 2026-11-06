import { describe, expect, it } from "vitest";
import { clientIpOf } from "../client-ip";

const headers = (map: Record<string, string>) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
});

describe("clientIpOf", () => {
  it("takes the first x-forwarded-for hop", () => {
    expect(
      clientIpOf(headers({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" })),
    ).toBe("203.0.113.9");
  });

  it("falls back to the other proxy headers in order", () => {
    expect(
      clientIpOf(
        headers({ "cf-connecting-ip": "198.51.100.7", "x-real-ip": "" }),
      ),
    ).toBe("198.51.100.7");
  });

  it("returns null when nothing usable is present", () => {
    expect(clientIpOf(headers({}))).toBeNull();
    expect(clientIpOf(headers({ "x-forwarded-for": " , " }))).toBeNull();
  });
});
