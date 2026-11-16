// 编辑历史窗口：请求只带白名单字段、按服务端给的能力显示按钮、渲染记录与详情、拒绝时给出原因、清除必须带筛选条件。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');

const h = H.create({ data: { uiLocale: 'zh_cn' } });
const c = h.c;
function next(action) {
  const [channel, msg] = h.sent.shift();
  assert.equal(channel, 'history');
  assert.equal(msg.action, action);
  assert.ok(/^hs\d+-/.test(msg.requestId), 'page request id');
  return msg;
}
function reply(msg, fields) {
  c.EditHistory.receive(
    Object.assign({ status: 'history', op: 'history', requestId: msg.requestId, action: msg.action }, fields)
  );
}
const visible = (el) => el.style.display !== 'none';
const button = (text) => h.root.querySelectorAll('.k-btn').find((b) => b.textContent.includes(text));

// A reader: may view all, cannot edit or delete.
c.openHistory({});
const caps = next('capabilities');
reply(caps, {
  capabilities: { 'history.view': true, 'history.own': true, 'history.edit': false, 'history.delete': false },
  enabled: true
});
let list = next('list');
assert.deepEqual(JSON.parse(JSON.stringify(list.filter)), {}, 'no filter at first');
assert.equal(list.page, 0);
assert.ok(!visible(button('添加记录')), 'no add without history.edit');
assert.ok(!visible(button('按条件清除')), 'no purge without history.delete');
reply(list, {
  total: 2,
  page: 0,
  size: 20,
  scope: 'all',
  records: [
    {
      id: 7,
      time: 1700000000000,
      actor: { id: 'u-1', name: 'Steve' },
      action: 'world.apply',
      target: 'block minecraft:overworld 1 2 3 minecraft:chest',
      outcome: 'denied',
      code: 'not_allowed',
      node: 'cadeditor.world.edit',
      detail: { reason: 'Missing editor permission cadeditor.world.edit' },
      tags: ['forged']
    },
    {
      id: 6,
      time: 1699999990000,
      actor: { id: 'u-2', name: 'Alex' },
      action: 'item.apply',
      target: 'inventory[0] minecraft:stone',
      outcome: 'ok',
      note: 'fine'
    }
  ]
});
let rows = h.root.querySelectorAll('.hs-row');
assert.equal(rows.length, 2);
assert.match(rows[0].textContent, /#7.*Steve.*world\.apply.*无权限.*minecraft:chest.*forged/);
assert.match(h.root.querySelector('.hs-stat').textContent, /共 2 条/);
rows[0].click();
const detail = h.root.querySelector('.hs-detail');
assert.ok(detail, 'clicking a row opens its detail');
assert.match(detail.textContent, /cadeditor\.world\.edit/);
assert.ok(detail.querySelector('.hs-note').getAttribute('readonly') !== null, 'note is read-only without history.edit');
assert.ok(!detail.textContent.includes('保存备注和标签'), 'no save without history.edit');

// Filters go to the server as the filter object.
c.EditHistory.wait = {};
h.sent.length = 0;
const seg = h.root.querySelectorAll('.k-segi').find((s) => s.textContent === '无权限');
// Every filter choice carries an icon; outcome icons share the list badge colour class.
const segs = h.root.querySelectorAll('.k-segi');
assert.equal(segs.length, 12);
for (const s of segs) assert.ok(s.querySelector('.o-ico'), 'filter "' + s.textContent + '" has an icon');
assert.ok(seg.classList.contains('hs-o-denied'));
assert.equal(
  segs
    .find((s) => s.textContent === '保险库发放')
    .querySelector('.o-ico')
    .getAttribute('src'),
  'oriel:textures/icons/chest.png'
);
seg.click();
list = next('list');
assert.deepEqual(JSON.parse(JSON.stringify(list.filter)), { outcome: 'denied' });
reply(list, { status: 'rejected', code: 'permission_denied', reason: '缺少编辑器权限 cadeditor.history.view' });
assert.match(
  h.root.querySelector('.hs-msg').textContent,
  /没有权限.*cadeditor\.history\.view/,
  'the server reason is shown'
);
assert.equal(h.root.querySelectorAll('.hs-row').length, 0);

// An owner: add and purge appear; purge needs a filter and sends it.
const h2 = H.create({ data: { uiLocale: 'zh_cn' } });
const c2 = h2.c;
c2.openHistory({});
let [, m] = h2.sent.shift();
c2.EditHistory.receive({
  status: 'history',
  requestId: m.requestId,
  capabilities: { 'history.view': true, 'history.edit': true, 'history.delete': true },
  enabled: true
});
[, m] = h2.sent.shift();
c2.EditHistory.receive({
  status: 'history',
  requestId: m.requestId,
  total: 1,
  page: 0,
  size: 20,
  scope: 'all',
  records: [
    { id: 3, time: 1, actor: { id: 'console', name: 'Server' }, action: 'history.add', outcome: 'note', note: 'n' }
  ]
});
const btn2 = (text) => h2.root.querySelectorAll('.k-btn').find((b) => b.textContent.includes(text));
assert.ok(visible(btn2('添加记录')));
assert.ok(visible(btn2('按条件清除')));
btn2('按条件清除').click();
assert.equal(h2.sent.length, 0, 'purge without a filter is not sent');
h2.root
  .querySelectorAll('.k-segi')
  .find((s) => s.textContent === '物品')
  .click();
[, m] = h2.sent.shift();
c2.EditHistory.receive({
  status: 'history',
  requestId: m.requestId,
  total: 0,
  page: 0,
  size: 20,
  scope: 'all',
  records: []
});
btn2('按条件清除').click();
const confirm = h2.root
  .querySelectorAll('.k-btn')
  .filter((b) => b.textContent.includes('按条件清除'))
  .pop();
confirm.click();
[, m] = h2.sent.shift();
assert.equal(m.action, 'purge');
assert.deepEqual(JSON.parse(JSON.stringify(m.filter)), { action: 'item' });

// Disabled history on the server.
const h3 = H.create({ data: { uiLocale: 'zh_cn' } });
h3.c.openHistory({});
[, m] = h3.sent.shift();
h3.c.EditHistory.receive({ status: 'history', requestId: m.requestId, capabilities: {}, enabled: false });
assert.equal(h3.sent.length, 0, 'no list request when history is off');
assert.match(h3.root.querySelector('.hs-msg').textContent, /没有开启编辑历史/);

console.log('ui-history: all checks passed');
