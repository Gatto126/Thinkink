import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
const [version, worker] = process.argv.slice(2);
if (
  !version ||
  !worker ||
  !/^[a-f0-9-]{36}$/i.test(version) ||
  !/^[a-z0-9][a-z0-9-]{0,62}$/.test(worker)
) {
  console.error(
    'Usage: npm run release:rollback -- <previous-version-uuid> <worker-name>',
  );
  console.error(
    'Restores application code/assets only. Does not reset the database or secrets.',
  );
  process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(
  fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url)),
  [
    'rollback',
    version,
    '--name',
    worker,
    '--config',
    'apps/backend/wrangler.jsonc',
    '--message',
    'Restore the previous verified beta release',
  ],
  { cwd: root, stdio: 'inherit' },
);
