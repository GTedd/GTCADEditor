// Ctrl+K field search (js/fieldindex.js + paletteSearch in js/screens.js): every page of the current item is indexed
// from declarations and live component schemas without rendering cards; results show "page › card › field", rank
// exact > prefix > substring > pinyin, coexist with actions/pages/components, and selecting one switches the page,
// expands the card (or opens its detail window), scrolls to the field and highlights it.
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');

function fresh(id, comps) {
  const t = H.create(),
    c = t.c;
  c.Reg.meta = {};
  c.Reg.kinds = {};
  c.window.EDITOR_PREVIEW = true;
  c.snd = () => {};
  t.toasts = [];
  c.toast = (text, kind) => t.toasts.push({ text, kind });
  const d = c.makeDoc({ id, comps: comps || {} });
  c.Store.docs.push(d);
  c.drawEdit();
  return t;
}
// Run the short layout timers only; the 1.8 s highlight removal stays pending so the highlight can be checked.
const run = (t) => {
  for (let i = 0; i < 6; i++) {
    const due = t.timers.filter((x) => x.ms <= 100 && !x.repeat);
    if (!due.length) return;
    due.forEach((x) => t.timers.splice(t.timers.indexOf(x), 1));
    due.forEach((x) => x.fn());
  }
};
const T = (c, key) => c.I18n.t(key);

// ---- index: all pages, declarations + schemas, nothing rendered ----
{
  const t = fresh('diamond_sword'),
    c = t.c;
  let made = 0;
  const realMake = c.makeCard;
  c.makeCard = function (spec) {
    made++;
    return realMake(spec);
  };
  c.FieldIndex.reset();
  const list = c.FieldIndex.build();
  c.makeCard = realMake;
  assert.equal(made, 0, 'building the index never renders a card');
  const tabs = new Set(list.map((e) => e.tab));
  const kind = c.kindOfItem('minecraft:diamond_sword');
  c.tabsOfKind(kind)
    .filter((x) => x.id !== 'item-stack')
    .forEach((x) => assert.ok(tabs.has(x.id), 'visible page indexed: ' + x.id));
  assert.ok(
    c.hiddenUniTabs(kind).some((x) => tabs.has(x.id)),
    'pages still in the "more" menu are indexed too'
  );
  const reach = list.find((e) => e.field === T(c, 'cadeditor.ui.cards2.maximum_reach'));
  assert.ok(reach, 'declared field of a specialised card');
  assert.equal(reach.path.split(' › ').length, 3, 'field path is page › card › field');
  assert.equal(reach.en, c.I18n.en('cadeditor.ui.cards2.maximum_reach'), 'English original indexed');
  const schemaField = list.find((e) => e.key === 'auto' && e.field && e.fieldKey && e.en);
  assert.ok(schemaField, 'generic component card fields come from the live schema with English text');
  const card = list.find((e) => e.key === 'reach' && !e.field);
  assert.ok(card.texts.includes('attack_range'), 'card entry carries its component ID');
  assert.strictEqual(c.FieldIndex.build(), list, 'index cached for the same item and pages');
  console.log('PASS field index: every page, declarations + live schemas, English and component IDs, no rendering');
}

// ---- ranking: exact > prefix > substring > pinyin; English and IDs ----
{
  const t = fresh('diamond_sword'),
    c = t.c,
    F = c.FieldIndex;
  assert.equal(F.rank('abc', 'abc'), 4);
  assert.equal(F.rank('abcd', 'abc'), 3);
  assert.equal(F.rank('xabc', 'abc'), 2);
  assert.equal(F.rank('minecraft:attack_range', 'attack'), 3, 'namespaced ID prefix after the namespace');
  assert.equal(F.rank('max_stack_size', 'max stack'), 3, 'underscore key matches spaced words');
  assert.equal(F.rank('最远能打到', 'zyndd'), 1, 'pinyin initials');
  assert.equal(F.rank('最远能打到', 'qqq'), 0);
  const label = T(c, 'cadeditor.ui.cards2.maximum_reach');
  const exact = F.search(label);
  assert.equal(exact[0].e.field, label, 'exact label first');
  assert.equal(exact[0].score, 4);
  const en = c.I18n.en('cadeditor.ui.cards2.maximum_reach').toLowerCase();
  assert.equal(F.search(en)[0].e.field, label, 'English original finds the field in a Chinese UI');
  const py = F.search('zyndd');
  assert.ok(
    py.some((r) => r.e.field === label && r.score === 1),
    'pinyin initials find the field'
  );
  const id = F.search('attack_range');
  assert.equal(id[0].e.key, 'reach', 'component ID finds the card');
  const scores = F.search('攻击').map((r) => r.score);
  assert.deepEqual(
    scores,
    scores.slice().sort((a, b) => b - a),
    'results sorted by match level'
  );
  console.log('PASS field ranking: exact > prefix > substring > pinyin; English, IDs and pinyin all match');
}

