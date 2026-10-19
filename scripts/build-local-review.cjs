require('./local-review-env.cjs');
const { spawnSync } = require('node:child_process');
for (const args of [
  ['node_modules/prisma/build/index.js', 'generate'],
  ['node_modules/next/dist/bin/next', 'build'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env, windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
