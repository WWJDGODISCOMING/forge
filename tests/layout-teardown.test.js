// #232: the layout browser teardown is bounded even when Chrome never exits and the server holds sockets open.
import { EventEmitter } from 'node:events';
import { createServer, request } from 'node:http';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, assert } from './harness.js';
import { teardown } from './layout/browser.js';

test('layout teardown: resolves within the bound with a Chrome that never exits and an open keep-alive socket', async () => {
  const srv = createServer((req, res) => res.end('ok'));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const agent = new (await import('node:http')).Agent({ keepAlive: true });
  await new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port: srv.address().port, agent }, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject).end();
  });
  const proc = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill() { return true; } }); // ignores SIGKILL
  const ws = { close() { throw new Error('already closed'); } };
  const dir = mkdtempSync(join(tmpdir(), 'forge-teardown-'));
  const t0 = Date.now();
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try { await teardown({ ws, proc, srv, dir }, 1200); } finally { console.warn = warn; agent.destroy(); }
  const ms = Date.now() - t0;
  assert(ms < 1800, `teardown took ${ms} ms`);
  assert(warnings.some((w) => /Chrome exit/.test(w)), 'should warn that Chrome did not exit');
  assert(!srv.listening, 'server should be closed');
  assert(!existsSync(dir), 'profile dir should be removed');
});

test('layout teardown: a fast, clean shutdown logs nothing', async () => {
  const srv = createServer((req, res) => res.end('ok'));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const proc = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill() { setImmediate(() => proc.emit('exit')); return true; } });
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try { await teardown({ ws: { close() {} }, proc, srv, dir: mkdtempSync(join(tmpdir(), 'forge-teardown-')) }); } finally { console.warn = warn; }
  assert(warnings.length === 0, `unexpected warnings: ${warnings}`);
});
