import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { cacheDir, projectRoot } from '../io/paths.js';

function safeSegment(value, fallback) {
  const normalized = String(value || fallback || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback || 'unknown';
}

export async function prepareDebugArtifactPaths({ runId, productId, engineName }) {
  const directory = resolve(
    cacheDir(),
    'debug',
    safeSegment(runId, 'run'),
    safeSegment(productId, 'product'),
    safeSegment(engineName, 'engine'),
  );

  await mkdir(directory, { recursive: true });

  return {
    directory,
    artifact_dir: relative(projectRoot(), directory).replace(/\\/g, '/'),
    htmlPath: resolve(directory, 'page.html'),
    screenshotPath: resolve(directory, 'screenshot.png'),
    metadataPath: resolve(directory, 'metadata.json'),
    tracePath: resolve(directory, 'trace.zip'),
  };
}

export async function writeFailureArtifacts({
  paths,
  html = '',
  metadata = {},
  page = null,
  saveScreenshot = true,
}) {
  const finalMetadata = { ...metadata };

  if (typeof html === 'string' && html.length > 0) {
    await writeFile(paths.htmlPath, html, 'utf8');
  }

  if (page && saveScreenshot) {
    try {
      await page.screenshot({
        path: paths.screenshotPath,
        fullPage: true,
      });
    } catch (error) {
      finalMetadata.screenshot_error = error instanceof Error ? error.message : String(error);
    }
  }

  await writeFile(paths.metadataPath, `${JSON.stringify(finalMetadata, null, 2)}\n`, 'utf8');
  return paths.artifact_dir;
}
