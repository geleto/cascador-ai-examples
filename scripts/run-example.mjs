import { access, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, resolve, relative } from 'node:path';
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
async function findMatches(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const matches = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (!entry.name.startsWith(basePrefix)) {
        continue;
      }

      const directory = join(dir, entry.name);
      const indexFile = join(directory, 'index.ts');

      try {
        await access(indexFile);
        matches.push({
          dir: directory,
          name: 'index.ts',
          displayName: relative(srcDir, indexFile) || indexFile,
        });
      } catch {
        // Ignore directories without an index.ts file
      }
    }

    return matches;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

const matches = (await Promise.all([srcDir].map((dir) => findMatches(dir)))).flat();

if (matches.length === 0) {
  console.error(`No example folder starting with "${basePrefix}" found in src.`);
  process.exitCode = 1;
  process.exit();
}

if (matches.length > 1) {
  console.error(`Found multiple matches for prefix "${basePrefix}". Please be more specific.`);
  matches.forEach((match) => console.error(` - ${match.displayName}`));
  process.exitCode = 1;
  process.exit();
}

const [match] = matches;
const targetFile = join(match.dir, match.name);

try {
  await import(pathToFileURL(targetFile).href);
} catch (error) {
  console.error(`Failed to run example "${match.displayName}".`);
  console.error(error);
  process.exitCode = 1;
  process.exit();
}

