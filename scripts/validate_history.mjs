import { inspectHistoryIntegrity } from '../src/io/history_integrity.js';

try {
  const report = await inspectHistoryIntegrity();
  if (!report.ok) {
    for (const entry of report.issues) {
      console.error(`[${entry.code}] ${entry.file}: ${entry.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `History validation passed for ${report.stats.valid_runs} run(s), `
      + `${report.stats.error_files} error payload(s), and both data roots.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
