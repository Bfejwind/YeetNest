import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installAutomationControl } from '../server/automation-control.js';

test('restart rejects unauthenticated and non-operator wallets before accessing worker credentials', async () => {
  const app = express();
  const fail = (message, status) => Object.assign(new Error(message), { status });
  const route = handler => (req,res,next) => Promise.resolve(handler(req,res)).catch(next);
  installAutomationControl(app, { config: { AUTOLAUNCH_ENABLED: 'true', AUTOLAUNCH_OPERATOR_WALLETS: 'operator', AUTOLAUNCH_SECRET_KEY: 'must-stay-private' }, auth: async req => {
    if (!req.headers.authorization) throw fail('Sign in.', 401);
    return req.headers.authorization;
  }, route, fail });
  app.use((error,req,res,next) => res.status(error.status || 500).json({error:error.message}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/automation/restart`;
    assert.equal((await fetch(url,{method:'POST'})).status,401);
    assert.equal((await fetch(url,{method:'POST',headers:{authorization:'other'}})).status,403);
    const response = await fetch(url,{method:'POST',headers:{authorization:'operator'}});
    assert.equal(response.status,503);
    assert.ok(!(await response.text()).includes('must-stay-private'));
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
