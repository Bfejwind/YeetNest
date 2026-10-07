export async function withTimeout(operation, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'OPERATION_TIMEOUT' })), milliseconds);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