// ---- palette: field results coexist with actions / pages / components ----
{
  const t = fresh('diamond_sword'),
    c = t.c;
  const all = c.paletteItems();
  assert.ok(
    all.some((x) => x.label === T(c, 'cadeditor.ui.newitem.action')),
    'palette offers New item'
  );
  const rows = c.paletteSearch(all, T(c, 'cadeditor.ui.screens.undo').toLowerCase());
  assert.equal(rows[0].label, T(c, 'cadeditor.ui.screens.undo'), 'exact action stays first');
  const label = T(c, 'cadeditor.ui.cards2.maximum_reach');
  const fieldRows = c.paletteSearch(all, label);
  assert.ok(fieldRows[0].label.endsWith(' › ' + label), 'field result shows page › card › field');
  assert.ok(
    c.paletteSearch(all, 'reach').some((x) => x.label.indexOf(' › ') > 0),
    'English query lists field/card results'
  );
  const unbreakable = c.paletteSearch(all, 'unbreakable');
  assert.ok(
    unbreakable.some((x) => x.sub === 'minecraft:unbreakable' && x.icon === 'plus'),
    'add-component results still offered'
  );
  assert.ok(
    unbreakable.some((x) => x.icon === 'tag' && x.label.indexOf(' › ') > 0),
    'beside the card that already edits it'
  );
  assert.ok(
    !c.paletteSearch(all, T(c, 'cadeditor.ui.screens.current_page')).some((x) => x.card),
    'current-page card shortcuts give way to the all-pages index when searching'
  );
  // Real input -> Enter reveals the field.
  c.openPalette();
  const input = t.doc.querySelector('.k-pal').querySelector('input');
  input.value = label;
  input.fire('input');
  const first = t.doc.querySelector('.k-pall').querySelector('.k-pr');
  assert.ok(first.textContent.includes(label));
  input.fire('keydown', { key: 'Enter' });
  run(t);
  assert.equal(c.UI.tab, 'combat', 'switched to the page holding the field');
  const hit = t.doc.querySelectorAll('.m-attention')[0];
  assert.ok(hit, 'something highlighted');
  assert.ok(hit.textContent.includes(label), 'the field row itself is highlighted');
  assert.ok(hit.closest('.k-card').querySelector('.k-cbody'), 'its card is expanded');
  console.log('PASS palette: field rows beside actions/pages/components; Enter switches page, expands, highlights');
}

// ---- hidden page and undeclared card: card-level hit, page opened from "more" ----
{
  const t = fresh('diamond_sword'),
    c = t.c,
    kind = c.kindOfItem('minecraft:diamond_sword');
  const hidden = c.hiddenUniTabs(kind)[0];
  const e = c.FieldIndex.build().find((x) => x.tab === hidden.id && !x.field);
  assert.ok(e, 'hidden page card indexed');
  assert.ok(c.FieldIndex.reveal(e), 'reveal succeeds');
  run(t);
  assert.equal(c.UI.tab, hidden.id);
  assert.ok(c.UI.uni[hidden.id], 'hidden page now shown in the tab bar');
  assert.ok(t.doc.querySelectorAll('.m-attention').length, 'card highlighted');
  console.log('PASS hidden "more" page opens and its card is highlighted');
}

// ---- detail window: a field of a detail card opens the window and is highlighted there ----
{
  const t = fresh('apple'),
    c = t.c;
  const label = T(c, 'cadeditor.ui.cards3.hold_duration');
  const r = c.FieldIndex.search(label)[0];
  assert.ok(r && r.e.field === label, 'detail card field indexed');
  c.FieldIndex.reveal(r.e);
  run(t);
  const win = t.doc.getElementById('detailwin');
  assert.ok(win, 'detail window opened');
  const hit = win.querySelectorAll('.m-attention')[0];
  assert.ok(hit && hit.textContent.includes(label), 'field highlighted inside the detail window');
  console.log('PASS detail card field opens its window and is highlighted there');
}

// ---- declarations: generic mechanism, keys exist ----
{
  const t = fresh('diamond_sword'),
    c = t.c;
  const cat = c.EditorCatalogs;
  const fs = require('node:fs'),
    path = require('node:path');
  const src = fs.readFileSync(path.join(t.dir, 'js/fielddecl.js'), 'utf8');
  for (const m of src.matchAll(/'(cadeditor\.[a-z0-9_.]+)'/g))
    assert.ok(Object.prototype.hasOwnProperty.call(cat.zh_cn, m[1]), 'declared key exists: ' + m[1]);
  // Drift guard: the declared fields of a rendered card are really there (re-run tools/field-decl-gen.cjs --write).
  c.UI.tab = 'combat';
  c.drawTabBody();
  const at = c.UI.page.cards.findIndex((x) => x.spec.id === 'reach');
  c.UI.page.cards[at].setCollapsed(false);
  const reachCard = c.UI.page.cards[at];
  c.FieldIndex.build()
    .filter((e) => e.key === 'reach' && e.field)
    .forEach((e) => assert.ok(c.FieldIndex.findField(reachCard.el, e.field), 'declared field rendered: ' + e.field));
  c.FieldIndex.declare('reach', { fields: ['cadeditor.ui.common.reset'] });
  assert.ok(
    c.FieldIndex.build().some((e) => e.key === 'reach' && e.field === T(c, 'cadeditor.ui.common.reset')),
    'cards can add their own field declarations'
  );
  console.log('PASS declarations: every declared key exists; FieldIndex.declare extends a card');
}
