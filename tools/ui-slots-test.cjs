// 物品页容器 / 收纳袋卡片的格子交互：单击打开小窗、按住拖动移动或对换、右键菜单。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');
const docEvents = {};
const t = H.create({ documentEvents: docEvents }),
  c = t.c;
c.snd = () => {};
c.toast = () => {};
c.Reg.meta = {};
c.window.EDITOR_PREVIEW = true; // This card test deliberately renders the offline preview fixtures.

function openCard(id, comps, cardName) {
  c.Store.docs.length = 0;
  const d = c.makeDoc({ id, comps });
  c.Store.docs.push(d);
  c.Store.cur = 0;
  let card = null;
  for (const tab of c.tabsOfKind(c.kindOfItem(id))) {
    c.UI.tab = tab.id;
    c.drawEdit();
    card = c.UI.page.cards.find((x) => x.spec && x.spec.id === cardName);
    if (card) break;
  }
  assert.ok(card, '页面里有 ' + cardName + ' 卡片');
  card.setCollapsed(false); // 懒加载的卡片展开时才建内容，并换掉原来的占位元素：重新按 data-card 找
  const el = t.doc
    .getElementById('screen')
    .querySelectorAll('.k-card')
    .find((x) => x.getAttribute('data-card') === cardName);
  assert.ok(el, '卡片元素在页面里');
  return { d, card: { body: el } };
}
const cellsOf = (card) => card.body.querySelectorAll('.slot').filter((x) => !x.classList.contains('addslot'));
const flushTimers = () => {
  while (t.timers.length) t.timers.shift().fn();
};
const noRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
// Press on `from`, move past the drag threshold and release over `to` (only `to` is hit-testable).
function drag(from, to) {
  for (const x of c.WE_DND.cells) x.el.getBoundingClientRect = noRect;
  if (to) to.getBoundingClientRect = () => ({ left: 100, top: 100, width: 34, height: 34, right: 134, bottom: 134 });
  const moves = (docEvents.mousemove || []).length,
    ups = (docEvents.mouseup || []).length;
  from.fire('mousedown', { button: 0, clientX: 10, clientY: 10 });
  const mv = (docEvents.mousemove || [])[moves],
    up = (docEvents.mouseup || [])[ups];
  if (!mv) return false; // the drag never started
  mv({ clientX: 110, clientY: 110 });
  up({ clientX: 117, clientY: 117 });
  return true;
}
const sorted = (cid) => JSON.parse(JSON.stringify(c.Ctx.get(cid))).sort((a, b) => a.slot - b.slot);

// ---------- 容器：拖到空格 = 移动，拖到有物品的格 = 对换 ----------
{
  openCard(
    'minecraft:shulker_box',
    {
      container: [
        { slot: 0, item: { id: 'minecraft:diamond', count: 5 } },
        { slot: 3, item: { id: 'minecraft:stick', count: 1, components: { custom_name: 'x' } } }
      ]
    },
    'container'
  );
  const card = {
    get body() {
      return t.doc
        .getElementById('screen')
        .querySelectorAll('.k-card')
        .find((x) => x.getAttribute('data-card') === 'container');
    }
  };
  let cells = cellsOf(card);
  assert.equal(cells.length, 27);
  // Native item element carries the game tooltip and count; the cell has no separate text tip.
  const icon = cells[0].querySelector('item');
  assert.ok(icon, '格子里是原生物品元素');
  assert.equal(icon.id, 'minecraft:diamond');
  assert.equal(icon.getAttribute('count'), '5');
  assert.equal(icon.getAttribute('tooltip'), '');
  assert.equal(cells[0].getAttribute('data-tip'), null, '原生物品自带提示，格子不再重复');
  assert.equal(cells[3].querySelectorAll('.mk').length, 1, '带组件的格子有小黄点');
  assert.ok(drag(cells[0], cells[7]), '有物品的格子可以拖');
  const list = sorted('container');
  assert.deepEqual(
    list.map((e) => e.slot),
    [3, 7],
    '钻石从 0 号格移到 7 号格'
  );
  assert.equal(list[1].item.id, 'minecraft:diamond');
  assert.equal(list[1].item.count, 5);
  assert.equal(list[0].item.components.custom_name, 'x', '没动的格子里的组件原样保留');
  assert.equal(t.doc.getElementById('overlays').querySelector('.slot-ghost'), null, '松手后拖动影子消失');
  // 对换：3 ↔ 7
  cells = cellsOf(card);
  assert.ok(drag(cells[3], cells[7]));
  const l2 = sorted('container');
  assert.equal(l2[0].slot, 3);
  assert.equal(l2[0].item.id, 'minecraft:diamond');
  assert.equal(l2[1].slot, 7);
  assert.equal(l2[1].item.id, 'minecraft:stick');
  assert.equal(l2[1].item.components.custom_name, 'x', '对换时组件跟着物品走');
  // 拖回原格 = 取消
  cells = cellsOf(card);
  const before = JSON.stringify(sorted('container'));
  assert.ok(drag(cells[3], cells[3]));
  assert.equal(JSON.stringify(sorted('container')), before, '放回原格不改内容');
  assert.ok(!cells[3].classList.contains('sel'), '取消后不再高亮');
  // 空格拖不起来
  assert.equal(drag(cells[20], cells[0]), false, '空格拖不起来');
  assert.equal(JSON.stringify(sorted('container')), before);
  // 拖动结束后的那一下单击不打开小窗；之后的单击立即打开
  cells[3].fire('click');
  assert.equal(t.doc.getElementById('overlays').querySelector('.k-pickbox'), null, '拖完松手的单击被吞掉');
  flushTimers();
  cellsOf(card)[3].fire('click');
  assert.ok(t.doc.getElementById('overlays').querySelector('.k-pickbox'), '单击后弹出物品小窗');
  c.kPopClose();
  // 右键菜单项齐全
  const menu = [];
  const realMenu = c.kMenu;
  c.kMenu = (x, y, items) => {
    menu.push(...items);
  };
  cellsOf(card)[3].events.contextmenu[0]({ preventDefault() {}, clientX: 1, clientY: 1 });
  c.kMenu = realMenu;
  assert.deepEqual(
    menu.filter((m) => m.label).map((m) => m.label),
    ['编辑…', '复制到下一个空格', '清空']
  );
  menu.find((m) => m.label === '清空').run();
  assert.equal(JSON.parse(JSON.stringify(c.Ctx.get('container'))).length, 1, '右键清空');
  c.Store.docs.length = 0;
}

// ---------- 收纳袋：拖动调换顺序 ----------
{
  const { card } = openCard(
    'minecraft:bundle',
    {
      bundle_contents: [
        { id: 'minecraft:apple', count: 3 },
        { id: 'minecraft:stick', count: 12 }
      ]
    },
    'bundle'
  );
  const cells = cellsOf(card);
  assert.equal(cells.length, 2);
  assert.ok(drag(cells[0], cells[1]));
  const l = JSON.parse(JSON.stringify(c.Ctx.get('bundle_contents')));
  assert.deepEqual(
    l.map((x) => x.id),
    ['minecraft:stick', 'minecraft:apple'],
    '拖动 = 调换顺序'
  );
  assert.equal(l[1].count, 3);
  assert.equal(card.body.querySelectorAll('.addslot').length, 1, '重画后仍只有一个「放入物品」格');
  assert.equal(cellsOf(card).length, 2);
  c.Store.docs.length = 0;
}
console.log('PASS slots: container / bundle click popup, drag move and swap, cancel, context menu.');
