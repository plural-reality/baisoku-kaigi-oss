import { describe, expect, it } from "vitest";
import {
  GENERATION_IN_PROGRESS,
  respondExclusive,
  runExclusive,
} from "../single-flight";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("runExclusive", () => {
  it("refuses a second run of the same key while the first is in flight", async () => {
    const first = deferred<string>();
    let secondRan = false;

    const running = runExclusive("k", () => first.promise);
    const second = await runExclusive("k", async () => {
      secondRan = true;
      return "second";
    });
    first.resolve("first");

    expect(second).toEqual({ status: "busy" });
    expect(secondRan).toBe(false);
    expect(await running).toEqual({ status: "done", value: "first" });
  });

  it("does not block other keys", async () => {
    const first = deferred<string>();
    const running = runExclusive("a", () => first.promise);

    expect(await runExclusive("b", async () => "b")).toEqual({
      status: "done",
      value: "b",
    });
    first.resolve("a");
    await running;
  });

  it("releases the key after success and after failure", async () => {
    await runExclusive("k", async () => "ok");
    await expect(
      runExclusive("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await runExclusive("k", async () => "again")).toEqual({
      status: "done",
      value: "again",
    });
  });
});

describe("respondExclusive", () => {
  it("answers 409 with a recognisable code while busy", async () => {
    const first = deferred<Response>();
    const running = respondExclusive("r", () => first.promise);

    const busy = await respondExclusive("r", async () => new Response("x"));
    first.resolve(new Response("done"));

    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: GENERATION_IN_PROGRESS });
    expect(await (await running).text()).toBe("done");
  });
});
