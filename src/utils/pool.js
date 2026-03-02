export async function runWithPool(items, concurrency, worker) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }

  const size = Math.max(1, Number.parseInt(String(concurrency), 10) || 1);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          unhandled: true,
        };
      }
    }
  }

  const workers = Array.from({ length: Math.min(size, Math.max(items.length, 1)) }, consume);
  await Promise.all(workers);

  return results;
}

export function sleep(ms) {
  const duration = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, duration));
}