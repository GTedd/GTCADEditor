// Field search declarations (js/fielddecl.js): renders every item page card in the test harness once, offline, and
// records which translation keys its field labels come from. The page never renders cards just to index them; it reads
// these declarations (plus live component schemas for generic cards) when Ctrl+K searches fields.
//   node tools/field-decl-gen.cjs           print the declarations as JSON
//   node tools/field-decl-gen.cjs --write   rewrite js/fielddecl.js
// Re-run after adding or relabelling card fields. Cards can also declare fields themselves with FieldIndex.declare.
const fs = require('node:fs');
const path = require('node:path');
const H = require('./lib/ui-harness.cjs');

const ITEMS = [
  'diamond_sword',
  'diamond_pickaxe',
  'bow',
  'crossbow',
  'trident',
  'mace',
  'shield',
  'diamond_chestplate',
  'leather_helmet',
  'elytra',
  'apple',
  'cooked_beef',
  'honey_bottle',
  'potion',
  'tipped_arrow',
  'suspicious_stew',
  'enchanted_book',
  'written_book',
  'writable_book',
  'chest',
  'shulker_box',
  'bundle',
  'firework_rocket',
  'firework_star',
  'white_banner',
  'music_disc_13',
  'pig_spawn_egg',
  'villager_spawn_egg',
  'pufferfish_bucket',
  'spawner',
  'stone',
  'totem_of_undying',
  'goat_horn',
  'filled_map',
  'player_head',
  'compass',
  'armor_stand',
  'item_frame',
  'oak_sign',
  'command_block',
  'wolf_armor',
  'lodestone'
];

function harness() {
  const t = H.create(),
    c = t.c;
  c.Reg.meta = {};
  c.Reg.kinds = {};
  c.window.EDITOR_PREVIEW = true;
  c.snd = () => {};
  return t;
}

const t = harness(),
  c = t.c;
const catalog = require('node:vm').runInContext('EditorCatalogs', c);
// Reverse lookup for labels built before recording started (constants) and literal fallbacks.
const reverse = {};
Object.keys(catalog.zh_cn).forEach((key) => {
  const text = catalog.zh_cn[key];
  if (/%/.test(text)) return;
  if (!(text in reverse)) reverse[text] = key;
});
const recorded = {};
const original = c.I18n.t;
c.I18n.t = function (key) {
  const text = original.apply(this, arguments);
  if (arguments.length === 1 && typeof key === 'string' && !(text in recorded)) recorded[text] = key;
  return text;
};
const keyOf = (text) => {
  text = String(text || '')
    .replace(/\s*\*$/, '')
    .trim();
  if (!text) return null;
  return recorded[text] || reverse[text] || null;
};
const realMake = c.makeCard;
c.makeCard = function (spec) {
  const card = realMake(spec);
  if (card) card.__spec = spec;
  return card;
};

