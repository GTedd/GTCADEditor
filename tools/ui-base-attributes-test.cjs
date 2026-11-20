// 攻击伤害 / 攻击速度卡片要等玩家基础属性（entity_base_attributes）到达，之前显示“正在读取”。
// Oriel 按页面的消息预算丢掉的请求由 HostOutbox 重发；传输失败或超时（30 秒）后过一会儿重新请求，
// 卡片不会一直停在“正在读取”。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');

const t = H.create({ data: {} }),
  c = t.c;
c.Reg.meta = { generation: '1' };
let accept = false;
const sent = [];
c.oriel.send = (channel, value) => {
  if (accept) sent.push([channel, value]);
  return accept;
};
const asked = () => sent.filter((m) => m[0] === 'registry' && m[1].name === 'entity_base_attributes');
const run = (ms) => {
  const due = t.timers.filter((x) => x.ms === ms);
  t.timers.splice(0, t.timers.length, ...t.timers.filter((x) => x.ms !== ms));
  due.forEach((x) => x.fn());
};
const outbox = () => {
  for (let i = 0; i < 6 && c.HostOutbox.pending(); i++) [50, 100, 200, 400].forEach(run);
};

// Dropped by the message budget: queued, then sent again with the same request id.
assert.equal(c.Reg.baseAttr('minecraft:player', 'attack_damage', null), null);
assert.equal(c.HostOutbox.pending(), 1, 'dropped request waits in the outbox');
accept = true;
outbox();
assert.equal(asked().length, 1, 'the dropped request was sent again');
const token = asked()[0][1].requestId;
assert.ok(c.RegWire.pending[token], 'still waiting for the same request');
assert.equal(c.Reg.baseAttr('minecraft:player', 'attack_damage', null), null);
assert.equal(asked().length, 1, 'a pending request is not repeated');

// Failed (here: the 30-second timeout): not "no attributes", asked again after a short wait.
c.RegWire.fail(token, 'fixture timeout');
assert.equal(c.Reg.baseAttr('minecraft:player', 'attack_damage', null), null);
assert.equal(asked().length, 1, 'not asked again at once');
run(2000);
assert.equal(c.Reg.baseAttr('minecraft:player', 'attack_damage', null), null);
assert.equal(asked().length, 2, 'asked again after the wait');

// The attack card waits while the base value is missing, and the waiting state is the loading text.
c.Store.open({ id: 'minecraft:diamond_sword', count: 1, comps: {}, removed: {} }, true);
const card = c.CARDS.attackDamage();
assert.match(card.el.textContent, new RegExp(c.I18n.t('cadeditor.ui.cards1.loading')));

// At most five retries per world, so a host that cannot answer is not asked forever.
for (let i = 0; i < 8; i++) {
  const pending = Object.keys(c.RegWire.pending).find((k) => c.RegWire.pending[k].name === 'entity_base_attributes');
  if (pending) c.RegWire.fail(pending, 'fixture');
  [2000, 4000, 6000, 8000, 10000, 12000].forEach(run);
  c.Reg.baseAttr('minecraft:player', 'attack_damage', null);
}
assert.ok(asked().length <= 7, 'bounded retries: ' + asked().length);

console.log(
  'PASS base attributes: dropped requests resent, failed requests asked again (bounded), attack card waits meanwhile.'
);
