import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns", () => ({ lookup: vi.fn() }));
vi.mock("axios", () => ({ default: { post: vi.fn() } }));

import { lookup } from "node:dns";
import axios from "axios";
import { guardedLookup, isBlockedAddress, postToDecidim } from "../http";

const mockedLookup = lookup as unknown as ReturnType<typeof vi.fn>;

const resolvesTo = (addresses: readonly string[]) => {
  mockedLookup.mockImplementation((_host, _options, callback) => {
    callback(
      null,
      addresses.map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      })),
    );
  });
};

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.77.183.125",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::7f00:1",
    "64:ff9b::a00:5",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:0:0:0:0:7f00:1",
    "64:ff9b::",
    "64:ff9b:1::1",
    "fec0::1",
    "2001::1",
    "::7f00:1",
    "::ffff:0:7f00:1",
    "192.88.99.1",
    "fe80::1%en0",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "133.242.0.1",
    "2606:4700:4700::1111",
  ])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe("postToDecidim", () => {
  const mockedPost = axios.post as unknown as ReturnType<typeof vi.fn>;

  it("posts the query to /api with every network guard on", async () => {
    mockedPost.mockResolvedValue({ data: { data: {} } });

    const result = await postToDecidim("https://x.example", "{ a }");

    expect(result).toEqual({ ok: true, body: { data: {} } });
    const [url, body, config] = mockedPost.mock.calls[0];
    expect(url).toBe("https://x.example/api");
    expect(body).toEqual({ query: "{ a }" });
    expect(config.proxy).toBe(false);
    expect(config.maxRedirects).toBe(0);
    expect(config.maxContentLength).toBeGreaterThan(0);
    expect(config.httpsAgent.options.lookup).toBe(guardedLookup);
  });

  it("turns a failed request into a value", async () => {
    mockedPost.mockRejectedValue(new Error("refused"));
    expect(await postToDecidim("https://x.example", "{ a }")).toEqual({
      ok: false,
    });
  });
});

describe("guardedLookup", () => {
  it("returns the address for a public name", () => {
    resolvesTo(["8.8.8.8"]);
    const callback = vi.fn();
    guardedLookup("x.example", { family: 0 }, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });

  it("returns every address when asked for all", () => {
    resolvesTo(["8.8.8.8", "2606:4700:4700::1111"]);
    const callback = vi.fn();
    guardedLookup("x.example", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
  });

  it("refuses a name when any of its addresses is private", () => {
    resolvesTo(["8.8.8.8", "10.0.0.5"]);
    const callback = vi.fn();
    guardedLookup("rebind.example", { all: true }, callback);
    expect(callback.mock.calls[0][0]).toMatchObject({
      code: "EBLOCKEDADDRESS",
    });
  });
});
