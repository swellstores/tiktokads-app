import { vi } from "vitest";

type Row = Record<string, any>;

function value(row: Row, field: string): unknown {
  return field.split(".").reduce<any>((current, part) => (current === null || current === undefined ? undefined : current[part]), row) ?? null;
}

function matches(row: Row, where: Row | undefined): boolean {
  return Object.entries(where || {}).every(([field, expected]) => {
    const actual = value(row, field);
    if (expected === null) {
      // The store receives a query as text, where null becomes "null" and matches nothing
      throw new Error(`A query compares ${field} with null, which the store receives as the text "null"`);
    }
    if (expected && typeof expected === "object") {
      return Object.entries(expected).every(([operator, operand]) => {
        switch (operator) {
          case "$lt":
            return actual !== null && (actual as any) < (operand as any);
          default:
            throw new Error(`Operator ${operator} is not supported by the test store`);
        }
      });
    }
    return actual === expected;
  });
}

const UNIQUE: Record<string, string> = { checkouts: "cart_id", issues: "key" };

/**
 * An in-memory stand-in for the store API, as far as the app uses it: orders (stored as the
 * app reads them, with account and items expanded), carts, the app's collections and settings.
 * A refused write throws, as it does in a function.
 */
export function createStore(seed: { settings?: Row } = {}) {
  let sequence = 0;
  const collections: Record<string, Row[]> = { orders: [], carts: [], checkouts: [], issues: [] };
  let settings: Row = seed.settings || {};
  /** Called once for the next write that matches, to make it fail as the store API would */
  const failures: { when: (method: string, path: string) => boolean; error: Error }[] = [];

  function nextId(): string {
    sequence += 1;
    return (0x6ad10000 + sequence).toString(16).padStart(8, "0") + sequence.toString(16).padStart(16, "0");
  }

  function failing(method: string, path: string): void {
    const index = failures.findIndex((failure) => failure.when(method, path));
    if (index >= 0) {
      throw failures.splice(index, 1)[0].error;
    }
  }

  function locate(path: string): { name: string; id?: string } {
    const [, name, id] = path.split("/");
    if (!collections[name]) {
      throw new Error(`Unexpected request to ${path}`);
    }
    return { name, id };
  }

  const swell = {
    settings: vi.fn(async () => settings),
    get: vi.fn(async (path: string, query: Row = {}) => {
      failing("get", path);
      const { name, id } = locate(path);
      if (id) {
        const row = collections[name].find((item) => item.id === id);
        return row ? structuredClone(row) : "";
      }
      const found = collections[name].filter((row) => matches(row, query.where));
      return { count: found.length, results: found.slice(0, query.limit || 15).map((row) => structuredClone(row)) };
    }),
    post: vi.fn(async (path: string, body: Row) => {
      failing("post", path);
      const { name } = locate(path);
      const unique = UNIQUE[name];
      if (unique && collections[name].some((row) => row[unique] === body[unique])) {
        throw Object.assign(new Error("Validation failed"), { status: 400, body: { [unique]: { code: "UNIQUE", message: "Already exists" } } });
      }
      const row = { ...body, id: nextId(), date_created: new Date().toISOString() };
      collections[name].push(row);
      return structuredClone(row);
    }),
    put: vi.fn(async (path: string, body: Row) => {
      failing("put", path);
      const { name, id } = locate(path);
      const row = collections[name].find((item) => item.id === id);
      if (!row) {
        return "";
      }
      Object.assign(row, body);
      return structuredClone(row);
    }),
    delete: vi.fn(async (path: string) => {
      failing("delete", path);
      const { name, id } = locate(path);
      const index = collections[name].findIndex((row) => row.id === id);
      if (index >= 0) {
        collections[name].splice(index, 1);
      }
      return {};
    }),
  };

  return {
    swell,
    orders: collections.orders,
    carts: collections.carts,
    checkouts: collections.checkouts,
    issues: collections.issues,
    failures,
    nextId,
    get settings() {
      return settings;
    },
    set settings(next: Row) {
      settings = next;
    },
  };
}

export type TestStore = ReturnType<typeof createStore>;
