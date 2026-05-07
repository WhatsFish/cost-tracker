import { Client, type QueryResultRow } from "pg";

function config() {
  return {
    host: process.env.PG_HOST ?? "db",
    port: parseInt(process.env.PG_PORT ?? "5432", 10),
    user: process.env.PG_USER ?? "cost_tracker",
    password: process.env.PG_PASSWORD ?? "",
    database: process.env.PG_DB ?? "cost_tracker",
  };
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = new Client(config());
  await c.connect();
  try {
    const r = await c.query<T>(sql, params);
    return r.rows;
  } finally {
    await c.end();
  }
}
