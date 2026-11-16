// Runs every UI test under tools/ (each in its own node process) plus a syntax check of the UI scripts.
// Usage: node tools/ui-check-all.cjs [log directory]. Exit code 1 when anything fails.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const logs = path.resolve(process.argv[2] || process.env.UI_CHECK_LOG_DIR || path.join(root, 'build', 'ui-check'));
fs.mkdirSync(logs, { recursive: true });

// Generators and helpers that other programs drive; they are not tests on their own.
const notTests = new Set([
  'field-decl-gen.cjs',
  'i18n-add.cjs',
  'i18n-sync.cjs',
  'linked-attribute-native.cjs',
  'ui-check-all.cjs'
]);
const tests = fs
  .readdirSync(__dirname)
  .filter((name) => name.endsWith('.cjs') && !notTests.has(name))
  .sort()
  .map((name) => path.join(__dirname, name))
  .concat([path.join(__dirname, 'entity-feedback', 'item-drafts-test.cjs')]);

let failed = 0;
for (const file of tests) {
  const name = path.basename(file, '.cjs');
  const run = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = (run.stdout || '') + (run.stderr || '');
  fs.writeFileSync(path.join(logs, name + '.log'), output);
  const ok = run.status === 0;
  if (!ok) failed++;
  const last = output.trim().split('\n').pop() || '';
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + last.slice(0, 160)));
}

const scripts = path.join(root, 'client/src/main/resources/assets/cadeditor/ui/js');
for (const name of fs.readdirSync(scripts).filter((f) => f.endsWith('.js'))) {
  const run = spawnSync(process.execPath, ['--check', path.join(scripts, name)], { encoding: 'utf8' });
  if (run.status !== 0) {
    failed++;
    console.log('FAIL syntax ' + name + '  ' + (run.stderr || '').trim().split('\n')[0]);
  }
}

console.log(failed ? failed + ' failed (logs in ' + logs + ')' : tests.length + ' UI tests passed');
process.exit(failed ? 1 : 0);
