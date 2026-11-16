/* 页面编排：物品类别 → 分页 → 卡片。只显示与这类物品相关的内容；其余组件通过「添加设置」加入，显示在「附加设置」页。 */

var KIND_INFO = {
  melee: { name: I18n.t('cadeditor.ui.pages.melee_weapons'), color: '#e8663d', icon: 'sword' },
  tool: { name: I18n.t('cadeditor.ui.pages.tools'), color: '#e5b417', icon: 'pickaxe' },
  ranged: { name: I18n.t('cadeditor.ui.pages.ranged_weapons'), color: '#7bc74d', icon: 'bow' },
  shield: { name: I18n.t('cadeditor.ui.pages.shield'), color: '#8fa3b8', icon: 'shield' },
  armor: { name: I18n.t('cadeditor.ui.pages.armor_equipment'), color: '#4a9bff', icon: 'chestplate' },
  food: { name: I18n.t('cadeditor.ui.cards3.food'), color: '#f2a33a', icon: 'apple' },
  potion: { name: I18n.t('cadeditor.ui.cards3.potion'), color: '#b46bff', icon: 'potion_round' },
  ebook: { name: I18n.t('cadeditor.ui.pages.enchanted_book'), color: '#c46aff', icon: 'book' },
  book: { name: I18n.t('cadeditor.ui.pages.book'), color: '#c9a26b', icon: 'book_open' },
  container: { name: I18n.t('cadeditor.ui.pages.container'), color: '#d08b4a', icon: 'chest' },
  firework: { name: I18n.t('cadeditor.ui.cards3.fireworks'), color: '#ff5a9a', icon: 'explosion' },
  banner: { name: I18n.t('cadeditor.ui.pages.banner'), color: '#4ac8d9', icon: 'banner' },
  disc: { name: I18n.t('cadeditor.ui.pages.music_disc'), color: '#6ed1a8', icon: 'music' },
  spawn: { name: I18n.t('cadeditor.ui.pages.spawn_egg'), color: '#7bc74d', icon: 'paw' },
  bucket: { name: I18n.t('cadeditor.ui.pages.mob_bucket'), color: '#4ac8d9', icon: 'paw' },
  spawner: { name: I18n.t('cadeditor.ui.pages.spawner'), color: '#8f7be0', icon: 'paw' },
  stand: { name: I18n.t('cadeditor.ui.itemspecial.kind_stand'), color: '#c9a26b', icon: 'user' },
  frame: { name: I18n.t('cadeditor.ui.itemspecial.kind_frame'), color: '#d08b4a', icon: 'image' },
  sign: { name: I18n.t('cadeditor.ui.itemspecial.kind_sign'), color: '#c9a26b', icon: 'edit' },
  cmdblock: { name: I18n.t('cadeditor.ui.itemspecial.kind_command'), color: '#e0a03c', icon: 'terminal' },
  generic: { name: I18n.t('cadeditor.ui.pages.items_blocks'), color: '#6cc349', icon: 'cube' }
};
var RARITY_ZH = Labels.rarityZh;

var APPEAR = [
  I18n.t('cadeditor.ui.pages.name_description'),
  'name',
  'lore',
  I18n.t('cadeditor.ui.pages.rare_display'),
  'rarity',
  'glint',
  'tooltip',
  'model'
];
var DURA = [
  I18n.t('cadeditor.ui.pages.durability'),
  'maxDamage',
  'damage',
  'unbreakable',
  I18n.t('cadeditor.ui.pages.repair_protection'),
  'repair',
  'resist',
  I18n.t('cadeditor.ui.pages.stack'),
  'stack'
];
var ENCH = [
  I18n.t('cadeditor.ui.pages.enchantment'),
  ['enchants', 'enchantments'],
  I18n.t('cadeditor.ui.pages.enchanting_table'),
  'enchantable'
];

