// 物品形态的特殊数据表单（js/itemspecial.js）与世界侧同步项：盔甲架（姿势、预设、开关、DisabledSlots）、展示框（Facing）、
// 告示牌（只认真实的告示牌方块实体）、命令方块（类型切换、命令、CommandAssist）、刷怪蛋交易；未知字段、long、类型化数组保真。
// 下面的 item_meta / entity_schema 是测试夹具，模拟宿主给的事实，不是编辑器里的数据表。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');
const t = H.create(),
  c = t.c;
c.snd = () => {};
const toasts = [];
c.toast = (m, tone) => toasts.push([m, tone]);
c.window.EDITOR_PREVIEW = false;
c.Reg.meta = { generation: 'item-entitydata-test' };
c.eggRedraw = () => {};
const qa = (el, sel) => el.querySelectorAll(sel);
// 假 DOM 不支持属性选择器：按属性值找后代
const byAttr = (el, k, v) => {
  for (const x of el.children) {
    if (x.getAttribute && x.getAttribute(k) === v) return x;
    const y = byAttr(x, k, v);
    if (y) return y;
  }
  return null;
};
const text = (cid) => c.nbtComponentText(c.Store.doc(), cid);

const STAND = 'minecraft:armor_stand';
const FRAME = 'minecraft:item_frame';
const VILLAGER = 'minecraft:villager';
const LOCKS = {
  type: 'int',
  default: 0,
  offsets: { lock: 0, take: 8, put: 16 },
  slots: [
    { slot: 'mainhand', bit: 0 },
    { slot: 'feet', bit: 1 },
    { slot: 'legs', bit: 2 },
    { slot: 'chest', bit: 3 },
    { slot: 'head', bit: 4 },
    { slot: 'offhand', bit: 5 }
  ]
};
c.Reg.eschema[STAND] = {
  id: STAND,
  available: true,
  default_nbt: '{Small:0b,ShowArms:0b,NoBasePlate:0b,Invisible:0b,Marker:0b,DisabledSlots:0}',
  variants: [],
  flags: [],
  attributes: [
    { id: 'minecraft:scale', base: 1, min: 0.0625, max: 16, common: true },
    { id: 'minecraft:max_health', base: 20, min: 1, max: 1024, common: true }
  ],
  equipment: [
    { slot: 'head', nbtPath: ['equipment', 'head'], canHold: true },
    { slot: 'mainhand', nbtPath: ['equipment', 'mainhand'], canHold: false, requires: { ShowArms: 1 } }
  ],
  views: {
    pose: {
      fields: {
        Head: { default: [0, 0, 0] },
        Body: { default: [0, 0, 0] },
        LeftArm: { default: [-10, 0, -10] },
        RightArm: { default: [-15, 0, 10] },
        LeftLeg: { default: [-1, 0, -1] },
        RightLeg: { default: [1, 0, 1] },
        ShowArms: { type: 'boolean', default: false },
        Small: { type: 'boolean', default: false },
        DisabledSlots: LOCKS
      }
    }
  }
};
c.Reg.eschema[FRAME] = {
  id: FRAME,
  available: true,
  default_nbt: '{ItemRotation:0b,ItemDropChance:1.0f,Invisible:0b,Fixed:0b,Facing:2b}',
  variants: [],
  flags: [],
  equipment: [],
  views: {
    item_frame: {
      fields: {
        ItemRotation: { default: 0 },
        ItemDropChance: { default: 1 },
        Facing: {
          readOnly: true,
          options: [
            { value: 0, name: 'down' },
            { value: 1, name: 'up' },
            { value: 2, name: 'north' },
            { value: 3, name: 'south' },
            { value: 4, name: 'west' },
            { value: 5, name: 'east' }
          ]
        }
      }
    }
  }
};
const META = {
  [STAND]: { id: STAND, placed_entity: STAND, placed_entity_kind: 'armor_stand' },
  [FRAME]: { id: FRAME, placed_entity: FRAME, placed_entity_kind: 'item_frame' },
  'minecraft:painting': {
    id: 'minecraft:painting',
    placed_entity: 'minecraft:painting',
    placed_entity_kind: 'hanging'
  },
  'minecraft:oak_sign': {
    id: 'minecraft:oak_sign',
    block_item: true,
    block_entity_type: 'minecraft:sign',
    block_entity_kind: 'sign',
    sign_lines: 4
  },
  'minecraft:oak_hanging_sign': {
    id: 'minecraft:oak_hanging_sign',
    block_item: true,
    block_entity_type: 'minecraft:hanging_sign',
    block_entity_kind: 'sign',
    sign_lines: 4
  },
  // Item-Editor 把这些也当告示牌；它们的方块实体不是告示牌，不能出告示牌表单
  'minecraft:torch': { id: 'minecraft:torch', block_item: true },
  'minecraft:skeleton_skull': {
    id: 'minecraft:skeleton_skull',
    block_item: true,
    block_entity_type: 'minecraft:skull'
  },
  'minecraft:white_banner': { id: 'minecraft:white_banner', block_item: true, block_entity_type: 'minecraft:banner' },
  'mod:sign_named_lamp': { id: 'mod:sign_named_lamp', block_item: true, block_entity_type: 'mod:sign_named_lamp' }
};
const CB = ['minecraft:chain_command_block', 'minecraft:command_block', 'minecraft:repeating_command_block'];
CB.forEach((id) => {
  META[id] = {
    id,
    block_item: true,
    block_entity_type: 'minecraft:command_block',
    block_entity_kind: 'command_block',
    block_entity_op_only: true,
    command_block_items: CB,
    block_entity_default_nbt:
      '{Command:"",SuccessCount:0,TrackOutput:1b,UpdateLastExecution:1b,powered:0b,conditionMet:0b,auto:0b}'
  };
});
Object.keys(META).forEach((id) => {
  c.Reg.imeta[id] = META[id];
  c.Reg.defs[id] = { id, comps: {} };
});
c.Reg.ingest('registry.enum:dye_color', {
  generation: 'item-entitydata-test',
  entries: [
    { id: 'black', name: '黑' },
    { id: 'red', name: '红' }
  ],
  total: 2,
  done: true
});
function open(id, comps, snbt) {
  c.Store.open({ id, count: 1, comps: comps || {}, removed: {}, snbt: snbt || {} }, true);
  return c.Store.doc();
}
function typed(cid, snbt) {
  const comps = {};
  c.nbtPut(comps, cid, c.parseSnbtUser(snbt));
  return { comps, snbt: { [cid]: snbt } };
}

