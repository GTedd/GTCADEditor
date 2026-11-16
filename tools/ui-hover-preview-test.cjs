// 悬停即时预览：实体的颜色色块 / 品种列表，鼠标停上去左栏 3D 预览就换成那个值；
// 不写草稿、不进撤销；移开或没选就关掉时画回草稿；选定后由真实改动刷新，不先闪回旧值。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');
const t = H.create(),
  c = t.c;
c.snd = () => {};
c.Reg.meta = {};
const DYES = Object.keys(c.DYE_RGB);
assert.equal(DYES.length, 16);
c.dyeList = () => DYES.map((k) => ({ v: k, label: k, rgb: c.DYE_RGB[k] }));
const FISH = 'minecraft:tropical_fish';
c.Reg.eschema[FISH] = {
  id: FISH,
  available: true,
  variants: [
    {
      id: 'minecraft:tropical_fish/base_color',
      kind: 'enum',
      nbt: { path: ['Variant'], valueFormat: 'snbt', mask: 0xff0000 },
      default: 0,
      options: DYES.map((label, i) => ({ value: i << 16, snbt: String(i << 16), label }))
    },
    {
      id: 'minecraft:tropical_fish/pattern',
      kind: 'enum',
      nbt: { path: ['Variant'], valueFormat: 'snbt', mask: 0xffff },
      default: 0,
      options: [
        { value: 0, snbt: '0', label: 'kob' },
        { value: 1, snbt: '1', label: 'sunstreak' }
      ]
    }
  ],
  equipment: [],
  flags: []
};
const BASE = (name) => '"minecraft:tropical_fish/base_color":"' + name + '"';
const PATTERN = (name) => '"minecraft:tropical_fish/pattern":"' + name + '"';

const hero = c.h('div', { id: 'hero' });
t.root.appendChild(hero);
let data = { Variant: (1 << 16) | 1 }; // orange + sunstreak
let edits = 0;
const el = c.heroEntity(FISH, data, null);
hero.appendChild(el);
const shown = [];
const setAttribute = el.setAttribute.bind(el);
el.setAttribute = (k, v) => {
  if (k === 'components') shown.push(v);
  setAttribute(k, v);
};
const comps = () => el.getAttribute('components');
assert.ok(comps().includes(BASE('orange')) && comps().includes(PATTERN('sunstreak')), comps());

const panel = c.esVariantList(c.Reg.entitySchema(FISH), {
  get: () => data,
  set: (next) => {
    edits++;
    data = next;
    c.heroEntity(FISH, data, el); // 页面真正的改动路径：按新草稿重画左栏
  },
  redraw() {}
});
const pop = () => c.KPop.el; // the live popover; a closed one stays inert in the DOM for its exit animation
const swatches = () => pop().querySelectorAll('.ed-dye');
const dyeBtn = panel.querySelectorAll('.k-btn').find((b) => b.querySelector('.dye-chip'));

// ---- 色块：悬停换预览，草稿不动；离开色块区画回草稿
dyeBtn.fire('click');
assert.equal(swatches().length, 16);
swatches()[4].fire('mouseenter');
assert.ok(comps().includes(BASE(DYES[4])), 'hovered colour previews immediately');
assert.ok(comps().includes(PATTERN('sunstreak')), 'other variant bits of the shared int are kept');
assert.equal(data.Variant, (1 << 16) | 1, 'draft untouched while hovering');
assert.equal(edits, 0, 'hover never writes the draft (no undo entry, no unapplied change)');
swatches()[7].fire('mouseenter');
assert.ok(comps().includes(BASE(DYES[7])));
swatches()[0].parentNode.fire('mouseleave');
assert.ok(comps().includes(BASE('orange')), 'leaving the swatches restores the draft');

// ---- 悬停后没选就关掉弹层：画回草稿
swatches()[9].fire('mouseenter');
assert.ok(comps().includes(BASE(DYES[9])));
c.kPopClose();
assert.ok(comps().includes(BASE('orange')), 'closing without a pick restores the draft');
assert.equal(edits, 0);

// ---- 选定：写草稿，预览直接从悬停值变成新值，中间不闪回旧颜色
dyeBtn.fire('click');
swatches()[4].fire('mouseenter');
shown.length = 0;
swatches()[4].fire('click');
assert.equal(edits, 1);
assert.equal(data.Variant, (4 << 16) | 1, 'pick writes through the masked int');
assert.ok(comps().includes(BASE(DYES[4])));
assert.ok(!shown.some((v) => v.includes(BASE('orange'))), 'no flash back to the old colour: ' + shown.join(' | '));
assert.equal(pop(), null, 'palette closed after pick');

// ---- 品种列表（pickFrom）：同样悬停预览
const sel = panel.querySelectorAll('.k-sel')[0];
sel.fire('click');
const rows = pop().querySelectorAll('.k-prow');
assert.equal(rows.length, 2);
rows[0].fire('mouseenter');
assert.ok(comps().includes(PATTERN('kob')), 'hovered pattern previews immediately');
assert.ok(comps().includes(BASE(DYES[4])), 'colour bits kept while previewing the pattern');
assert.equal(data.Variant, (4 << 16) | 1);
pop().querySelector('.k-plist').fire('mouseleave');
assert.ok(comps().includes(PATTERN('sunstreak')), 'leaving the list restores the draft');
rows[0].fire('mouseenter');
c.kPopClose();
assert.ok(comps().includes(PATTERN('sunstreak')), 'closing the list restores the draft');
assert.equal(edits, 1);

