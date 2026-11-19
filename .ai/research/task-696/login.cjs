// Refresh e2e/.secrets/state.json (git-ignored) via /api/auth/login. Never prints the password.
const path = require('path'), fs = require('fs');
const root = path.resolve(__dirname, '../../..');
const { request } = require(path.join(root, 'node_modules/playwright-core'));
(async () => {
  const pw = fs.readFileSync(path.join(root, 'e2e/.secrets/pw'), 'utf8').trim();
  const ctx = await request.newContext({ baseURL: process.argv[2] });
  const r = await ctx.post('/api/auth/login', { data: { email: 'doctor@ucc.local', password: pw } });
  console.log('login', r.status());
  if (r.ok()) await ctx.storageState({ path: path.join(root, 'e2e/.secrets/state.json') });
})();