/* 每类物品的分页。cards 里：字符串=CARDS 的键；[键, 参数…]=带参数调用 */
var PAGES = {
  bucket: [
    {
      id: 'bucket',
      label: I18n.t('cadeditor.ui.pages.bucket_entity'),
      icon: 'paw',
      cards: ['bucketEntity', 'bucketFields', 'bucketAttrs', 'bucketAppearance', 'bucketEntityData']
    },
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR }
  ],
  melee: [
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR },
    {
      id: 'combat',
      label: I18n.t('cadeditor.ui.pages.combat'),
      icon: 'sword',
      cards: [
        I18n.t('cadeditor.ui.pages.base_value'),
        'attackDamage',
        'attackSpeed',
        I18n.t('cadeditor.ui.pages.attack_properties'),
        'weapon',
        'reach',
        'swing',
        'cooldown',
        I18n.t('cadeditor.ui.pages.extra_attribute'),
        'extraAttrs'
      ]
    },
    { id: 'dura', label: I18n.t('cadeditor.ui.pages.durability_2'), icon: 'shield', cards: DURA },
    { id: 'ench', label: I18n.t('cadeditor.ui.cards1.enchantments'), icon: 'enchant', cards: ENCH }
  ],
  tool: [
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR },
    {
      id: 'mine',
      label: I18n.t('cadeditor.ui.pages.mining_attacks'),
      icon: 'pickaxe',
      cards: [
        I18n.t('cadeditor.ui.pages.mining'),
        'tool',
        I18n.t('cadeditor.ui.pages.attack'),
        'attackDamage',
        'attackSpeed',
        'weapon',
        'swing',
        I18n.t('cadeditor.ui.pages.extra_attribute'),
        'extraAttrs'
      ]
    },
    { id: 'dura', label: I18n.t('cadeditor.ui.pages.durability_2'), icon: 'shield', cards: DURA },
    { id: 'ench', label: I18n.t('cadeditor.ui.cards1.enchantments'), icon: 'enchant', cards: ENCH }
  ],
  ranged: [
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR },
    { id: 'dura', label: I18n.t('cadeditor.ui.pages.durability_2'), icon: 'shield', cards: DURA },
    { id: 'ench', label: I18n.t('cadeditor.ui.cards1.enchantments'), icon: 'enchant', cards: ENCH },
    {
      id: 'attrs',
      label: I18n.t('cadeditor.ui.eschema.attributes'),
      icon: 'sliders',
      cards: [I18n.t('cadeditor.ui.pages.attribute'), 'extraAttrs', I18n.t('cadeditor.ui.pages.cooldown'), 'cooldown']
    }
  ],
  shield: [
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR },
    {
      id: 'banner',
      label: I18n.t('cadeditor.ui.pages.banner_patterns'),
      icon: 'banner',
      cards: [
        I18n.t('cadeditor.ui.pages.flags'),
        ['auto', 'banner_patterns'],
        ['auto', 'base_color'],
        I18n.t('cadeditor.ui.pages.material'),
        ['auto', 'provides_banner_patterns']
      ]
    },
    { id: 'dura', label: I18n.t('cadeditor.ui.pages.durability_2'), icon: 'shield', cards: DURA },
    { id: 'ench', label: I18n.t('cadeditor.ui.cards1.enchantments'), icon: 'enchant', cards: ENCH },
    {
      id: 'attrs',
      label: I18n.t('cadeditor.ui.eschema.attributes'),
      icon: 'sliders',
      cards: [I18n.t('cadeditor.ui.pages.attribute'), 'extraAttrs']
    }
  ],
  armor: [
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR },
    {
      id: 'def',
      label: I18n.t('cadeditor.ui.pages.equipment_protection'),
      icon: 'chestplate',
      cards: [
        I18n.t('cadeditor.ui.pages.wear'),
        'equip',
        I18n.t('cadeditor.ui.pages.protective_values'),
        'armorValue',
        'armorToughness',
        'knockbackResist',
        I18n.t('cadeditor.ui.pages.appearance_customised'),
        'trim',
        'dye',
        I18n.t('cadeditor.ui.pages.other'),
        'glider',
        'extraAttrs'
      ]
    },
    { id: 'dura', label: I18n.t('cadeditor.ui.pages.durability_2'), icon: 'shield', cards: DURA },
    { id: 'ench', label: I18n.t('cadeditor.ui.cards1.enchantments'), icon: 'enchant', cards: ENCH }
  ],
  food: [
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR },
    {
      id: 'eat',
      label: I18n.t('cadeditor.ui.pages.consume'),
      icon: 'apple',
      cards: [
        I18n.t('cadeditor.ui.pages.food'),
        'food',
        I18n.t('cadeditor.ui.pages.use_behavior'),
        'consumable',
        'cooldown',
        I18n.t('cadeditor.ui.pages.after_use'),
        'remainder',
        'stack'
      ]
    },
    {
      id: 'fx',
      label: I18n.t('cadeditor.ui.pages.consume_effects'),
      icon: 'flask',
      cards: [I18n.t('cadeditor.ui.pages.end_use'), 'consumeEffects', I18n.t('cadeditor.ui.pages.crotch'), 'stew']
    }
  ],
  potion: [
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR },
    {
      id: 'potion',
      label: I18n.t('cadeditor.ui.cards3.potion'),
      icon: 'potion_round',
      cards: [
        I18n.t('cadeditor.ui.pages.potion'),
        'potion',
        I18n.t('cadeditor.ui.pages.use_behavior'),
        'consumable',
        'remainder',
        'stack'
      ]
    }
  ],
  ebook: [
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR },
    {
      id: 'ench',
      label: I18n.t('cadeditor.ui.cards1.enchantments'),
      icon: 'enchant',
      cards: [I18n.t('cadeditor.ui.pages.enchanted_book_2'), ['enchants', 'stored_enchantments']]
    }
  ],
  book: [
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR },
    {
      id: 'text',
      label: I18n.t('cadeditor.ui.pages.contents'),
      icon: 'book_open',
      cards: [I18n.t('cadeditor.ui.pages.book_content'), 'writtenBook', 'writableBook']
    }
  ],
  container: [
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR },
    {
      id: 'inside',
      label: I18n.t('cadeditor.ui.pages.contents'),
      icon: 'chest',
      cards: [I18n.t('cadeditor.ui.pages.item'), 'container', 'bundle', 'stack']
    }
  ],
  firework: [
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR },
    {
      id: 'fw',
      label: I18n.t('cadeditor.ui.cards3.fireworks'),
      icon: 'explosion',
      cards: [I18n.t('cadeditor.ui.pages.firework'), 'fireworks', 'fireworkStar', 'stack']
    }
  ],
  generic: [
    { id: 'look', label: I18n.t('cadeditor.ui.eschema.appearance'), icon: 'palette', cards: APPEAR },
    {
      id: 'stack',
      label: I18n.t('cadeditor.ui.pages.stack_durability'),
      icon: 'layers',
      cards: DURA.concat([I18n.t('cadeditor.ui.pages.death_protection'), 'deathProtection'])
    },
    { id: 'ench', label: I18n.t('cadeditor.ui.cards1.enchantments'), icon: 'enchant', cards: ENCH }
  ]
};
PAGES.banner = [
  PAGES.generic[0],
  {
    id: 'banner',
    label: I18n.t('cadeditor.ui.pages.banner_patterns'),
    icon: 'banner',
    cards: [
      I18n.t('cadeditor.ui.pages.flags'),
      ['auto', 'banner_patterns'],
      ['auto', 'base_color'],
      I18n.t('cadeditor.ui.pages.material'),
      ['auto', 'provides_banner_patterns']
    ]
  }
].concat(PAGES.generic.slice(1));
PAGES.disc = PAGES.generic;
PAGES.spawn = [
  {
    id: 'egg',
    label: I18n.t('cadeditor.ui.pages.spawn_egg'),
    icon: 'paw',
    cards: ['spawnEgg', 'eggLook', 'eggFlags', 'eggAttrs', 'eggEffects', 'eggGear', 'eggTrades', 'eggData']
  },
  PAGES.generic[0],
  PAGES.generic[1]
];
/* 物品形态的特殊数据（itemspecial.js）：专用卡片在前，「其它字段」保留通用字段表 */
PAGES.stand = [
  {
    id: 'stand',
    label: I18n.t('cadeditor.ui.itemspecial.kind_stand'),
    icon: 'user',
    cards: ['standPose', 'standFlags', 'standGear', ['specialRest', 'entity_data']]
  },
  PAGES.generic[0],
  PAGES.generic[1]
];
PAGES.frame = [
  {
    id: 'frame',
    label: I18n.t('cadeditor.ui.itemspecial.kind_frame'),
    icon: 'image',
    cards: ['frameForm', ['specialRest', 'entity_data']]
  },
  PAGES.generic[0],
  PAGES.generic[1]
];
PAGES.sign = [
  {
    id: 'sign',
    label: I18n.t('cadeditor.ui.itemspecial.kind_sign'),
    icon: 'edit',
    cards: ['signForm', ['specialRest', 'block_entity_data']]
  },
  PAGES.generic[0],
  PAGES.generic[1]
];
PAGES.cmdblock = [
  {
    id: 'cmdblock',
    label: I18n.t('cadeditor.ui.itemspecial.kind_command'),
    icon: 'terminal',
    cards: ['cmdBlockForm', ['specialRest', 'block_entity_data']]
  },
  PAGES.generic[0],
  PAGES.generic[1]
];
/* item_meta 的事实：物品类决定放出的实体（placed_entity_kind），方块实体类决定方块数据（block_entity_kind）。不看物品 ID 的写法 */
function itemSpecialKind(meta) {
  if (!meta) return '';
  if (meta.placed_entity_kind === 'armor_stand' && meta.placed_entity) return 'stand';
  if (meta.placed_entity_kind === 'item_frame' && meta.placed_entity) return 'frame';
  if (meta.block_entity_kind === 'sign' && meta.block_entity_type) return 'sign';
  if (meta.block_entity_kind === 'command_block' && meta.block_entity_type) return 'cmdblock';
  return '';
}
PAGES.spawner = [
  {
    id: 'spawner',
    label: I18n.t('cadeditor.ui.pages.spawner_settings'),
    icon: 'paw',
    cards: [I18n.t('cadeditor.ui.pages.spawner_2'), 'spawner']
  },
  PAGES.generic[0],
  PAGES.generic[1]
];

