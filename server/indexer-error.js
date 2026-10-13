export function indexerErrorCode(error) {
  if (typeof error?.code === 'number') return error.code;
  const message = String(error?.message || '');
  if (/429|too many requests|rate.?limit/i.test(message)) return 'RPC_RATE_LIMIT';
  if (/401|403|unauthorized|forbidden|invalid api.?key/i.test(message)) return 'RPC_AUTH_ERROR';
  if (/timeout|timed out|abort/i.test(message) || /Timeout|Abort/.test(error?.name || '')) return 'RPC_TIMEOUT';
  if (/Finalized transaction not available/i.test(message)) return 'RPC_HISTORY_UNAVAILABLE';
  if (/fetch failed|network|ECONN|ENOTFOUND/i.test(message)) return 'RPC_NETWORK_ERROR';
  return /^[A-Z0-9_]{1,30}$/.test(String(error?.code || '')) ? error.code : 'PROCESSING_ERROR';
}
