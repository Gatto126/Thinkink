import process from 'node:process';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = resolve(root, 'node_modules/.bin/supabase');
const environment = { ...process.env };
if (
  process.platform === 'darwin' &&
  existsSync('/Applications/Docker.app/Contents/Resources/bin/docker')
) {
  environment.PATH = `/Applications/Docker.app/Contents/Resources/bin${delimiter}${environment.PATH ?? ''}`;
  const socket = `${process.env.HOME}/.docker/run/docker.sock`;
  if (!environment.DOCKER_HOST && existsSync(socket))
    environment.DOCKER_HOST = `unix://${socket}`;
}
const run = (args, capture = false) =>
  execFileSync(cli, args, {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
const loopback = (url) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
try {
  const command = process.argv[2];
  if (command === 'configure') {
    const status = JSON.parse(run(['status', '-o', 'json'], true));
    if (!status.API_URL || !loopback(status.API_URL))
      throw new Error('Expected local Supabase.');
    const path = resolve(root, 'apps/backend/.dev.vars');
    let content = existsSync(path)
      ? readFileSync(path, 'utf8')
      : '# Local development only. Do not commit.\n';
    const previous = parseEnv(content);
    if (previous.SUPABASE_URL && !loopback(previous.SUPABASE_URL))
      throw new Error('Refusing to replace a hosted configuration.');
    const values = {
      SUPABASE_URL: status.API_URL,
      SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
      SUPABASE_SECRET_KEY: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
      SIGNUP_INVITE_CODE: previous.SIGNUP_INVITE_CODE || 'thinkink-local',
      AUTH_LOCAL_SIGNUP: 'true',
      AUTH_ALLOWED_ORIGINS:
        'http://127.0.0.1:4173,http://127.0.0.1:5173,http://localhost:4173,http://localhost:5173',
    };
    for (const [key, value] of Object.entries(values)) {
      if (!value) throw new Error(`Missing local configuration: ${key}`);
      const line = `${key}=${JSON.stringify(value)}`;
      const pattern = new RegExp(`^${key}=.*$`, 'm');
      content = pattern.test(content)
        ? content.replace(pattern, () => line)
        : `${content.trimEnd()}\n${line}\n`;
    }
    writeFileSync(path, content, { mode: 0o600 });
    chmodSync(path, 0o600);
    console.log(
      'Local Supabase connected. Credentials saved only in apps/backend/.dev.vars. Restart the Worker.',
    );
  } else {
    const commands = {
      start: [
        'start',
        '--exclude',
        'realtime,storage-api,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor',
      ],
      stop: ['stop'],
      status: ['status', '-o', 'json'],
      migrate: ['migration', 'up', '--local'],
      test: ['test', 'db'],
    };
    if (!commands[command])
      throw new Error('Use start, stop, status, migrate, configure or test.');
    if (command === 'start') {
      // The CLI prints local secret keys on startup; keep them out of CI logs.
      run(commands[command], true);
      console.log(
        'Local Supabase started. Run npm run db:configure to connect the Worker.',
      );
    } else if (command === 'status') {
      const status = JSON.parse(run(commands[command], true));
      console.log({ api: status.API_URL, studio: status.STUDIO_URL });
    } else {
      run(commands[command]);
    }
  }
} catch {
  console.error(
    'Local database command failed. Check Docker and local Supabase; hosted configuration is never overwritten.',
  );
  process.exitCode = 1;
}
