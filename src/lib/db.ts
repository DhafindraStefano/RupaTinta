import postgres from 'postgres';

let client: postgres.Sql | undefined;

// One pooled client per server instance. `prepare: false` keeps it compatible with Neon's pgbouncer endpoint.
export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  client ??= postgres(url, { max: 5, idle_timeout: 20, prepare: false });
  return client;
}
