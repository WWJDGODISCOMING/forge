// Loads index.js with the real firebase-functions / firebase-admin packages (CI installs them) to catch
// wiring mistakes: every function exported, each one capped at 2 instances in us-east1. Skipped when the
// packages aren't installed (a plain `node --test` on a machine without `npm install`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const installed = existsSync(new URL('../node_modules/firebase-functions/package.json', import.meta.url));

test('index.js exports every function with region us-east1 and maxInstances 2', { skip: !installed && !process.env.CI && 'npm install first' }, async () => {
  process.env.GCLOUD_PROJECT = 'demo-forge';
  const mod = await import('../index.js');
  const names = ['withingsAuthStart', 'withingsOAuthCallback', 'withingsWebhook', 'withingsTask', 'withingsSyncNow', 'withingsDataCheck', 'withingsDisconnect', 'withingsMaintenance', 'withingsReimport', 'healthIngest', 'createShortcutToken', 'revokeShortcutToken', 'importHealthDays', 'deleteAppleHealthData', 'foodSearch', 'foodBarcode', 'snapMealPhoto', 'personalizeMealPlan', 'askForge'];
  for (const n of names) {
    assert.ok(mod[n], `${n} exported`);
    const ep = mod[n].__endpoint;
    assert.ok(ep, `${n} has an endpoint`);
    assert.deepEqual(ep.region, ['us-east1'], `${n} region`);
    assert.equal(ep.maxInstances, 2, `${n} maxInstances`);
  }
  assert.ok(mod.withingsTask.__endpoint.taskQueueTrigger, 'withingsTask is a task queue function');
  assert.ok(mod.withingsMaintenance.__endpoint.scheduleTrigger, 'maintenance is scheduled');
  assert.equal(Object.keys(mod).filter((k) => mod[k] && mod[k].__endpoint && mod[k].__endpoint.eventTrigger).length, 0, 'no event (Firestore) triggers');
  if (process.env.GITHUB_ACTIONS) (await import('node:fs')).writeFileSync(new URL('../.smoke-ran', import.meta.url), `${names.length}`);
});
