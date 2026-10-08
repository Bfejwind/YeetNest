export function indexerSettings(env) {
  const integer = (key, fallback, min, max) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}.`);
    return value;
  };
  const role = env.INDEXER_ROLE || 'all';
  if (!['all', 'scan', 'process'].includes(role)) throw new Error('INDEXER_ROLE must be all, scan or process.');
  return { role, concurrency: integer('INDEXER_CONCURRENCY', 4, 1, 16), pageSize: integer('INDEXER_PAGE_SIZE', 100, 1, 1000), scanInterval: integer('INDEXER_SCAN_INTERVAL_MS', 2000, 250, 60000), maxJobs: integer('INDEXER_MAX_PENDING', 10000, 100, 1000000) };
}
