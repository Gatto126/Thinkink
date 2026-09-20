// Explicit local fixture provisioning; never executed by startup or deployment.
import process from 'node:process';
import { URL } from 'node:url';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const config = parseEnv(
  readFileSync(new URL('../apps/backend/.dev.vars', import.meta.url), 'utf8'),
);
const url = new URL(config.SUPABASE_URL);
if (
  url.origin !== 'http://127.0.0.1:54321' ||
  config.AUTH_LOCAL_SIGNUP !== 'true'
)
  throw new Error(
    'Local administrator setup requires local Supabase and local signup.',
  );
const client = createClient(url.origin, config.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = 'admin@admin.com';
let user;
for (let page = 1; ; page++) {
  const { data, error } = await client.auth.admin.listUsers({
    page,
    perPage: 1000,
  });
  if (error) throw new Error('Cannot inspect local accounts.');
  user = data.users.find((value) => value.email === email);
  if (user || data.users.length < 1000) break;
}
if (user && user.app_metadata.localDevelopmentOnly !== true)
  throw new Error(
    'An account with this email already exists and is not a development fixture.',
  );
if (!user) {
  const { data, error } = await client.auth.admin.createUser({
    email,
    password: randomUUID() + randomUUID(),
    email_confirm: true,
    user_metadata: { username: 'thinkink_admin' },
    app_metadata: { localDevelopmentOnly: true },
  });
  if (error || !data.user)
    throw new Error('Cannot provision the local administrator.');
  user = data.user;
}
if (!/^[a-f0-9-]{36}$/.test(user.id))
  throw new Error('Invalid account identifier.');
// Keep the normal signup password policy intact. Only this explicit development
// fixture receives the short password requested for local testing.
execFileSync(
  '/Applications/Docker.app/Contents/Resources/bin/docker',
  [
    '-H',
    `unix://${process.env.HOME}/.docker/run/docker.sock`,
    'exec',
    '-i',
    'supabase_db_thinkink',
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
  ],
  {
    input: `update auth.users set encrypted_password = extensions.crypt('1234', extensions.gen_salt('bf')) where id = '${user.id}' and raw_app_meta_data @> '{"localDevelopmentOnly":true}';`,
    stdio: ['pipe', 'ignore', 'pipe'],
  },
);
const { error } = await client.from('moderators').upsert({ user_id: user.id });
if (error)
  throw new Error(
    'Cannot grant the local moderator role. Run database migrations first.',
  );
console.log(
  'Local development administrator ready: admin@admin.com. Use the requested test password.',
);
