import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We need to mock axios before importing llm
vi.mock("axios", async () => {
  const actual = (await vi.importActual("axios")) as typeof import("axios") &
    Record<string, unknown>;
  const actualDefault = actual.default as Record<string, unknown>;
  return {
    ...actual,
    default: {
      ...actualDefault,
      post: vi.fn(),
      isAxiosError:
        (actualDefault.isAxiosError as ((e: unknown) => boolean) | undefined) ??
        ((err: unknown) =>
          (err as { isAxiosError?: boolean })?.isAxiosError === true),
    },
  };
});

import { Readable } from "node:stream";
import axios from "axios";
import {
  callLLM,
  callLLMStreaming,
  callLLMWithMeta,
  extractUpstreamError,
  LLMAbortedError,
  LLMUnavailableError,
} from "../llm";
import { stringListFormat } from "../llm-structured-output";

const mockedPost = axios.post as ReturnType<typeof vi.fn>;

function makeAxiosErrorWithData(status: number | undefined, data: unknown) {
  return {
    isAxiosError: true,
    message: "request failed",
    response: status === undefined ? undefined : { status, data },
  };
}

function makeAxiosError(
  status: number,
  statusText: string,
  headers?: Record<string, string>,
) {
  const error = new Error(statusText) as Error & {
    isAxiosError: boolean;
    response: {
      status: number;
      statusText: string;
      data: Record<string, unknown>;
      headers: Record<string, string>;
    };
    config: { method: string; url: string };
  };
  error.isAxiosError = true;
  error.response = {
    status,
    statusText,
    data: {},
    headers: headers ?? {},
  };
  error.config = {
    method: "post",
    url: "https://openrouter.ai/api/v1/chat/completions",
  };
  return error;
}

function makeSuccessResponse(content: string) {
  return {
    data: {
      choices: [{ message: { content } }],
    },
  };
}

function makeChoiceErrorResponse(options: {
  code: number | string;
  message: string;
  errorType?: string;
}) {
  return {
    data: {
      choices: [
        {
          error: {
            code: options.code,
            message: options.message,
            metadata: options.errorType
              ? { error_type: options.errorType }
              : undefined,
          },
          message: {
            role: "assistant",
            content: null,
          },
        },
      ],
    },
  };
}

/**
 * Run callLLM and advance fake timers until the promise settles.
 * Attaches a no-op .catch to prevent unhandled rejection warnings
 * while timers are being drained.
 */
const runWithTimers = async <T>(promise: Promise<T>): Promise<T> => {
  // Prevent unhandled rejection while draining timers
  const guarded = promise.catch(() => {});
  for (let i = 0; i < 20; i++) {
    await vi.advanceTimersByTimeAsync(60_000);
  }
  // Suppress the guard — the real assertion uses the original promise
  void guarded;
  return promise;
};

describe("extractUpstreamError", () => {
  it("returns an empty object for a non-axios error", () => {
    const result = extractUpstreamError(new Error("boom"));
    expect(result.status).toBeUndefined();
    expect(result.body).toBeUndefined();
  });

  it("returns status only when the response body is absent", () => {
    const result = extractUpstreamError(makeAxiosErrorWithData(403, undefined));
    expect(result.status).toBe(403);
    expect(result.body).toBeUndefined();
  });

  it("passes through a string response body", () => {
    const result = extractUpstreamError(
      makeAxiosErrorWithData(402, "no credits"),
    );
    expect(result.status).toBe(402);
    expect(result.body).toBe("no credits");
  });

  it("serializes an OpenRouter JSON error body", () => {
    const result = extractUpstreamError(
      makeAxiosErrorWithData(403, {
        error: { code: 403, message: "Key limit exceeded" },
      }),
    );
    expect(result.status).toBe(403);
    expect(result.body).toContain("Key limit exceeded");
  });

  it("does not serialize a streaming (Readable) response body", () => {
    const result = extractUpstreamError(
      makeAxiosErrorWithData(403, new Readable()),
    );
    expect(result.status).toBe(403);
    // Must NOT leak the stream's internal state (_readableState, socket, ...).
    expect(result.body).toBeUndefined();
  });

  it("redacts participant input echoed in a moderation body", () => {
    const result = extractUpstreamError(
      makeAxiosErrorWithData(403, {
        error: {
          code: 403,
          message: "flagged",
          metadata: { flagged_input: "secret meeting transcript" },
        },
      }),
    );
    expect(result.body).toContain("[redacted]");
    expect(result.body).not.toContain("secret meeting transcript");
  });

  it("extracts the provider error.message as providerMessage", () => {
    const result = extractUpstreamError(
      makeAxiosErrorWithData(403, {
        error: { code: 403, message: "Key limit exceeded" },
      }),
    );
    expect(result.status).toBe(403);
    expect(result.providerMessage).toBe("Key limit exceeded");
  });
});