// ---- 分类：按物品类 / 方块实体类的事实，不按名字；火把、头颅、旗帜、名字带 sign 的方块都不是告示牌
{
  assert.equal(c.kindOfItem(STAND), 'stand');
  assert.equal(c.kindOfItem(FRAME), 'frame');
  assert.equal(c.kindOfItem('minecraft:painting'), 'generic', 'painting is a hanging entity but not an item frame');
  assert.equal(c.kindOfItem('minecraft:oak_sign'), 'sign');
  assert.equal(c.kindOfItem('minecraft:oak_hanging_sign'), 'sign');
  for (const id of ['minecraft:torch', 'minecraft:skeleton_skull', 'minecraft:white_banner', 'mod:sign_named_lamp'])
    assert.notEqual(c.kindOfItem(id), 'sign', id + ' is not a sign');
  CB.forEach((id) => assert.equal(c.kindOfItem(id), 'cmdblock'));
  assert.equal(c.itemSpecialKind({ block_entity_type: 'minecraft:sign' }), '', 'needs the host sign fact, not the id');
  open('minecraft:oak_sign');
  const tabs = c.tabsOfKind('sign').map((x) => x.id);
  assert.ok(tabs.includes('sign') && tabs.includes('look'));
  const cards = c.PAGES.sign[0].cards.map((x) => (Array.isArray(x) ? x.join(':') : x));
  assert.equal(cards.join(','), 'signForm,specialRest:block_entity_data', 'generic field table kept as "other fields"');
}