/* 卡片是否适用于当前物品（有些卡片只在物品本来有对应功能时出现） */
var CARD_NEEDS = {
  stew: 'suspicious_stew_effects',
  deathProtection: 'death_protection',
  fireworkStar: 'firework_explosion',
  fireworks: 'fireworks',
  bundle: 'bundle_contents',
  container: 'container',
  writtenBook: 'written_book_content',
  writableBook: 'writable_book_content'
};
function cardApplies(key, id, kind) {
  var need = CARD_NEEDS[key];
  if (key === 'container')
    return (
      (kind === 'container' && Ctx.protoItem(id, 'container') !== undefined) ||
      (kind === 'container' && Ctx.protoItem(id, 'bundle_contents') === undefined)
    );
  if (key === 'bundle') return Ctx.protoItem(id, 'bundle_contents') !== undefined;
  if (key === 'writtenBook') return id === 'written_book';
  if (key === 'writableBook') return id === 'writable_book';
  if (key === 'fireworks') return id === 'firework_rocket';
  if (key === 'fireworkStar') return id === 'firework_star';
  if (need) return Ctx.protoItem(id, need) !== undefined || Ctx.has(need);
  if (key === 'consumeEffects' && kind === 'generic') return Ctx.has('consumable');
  if (kind === 'generic') {
    if (key === 'consumable') return Ctx.has('consumable');
    if (key === 'food') return Ctx.has('food');
    if (key === 'equip') return Ctx.has('equippable');
    if (key === 'glider') return Ctx.has('glider');
    if (key === 'cooldown') return Ctx.has('use_cooldown');
  }
  return true;
}
function makeCard(spec) {
  var key = spec,
    args = [];
  if (Array.isArray(spec)) {
    key = spec[0];
    args = spec.slice(1);
  }
  var f = CARDS[key];
  if (!f) return null;
  var skipLazy = DETAIL_IN || DETAIL_BIG[key] || (key === 'auto' && DETAIL_AUTO[args[0]]);
  var card = null;
  KLAZY = skipLazy ? 0 : 1;
  var previousReads = ComponentReads,
    reads = {};
  ComponentReads = reads;
  try {
    card = f.apply(null, args);
  } catch (e) {
    if (e instanceof LazyCard) {
      card = e.card;
      card.lazy = { f: f, args: args };
      lazyHook(card);
    } else {
      KLAZY = 0;
      throw e;
    }
  } finally {
    ComponentReads = previousReads;
  }
  if (card) {
    card.depends = card.depends || {};
    Object.keys(reads).forEach(function (cid) {
      card.depends[cid] = true;
    });
  }
  KLAZY = 0;
  if (card && DETAIL_BIG[key] && !DETAIL_IN)
    detailize(card, { key: spec, cid: (card.comps && card.comps[0]) || '', title: card.spec && card.spec.title });
  return card;
}

