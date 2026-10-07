export function databaseConfig(connectionString) {
  const url = new URL(connectionString);
  // Render's public endpoint requires TLS; keep certificate verification enabled.
  const renderExternal = url.hostname.endsWith('.render.com');
  const explicitTls = [...url.searchParams.keys()].some(key => key.startsWith('ssl'));
  return {
    connectionString,
    ...(renderExternal && !explicitTls ? { ssl: { rejectUnauthorized: true } } : {}),
    connectionTimeoutMillis: 5000,
  };
}