const own = (el) => (el ? (el._text || '').trim() || el.textContent.trim() : '');
const out = {};
function labelsOf(el) {
  const found = [];
  el.querySelectorAll('.lt').forEach((x) => found.push(own(x)));
  el.querySelectorAll('.pr-k').forEach((x) => found.push(own(x.children[0])));
  el.querySelectorAll('.fk').forEach((x) => found.push(own(x)));
  el.querySelectorAll('.k-togl').forEach((x) => found.push(own(x)));
  return found;
}
function record(spec, real) {
  const key = Array.isArray(spec) ? spec[0] : spec;
  if (!key || key === 'auto') return; // Generic component cards are indexed from their live schema.
  const entry = (out[key] = out[key] || { id: '', title: '', fields: [] });
  if (real.spec && real.spec.id && !entry.id) entry.id = real.spec.id;
  const titleKey = real.spec && typeof real.spec.title === 'string' ? keyOf(real.spec.title) : null;
  if (titleKey && !entry.title) entry.title = titleKey;
  labelsOf(real.el).forEach((label) => {
    const k = keyOf(label);
    if (k && k !== entry.title && entry.fields.indexOf(k) < 0) entry.fields.push(k);
  });
}
// Enabled components show their fields (an off card is only a switch): start from component defaults.
function enabledComps(id, kind) {
  const d0 = c.makeDoc({ id, comps: {} });
  c.Store.docs.length = 0;
  c.Store.docs.push(d0);
  const comps = {};
  c.UI.uni = {};
  c.uniTabsFor(kind).forEach((u) => (c.UI.uni[u.id] = 1));
  c.tabsOfKind(kind).forEach((tab) =>
    tab.cards.forEach((spec) => {
      if (typeof spec === 'string' && !c.CARDS[spec]) return;
      c.cardComps(spec).forEach((cid) => {
        const meta = c.CIDX[cid];
        if (!meta || comps[cid] !== undefined || c.protoOf(id)[cid] !== undefined) return;
        try {
          const v = c.defaultFor(meta.schema);
          if (v !== undefined) comps[cid] = v;
        } catch (e) {}
      });
    })
  );
  return comps;
}
for (const id of ITEMS) {
  const kind0 = c.kindOfItem(c.fullId(id));
  const d = c.makeDoc({ id, comps: enabledComps(c.fullId(id), kind0) });
  c.Store.docs.length = 0;
  c.Store.docs.push(d);
  c.UI.uni = {};
  const kind = c.kindOfItem(d.id);
  c.uniTabsFor(kind).forEach((u) => (c.UI.uni[u.id] = 1));
  for (const tab of c.tabsOfKind(kind)) {
    if (tab.id === 'item-stack') continue;
    c.UI.tab = tab.id;
    try {
      c.drawEdit();
    } catch (e) {
      continue;
    }
    const cards = (c.UI.page ? c.UI.page.cards : []).slice();
    const specs = cards.map((x) => x.__spec);
    cards.forEach((card, i) => {
      try {
        if (card.setCollapsed) card.setCollapsed(false);
      } catch (e) {}
      const real = c.UI.page.cards[i] || card,
        spec = specs[i];
      record(spec, real);
      // Detail cards edit in their own window: render it once and read the fields there too.
      if (real.el.classList.contains('det-card') && spec && !(Array.isArray(spec) && spec[0] === 'auto')) {
        try {
          c.openDetail({ cid: (real.comps && real.comps[0]) || '', key: spec, title: real.spec && real.spec.title });
          const main = t.doc.getElementById('detailmain');
          if (main) record(spec, { spec: real.spec, el: main });
        } catch (e) {}
        try {
          c.closeModal();
        } catch (e) {}
      }
    });
  }
}
const keys = Object.keys(out).sort();
const sorted = {};
keys.forEach((k) => {
  if (out[k].fields.length || out[k].title) sorted[k] = out[k];
});
if (!process.argv.includes('--write')) {
  console.log(JSON.stringify(sorted, null, 1));
  process.exit(0);
}
const target = path.resolve(__dirname, '../client/src/main/resources/assets/cadeditor/ui/js/fielddecl.js');
const lines = [
  '/* Generated by tools/field-decl-gen.cjs; do not edit by hand. Field search (Ctrl+K) declarations: for each card key',
  '   in PAGES, its data-card id, title key and field label keys. Cards may add or override entries with',
  '   FieldIndex.declare(key, { id, title, fields }). */',
  'FieldIndex.declareAll({'
];
// Prettier layout (printWidth 120): one line when it fits, otherwise one property per line.
const quote = (x) => "'" + x + "'";
keys
  .filter((k) => sorted[k])
  .forEach((k, i, all) => {
    const e = sorted[k],
      name = /^[a-zA-Z_$][\w$]*$/.test(k) ? k : quote(k),
      comma = i < all.length - 1 ? ',' : '',
      fields = '[' + e.fields.map(quote).join(', ') + ']';
    const one = '  ' + name + ': { id: ' + quote(e.id) + ', title: ' + quote(e.title) + ', fields: ' + fields + ' }';
    if ((one + comma).length <= 120) {
      lines.push(one + comma);
      return;
    }
    lines.push('  ' + name + ': {', '    id: ' + quote(e.id) + ',', '    title: ' + quote(e.title) + ',');
    if (('    fields: ' + fields).length <= 120) lines.push('    fields: ' + fields);
    else {
      lines.push('    fields: [');
      e.fields.forEach((f, j) => lines.push('      ' + quote(f) + (j < e.fields.length - 1 ? ',' : '')));
      lines.push('    ]');
    }
    lines.push('  }' + comma);
  });
lines.push('});');
fs.writeFileSync(target, lines.join('\n') + '\n');
console.log(
  'field-decl-gen: ' + Object.keys(sorted).length + ' cards written to ' + path.relative(process.cwd(), target)
);