/* 构建一个分页的卡片 */
function buildTabCards(kind, tab) {
  var id = Ctx.id(),
    out = [];
  tab.cards.forEach(function (c) {
    var key = Array.isArray(c) ? c[0] : c;
    if (typeof c === 'string' && c.charAt(0) === '#') {
      out.push({ marker: c.substring(1) });
      return;
    }
    if (!tab.force && !cardApplies(key, id, kind)) return;
    var card = makeCard(c);
    if (card) out.push(card);
  });
  return out;
}
/* 一张卡片对应的组件 id 列表 */
function cardComps(c) {
  var key = Array.isArray(c) ? c[0] : c;
  if (key === 'auto' || key === 'enchants') return [c[1]];
  if (key === 'extraAttrs') return ['attribute_modifiers'];
  if (key === 'bucketEntity' || key === 'bucketFields') return ['bucket_entity_data'];
  if (key === 'bucketAttrs' || key === 'bucketEntityData') return ['entity_data'];
  if (key === 'bucketAppearance') return (bucketMeta().bucket_components || []).map(shortId);
  if (key === 'specialRest') return [c[1]];
  return CARD_COMPS[key] || [];
}
function cardKey(c) {
  var key = Array.isArray(c) ? c[0] : c;
  return key === 'auto' || key === 'enchants' || key === 'specialRest' ? key + ':' + c[1] : key;
}
/* 一个分页里被改动过的组件个数（用于标签上的角标） */
function tabModCount(kind, tab) {
  var seen = {},
    n = 0,
    d = Ctx.doc();
  tab.cards.forEach(function (c) {
    cardComps(c).forEach(function (cid) {
      if (!seen[cid] && intentOf(d, cid) !== 'inherit') {
        seen[cid] = 1;
        n++;
      }
    });
  });
  return n;
}
var CARD_COMPS = {
  name: ['custom_name'],
  lore: ['lore'],
  rarity: ['rarity'],
  glint: ['enchantment_glint_override'],
  tooltip: ['tooltip_display'],
  model: ['item_model'],
  maxDamage: ['max_damage'],
  damage: ['damage'],
  unbreakable: ['unbreakable'],
  repair: ['repair_cost', 'repairable'],
  resist: ['damage_resistant'],
  stack: ['max_stack_size'],
  enchantable: ['enchantable'],
  attackDamage: ['attribute_modifiers'],
  attackSpeed: ['attribute_modifiers'],
  weapon: ['weapon'],
  reach: ['attack_range'],
  swing: ['swing_animation'],
  cooldown: ['use_cooldown'],
  tool: ['tool'],
  equip: ['equippable'],
  armorValue: ['attribute_modifiers'],
  armorToughness: ['attribute_modifiers'],
  knockbackResist: ['attribute_modifiers'],
  trim: ['trim'],
  dye: ['dyed_color'],
  glider: ['glider'],
  food: ['food'],
  consumable: ['consumable'],
  consumeEffects: ['consumable'],
  remainder: ['use_remainder'],
  potion: ['potion_contents'],
  stew: ['suspicious_stew_effects'],
  deathProtection: ['death_protection'],
  container: ['container'],
  bundle: ['bundle_contents'],
  writtenBook: ['written_book_content'],
  writableBook: ['writable_book_content'],
  fireworks: ['fireworks'],
  fireworkStar: ['firework_explosion'],
  standPose: ['entity_data'],
  standFlags: ['entity_data'],
  standGear: ['entity_data'],
  frameForm: ['entity_data'],
  signForm: ['block_entity_data'],
  cmdBlockForm: ['block_entity_data']
};