// ---- 姿势预设：约 20 个，世界和物品共用；每个 6 个部位 × 3 个角度
{
  assert.ok(c.EV_POSE_PRESETS.length >= 18 && c.EV_POSE_PRESETS.length <= 24);
  const keys = new Set();
  c.EV_POSE_PRESETS.forEach((p) => {
    assert.ok(!keys.has(p.key), 'unique preset ' + p.key);
    keys.add(p.key);
    assert.equal(p.angles.length, 6);
    p.angles.forEach((a) => assert.ok(a.length === 3 && a.every((n) => Number.isFinite(n) && Math.abs(n) <= 180)));
  });
}

// ---- 盔甲架物品：预设写 float 列表，未知字段 / long / 类型化数组原样保留，id 由物品决定
{
  const raw =
    '{id:"minecraft:armor_stand",unknown:9007199254740993L,arr:[L;3L],Pose:{Head:[1.0f,2.0f,3.0f]},Glowing:1b}';
  const d = typed('entity_data', raw);
  open(STAND, d.comps, d.snbt);
  const card = c.CARDS.standPose();
  assert.ok(card.body.querySelector('.is-stand-ent'), '3D preview entity in the card');
  const ent = card.body.querySelector('.is-stand-ent');
  assert.equal(ent.getAttribute('type'), STAND);
  assert.match(ent.getAttribute('cad-stand'), /Head=1,2,3;Body=0,0,0;LeftArm=-10,0,-10/);
  assert.match(ent.getAttribute('cad-stand'), /ShowArms=0;Small=0;NoBasePlate=0/, 'flags always sent to the preview');
  const zombie = qa(card.body, '.k-btn').find((b) => b.getAttribute('data-preset') === 'zombie');
  zombie.fire('click');
  let s = text('entity_data');
  assert.ok(s.includes('unknown:9007199254740993L') && s.includes('arr:[L;3L]') && s.includes('Glowing:1b'), s);
  assert.ok(s.includes('LeftArm:[-90.0f,4.0f,0.0f]') || s.includes('LeftArm:[-90f,4f,0f]'), s);
  assert.ok(/ShowArms:(true|1b)/.test(s), 'preset shows arms');
  assert.ok(s.includes('id:"minecraft:armor_stand"'));
  // 单个角度
  const io = {};
  c.standPoseRows(c.h('div'), {
    openKey: 'test:',
    get: (k) => (c.isEntGet().Pose || {})[k],
    def: (k) => c.Reg.eschema[STAND].views.pose.fields[k].default,
    set: (k, a) => {
      io.set = [k, a];
      c.standWrite(STAND, (o) => {
        const pose = c.isObj(o.Pose) ? o.Pose : {};
        c.nbtPut(pose, k, c.isFloatList(a));
        o.Pose = pose;
      });
    },
    redraw: () => {}
  });
  c.standWrite(STAND, (o) => {
    c.nbtPut(o.Pose, 'Head', c.isFloatList([15, 0, -2.5]));
  });
  s = text('entity_data');
  assert.ok(/Head:\[15(\.0)?f,0(\.0)?f,-2\.5f\]/.test(s), s);
  // 重置：去掉 6 个部位，Pose 空了就整个去掉
  c.CARDS.standPose().body.querySelector('.stand-presets').lastChild.fire('click');
  assert.equal(c.isEntGet().Pose, undefined);
  assert.ok(text('entity_data').includes('9007199254740993L'));
}

