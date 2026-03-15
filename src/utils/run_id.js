export function createRunId(generatedAt = new Date().toISOString()) {
  return String(generatedAt)
    .trim()
    .replace(/:/g, '-')
    .replace(/\./g, '-');
}

export function runFileName(runId) {
  return `${runId}.json`;
}

export function inferRunDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function inferRunIdFromFileName(fileName) {
  return String(fileName || '').replace(/\.json$/i, '');
}
