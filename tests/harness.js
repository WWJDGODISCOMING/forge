// Tiny test harness that works in Node and in the browser.
export const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

export function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function near(actual, expected, tol, msg = '') {
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`${msg} expected ${expected} ± ${tol}, got ${actual}`);
}

export async function runAll(log = console.log) {
  let pass = 0;
  let fail = 0;
  const only = typeof process !== 'undefined' && process.env && process.env.TEST_GREP; // TEST_GREP=onboarding runs only matching names
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    try {
      await t.fn();
      pass++;
      log(`  ✓ ${t.name}`);
    } catch (e) {
      fail++;
      log(`  ✗ ${t.name}\n      ${e.message}`);
    }
  }
  log(`\n${pass} passed, ${fail} failed`);
  return { pass, fail };
}
