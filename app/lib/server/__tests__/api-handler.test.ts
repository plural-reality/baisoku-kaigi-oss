import { describe, expect, it, vi } from "vitest";
import { handleApiError } from "../api-handler";
import { SessionAccessError } from "../session-access";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe("handleApiError", () => {
  it("returns the correct status for SessionAccessError (404)", async () => {
    const error = new SessionAccessError("Session not found", 404);
    const response = handleApiError(error);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Session not found");
  });

  it("returns the correct status for SessionAccessError (403)", async () => {
    const error = new SessionAccessError("Forbidden", 403);
    const response = handleApiError(error);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
  });

  it("returns 500 for unknown errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("something went wrong");
    const response = handleApiError(error);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Internal Server Error");
    expect(spy).toHaveBeenCalledWith("Unhandled API error:", error);
    spy.mockRestore();
  });

  it("returns 500 for non-Error values", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = handleApiError("string error");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Internal Server Error");
    spy.mockRestore();
  });
});
