import { resolve } from 'node:path';

export function projectRoot() {
  return resolve(process.env.DATA_ROOT || process.cwd());
}

export function primaryDataDir() {
  return resolve(projectRoot(), 'data');
}

export function mirrorDataDir() {
  return resolve(projectRoot(), 'docs', 'data');
}

export function cacheDir() {
  return resolve(projectRoot(), '.cache');
}
