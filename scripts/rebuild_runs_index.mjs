import { rebuildRunsIndex } from '../src/io/storage.js';

try {
  const result = await rebuildRunsIndex();
  console.log(
    `Runs manifest rebuilt with ${result.stats.valid_runs} valid run(s) `
    + `across ${result.manifest.daily.length} day(s).`,
  );

  for (const entry of result.issues) {
    console.warn(`[${entry.code}] ${entry.message}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