// ---- 盔甲架开关、名字、体型
{
  open(STAND);
  const card = c.CARDS.standFlags();
  const rows = qa(card.body, '.k-xrow');
  const tips = rows.map((r) => r.querySelector('.tx').getAttribute('data-tip'));
  for (const k of [
    'Small',
    'ShowArms',
    'NoBasePlate',
    'Invisible',
    'NoGravity',
    'Invulnerable',
    'CustomNameVisible',
    'Marker'
  ])
    assert.ok(tips.includes(k), 'flag ' + k);
  rows[tips.indexOf('Marker')].querySelector('.k-toggle').fire('click');
  assert.equal(c.isEntGet().Marker, true);
  assert.equal(c.isEntGet().id, STAND, 'type comes from the item');
  rows[tips.indexOf('Marker')].querySelector('.k-toggle').fire('click');
  assert.equal(c.isEntGet().Marker, false);
  assert.ok(card.body.textContent.includes(c.I18n.t('cadeditor.ui.eschema.size')), 'scale row');
  assert.ok(card.body.querySelector('.k-rdta') || card.body.querySelector('.k-rd'), 'rich text name editor');
}

// ---- DisabledSlots：每槽三个位，全锁 / 全解只动认识的位，不认识的位保留；显示数值
{
  open(STAND, typed('entity_data', '{id:"minecraft:armor_stand",DisabledSlots:1073741824}').comps, {
    entity_data: '{id:"minecraft:armor_stand",DisabledSlots:1073741824}'
  });
  let card = c.CARDS.standGear();
  const lock = (key) => byAttr(card.body, 'data-lock', key);
  assert.ok(lock('head:lock') && lock('mainhand:put') && lock('offhand:take'));
  const toggle = (key) => {
    const el = lock(key);
    (el.querySelector('.k-toggle') || el).fire('click');
  };
  toggle('head:lock');
  assert.equal(c.isEntGet().DisabledSlots, (1 << 30) | (1 << 4));
  card = c.CARDS.standGear();
  toggle('head:take');
  assert.equal(c.isEntGet().DisabledSlots, (1 << 30) | (1 << 4) | (1 << 12));
  card = c.CARDS.standGear();
  toggle('mainhand:put');
  assert.equal(c.isEntGet().DisabledSlots, (1 << 30) | (1 << 4) | (1 << 12) | (1 << 16));
  card = c.CARDS.standGear();
  qa(card.body, '.k-btn')
    .find((b) => b.textContent === c.I18n.t('cadeditor.ui.worldentity.lock_all'))
    .fire('click');
  assert.equal(c.isEntGet().DisabledSlots, (1 << 30) | 0x3f3f3f, 'all six slots × three bits, unknown bit kept');
  card = c.CARDS.standGear();
  qa(card.body, '.k-btn')
    .find((b) => b.textContent === c.I18n.t('cadeditor.ui.worldentity.unlock_all'))
    .fire('click');
  assert.equal(c.isEntGet().DisabledSlots, 1 << 30, 'unlock keeps the unknown bit');
  assert.ok(text('entity_data').includes('DisabledSlots:1073741824'));
  assert.equal(c.standLockAll(c.standLockInfo(null)), 0x3f3f3f, 'offline fallback has the same layout');
  card = c.CARDS.standGear();
  const num = card.body.querySelector('.stand-locks').querySelector('input');
  assert.equal(num.value, String(1 << 30), 'numeric value shown');
}

