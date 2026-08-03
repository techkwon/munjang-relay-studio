interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

type D1RunResult = {
  success: boolean;
  meta?: { changes?: number };
};

interface D1PreparedStatement {
  bind(...values: Array<unknown>): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<D1RunResult>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = D1RunResult>(statements: D1PreparedStatement[]): Promise<T[]>;
}

declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
