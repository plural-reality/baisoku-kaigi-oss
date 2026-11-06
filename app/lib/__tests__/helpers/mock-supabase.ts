import { vi } from "vitest";

type MockResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

type ChainableQuery = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function createChainableQuery(result: MockResult): ChainableQuery {
  const chain: ChainableQuery = {} as ChainableQuery;

  const methods = [
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "neq",
    "in",
    "or",
    "order",
    "limit",
    "range",
  ] as const;

  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  // Terminal methods return the result
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);

  // Make the chain itself thenable (for queries without .single())
  // biome-ignore lint/suspicious/noThenProperty: Supabase client requires thenable chain
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: MockResult) => void) => {
      return Promise.resolve(result).then(resolve);
    },
    enumerable: false,
  });

  return chain;
}

/**
 * Sequential mock: returns different results on each call to the same table.
 * After exhausting the sequence, the last result is reused.
 */
export function createSequentialMock(sequence: MockResult[]): MockResult[] {
  return [...sequence];
}

export function createMockSupabase(config?: {
  tables?: Record<string, MockResult | MockResult[]>;
}) {
  const defaultResult: MockResult = { data: null, error: null };
  const tables = config?.tables ?? {};
  const callCounters: Record<string, number> = {};

  const from = vi.fn((table: string) => {
    const entry = tables[table];
    if (!entry) return createChainableQuery(defaultResult);

    if (Array.isArray(entry)) {
      const idx = callCounters[table] ?? 0;
      callCounters[table] = idx + 1;
      const result = idx < entry.length ? entry[idx] : entry[entry.length - 1];
      return createChainableQuery(result);
    }

    return createChainableQuery(entry);
  });

  return { from, auth: { getUser: vi.fn() } };
}

/**
 * Mirrors lib/supabase selectAllRange for tests: the mocked chain returns every
 * row in a single page, so one buildPage call yields the full result.
 */
export async function mockSelectAllRange<T>(
  buildPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  const { data, error } = await buildPage(0, 999);
  return { data: data ?? [], error };
}

/**
 * Convenience: success result
 */
export function mockSuccess(data: unknown): MockResult {
  return { data, error: null };
}

/**
 * Convenience: error result
 */
export function mockError(message: string, code?: string): MockResult {
  return { data: null, error: { message, code } };
}

/**
 * Convenience: "not found" error (PGRST116)
 */
export function mockNotFound(): MockResult {
  return mockError("not found", "PGRST116");
}
