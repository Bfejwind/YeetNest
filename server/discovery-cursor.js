export function encodeCursor(row, query, status) {
  return Buffer.from(JSON.stringify({ created: Number(row.created || 0), pool: row.pool, query, status: status ?? null })).toString('base64url');
}

export function decodeCursor(value, query, status) {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== 'string' || value.length > 400 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(cursor.created) || cursor.created < 0 || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cursor.pool) || cursor.query !== query || cursor.status !== (status ?? null)) throw new Error();
    return { created: cursor.created, pool: cursor.pool };
  } catch { throw Object.assign(new Error('Invalid discovery cursor. Refresh the results.'), { status: 400 }); }
}