// ---- 展示框：Facing 写 byte，可清除；ItemRotation byte；ItemDropChance float
{
  const raw = '{id:"minecraft:item_frame",keep:[I;1,2],Item:{id:"minecraft:diamond",count:1}}';
  const d = typed('entity_data', raw);
  open(FRAME, d.comps, d.snbt);
  let card = c.CARDS.frameForm();
  const seg = (label) => qa(card.body, '.k-segi').find((x) => x.textContent === label);
  seg(c.Labels.blockVal.east).fire('click');
  let s = text('entity_data');
  assert.ok(s.includes('Facing:5b'), s);
  assert.ok(s.includes('keep:[I;1,2]') && s.includes('minecraft:diamond'));
  card = c.CARDS.frameForm();
  seg(c.I18n.t('cadeditor.ui.common.unset')).fire('click');
  assert.equal(c.isEntGet().Facing, undefined, 'unset removes Facing');
  card = c.CARDS.frameForm();
  const rot = qa(card.body, '.k-xrow').find((r) => r.querySelector('.tx').getAttribute('data-tip') === 'ItemRotation');
  const inp = rot.querySelector('input');
  inp.value = '3';
  inp.fire('input');
  inp.fire('change');
  const drop = qa(card.body, '.k-xrow').find(
    (r) => r.querySelector('.tx').getAttribute('data-tip') === 'ItemDropChance'
  );
  const di = drop.querySelector('input');
  di.value = '0.5';
  di.fire('input');
  di.fire('change');
  s = text('entity_data');
  assert.ok(s.includes('ItemRotation:3b') && s.includes('ItemDropChance:0.5f'), s);
}

// ---- 告示牌：正面第二行、颜色保留、涂蜡；未知字段保留
{
  const raw = '{id:"minecraft:sign",front_text:{messages:["a","","",""],color:"red",has_glowing_text:0b},extra:5s}';
  const d = typed('block_entity_data', raw);
  open('minecraft:oak_sign', d.comps, d.snbt);
  const card = c.CARDS.signForm();
  t.doc.getElementById('screen').appendChild(card.el);
  const ta = card.body.querySelector('.k-rdta');
  assert.ok(ta, 'rich text sign lines');
  ta.value = ta.value
    .split('\n')
    .map((x, i) => (i === 1 ? '你好' : x))
    .join('\n');
  ta.fire('input');
  const v = c.isBlkGet();
  assert.equal(c.msgText(v.front_text.messages[1]), '你好');
  assert.equal(v.front_text.messages.length, 4);
  assert.equal(v.front_text.color, 'red', 'color kept');
  const s = text('block_entity_data');
  assert.ok(s.includes('extra:5s') && s.includes('id:"minecraft:sign"'), s);
  const wax = qa(card.body, '.k-xrow').find((r) => r.querySelector('.tx').getAttribute('data-tip') === 'is_waxed');
  wax.querySelector('.k-toggle').fire('click');
  assert.equal(c.isBlkGet().is_waxed, true);
  assert.ok(qa(card.body, '.k-xrow').some((r) => r.querySelector('.tx').getAttribute('data-tip') === 'color'));
  card.el.remove();
}