describe("callLLM", () => {
  const originalEnv = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv !== undefined) {
      process.env.OPENROUTER_API_KEY = originalEnv;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("throws when OPENROUTER_API_KEY is not set", async () => {
    delete process.env.OPENROUTER_API_KEY;

    await expect(callLLM([{ role: "user", content: "hello" }])).rejects.toThrow(
      "OPENROUTER_API_KEY is not set",
    );
  });

  it("returns content from a successful response", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";

    mockedPost.mockResolvedValueOnce(makeSuccessResponse("Hello from LLM"));

    const result = await callLLM([{ role: "user", content: "hi" }]);
    expect(result).toBe("Hello from LLM");

    expect(mockedPost).toHaveBeenCalledOnce();
    const [url, body, config] = mockedPost.mock.calls[0];
    expect(url).toContain("openrouter.ai");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(config.headers.Authorization).toBe("Bearer test-key");
  });

  it("throws rate-limit error on 429 after all retries exhausted", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";

    const axiosError = makeAxiosError(429, "Too Many Requests");

    mockedPost
      .mockRejectedValueOnce(axiosError)
      .mockRejectedValueOnce(axiosError)
      .mockRejectedValueOnce(axiosError)
      .mockRejectedValueOnce(axiosError)
      .mockRejectedValueOnce(axiosError);

    const promise = callLLM([{ role: "user", content: "hi" }]);

    await expect(runWithTimers(promise)).rejects.toThrow("Rate limit exceeded");
    expect(mockedPost).toHaveBeenCalledTimes(5);
  });

  it("throws generic error on non-retryable API errors without retry", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";

    mockedPost.mockRejectedValueOnce(
      makeAxiosError(500, "Internal Server Error"),
    );

    await expect(callLLM([{ role: "user", content: "hi" }])).rejects.toThrow(
      "Failed to call LLM API",
    );
    expect(mockedPost).toHaveBeenCalledOnce();
  });

  it("throws LLMUnavailableError carrying the upstream status on 403", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";

    mockedPost.mockRejectedValueOnce(makeAxiosError(403, "Forbidden"));

    const error = await callLLM([{ role: "user", content: "hi" }]).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(LLMUnavailableError);
    expect((error as LLMUnavailableError).status).toBe(403);
    // Message stays stable so the session-report layer maps by status, not text.
    expect((error as Error).message).toBe("Failed to call LLM API");
    expect(mockedPost).toHaveBeenCalledOnce();
  });

  it("carries the OpenRouter reason so 403 is not mislabeled", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";

    mockedPost.mockRejectedValueOnce(
      makeAxiosErrorWithData(403, {
        error: { code: 403, message: "Key limit exceeded" },
      }),
    );

    const error = await callLLM([{ role: "user", content: "hi" }]).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(LLMUnavailableError);
    expect((error as LLMUnavailableError).status).toBe(403);
    expect((error as LLMUnavailableError).providerMessage).toBe(
      "Key limit exceeded",
    );
  });

  it("throws generic error on non-retryable choice-level provider errors without retry", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";

    mockedPost.mockResolvedValueOnce(
      makeChoiceErrorResponse({
        code: 400,
        message: "Prompt rejected",
        errorType: "invalid_request",
      }),
    );

    await expect(callLLM([{ role: "user", content: "hi" }])).rejects.toThrow(
      "Failed to call LLM API",
    );
    expect(mockedPost).toHaveBeenCalledOnce();
  });

  it("passes the model parameter to the API", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";

    mockedPost.mockResolvedValueOnce(makeSuccessResponse("response"));

    await callLLM([{ role: "user", content: "hi" }], "custom-model");
    expect(mockedPost.mock.calls[0][1].model).toBe("custom-model");
  });

  it("keeps OpenRouter's response id, resolved model and usage", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    mockedPost.mockResolvedValueOnce({
      data: {
        id: "gen-123",
        model: "google/resolved-model",
        usage,
        choices: [{ message: { content: "text" } }],
      },
    });

    await expect(
      callLLMWithMeta([{ role: "user", content: "hi" }], "requested-model"),
    ).resolves.toEqual({
      content: "text",
      model: "google/resolved-model",
      generationId: "gen-123",
      usage,
    });
  });

  it("falls back to the requested model when the response omits metadata", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    mockedPost.mockResolvedValueOnce(makeSuccessResponse("text"));

    await expect(
      callLLMWithMeta([{ role: "user", content: "hi" }], "requested-model"),
    ).resolves.toEqual({
      content: "text",
      model: "requested-model",
      generationId: null,
      usage: null,
    });
    // Unstructured calls send no response_format / provider fields.
    expect(mockedPost.mock.calls[0][1]).not.toHaveProperty("response_format");
    expect(mockedPost.mock.calls[0][1]).not.toHaveProperty("provider");
  });

  it("sends a strict json_schema response_format and requires the parameter", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    mockedPost.mockResolvedValueOnce(makeSuccessResponse('{"items":[]}'));
    const format = stringListFormat("test_list", "items");

    await callLLM([{ role: "user", content: "hi" }], "m", {
      responseFormat: format,
    });
    expect(mockedPost.mock.calls[0][1]).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "test_list",
          strict: true,
          schema: {
            type: "object",
            properties: { items: { type: "array", items: { type: "string" } } },
            required: ["items"],
            additionalProperties: false,
          },
        },
      },
    });
  });

  describe("retry logic", () => {
    it("retries on 429 and succeeds", async () => {
      process.env.OPENROUTER_API_KEY = "test-key";

      mockedPost
        .mockRejectedValueOnce(makeAxiosError(429, "Too Many Requests"))
        .mockResolvedValueOnce(makeSuccessResponse("retry success"));

      const promise = callLLM([{ role: "user", content: "hi" }]);
      const result = await runWithTimers(promise);
      expect(result).toBe("retry success");
      expect(mockedPost).toHaveBeenCalledTimes(2);
    });

    it("retries on 502 and succeeds", async () => {
      process.env.OPENROUTER_API_KEY = "test-key";

      mockedPost
        .mockRejectedValueOnce(makeAxiosError(502, "Bad Gateway"))
        .mockResolvedValueOnce(makeSuccessResponse("recovered"));

      const promise = callLLM([{ role: "user", content: "hi" }]);
      const result = await runWithTimers(promise);
      expect(result).toBe("recovered");
      expect(mockedPost).toHaveBeenCalledTimes(2);
    });

    it("retries on 503 and succeeds", async () => {
      process.env.OPENROUTER_API_KEY = "test-key";

      mockedPost
        .mockRejectedValueOnce(makeAxiosError(503, "Service Unavailable"))
        .mockResolvedValueOnce(makeSuccessResponse("back online"));

      const promise = callLLM([{ role: "user", content: "hi" }]);
      const result = await runWithTimers(promise);
      expect(result).toBe("back online");
      expect(mockedPost).toHaveBeenCalledTimes(2);
    });

    it("retries on choice-level provider_unavailable payload and succeeds", async () => {
      process.env.OPENROUTER_API_KEY = "test-key";

      mockedPost
        .mockResolvedValueOnce(
          makeChoiceErrorResponse({
            code: 502,
            message: "Network connection lost.",
            errorType: "provider_unavailable",
          }),
        )
        .mockResolvedValueOnce(
          makeSuccessResponse("recovered from choice error"),
        );

      const promise = callLLM([{ role: "user", content: "hi" }]);
      const result = await runWithTimers(promise);
      expect(result).toBe("recovered from choice error");
      expect(mockedPost).toHaveBeenCalledTimes(2);
    });

    it("throws after 5 consecutive retryable failures", async () => {
      process.env.OPENROUTER_API_KEY = "test-key";

      mockedPost
        .mockRejectedValueOnce(makeAxiosError(502, "Bad Gateway"))
        .mockRejectedValueOnce(makeAxiosError(502, "Bad Gateway"))
        .mockRejectedValueOnce(makeAxiosError(502, "Bad Gateway"))
        .mockRejectedValueOnce(makeAxiosError(502, "Bad Gateway"))
        .mockRejectedValueOnce(makeAxiosError(502, "Bad Gateway"));

      const promise = callLLM([{ role: "user", content: "hi" }]);

      await expect(runWithTimers(promise)).rejects.toThrow(
        "Failed to call LLM API",
      );
      expect(mockedPost).toHaveBeenCalledTimes(5);
    });

    it("retries on ECONNABORTED (timeout) and succeeds", async () => {
      process.env.OPENROUTER_API_KEY = "test-key";

      const timeoutError = new Error(
        "timeout of 300000ms exceeded",
      ) as Error & {
        code: string;
        isAxiosError: boolean;
      };
      timeoutError.code = "ECONNABORTED";
      timeoutError.isAxiosError = true;

      mockedPost
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(makeSuccessResponse("timeout recovered"));

      const promise = callLLM([{ role: "user", content: "hi" }]);
      const result = await runWithTimers(promise);
      expect(result).toBe("timeout recovered");
      expect(mockedPost).toHaveBeenCalledTimes(2);
    });

    it("respects Retry-After header on 429", async () => {
      process.env.OPENROUTER_API_KEY = "test-key";

      const errorWithRetryAfter = makeAxiosError(429, "Too Many Requests", {
        "retry-after": "2",
      });

      mockedPost
        .mockRejectedValueOnce(errorWithRetryAfter)
        .mockResolvedValueOnce(makeSuccessResponse("after retry-after"));

      const promise = callLLM([{ role: "user", content: "hi" }]);
      const result = await runWithTimers(promise);
      expect(result).toBe("after retry-after");
      expect(mockedPost).toHaveBeenCalledTimes(2);
    });
  });
});

