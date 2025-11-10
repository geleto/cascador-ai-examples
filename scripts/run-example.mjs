import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { register } from 'tsx/esm/api';

register();

function getRequestedPrefix() {
  const cliArgs = process.argv.slice(2);
  if (cliArgs.length > 0) {
    return cliArgs[cliArgs.length - 1];
  }

  const raw = process.env.npm_config_argv;
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    const original = Array.isArray(parsed?.original) ? parsed.original : [];
    const filtered = original.filter((arg) => arg !== 'npm' && arg !== 'run' && arg !== 'run-script');
    if (filtered.length === 0) {
      return undefined;
    }
    return filtered[filtered.length - 1];
  } catch {
    return undefined;
  }
}

const prefix = getRequestedPrefix();

if (!prefix) {
  console.error('Usage: npm run example <prefix>');
  console.error('Example: npm run example 1');
  process.exitCode = 1;
  process.exit();
}

const basePrefix = `${prefix}-`;
const srcDir = resolve(process.cwd(), 'src');

const entries = await readdir(srcDir);
const matches = entries
  .filter((name) => name.startsWith(basePrefix))
  .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
  .filter((name) => !name.endsWith('.d.ts'));

if (matches.length === 0) {
  console.error(`No example file starting with "${basePrefix}" found in src.`);
  process.exitCode = 1;
  process.exit();
}

if (matches.length > 1) {
  console.error(`Found multiple matches for prefix "${basePrefix}". Please be more specific.`);
  matches.forEach((name) => console.error(` - ${name}`));
  process.exitCode = 1;
  process.exit();
}

const targetFile = join(srcDir, matches[0]);

try {
  await import(pathToFileURL(targetFile).href);
} catch (error) {
  console.error(`Failed to run example "${matches[0]}".`);
  console.error(error);
  process.exitCode = 1;
  process.exit();
}