// ---- 命令方块：命令、开关、long、类型切换换物品；命令框接 CommandAssist，重画时断开旧的
{
  const attached = [],
    detached = [];
  c.CommandAssist = {
    attach(ta, opts) {
      const rec = { ta, opts };
      attached.push(rec);
      return () => detached.push(rec);
    }
  };
  const raw = '{id:"minecraft:command_block",Command:"say hi",LastExecution:9007199254740993L,mystery:[B;1b]}';
  const d = typed('block_entity_data', raw);
  open('minecraft:command_block', d.comps, d.snbt);
  let card = c.CARDS.cmdBlockForm();
  assert.equal(attached.length, 1, 'command box attached');
  assert.ok(
    card.body.textContent.includes(c.I18n.t('cadeditor.ui.itemspecial.op_only_nbt')),
    'op-only placement hint from the host fact'
  );
  const ta = card.body.querySelector('textarea.we-cmd');
  assert.equal(ta.value, 'say hi');
  ta.value = '/tp @s ~ ~1 ~';
  ta.fire('change');
  assert.equal(c.isBlkGet().Command, '/tp @s ~ ~1 ~');
  attached[0].opts.onApply('give @s stone');
  assert.equal(c.isBlkGet().Command, 'give @s stone', 'accepted completion is written');
  const flag = (k) => qa(card.body, '.k-xrow').find((r) => r.querySelector('.tx').getAttribute('data-tip') === k);
  for (const k of ['auto', 'powered', 'conditionMet', 'TrackOutput', 'UpdateLastExecution']) assert.ok(flag(k), k);
  assert.equal(flag('TrackOutput').querySelector('.k-toggle').classList.contains('on'), true, 'default from host save');
  flag('auto').querySelector('.k-toggle').fire('click');
  assert.equal(c.isBlkGet().auto, true);
  let s = text('block_entity_data');
  assert.ok(s.includes('LastExecution:9007199254740993L') && s.includes('mystery:[B;1b]'), s);
  card = c.CARDS.cmdBlockForm();
  assert.equal(detached.length, 1, 'redraw of the same document detaches the previous box');
  const last = qa(card.body, '.k-xrow').find(
    (r) => r.querySelector('.tx').getAttribute('data-tip') === 'LastExecution'
  );
  const li = last.querySelector('input');
  li.value = '9007199254740995';
  li.fire('keydown', { key: 'Enter' });
  li.fire('change');
  li.fire('blur');
  s = text('block_entity_data');
  assert.ok(s.includes('LastExecution:9007199254740995L'), s);
  // Short labels shared with the world command block view, so the row fits narrow windows.
  qa(card.body, '.k-segi')
    .find((x) => x.textContent === c.I18n.t('cadeditor.ui.worldview.repeat'))
    .fire('click');
  assert.equal(c.Store.doc().id, 'minecraft:repeating_command_block', 'type switch changes the item id');
  assert.ok(text('block_entity_data').includes('9007199254740995L'), 'block entity data kept across the switch');
  delete c.CommandAssist;
  c.CARDS.cmdBlockForm(); // 没有 CommandAssist 也能用
}