describe("callLLMStreaming", () => {
  const originalEnv = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv !== undefined) {
      process.env.OPENROUTER_API_KEY = originalEnv;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  const makeSseStream = async function* (chunks: string[]) {
    for (const chunk of chunks) {
      yield chunk;
    }
  };

  it("streams chunks and parses SSE delta content", async () => {
    mockedPost.mockResolvedValueOnce({
      data: makeSseStream([
        'data: {"choices":[{"delta":{"content":"こんにちは"}}]}\n',
        'data: {"choices":[{"delta":{"content":"世界"}}]}\n',
        "data: [DONE]\n",
      ]),
    });

    const received: string[] = [];
    await callLLMStreaming(
      [{ role: "user", content: "hi" }],
      (chunk) => received.push(chunk),
      "custom-stream-model",
    );

    expect(received).toEqual(["こんにちは", "世界"]);
    expect(mockedPost).toHaveBeenCalledOnce();
    const [url, body, config] = mockedPost.mock.calls[0];
    expect(url).toContain("openrouter.ai");
    expect(body.model).toBe("custom-stream-model");
    expect(body.stream).toBe(true);
    expect(config.responseType).toBe("stream");
    expect(config.timeout).toBe(300000);
  });

  it("retries once on timeout and then succeeds", async () => {
    const timeoutError = new Error("timeout of 300000ms exceeded") as Error & {
      code: string;
      isAxiosError: boolean;
    };
    timeoutError.code = "ECONNABORTED";
    timeoutError.isAxiosError = true;

    mockedPost.mockRejectedValueOnce(timeoutError).mockResolvedValueOnce({
      data: makeSseStream([
        'data: {"choices":[{"delta":{"content":"retry ok"}}]}\n',
        "data: [DONE]\n",
      ]),
    });

    const received: string[] = [];
    const promise = callLLMStreaming(
      [{ role: "user", content: "hi" }],
      (chunk) => received.push(chunk),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await promise;

    expect(received).toEqual(["retry ok"]);
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });
});

describe("aborting an LLM call", () => {
  const originalEnv = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OPENROUTER_API_KEY = originalEnv;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("does not start a request once the caller has given up", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      callLLM([{ role: "user", content: "hi" }], "m", {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(LLMAbortedError);
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("hands the signal to the request and does not retry after an abort", async () => {
    const controller = new AbortController();
    mockedPost.mockImplementationOnce(async () => {
      controller.abort();
      throw Object.assign(new Error("canceled"), { code: "ECONNABORTED" });
    });

    await expect(
      callLLM([{ role: "user", content: "hi" }], "m", {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(LLMAbortedError);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost.mock.calls[0][2]).toMatchObject({
      signal: controller.signal,
    });
  });

  it("stops a retry backoff as soon as the stream consumer disconnects", async () => {
    const controller = new AbortController();
    mockedPost.mockRejectedValueOnce(makeAxiosError(503, "Unavailable"));

    const pending = callLLMStreaming(
      [{ role: "user", content: "hi" }],
      () => undefined,
      "m",
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(LLMAbortedError);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });
});
