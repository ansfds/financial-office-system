// Ignored local credentials are generated once, never copied from .env or production.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const file = path.resolve('.tmp/local-review-env.json');
if (!fs.existsSync(file)) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const password = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(
    file,
    JSON.stringify({
      DATABASE_URL:
        'postgresql://postgres:postgres@127.0.0.1:55432/postgres?schema=public&connection_limit=1&sslmode=disable&pgbouncer=true&statement_cache_size=0',
      SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
      RESET_SYSTEM_PASSWORD: crypto.randomBytes(24).toString('base64url'),
      RESET_ADMIN_USERNAMES: 'ANS',
      USER_ANS_PASSWORD: password,
      USER_MOHAMMED_PASSWORD: crypto.randomBytes(18).toString('base64url'),
      USER_HOSSAM_PASSWORD: crypto.randomBytes(18).toString('base64url'),
    }),
  );
  fs.writeFileSync(
    path.resolve('.tmp/local-review-access.txt'),
    `هذه بيانات دخول محلية لقاعدة اختبار منفصلة فقط.\nالرابط: http://localhost:3000/login\nالمستخدم: ANS\nكلمة المرور: ${password}\n`,
  );
}
const values = JSON.parse(fs.readFileSync(file, 'utf8'));
Object.assign(process.env, values);
process.env.LOCAL_REVIEW = 'true';
process.env.RESET_PASSWORD_HASH = '';
// Next's env loader must not resolve local testing through the production .env.
process.env.OPENAI_API_KEY = '';
module.exports = values;