// ---- 刷怪蛋交易：没改的交易原样保留；改过的字段按类型重写；缺省值来自游戏
{
  c.Reg.eschema[VILLAGER] = {
    id: VILLAGER,
    available: true,
    default_nbt: '{Xp:0,VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}',
    variants: [],
    flags: [],
    equipment: [],
    views: {
      trades: {
        offer_defaults: {
          uses: 0,
          maxUses: 4,
          rewardExp: true,
          xp: 1,
          priceMultiplier: 0,
          demand: 0,
          specialPrice: 0
        }
      }
    }
  };
  c.Reg.imeta['minecraft:villager_spawn_egg'] = { id: 'minecraft:villager_spawn_egg', spawn_egg_entity: VILLAGER };
  c.Reg.defs['minecraft:villager_spawn_egg'] = { id: 'minecraft:villager_spawn_egg', comps: {} };
  const raw =
    '{id:"minecraft:villager",Offers:{Recipes:[' +
    '{buy:{id:"minecraft:emerald",count:3},sell:{id:"minecraft:bread",count:1,components:{"minecraft:custom_data":{n:7L}}},maxUses:9,future:1b},' +
    '{buy:{id:"minecraft:wheat",count:20},sell:{id:"minecraft:emerald",count:1},priceMultiplier:0.05f}]},keep:2s}';
  const d = typed('entity_data', raw);
  open('minecraft:villager_spawn_egg', d.comps, d.snbt);
  assert.equal(c.kindOfItem('minecraft:villager_spawn_egg'), 'spawn');
  const card = c.CARDS.eggTrades();
  assert.ok(card, 'trades card for a villager egg');
  assert.ok(/你支付|支付/.test(card.body.textContent) && card.body.textContent.includes('→'));
  const st = c.IT_TRADES.egg;
  assert.equal(st.list.length, 2);
  assert.equal(st.list[0].maxUses, 9);
  assert.equal(st.list[1].maxUses, 4, 'missing maxUses shows the codec default from the host');
  assert.equal(st.list[0].buy.id, 'minecraft:emerald');
  // 只改第二条的使用次数：第一条原样（含未知键 future、long 组件），第二条只多出 uses
  st.list[1].uses = 2;
  const m = c.tradeEditModal(st.list[1], 1, {
    valid: () => true,
    mark: () => {},
    closed: () => {}
  });
  c.closeModal();
  c.itemTradeSection({
    key: 'egg',
    schema: c.Reg.eschema[VILLAGER],
    get: c.eggData,
    set: c.eggWrite,
    redraw: () => {}
  });
  const st2 = c.IT_TRADES.egg;
  assert.equal(st2, st, 'state reused while Offers text is unchanged');
  // 用交易列表的写回
  const box = c.itemTradeSection({
    key: 'egg',
    schema: c.Reg.eschema[VILLAGER],
    get: c.eggData,
    set: c.eggWrite,
    redraw: () => {}
  });
  assert.ok(box.querySelectorAll('.trade-list-row').length === 2);
  // 删除第二条以外：通过 mark 触发写回（模拟交易窗改动后的写回）
  const recipes = st.list.map(c.tradeToRecipe);
  const s0 = c.nbtMerge(recipes[0], null);
  assert.ok(s0.includes('future:1b') && s0.includes('n:7L') && s0.includes('maxUses:9'), s0);
  assert.ok(!s0.includes('uses:0'), 'unchanged recipe does not gain default fields');
  const s1 = c.nbtMerge(recipes[1], null);
  assert.ok(s1.includes('uses:2') && s1.includes('priceMultiplier:0.05f') && !s1.includes('maxUses'), s1);
  // 新增一条：模板写全，priceMultiplier 是 float
  const fresh = c.tradeFromRecipe({}, null);
  Object.assign(fresh, c.tradeTemplate());
  const s2 = c.nbtMerge(c.tradeToRecipe(fresh), null);
  assert.ok(s2.includes('priceMultiplier:0.05f') && s2.includes('maxUses:12') && s2.includes('minecraft:emerald'), s2);
  // 支付物品不能写「去掉组件」：忽略并提示
  const cost = c.tradeFromRecipe({ buy: { id: 'minecraft:emerald', count: 1 }, sell: { id: 'minecraft:stone' } }, null);
  cost.buy = { id: 'minecraft:emerald', count: 2, comps: {}, removed: { lore: 1 } };
  const s3 = c.nbtMerge(c.tradeToRecipe(cost), null);
  assert.ok(!s3.includes('!minecraft:lore') && s3.includes('count:2'), s3);
  assert.ok(toasts.some((x) => x[1] === 'warn'));
  // 整体写回：Offers 外的字段（keep:2s）保留
  const rows = box.querySelectorAll('.trade-list-row');
  rows[1].querySelector('.k-mini.del').fire('click');
  const s4 = text('entity_data');
  assert.ok(s4.includes('keep:2s') && s4.includes('future:1b') && !s4.includes('minecraft:wheat'), s4);
  assert.equal(c.IT_TRADES.egg.list.length, 1);
  void m;
  // 「其他数据」不再列出交易卡管的 Offers / Xp（旧快照不会盖掉交易卡的修改）
  const other = c.CARDS.eggData().body.textContent;
  assert.ok(other.includes('keep') && !other.includes('Offers'), other);
  // 刷怪笼里的村民：同一个交易区（esPanel 的 trades 选项）
  let spawnEntity = c.parseSnbtUser(
    '{id:"minecraft:villager",Offers:{Recipes:[{buy:{id:"minecraft:emerald"},sell:{id:"minecraft:apple"}}]}}'
  );
  const panel = c.esPanel({
    type: VILLAGER,
    trades: 'spawner:data',
    get: () => spawnEntity,
    set: (e) => {
      spawnEntity = e;
    }
  });
  assert.equal(panel.querySelectorAll('.trade-list-row').length, 1, 'spawner entity trades');
  const panelNoTrades = c.esPanel({ type: VILLAGER, get: () => spawnEntity, set: () => {} });
  assert.equal(
    panelNoTrades.querySelectorAll('.trade-list-row').length,
    0,
    'world entity attributes page has no trades'
  );
  // 不是村民类：没有交易卡
  c.Reg.eschema['minecraft:pig'] = { id: 'minecraft:pig', available: true, variants: [], flags: [], equipment: [] };
  c.Reg.imeta['minecraft:pig_spawn_egg'] = { id: 'minecraft:pig_spawn_egg', spawn_egg_entity: 'minecraft:pig' };
  c.Reg.defs['minecraft:pig_spawn_egg'] = { id: 'minecraft:pig_spawn_egg', comps: {} };
  open('minecraft:pig_spawn_egg');
  assert.equal(c.CARDS.eggTrades(), null);
}

