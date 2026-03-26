import { spawn } from 'node:child_process';

const coverageAreas = [
  {
    name: 'failures',
    thresholds: { lines: 90, branches: 85, functions: 90 },
    includes: ['src/utils/failure.js'],
    tests: ['test/failure_classification.test.js'],
  },
  {
    name: 'schema',
    thresholds: { lines: 90, branches: 75, functions: 80 },
    includes: ['src/schema/catalog.js'],
    tests: ['test/catalog_schema.test.js'],
  },
  {
    name: 'persistence',
    thresholds: { lines: 90, branches: 65, functions: 90 },
    includes: ['src/io/storage.js'],
    tests: ['test/storage_manifest.test.js', 'test/scrape_pipeline.test.js'],
  },
  {
    name: 'scraping',
    thresholds: { lines: 60, branches: 50, functions: 60 },
    includes: [
      'src/scrape.js',
      'src/engines/*.js',
      'src/extract/*.js',
      'src/adapters/*.js',
    ],
    tests: [
      'test/extract_price.test.js',
      'test/site_regression.test.js',
      'test/browser_engines.test.js',
      'test/scrape_pipeline.test.js',
    ],
  },
];

function runNodeTestCommand(area) {
  const args = [
    '--test',
    '--experimental-test-isolation=none',
    '--experimental-test-coverage',
    `--test-coverage-lines=${area.thresholds.lines}`,
    `--test-coverage-branches=${area.thresholds.branches}`,
    `--test-coverage-functions=${area.thresholds.functions}`,
    ...area.includes.map((item) => `--test-coverage-include=${item}`),
    ...area.tests,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Coverage gate failed for area "${area.name}" with exit code ${code}`));
    });
  });
}

async function main() {
  for (const area of coverageAreas) {
    console.log(`\n[coverage] validating ${area.name}`);
    await runNodeTestCommand(area);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