/* ---------- 变更的人话描述（应用前确认、差异对比用） ---------- */
function compBrief(cid, val) {
  var c = CIDX[cid];
  if (val === undefined) return I18n.t('cadeditor.ui.pages.none');
  try {
    switch (cid) {
      case 'custom_name':
      case 'item_name': {
        var r = tcRuns(val);
        return r
          ? '「' +
              r.runs
                .map(function (x) {
                  return x.text;
                })
                .join('') +
              '」'
          : I18n.t('cadeditor.ui.forms.complex_text');
      }
      case 'lore':
        return I18n.t('cadeditor.ui.pages.line_description', val.length);
      case 'rarity':
        return RARITY_ZH[val] || val;
      case 'enchantments':
      case 'stored_enchantments': {
        var k = Object.keys(val);
        return k.length
          ? k
              .map(function (x) {
                var e = Reg.enchant(x);
                return (e ? e.name : shortId(x)) + ' ' + levelText(val[x]);
              })
              .join('、')
          : I18n.t('cadeditor.ui.pages.enchantments');
      }
      case 'attribute_modifiers':
        return val.length
          ? val
              .map(function (m) {
                return attrName(m.type) + ' ' + modSummary(m);
              })
              .join('、')
          : I18n.t('cadeditor.ui.pages.attribute_modifiers');
      case 'max_damage':
      case 'damage':
      case 'max_stack_size':
      case 'repair_cost':
        return bigOrNum(val);
      case 'unbreakable':
        return I18n.t('cadeditor.ui.cards1.unbreakable');
      case 'enchantment_glint_override':
        return val ? I18n.t('cadeditor.ui.cards1.always_show_glint') : I18n.t('cadeditor.ui.cards1.glint');
      case 'food':
        return I18n.t('cadeditor.ui.pages.hunger_saturation', val.nutrition, val.saturation);
      case 'dyed_color':
        return typeof val === 'number' ? hex6(val) : I18n.t('cadeditor.ui.pages.custom_color');
      case 'item_model':
        return I18n.t('cadeditor.ui.pages.appearance', nameOfItem(val));
      case 'equippable':
        return I18n.t(
          'cadeditor.ui.pages.in',
          (
            EQ_SLOTS.filter(function (s) {
              return s.v === val.slot;
            })[0] || { label: val.slot }
          ).label
        );
      case 'trim':
        return I18n.t('cadeditor.ui.pages.trim', shortId(val.pattern), shortId(val.material));
      case 'container':
        return I18n.t('cadeditor.ui.cards3.item', val.length);
      case 'potion_contents': {
        var o = typeof val === 'string' ? { potion: val } : val;
        return (
          (o.potion ? potionName(o.potion) : '') +
          (o.custom_effects && o.custom_effects.length
            ? I18n.t('cadeditor.ui.pages.custom_effects', o.custom_effects.length)
            : '')
        );
      }
      case 'tool':
        return I18n.t('cadeditor.ui.pages.article_mining_rules', (val.rules || []).length);
    }
  } catch (e) {
    /* 落到下面的通用描述 */
  }
  return c ? I18n.t('cadeditor.ui.pages.modified', c.name) : cid;
}
function describeDiff(x) {
  var name =
    x.cid === '#item'
      ? I18n.t('cadeditor.ui.pages.item_2')
      : x.cid === '#count'
        ? I18n.t('cadeditor.ui.pages.count')
        : CIDX[x.cid]
          ? CIDX[x.cid].name
          : x.cid;
  var b = x.before,
    a = x.after,
    kind;
  function side(st) {
    if (st.k === 'inherit') return I18n.t('cadeditor.ui.pages.vanilla_default');
    if (st.k === 'remove') return I18n.t('cadeditor.ui.pages.removed');
    return x.cid.charAt(0) === '#' ? String(st.v) : compBrief(x.cid, st.v);
  }
  if (a.k === 'remove') kind = 'rm';
  else if (b.k === 'inherit' && a.k === 'set') kind = 'add';
  else if (a.k === 'inherit') kind = 'rv';
  else kind = 'ch';
  return { name: name, kind: kind, before: side(b), after: side(a) };
}
/* Apply and Advanced share the same field-level comparison. Pair modifiers by
   their actual ID, never by display name; unchanged attack speed is not a change. */
