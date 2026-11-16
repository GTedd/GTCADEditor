// 中文 Minecraft Wiki 入口：原版物品 / 方块 / 实体的标签行末尾有「Wiki」，点一下只把类型和 ID 交给宿主（网址由宿主拼）；
// 模组内容、玩家和没有宿主的页面不显示；宿主回复后给出提示。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');

{
  const t = H.create({ data: { hostWiki: true } }),
    c = t.c;
  c.snd = () => {};
  const toasts = [];
  c.toast = (text, kind) => toasts.push([kind, text]);
  const tag = c.edWikiTag('item', 'diamond_sword');
  assert.ok(tag, 'vanilla item gets a wiki entry');
  assert.equal(tag.textContent, 'Wiki');
  assert.match(tag.getAttribute('data-tip'), /中文 Minecraft Wiki/);
  tag.fire('click', { stopPropagation() {} });
  const sent = t.sent.filter((m) => m[0] === 'editor_wiki');
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].kind, 'item');
  assert.equal(sent[0][1].id, 'minecraft:diamond_sword', 'the page sends an ID, never an address');
  assert.equal(Object.keys(sent[0][1]).sort().join(), 'id,kind,requestId');
  assert.ok(c.edWikiTag('block', 'minecraft:chest'));
  assert.ok(c.edWikiTag('entity', 'minecraft:tropical_fish'));
  assert.equal(c.edWikiTag('item', 'mymod:ruby'), null, 'mod content has no official wiki entry');
  assert.equal(c.edWikiTag('item', ''), null);
}
{
  const t = H.create({ data: {} }),
    c = t.c;
  assert.equal(c.edWikiTag('item', 'minecraft:stone'), null, 'no host channel, no button');
}
// Hero rows: item editor and world editor carry the chip; players do not.
{
  const t = H.create({ data: { hostWiki: true } }),
    c = t.c;
  c.snd = () => {};
  c.Prefs.init({ hostPrefs: true, prefs: {} });
  c.Store.open({ id: 'minecraft:diamond_sword', count: 1, comps: {} }, true);
  c.drawEdit();
  const hero = t.root.querySelector('#hero') || t.root;
  const chips = hero.querySelectorAll('.ed-wiki');
  assert.equal(chips.length, 1, 'item hero has one wiki chip');
  chips[0].fire('click', { stopPropagation() {} });
  assert.deepEqual(
    t.sent.filter((m) => m[0] === 'editor_wiki').map((m) => m[1].id),
    ['minecraft:diamond_sword']
  );
}
console.log('PASS wiki: chip for vanilla item/block/entity only, sends kind+id to the host, item hero carries it.');