// ---- 左栏是别的生物：悬停什么也不改
assert.equal(
  c.esPeek('minecraft:cat', (o) => (o.Variant = 0)),
  false
);
assert.ok(comps().includes(BASE(DYES[4])) && comps().includes(PATTERN('sunstreak')));

// ---- 桶里的生物外观由物品组件决定，不参与悬停预览
{
  const bucket = c.heroEntity(FISH, data, null);
  bucket._esPeek = null; // bucketPreview 的约定
  hero.appendChild(bucket);
  const before = bucket.getAttribute('components');
  c.esPeek(FISH, (o) => (o.Variant = 0));
  assert.equal(bucket.getAttribute('components'), before);
}
console.log(
  'PASS hover preview: dye swatches and variant lists preview on the 3D entity without touching the draft; restore on leave/close; no flash on pick.'
);

// ---- 发光颜色：发光打开才有「发光颜色」行；颜色写进原版 Team（编辑器的发光队伍）；左栏用同色描边预览，悬停即时换色
{
  hero.children.length = 0;
  c.Reg.eschema[FISH].flags = [{ id: 'glowing', key: 'Glowing', type: 'byte-bool', default: false, common: true }];
  let glowData = { Variant: 1 };
  let glowEdits = 0;
  const ent = c.heroEntity(FISH, glowData, null);
  hero.appendChild(ent);
  const io = {
    get: () => glowData,
    set: (next) => {
      glowEdits++;
      glowData = next;
      c.heroEntity(FISH, glowData, ent);
    },
    redraw() {},
    glowColor: true
  };
  const flags = () => c.esFlagList(c.Reg.entitySchema(FISH), io);
  // 刷怪蛋 / 刷怪笼里的生物没有队伍：只有开关，没有颜色行
  assert.ok(
    !/发光颜色/.test(
      c.esFlagList(c.Reg.entitySchema(FISH), Object.assign({}, io, { glowColor: false, get: () => ({ Glowing: 1 }) }))
        .textContent
    )
  );
  const filter = () => /filter:([^;]*)/.exec(ent.getAttribute('style') || '');
  assert.equal(ent.getAttribute('data-glow'), null, 'no glow, no outline');
  assert.equal(filter(), null);
  assert.ok(!/发光颜色/.test(flags().textContent), 'colour row only while glowing');
  flags().querySelectorAll('.k-toggle')[0].fire('click');
  assert.equal(glowData.Glowing, true);
  assert.equal(ent.getAttribute('data-glow'), '#FFFFFF', 'no team = white outline, like the game');
  assert.match(filter()[1], /drop-shadow\(1px 0 0 #FFFFFF\)/);
  const list = flags();
  assert.match(list.textContent, /发光颜色/);
  const colorBtn = list.querySelectorAll('.k-btn').find((b) => b.querySelector('.dye-chip'));
  assert.equal(colorBtn.textContent, '默认', 'short label keeps the row title on one line');
  colorBtn.fire('click');
  const sw = () => c.KPop.el.querySelectorAll('.ed-dye');
  assert.equal(sw().length, 17, 'default + 16 team colours');
  assert.ok(sw()[0].classList.contains('nonec') && sw()[0].textContent === '×', 'default uses the shared × swatch');
  assert.equal(sw()[0].getAttribute('data-tip'), '默认（白色）');
  const red = sw().find((x) => x.getAttribute('data-tip') === '红色');
  red.fire('mouseenter');
  assert.equal(ent.getAttribute('data-glow'), '#FF5555', 'hovered team colour previews at once');
  assert.match(filter()[1], /#FF5555/);
  assert.equal(glowData.Team, undefined, 'hover does not write the draft');
  red.parentNode.fire('mouseleave');
  assert.equal(ent.getAttribute('data-glow'), '#FFFFFF');
  red.fire('mouseenter');
  red.fire('click');
  assert.equal(glowData.Team, 'cadeditor_glow_red', 'pick joins the editor glow team');
  assert.equal(ent.getAttribute('data-glow'), '#FF5555');
  const again = flags();
  assert.match(again.querySelectorAll('.k-btn').find((b) => b.querySelector('.dye-chip')).textContent, /红色/);
  // 默认 = 去掉 Team
  again
    .querySelectorAll('.k-btn')
    .find((b) => b.querySelector('.dye-chip'))
    .fire('click');
  sw()[0].fire('click');
  assert.equal(glowData.Team, undefined);
  assert.equal(ent.getAttribute('data-glow'), '#FFFFFF');
  // 别的队伍：说明颜色由那个队伍决定
  glowData = Object.assign({}, glowData, { Team: 'red_team' });
  assert.match(flags().textContent, /red_team/);
  // 关掉发光：描边消失
  glowData = { Variant: 1, Glowing: 0, Team: 'cadeditor_glow_blue' };
  c.heroEntity(FISH, glowData, ent);
  assert.equal(ent.getAttribute('data-glow'), null);
  assert.equal(filter(), null);
  assert.equal(c.esGlow({ Glowing: 1, Team: 'cadeditor_glow_nope' }).color, null, 'unknown colour ids are ignored');
}
console.log('PASS glow colour: team colour row while glowing, written as vanilla Team, outline preview with hover.');