function describeDiffRows(x, d) {
  var summary = describeDiff(x);
  if (x.cid !== 'attribute_modifiers') return [summary];
  var base = nbtReadSnapshot(d.base),
    beforeDefaults = protoOf(base.id),
    afterDefaults = protoOf(d.id);
  function list(state, defaults) {
    return state.k === 'set' ? state.v : state.k === 'remove' ? [] : defaults.attribute_modifiers;
  }
  var before = list(x.before, beforeDefaults),
    after = list(x.after, afterDefaults);
  if (!Array.isArray(before) || !Array.isArray(after)) return [summary];
  var bm = Object.create(null),
    am = Object.create(null),
    keys = [],
    duplicate = false;
  function index(rows, map) {
    rows.forEach(function (m) {
      if (!isObj(m) || !m.id) {
        duplicate = true;
        return;
      }
      var k = String(m.id);
      if (map[k]) {
        duplicate = true;
        return;
      }
      map[k] = m;
      if (keys.indexOf(k) < 0) keys.push(k);
    });
  }
  index(before, bm);
  index(after, am);
  if (duplicate)
    return [{ name: summary.name, kind: summary.kind, before: nbtMerge(before, null), after: nbtMerge(after, null) }];
  var rows = [];
  function value(v) {
    return v === undefined
      ? I18n.t('cadeditor.ui.common.unset')
      : typeof v === 'number' || (nbtMeta(v) && nbtMeta(v).scalar)
        ? numLabel(v)
        : typeof v === 'string'
          ? v
          : nbtMerge(v, null);
  }
  keys.forEach(function (key) {
    var b = bm[key],
      a = am[key];
    if (deepEq(b, a)) return;
    var m = a || b,
      title = attrName(m.type),
      slot = SLOT_ZH[m.slot || 'any'] || m.slot || I18n.t('cadeditor.ui.pages.any_slot');
    var op =
      (
        OPMODES.filter(function (o) {
          return o.v === (m.operation || 'add_value');
        })[0] || {}
      ).label || m.operation;
    var sub = slot + (m.operation && m.operation !== 'add_value' && op ? ' · ' + op : ''),
      kind = !b ? 'add' : !a ? 'rm' : 'ch';
    if (!b || !a) {
      rows.push({
        name: I18n.t('cadeditor.ui.pages.caing', title),
        sub: sub,
        kind: kind,
        before: b ? numLabel(b.amount) : I18n.t('cadeditor.ui.pages.modifier_found'),
        after: a ? numLabel(a.amount) : I18n.t('cadeditor.ui.cards1.remove'),
        id: key
      });
      return;
    }
    var fields = Object.keys(b).concat(
      Object.keys(a).filter(function (k) {
        return !Object.prototype.hasOwnProperty.call(b, k);
      })
    );
    fields.forEach(function (field) {
      if (deepEq(nbtTake(b, field), nbtTake(a, field))) return;
      var labels = {
        amount: I18n.t('cadeditor.ui.pages.modifier'),
        type: I18n.t('cadeditor.ui.eschema.attributes'),
        id: I18n.t('cadeditor.ui.forms.modifier_id'),
        operation: I18n.t('cadeditor.ui.cards2.operation'),
        slot: I18n.t('cadeditor.ui.cards2.active_slots'),
        display: I18n.t('cadeditor.ui.pages.tooltip_display')
      };
      function fieldValue(o) {
        var v = nbtTake(o, field);
        if (field === 'slot') return SLOT_ZH[v || 'any'] || value(v);
        if (field === 'operation')
          return (
            (
              OPMODES.filter(function (op) {
                return op.v === v;
              })[0] || {}
            ).label || value(v)
          );
        if (field === 'type') return attrName(v);
        return value(v);
      }
      rows.push({
        name: title + ' · ' + (labels[field] || field),
        sub: sub,
        kind: 'ch',
        before: fieldValue(b),
        after: fieldValue(a),
        id: key
      });
    });
  });
  if (!rows.length)
    rows.push({
      name: summary.name,
      kind: summary.kind,
      before:
        x.before.k === 'inherit'
          ? I18n.t('cadeditor.ui.pages.vanilla_default')
          : I18n.t('cadeditor.ui.pages.custom_override'),
      after:
        x.after.k === 'inherit'
          ? I18n.t('cadeditor.ui.pages.restore_vanilla_default')
          : I18n.t('cadeditor.ui.pages.modifier_sequenced_overlayed')
    });
  return rows;
}

/* ---------- 通用分页：任何物品都能打开 ----------
   原版允许给任意物品加上任何组件（不能穿戴的变成可穿戴、不能吃的变成能吃……）。
   这些分页放在「更多 ▾」里；物品本来就带着相关设置、或你改过其中的内容时，会自动出现在标签栏。 */