// ---- 世界侧：盔甲架锁定位、展示框朝向只读、命令框接 CommandAssist
{
  c.weRender = () => {};
  c.weHeroLive = () => {};
  c.WE.w = {
    kind: 'entity',
    type: STAND,
    views: {
      pose: {
        Head: [0, 0, 0],
        Body: [0, 0, 0],
        LeftArm: [-10, 0, -10],
        RightArm: [-15, 0, 10],
        LeftLeg: [-1, 0, -1],
        RightLeg: [1, 0, 1],
        ShowArms: false,
        Small: false,
        Marker: false,
        Invisible: false,
        NoBasePlate: false,
        DisabledSlots: 0,
        schema: { fields: c.Reg.eschema[STAND].views.pose.fields }
      }
    }
  };
  c.WE.ent = {};
  c.WE.offers = null;
  let b = c.h('div');
  c.evPoseTab(b);
  assert.equal(qa(b, '.stand-presets')[0].children.length, c.EV_POSE_PRESETS.length + 1, 'all presets + reset');
  byAttr(b, 'data-lock', 'chest:take').querySelector('.k-toggle').fire('click');
  const msg = {};
  c.evMsg(msg);
  assert.deepEqual(JSON.parse(JSON.stringify(msg.entity)), { pose: { DisabledSlots: 1 << 11 } });
  // 展示框：朝向只显示，不进草稿
  c.WE.w = {
    kind: 'entity',
    type: FRAME,
    views: {
      item_frame: {
        ItemRotation: 0,
        Invisible: false,
        Fixed: false,
        ItemDropChance: 1,
        Facing: 3,
        item: { empty: true },
        schema: c.Reg.eschema[FRAME].views.item_frame
      }
    }
  };
  c.WE.ent = {};
  b = c.h('div');
  c.evFrameTab(b);
  const facing = qa(b, '.k-xrow').find((r) => r.querySelector('.tx').getAttribute('data-tip') === 'Facing');
  assert.ok(facing && facing.textContent.includes(c.Labels.blockVal.south), 'facing shown read-only');
  assert.equal(facing.querySelector('input'), null);
  assert.deepEqual(c.WE.ent, {});
  // 命令方块 / 命令矿车的命令框
  const seen = [];
  c.CommandAssist = {
    attach(ta) {
      seen.push(ta);
      return () => {};
    }
  };
  c.WE.w = {
    kind: 'block',
    type: 'minecraft:command_block',
    block: 'minecraft:command_block',
    block_type_schema: [],
    views: { command_block: { value: { Command: 'say a', auto: false }, schema: { fields: {} } } }
  };
  c.WE.views = {};
  b = c.h('div');
  c.WEV.command_block(b, 'command_block');
  c.WE.w = {
    kind: 'entity',
    type: 'minecraft:command_block_minecart',
    views: { minecart_command: { Command: 'say b' } }
  };
  c.WE.ent = {};
  b = c.h('div');
  c.EV_SIMPLE_TAB.minecart_command(b);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].value, 'say a');
  assert.equal(seen[1].value, 'say b');
  delete c.CommandAssist;
}

assert(!t.sent.some(([key]) => key === 'apply' || key === 'apply_world'), 'forms never apply to the game');
console.log(
  'PASS item entity data forms: stand pose/presets/flags/DisabledSlots, frame Facing, sign detection, command block + CommandAssist, egg trades; typed fields kept.'
);
