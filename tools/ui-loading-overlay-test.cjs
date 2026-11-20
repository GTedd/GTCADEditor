// 「正在读取游戏数据…」：这件物品自己的数据一到就撤（留一小段让重画先跑），不再等后台零散请求安静下来；
// 数据很快到时根本不显示；数据到了一定补画一次；读不到时 1.5 秒无动静放行、最多 8 秒。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./lib/ui-harness.cjs');
const t = H.create({ data: {} }),
  c = t.c;
// EditorLoading lives in app.js, which the harness does not boot.
const app = fs.readFileSync(path.join(t.dir, 'js/app.js'), 'utf8');
vm.runInContext(app.slice(0, app.lastIndexOf('boot();')), c, { filename: 'js/app.js' });
let now = 1700000000000;
c.__t = now; // the harness's Date.now()
let ready = false,
  redraws = 0;
const L = c.EditorLoading;
L.ready = () => ready;
c.redrawRegistryPage = () => redraws++;
c.Store.open({ id: 'minecraft:diamond_sword', count: 1, comps: {} }, true);
const perf = [];
c.EditorDiag.perf = (site, fields) => perf.push([site, fields]);
const win = t.root.querySelector('#win');
const shown = () => !!win.querySelector('.ed-loading') && !win.querySelector('.ed-loading').classList.contains('out');
// Advance the clock in 100 ms steps, the overlay's own tick period; background requests keep trickling in.
function run(ms, trickle) {
  for (let i = 0; i < ms / 100; i++) {
    now += 100;
    c.__t = now;
    if (trickle) L.touch(true);
    if (!L.timer) return;
    L.tick();
  }
}
function open() {
  ready = false;
  redraws = 0;
  perf.length = 0;
  L.arm();
  L.touch(true);
  L.begin();
}

// Data in 200 ms with requests still trickling: never shown, closed ~120 ms after the data, one final redraw.
open();
run(200, true);
ready = true;
run(400, true);
assert.equal(L.timer, null, 'done right after the item data, not after the background requests');
assert.equal(shown(), false, 'fast data never flashes the overlay');
assert.equal(redraws, 1, 'final redraw even though the overlay never showed');
assert.ok(perf[0][1].total_ms <= 400, 'closed within ~200 ms of the data: ' + perf[0][1].total_ms);

// Slow data (1 s): overlay shows after 300 ms, closes ~120 ms after the data despite the trickle (was +2.5 s).
open();
run(400, true);
assert.equal(shown(), true, 'shown once loading is noticeable');
run(600, true);
ready = true;
run(300, true);
assert.equal(L.timer, null);
assert.ok(perf[0][1].total_ms <= 1300, 'total ' + perf[0][1].total_ms);
assert.equal(perf[0][1].shown, true);

// Data never comes and requests stop: give up after 1.5 s of silence.
open();
run(300, true);
run(1700, false);
assert.equal(L.timer, null, 'quiet failure releases the page');
assert.equal(perf[0][1].data_ready_ms, -1);

// Requests never stop and data never comes: hard cap 8 s.
open();
run(9000, true);
assert.equal(L.timer, null, 'never spins forever');
assert.ok(perf[0][1].total_ms <= 8200);
// A request the page's send limit dropped (oriel.send() === false) waits in HostOutbox and is sent again shortly;
// the next lookup does not repeat it, and an accepted one is never repeated. Otherwise the item never becomes
// "ready" and only the fallbacks end the wait.
{
  const t2 = H.create({ data: {} }),
    c2 = t2.c;
  c2.Reg.meta = {};
  c2.Reg.live = () => true;
  let accept = false;
  const names = [];
  c2.oriel.send = (k, v) => {
    names.push(v && v.name);
    return accept;
  };
  const count = (n) => names.filter((x) => x === n).length;
  assert.equal(c2.Reg.defaultsOf('minecraft:stone'), null);
  c2.Reg.itemMeta('minecraft:stone');
  assert.equal(c2.HostOutbox.pending(), 2, 'dropped requests wait in the outbox');
  accept = true;
  c2.Reg.defaultsOf('minecraft:stone');
  c2.Reg.itemMeta('minecraft:stone');
  assert.equal(count('item_defaults_one'), 1, 'a queued request is not repeated by the lookup');
  t2.timers.splice(0).forEach((x) => x.fn());
  assert.equal(c2.HostOutbox.pending(), 0, 'the outbox sent them again');
  assert.equal(count('item_defaults_one'), 2, 'dropped defaults request sent again');
  assert.equal(count('item_meta_one'), 1, 'a request queued behind a dropped one is sent once, in order');
  c2.Reg.defaultsOf('minecraft:stone');
  c2.Reg.itemMeta('minecraft:stone');
  assert.equal(count('item_defaults_one'), 2, 'accepted request not repeated');
  assert.equal(count('item_meta_one'), 1);
}
console.log(
  'PASS loading overlay: closes right after the item data, no flash for fast data, final redraw, 1.5 s / 8 s fallbacks, dropped requests resent by the outbox.'
);