function A(cid) {
  return ['auto', cid];
}
var UNIVERSAL = [
  {
    id: 'u-ability',
    label: I18n.t('cadeditor.ui.pages.features'),
    alt: I18n.t('cadeditor.ui.pages.more_features'),
    home: ['eat', 'potion', 'fx'],
    icon: 'wand',
    desc: I18n.t('cadeditor.ui.pages.wear_eat_use_mining_glide'),
    cards: [
      I18n.t('cadeditor.ui.pages.wearing_moving'),
      'equip',
      'glider',
      I18n.t('cadeditor.ui.pages.eating_using'),
      'food',
      'consumable',
      'consumeEffects',
      A('use_effects'),
      'remainder',
      A('potion_duration_scale'),
      A('ominous_bottle_amplifier'),
      I18n.t('cadeditor.ui.pages.tools_others'),
      'tool',
      'cooldown',
      'deathProtection',
      A('intangible_projectile')
    ]
  },
  {
    id: 'u-combat',
    label: I18n.t('cadeditor.ui.pages.attack_defense'),
    alt: I18n.t('cadeditor.ui.pages.more_combat'),
    home: ['combat', 'mine', 'def'],
    icon: 'sword',
    desc: I18n.t('cadeditor.ui.pages.attack_force_speed_attack_shield'),
    cards: [
      I18n.t('cadeditor.ui.pages.attack'),
      'attackDamage',
      'attackSpeed',
      'weapon',
      'reach',
      'swing',
      A('minimum_attack_charge'),
      A('damage_type'),
      A('kinetic_weapon'),
      A('piercing_weapon'),
      I18n.t('cadeditor.ui.pages.defense'),
      'armorValue',
      'armorToughness',
      'knockbackResist',
      A('blocks_attacks'),
      'extraAttrs'
    ]
  },
  {
    id: 'u-dura',
    label: I18n.t('cadeditor.ui.pages.durability_enchantments'),
    alt: I18n.t('cadeditor.ui.pages.more_durability'),
    home: ['dura', 'stack'],
    icon: 'shield',
    desc: I18n.t('cadeditor.ui.pages.durability_stack_fix_enchantment'),
    cards: [I18n.t('cadeditor.ui.pages.durability_stack')].concat(DURA, [
      I18n.t('cadeditor.ui.pages.enchantment'),
      'enchantable',
      ['enchants', 'enchantments']
    ])
  },
  {
    id: 'u-look',
    label: I18n.t('cadeditor.ui.pages.appearance_sounds'),
    alt: I18n.t('cadeditor.ui.pages.more_appearance'),
    icon: 'palette',
    desc: I18n.t('cadeditor.ui.pages.name_tooltip_style_model_sound'),
    cards: [I18n.t('cadeditor.ui.pages.name_display')].concat(APPEAR, [
      A('item_name'),
      A('tooltip_style'),
      A('custom_model_data'),
      I18n.t('cadeditor.ui.pages.color_trim'),
      'dye',
      'trim',
      A('provides_trim_material'),
      I18n.t('cadeditor.ui.pages.sound'),
      A('break_sound'),
      A('note_block_sound'),
      A('instrument'),
      A('jukebox_playable')
    ])
  },
  {
    id: 'u-banner',
    label: I18n.t('cadeditor.ui.pages.banner_patterns'),
    alt: I18n.t('cadeditor.ui.pages.banner_patterns'),
    icon: 'banner',
    desc: I18n.t('cadeditor.ui.pages.flag_pattern_background_pattern_material'),
    cards: [
      I18n.t('cadeditor.ui.pages.flag_pattern'),
      A('banner_patterns'),
      A('base_color'),
      I18n.t('cadeditor.ui.pages.material'),
      A('provides_banner_patterns')
    ]
  },
  {
    id: 'u-world',
    label: I18n.t('cadeditor.ui.pages.placement_data'),
    icon: 'cube',
    desc: I18n.t('cadeditor.ui.pages.place_destroy_rules_block_entity'),
    cards: [
      I18n.t('cadeditor.ui.pages.place_destroy'),
      A('can_place_on'),
      A('can_break'),
      A('block_state'),
      I18n.t('cadeditor.ui.pages.block_entity_data'),
      A('block_entity_data'),
      A('entity_data'),
      A('bucket_entity_data'),
      A('custom_data'),
      I18n.t('cadeditor.ui.pages.container_2'),
      A('lock'),
      A('container_loot'),
      A('bees'),
      A('pot_decorations'),
      I18n.t('cadeditor.ui.pages.player_item'),
      A('profile'),
      A('charged_projectiles'),
      A('recipes'),
      I18n.t('cadeditor.ui.pages.maps_tracking'),
      A('map_id'),
      A('map_color'),
      A('map_decorations'),
      A('lodestone_tracker'),
      I18n.t('cadeditor.ui.pages.debug'),
      A('debug_stick_state')
    ]
  }
];
function ownKeys(kind) {
  var m = {};
  (PAGES[kind] || PAGES.generic).forEach(function (t) {
    t.cards.forEach(function (c) {
      m[cardKey(c)] = 1;
    });
  });
  return m;
}
/* 这类物品能打开的通用分页（去掉本类已有的卡片） */
function uniTabsFor(kind) {
  var own = ownKeys(kind),
    out = [];
  var haveTab = {};
  (PAGES[kind] || PAGES.generic).forEach(function (t) {
    haveTab[t.id] = 1;
  });
  UNIVERSAL.forEach(function (u) {
    var cards = u.cards.filter(function (c) {
      return (typeof c === 'string' && c.charAt(0) === '#') || !own[cardKey(c)];
    });
    cards = cards.filter(function (c, i) {
      if (!(typeof c === 'string' && c.charAt(0) === '#')) return true;
      var n = cards[i + 1];
      return n !== undefined && !(typeof n === 'string' && n.charAt(0) === '#');
    });
    if (
      !cards.some(function (c) {
        return !(typeof c === 'string' && c.charAt(0) === '#');
      })
    )
      cards = [];
    var more =
      (u.home || []).some(function (x) {
        return haveTab[x];
      }) || u.id === 'u-look';
    if (cards.length)
      out.push({
        id: u.id,
        label: more ? u.alt : u.label,
        icon: u.icon,
        desc: u.desc,
        cards: cards,
        force: true,
        uni: true
      });
  });
  return out;
}
/* 通用分页里：物品本来就带着、或用户改过的组件 → 自动显示在标签栏 */
function uniRelevant(t, d) {
  var p = protoOf(d.id);
  return t.cards.some(function (c) {
    return cardComps(c).some(function (cid) {
      return intentOf(d, cid) !== 'inherit';
    });
  });
}

/* 这类物品的页面已经覆盖的组件；其余被改动过的组件归入「附加设置」 */
function coveredComps(kind) {
  var m = {};
  (PAGES[kind] || PAGES.generic).concat(uniTabsFor(kind)).forEach(function (t) {
    t.cards.forEach(function (c) {
      cardComps(c).forEach(function (x) {
        m[x] = 1;
      });
    });
  });
  return m;
}
function extraCompIds(d, kind) {
  var cov = coveredComps(kind),
    seen = {},
    out = [];
  Object.keys(d.comps)
    .concat(Object.keys(d.removed))
    .forEach(function (c) {
      if (!cov[c] && !seen[c] && CIDX[c]) {
        seen[c] = 1;
        out.push(c);
      }
    });
  return out;
}
var CAT_ICON = {
  look: 'palette',
  dura: 'shield',
  combat: 'sword',
  ench: 'enchant',
  use: 'apple',
  equip: 'helmet',
  cont: 'chest',
  book: 'book',
  fx: 'potion_round',
  variant: 'paw'
};
/* 变种类组件（cat/variant、wolf/collar、sheep/color ……）的卡片图标：用当前值渲染一个小的 <entity> 预览。
   组件 id 形如 「生物/字段」，实体组件照 elements.md 的 components 属性传（和 esPreviewAttrs 同一种写法）。
   没有可见外观的（声音变种）、不是生物的（画）、值不是字符串的返回 null，继续用原来的图标。 */
