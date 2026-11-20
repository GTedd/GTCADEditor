const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./lib/ui-harness.cjs');
const root = process.env.UI_DIR || path.resolve(__dirname, '../client/src/main/resources/assets/cadeditor/ui');
const source = fs.readFileSync(path.join(root, 'js/diagnostics.js'), 'utf8');
let now = 0;
const sent = [],
  frames = [],
  timers = [];
// Batched lines (diag_batch) are unpacked, so the assertions read one entry per log line or stage mark.
const messages = {
  get length() {
    return lines().length;
  },
  filter: (fn) => lines().filter(fn)
};
function lines() {
  const out = [];
  for (const [channel, value] of sent)
    if (channel === 'diag_batch') for (const item of value.items) out.push([item.channel, item.data]);
    else out.push([channel, value]);
  return out;
}
const flush = () => timers.splice(0).forEach((fn) => fn());
const context = vm.createContext({
  Date: { now: () => now },
  setTimeout: (fn) => timers.push(fn),
  requestAnimationFrame: (fn) => frames.push(fn),
  oriel: {
    send: (channel, value) => {
      sent.push([channel, value]);
      return true;
    }
  }
});
vm.runInContext(source, context);
context.EditorDiag.error('render', { name: 'TypeError', message: 'fixture', stack: 'at render (screens.js:1)' });
assert.equal(sent.length, 0, 'batched, not sent at once');
flush();
assert.equal(sent.length, 1, 'one diag_batch message');
assert.equal(sent[0][0], 'diag_batch');
assert.equal(messages.length, 1);
assert.equal(lines()[0][1].level, 'error');
assert.match(lines()[0][1].msg, /site=render TypeError: fixture.*screens.js:1/);
for (let i = 0; i < 50; i++) context.EditorDiag.error('render', new Error('fixture'));
flush();
assert.equal(messages.length, 1, 'repeat failure throttled independently of debug preference');
now = 5000;
context.EditorDiag.error('render', new Error('fixture'));
context.EditorDiag.perf('fixture.perf', { ms: 3 });
context.EditorDiag.phase('fixture.phase', () => 1);
flush();
assert.equal(sent.length, 2, 'a log line, a perf line and two stage marks in one message');
assert.match(lines()[1][1].msg, /repeated=50/);
assert.match(lines()[2][1].msg, /\[CAD-Editor-Perf\] site=fixture.perf ms=3/);
assert.deepEqual(
  lines()
    .slice(3)
    .map((m) => [m[0], m[1].state]),
  [
    ['editor_ready', 'begin'],
    ['editor_ready', 'end']
  ]
);
context.EditorDiag.ready();
context.EditorDiag.ready();
assert.equal(sent.filter((m) => m[0] === 'editor_ready').length, 1, 'load markers go out at once');
assert.equal(frames.length, 1);
frames[0]();
assert.deepEqual(
  sent.filter((m) => m[0] === 'editor_ready').map((m) => m[1].phase),
  ['boot', 'first_frame_callback']
);
context.oriel.send = () => {
  throw new Error('transport fixture');
};
assert.doesNotThrow(() => context.EditorDiag.warn('broken-transport', new Error('fixture')));
assert.doesNotThrow(flush);

const h = H.create();
// The page batches its log lines: run the batch timer, then read the lines out of the diag_batch messages.
const logged = (re) => {
  h.timers.splice(0).forEach((x) => x.fn());
  return h.sent.some(
    (m) => m[0] === 'diag_batch' && m[1].items.some((i) => i.channel === 'log' && re.test(i.data.msg))
  );
};
assert.equal(h.c.Prefs.get('debug', false), false);
h.c.Reg.subs = [
  () => {
    throw new Error('registry-render-fixture');
  }
];
h.c.Reg.flush();
assert(logged(/registry.subscriber.*registry-render-fixture/));
h.c.Valid.subs = [
  {
    f() {
      throw new Error('validation-render-fixture');
    }
  }
];
h.c.Valid.fire();
assert(logged(/validation.subscriber.*validation-render-fixture/));
assert(!h.sent.some((m) => m[0] === 'apply'), 'diagnostics cannot issue writes');
console.log(
  'PASS diagnostics: always-on errors, stack/site, throttling, single load markers, broken transport isolation, real registry/validation failure paths'
);
