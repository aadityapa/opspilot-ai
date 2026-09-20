import { spawnSync } from 'node:child_process';
// Force optimized React output even when the developer's .env says development.
for (const args of [
  ['node_modules/typescript/bin/tsc', '--noEmit'],
  ['node_modules/vite/bin/vite.js', 'build'],
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'],
]) {
  const r = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