var VAR_NO_PREVIEW = { 'painting/variant': 1 };
function varEntityIcon(cid, v) {
  var m = /^([a-z0-9_]+)\/([a-z0-9_]+)$/.exec(String(cid));
  if (!m || VAR_NO_PREVIEW[cid] || /sound_variant$/.test(cid) || typeof v !== 'string' || !v) return null;
  var comps =
    '{' +
    snbtStr('minecraft:' + cid) +
    ':' +
    snbtStr(v.indexOf(':') < 0 && m[2] === 'variant' ? 'minecraft:' + v : v) +
    '}';
  var el = h('entity', { type: 'minecraft:' + m[1], components: comps, class: 'k-vent' });
  el.setAttribute('style', 'width:24px;height:24px');
  return el;
}
/* 通用卡片：按组件的数据结构自动生成表单。一行 = 标题 + 右侧开关；打开开关才展开设置 */
CARDS.auto = function (cid) {
  if (cid === 'use_effects') return CARDS.useEffects();
  var c = CIDX[cid];
  if (!c) return null;
  var unit = c.schema && c.schema.t === 'unit';
  var headK = HEAD_AUTO[cid] ? 'body' : scalarHead(c.schema);
  var vIcon = null;
  if (c.cat === 'variant') {
    var vd = Store.doc(),
      vv = vd.comps[cid] !== undefined ? vd.comps[cid] : Ctx.proto(cid);
    vIcon = varEntityIcon(cid, vv);
  }
  var card = kCard(
    {
      id: 'auto-' + cid,
      icon: vIcon || CAT_ICON[c.cat] || 'tag',
      title: c.name,
      desc: shortDesc(c.desc),
      comps: [cid],
      toggle: true,
      bare: unit,
      eager: !!headK
    },
    Ctx
  );
  if (cid === 'can_place_on' || cid === 'can_break')
    card.make = function () {
      worldBlockPicker(
        null,
        function (blocks) {
          Ctx.enable(cid, { blocks: blocks }, I18n.t('cadeditor.ui.kit.enable', c.name));
          openDetail({ cid: cid });
        },
        I18n.t('cadeditor.ui.pages.select_target_block', c.name)
      );
    };
  var it = Ctx.modified(cid) ? intentOf(Store.doc(), cid) : 'inherit';
  if (it === 'remove') {
    card.el.classList.add('off');
    return card;
  }
  if (!Ctx.has(cid)) {
    card.el.classList.add('off');
    return card;
  }
  if (unit) return card;
  var d = Store.doc();
  if (headK && !DETAIL_IN) {
    headAuto(card, cid, c, headK, d.comps[cid] !== undefined ? d.comps[cid] : clone(Ctx.proto(cid)));
    return card;
  }
  if (DETAIL_AUTO[cid] && !DETAIL_IN) {
    detailize(card, { cid: cid, title: CIDX[cid].name });
    return card;
  }
  if (AUTO_BODY[cid]) {
    AUTO_BODY[cid](card, cid, d.comps[cid] !== undefined ? d.comps[cid] : clone(Ctx.proto(cid)));
    return card;
  }
  card.body.appendChild(
    renderComponentForm(
      cid,
      d.comps[cid] !== undefined ? d.comps[cid] : clone(Ctx.proto(cid)),
      function (v, o) {
        Store.set(cid, v, { key: 'f-' + cid + (o && o.key ? o.key : ''), structural: false });
      },
      d
    )
  );
  return card;
};
CARDS.raw = CARDS.auto;

/* 懒加载：折叠的卡片先只有卡片头；点开（或“展开全部”）时才真正构建内容并替换进页面 */
function lazyHook(stub) {
  function expand() {
    if (!stub.lazy) return;
    var lz = stub.lazy;
    stub.lazy = null;
    UIOpen['card:' + (stub.spec.id || stub.spec.title)] = false;
    KLAZY = 0;
    var previousReads = ComponentReads,
      reads = {};
    ComponentReads = reads;
    var real;
    try {
      real = lz.f.apply(null, lz.args);
    } finally {
      ComponentReads = previousReads;
    }
    if (!real) return;
    real.depends = real.depends || {};
    Object.keys(reads).forEach(function (cid) {
      real.depends[cid] = true;
    });
    if (stub.el.parentNode) stub.el.parentNode.replaceChild(real.el, stub.el);
    if (UI.page) for (var i = 0; i < UI.page.cards.length; i++) if (UI.page.cards[i] === stub) UI.page.cards[i] = real;
    try {
      real.update();
    } catch (e) {}
    decorate();
    if (typeof paintProblems === 'function') paintProblems();
    /* 第一次展开：真正的卡片是现建的，直接是展开状态，所以要补上和以后展开时同一个滑入动画（uiSlide） */
    if (real.body) uiSlide(real.body, true);
  }
  stub.onHead = function () {
    if (!stub.lazy) return false;
    expand();
    return true;
  };
  var oc = stub.setCollapsed;
  stub.setCollapsed = function (v) {
    if (stub.lazy) {
      if (!v) expand();
    } else oc(v);
  };
}
