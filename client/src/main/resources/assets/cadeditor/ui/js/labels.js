/* 中文标签字典：槽位、稀有度、属性操作、游戏模式、维度、生物变种与开关、方块状态……全部放在这一个文件里。
   只放「界面文字」；游戏里有的名字（物品、方块、实体、附魔……）仍然来自实时注册表，不在这里手写。
   各页面里保留原来的全局名（SLOT_ZH、OPS 等）作别名，指向这里的同一个对象。
   同一概念有两种措辞的（如槽位的「头部 / 头盔」、属性操作的「加值 / 加固定值」）是界面里不同位置用的，分开存放，不要合并措辞。 */
var Labels = {};
/* 关于：名称、作者、简介和链接（设置弹窗的「关于」区读这里；版本号由宿主在页面数据的 about.version 里带来） */
Labels.about = {
  name: 'CAD Editor',
  tagline: I18n.t('cadeditor.ui.labels.visually_edit_minecraft_items_blocks'),
  author: I18n.t('cadeditor.ui.labels.rinorsi'),
  authorRole: I18n.t('cadeditor.ui.labels.creator_cad_editor_oriel_ui'),
  feedbackGroup: '305562948',
  links: [
    {
      icon: 'code',
      title: 'GitHub',
      show: 'Rinorsi/CAD-Editor-Recast',
      url: 'https://github.com/Rinorsi/CAD-Editor-Recast'
    },
    {
      icon: 'play',
      title: I18n.t('cadeditor.ui.labels.bilibili'),
      show: 'b23.tv/hjUvs0c',
      url: 'https://b23.tv/hjUvs0c'
    },
    {
      icon: 'heart',
      title: I18n.t('cadeditor.ui.labels.afdian'),
      show: 'afdian.com/a/Rinorsi',
      url: 'https://afdian.com/a/Rinorsi'
    }
  ]
};
/* SLOT_ZH */
Labels.slot = {
  any: I18n.t('cadeditor.ui.labels.any'),
  mainhand: I18n.t('cadeditor.ui.labels.main_hand'),
  offhand: I18n.t('cadeditor.ui.labels.off_hand'),
  hand: I18n.t('cadeditor.ui.labels.both_hands'),
  head: I18n.t('cadeditor.ui.labels.head'),
  chest: I18n.t('cadeditor.ui.labels.chest'),
  legs: I18n.t('cadeditor.ui.labels.legs'),
  feet: I18n.t('cadeditor.ui.labels.feet'),
  armor: I18n.t('cadeditor.ui.labels.all_armor'),
  body: I18n.t('cadeditor.ui.labels.body'),
  saddle: I18n.t('cadeditor.ui.labels.saddle')
};
/* SLOT_HEAD */
Labels.slotHead = {
  mainhand: I18n.t('cadeditor.ui.labels.main_hand_2'),
  offhand: I18n.t('cadeditor.ui.labels.off_hand_2'),
  hand: I18n.t('cadeditor.ui.labels.either_hand'),
  head: I18n.t('cadeditor.ui.labels.head_2'),
  chest: I18n.t('cadeditor.ui.labels.body_2'),
  legs: I18n.t('cadeditor.ui.labels.legs_2'),
  feet: I18n.t('cadeditor.ui.labels.feet_2'),
  armor: I18n.t('cadeditor.ui.labels.worn'),
  body: I18n.t('cadeditor.ui.labels.body_3'),
  saddle: I18n.t('cadeditor.ui.labels.equipped_saddle'),
  any: I18n.t('cadeditor.ui.labels.active')
};
/* WP_EQ */
Labels.slotEquip = {
  head: I18n.t('cadeditor.ui.labels.helmet'),
  chest: I18n.t('cadeditor.ui.labels.chestplate'),
  legs: I18n.t('cadeditor.ui.labels.leggings'),
  feet: I18n.t('cadeditor.ui.labels.boots'),
  offhand: I18n.t('cadeditor.ui.labels.off_hand'),
  body: I18n.t('cadeditor.ui.labels.body'),
  saddle: I18n.t('cadeditor.ui.labels.saddle'),
  mainhand: I18n.t('cadeditor.ui.labels.main_hand')
};
/* ES_SLOT */
Labels.slotGear = {
  mainhand: [I18n.t('cadeditor.ui.labels.main_hand'), 'sword'],
  offhand: [I18n.t('cadeditor.ui.labels.off_hand'), 'shield'],
  head: [I18n.t('cadeditor.ui.labels.head'), 'helmet'],
  chest: [I18n.t('cadeditor.ui.labels.chest'), 'chestplate'],
  legs: [I18n.t('cadeditor.ui.labels.legs'), 'leggings'],
  feet: [I18n.t('cadeditor.ui.labels.feet'), 'boots'],
  body: [I18n.t('cadeditor.ui.labels.body'), 'shield'],
  saddle: [I18n.t('cadeditor.ui.labels.saddle'), 'cart']
};
/* EQ_SLOTS */
Labels.slotChoices = [
  {
    v: 'head',
    label: I18n.t('cadeditor.ui.labels.head'),
    sub: I18n.t('cadeditor.ui.labels.helmet'),
    icon: function () {
      return uiIcon('helmet', 20);
    }
  },
  {
    v: 'chest',
    label: I18n.t('cadeditor.ui.labels.chest'),
    sub: I18n.t('cadeditor.ui.labels.chestplate'),
    icon: function () {
      return uiIcon('chestplate', 20);
    }
  },
  {
    v: 'legs',
    label: I18n.t('cadeditor.ui.labels.legs'),
    sub: I18n.t('cadeditor.ui.labels.leggings'),
    icon: function () {
      return uiIcon('leggings', 20);
    }
  },
  {
    v: 'feet',
    label: I18n.t('cadeditor.ui.labels.feet'),
    sub: I18n.t('cadeditor.ui.labels.boots'),
    icon: function () {
      return uiIcon('boots', 20);
    }
  },
  {
    v: 'offhand',
    label: I18n.t('cadeditor.ui.labels.off_hand'),
    sub: '',
    icon: function () {
      return uiIcon('shield', 20);
    }
  },
  {
    v: 'body',
    label: I18n.t('cadeditor.ui.labels.body'),
    sub: I18n.t('cadeditor.ui.labels.horse_armor_etc'),
    icon: function () {
      return uiIcon('paw', 20);
    }
  },
  {
    v: 'saddle',
    label: I18n.t('cadeditor.ui.labels.saddle'),
    sub: '',
    icon: function () {
      return uiIcon('cart', 20);
    }
  },
  {
    v: 'mainhand',
    label: I18n.t('cadeditor.ui.labels.main_hand'),
    sub: '',
    icon: function () {
      return uiIcon('sword', 20);
    }
  }
];
/* ATTR_SLOT_ICON */
Labels.slotIcon = {
  mainhand: 'sword',
  offhand: 'shield',
  hand: 'sword',
  head: 'helmet',
  chest: 'chestplate',
  legs: 'leggings',
  feet: 'boots',
  armor: 'chestplate',
  body: 'paw',
  saddle: 'cart',
  any: 'grid'
};
/* PIECE_ID */
Labels.armorPiece = { head: 'helmet', chest: 'chestplate', legs: 'leggings', feet: 'boots' };
/* RARITY */
/* Vanilla 26.1–26.3 has no rarity.* language keys. Use Wiki terminology as
   the explicit fallback, while allowing real runtime/resource-pack translations. */
Labels.rarity = [
  { v: 'common', label: I18n.t('cadeditor.ui.labels.common'), title: I18n.t('cadeditor.ui.labels.white_name') },
  { v: 'uncommon', label: I18n.t('cadeditor.ui.labels.uncommon'), title: I18n.t('cadeditor.ui.labels.yellow_name') },
  { v: 'rare', label: I18n.t('cadeditor.ui.labels.rare'), title: I18n.t('cadeditor.ui.labels.aqua_name') },
  { v: 'epic', label: I18n.t('cadeditor.ui.labels.epic'), title: I18n.t('cadeditor.ui.labels.light_purple_name') }
];
/* OPS */
Labels.opShort = [
  {
    v: 'add_value',
    label: I18n.t('cadeditor.ui.labels.add_value'),
    title: I18n.t('cadeditor.ui.labels.add_value_add_fixed_value')
  },
  {
    v: 'add_multiplied_base',
    label: I18n.t('cadeditor.ui.labels.multiply_base'),
    title: I18n.t('cadeditor.ui.labels.add_multiplied_base_add_fraction')
  },
  {
    v: 'add_multiplied_total',
    label: I18n.t('cadeditor.ui.labels.multiply_total'),
    title: I18n.t('cadeditor.ui.labels.add_multiplied_total_multiply_final')
  }
];
/* OPMODES */
Labels.opLong = [
  {
    v: 'add_value',
    label: I18n.t('cadeditor.ui.labels.add_value_2'),
    title: I18n.t('cadeditor.ui.labels.add_value_directly')
  },
  {
    v: 'add_multiplied_base',
    label: I18n.t('cadeditor.ui.labels.add_base_multiplier'),
    title: I18n.t('cadeditor.ui.labels.increase_fraction_base_value_e')
  },
  {
    v: 'add_multiplied_total',
    label: I18n.t('cadeditor.ui.labels.multiply_total_2'),
    title: I18n.t('cadeditor.ui.labels.multiply_total_1_multiplier')
  }
];
/* WP_MODE */
Labels.mode = {
  survival: I18n.t('cadeditor.ui.labels.survival'),
  creative: I18n.t('cadeditor.ui.labels.creative'),
  adventure: I18n.t('cadeditor.ui.labels.adventure'),
  spectator: I18n.t('cadeditor.ui.labels.spectator')
};
/* WE_DIM */
Labels.dim = {
  'minecraft:overworld': I18n.t('cadeditor.ui.labels.overworld'),
  'minecraft:the_nether': I18n.t('cadeditor.ui.labels.nether'),
  'minecraft:the_end': I18n.t('cadeditor.ui.labels.end')
};
/* ES_VARIANT */
Labels.entVariant = {
  variant: I18n.t('cadeditor.ui.labels.variant'),
  sound_variant: I18n.t('cadeditor.ui.labels.sound_variant'),
  collar: I18n.t('cadeditor.ui.labels.collar_color'),
  color: I18n.t('cadeditor.ui.labels.wool_color'),
  markings: I18n.t('cadeditor.ui.labels.markings'),
  strength: I18n.t('cadeditor.ui.labels.strength'),
  size: I18n.t('cadeditor.ui.labels.size'),
  profession: I18n.t('cadeditor.ui.labels.profession'),
  level: I18n.t('cadeditor.ui.labels.level'),
  pattern: I18n.t('cadeditor.ui.cards2.pattern'),
  base_color: I18n.t('cadeditor.ui.labels.base_color'),
  pattern_color: I18n.t('cadeditor.ui.labels.pattern_color')
};
/* ES_FLAG */
Labels.entFlag = {
  CustomName: [I18n.t('cadeditor.ui.labels.name'), I18n.t('cadeditor.ui.labels.name_displayed_above_entity')],
  CustomNameVisible: [
    I18n.t('cadeditor.ui.labels.always_show_name'),
    I18n.t('cadeditor.ui.labels.show_name_without_aiming_entity')
  ],
  Health: [I18n.t('cadeditor.ui.labels.health'), ''],
  Age: [I18n.t('cadeditor.ui.labels.baby'), I18n.t('cadeditor.ui.labels.spawn_baby')],
  IsBaby: [I18n.t('cadeditor.ui.labels.baby'), I18n.t('cadeditor.ui.labels.spawn_baby')],
  NoAI: [I18n.t('cadeditor.ui.labels.ai'), I18n.t('cadeditor.ui.labels.move_attack_own')],
  Silent: [I18n.t('cadeditor.ui.labels.silent'), I18n.t('cadeditor.ui.labels.makes_sounds')],
  Invulnerable: [
    I18n.t('cadeditor.ui.labels.invulnerable'),
    I18n.t('cadeditor.ui.labels.immune_damage_except_creative_players')
  ],
  NoGravity: [I18n.t('cadeditor.ui.labels.gravity'), I18n.t('cadeditor.ui.labels.fall')],
  Glowing: [I18n.t('cadeditor.ui.labels.glowing_outline'), I18n.t('cadeditor.ui.labels.visible_through_blocks')],
  PersistenceRequired: [
    I18n.t('cadeditor.ui.labels.persistent'),
    I18n.t('cadeditor.ui.labels.despawn_players_move_away')
  ],
  ShowArms: [I18n.t('cadeditor.ui.labels.show_arms'), I18n.t('cadeditor.ui.labels.arms_hold_items')],
  LeftHanded: [I18n.t('cadeditor.ui.labels.left_handed'), I18n.t('cadeditor.ui.labels.swap_main_hand_off_hand')],
  CanPickUpLoot: [
    I18n.t('cadeditor.ui.labels.pick_up_loot'),
    I18n.t('cadeditor.ui.labels.picks_up_dropped_items_equipment')
  ]
};
/* WE_PROP */
Labels.blockProp = {
  facing: I18n.t('cadeditor.ui.labels.facing'),
  half: I18n.t('cadeditor.ui.labels.half'),
  type: I18n.t('cadeditor.ui.labels.type'),
  waterlogged: I18n.t('cadeditor.ui.labels.waterlogged'),
  open: I18n.t('cadeditor.ui.core.open'),
  powered: I18n.t('cadeditor.ui.labels.powered'),
  lit: I18n.t('cadeditor.ui.labels.lit'),
  rotation: I18n.t('cadeditor.ui.labels.rotation'),
  shape: I18n.t('cadeditor.ui.cards3.shape'),
  axis: I18n.t('cadeditor.ui.labels.axis'),
  hinge: I18n.t('cadeditor.ui.labels.hinge'),
  face: I18n.t('cadeditor.ui.labels.attachment_face'),
  age: I18n.t('cadeditor.ui.labels.growth_stage'),
  level: I18n.t('cadeditor.ui.labels.level'),
  persistent: I18n.t('cadeditor.ui.labels.persistent'),
  distance: I18n.t('cadeditor.ui.labels.distance'),
  bites: I18n.t('cadeditor.ui.labels.bites_taken'),
  delay: I18n.t('cadeditor.ui.labels.delay'),
  locked: I18n.t('cadeditor.ui.labels.locked'),
  mode: I18n.t('cadeditor.ui.labels.mode'),
  power: I18n.t('cadeditor.ui.labels.redstone_power'),
  snowy: I18n.t('cadeditor.ui.labels.snowy'),
  hanging: I18n.t('cadeditor.ui.labels.hanging'),
  honey_level: I18n.t('cadeditor.ui.labels.honey_level'),
  conditional: I18n.t('cadeditor.ui.labels.conditional'),
  attached: I18n.t('cadeditor.ui.labels.attached'),
  berries: I18n.t('cadeditor.ui.labels.berries'),
  bottom: I18n.t('cadeditor.ui.labels.bottom'),
  candles: I18n.t('cadeditor.ui.labels.candle_count'),
  charges: I18n.t('cadeditor.ui.labels.charges'),
  disarmed: I18n.t('cadeditor.ui.labels.disarmed'),
  east: I18n.t('cadeditor.ui.labels.east'),
  west: I18n.t('cadeditor.ui.labels.west'),
  north: I18n.t('cadeditor.ui.labels.north'),
  south: I18n.t('cadeditor.ui.labels.south'),
  up: I18n.t('cadeditor.ui.labels.up'),
  down: I18n.t('cadeditor.ui.labels.down'),
  drag: I18n.t('cadeditor.ui.labels.drag'),
  eye: I18n.t('cadeditor.ui.labels.eye_ender'),
  enabled: I18n.t('cadeditor.ui.common.enabled'),
  extended: I18n.t('cadeditor.ui.labels.extended'),
  falling: I18n.t('cadeditor.ui.labels.falling'),
  has_book: I18n.t('cadeditor.ui.labels.book'),
  has_record: I18n.t('cadeditor.ui.labels.record'),
  inverted: I18n.t('cadeditor.ui.labels.inverted'),
  instrument: I18n.t('cadeditor.ui.labels.instrument'),
  note: I18n.t('cadeditor.ui.labels.note'),
  occupied: I18n.t('cadeditor.ui.labels.occupied'),
  orientation: I18n.t('cadeditor.ui.labels.facing'),
  signal_fire: I18n.t('cadeditor.ui.labels.signal_fire'),
  stage: I18n.t('cadeditor.ui.labels.stage'),
  tilt: I18n.t('cadeditor.ui.labels.tilt'),
  triggered: I18n.t('cadeditor.ui.labels.triggered'),
  unstable: I18n.t('cadeditor.ui.labels.unstable'),
  vertical_direction: I18n.t('cadeditor.ui.labels.vertical_direction'),
  wet: I18n.t('cadeditor.ui.labels.wet'),
  layers: I18n.t('cadeditor.ui.labels.layers'),
  moisture: I18n.t('cadeditor.ui.labels.moisture'),
  slot_0_occupied: I18n.t('cadeditor.ui.labels.slot_1_book'),
  slot_1_occupied: I18n.t('cadeditor.ui.labels.slot_2_book'),
  slot_2_occupied: I18n.t('cadeditor.ui.labels.slot_3_book'),
  slot_3_occupied: I18n.t('cadeditor.ui.labels.slot_4_book'),
  slot_4_occupied: I18n.t('cadeditor.ui.labels.slot_5_book'),
  slot_5_occupied: I18n.t('cadeditor.ui.labels.slot_6_book'),
  flower_amount: I18n.t('cadeditor.ui.labels.petal_count'),
  segment_amount: I18n.t('cadeditor.ui.labels.flower_count'),
  cracked: I18n.t('cadeditor.ui.labels.cracked'),
  crafting: I18n.t('cadeditor.ui.labels.crafting'),
  ominous: I18n.t('cadeditor.ui.labels.ominous'),
  trial_spawner_state: I18n.t('cadeditor.ui.labels.trial_state'),
  sculk_sensor_phase: I18n.t('cadeditor.ui.labels.sensor_phase'),
  tip: I18n.t('cadeditor.ui.labels.tip'),
  thickness: I18n.t('cadeditor.ui.labels.thickness'),
  has_bottle_0: I18n.t('cadeditor.ui.labels.bottle_slot_1'),
  has_bottle_1: I18n.t('cadeditor.ui.labels.bottle_slot_2'),
  has_bottle_2: I18n.t('cadeditor.ui.labels.bottle_slot_3'),
  in_wall: I18n.t('cadeditor.ui.labels.wall'),
  short: I18n.t('cadeditor.ui.labels.short'),
  natural: I18n.t('cadeditor.ui.labels.naturally_generated'),
  pickles: I18n.t('cadeditor.ui.labels.sea_pickle_count'),
  eggs: I18n.t('cadeditor.ui.labels.egg_count'),
  hatch: I18n.t('cadeditor.ui.labels.hatch_stage'),
  dusted: I18n.t('cadeditor.ui.labels.brushing_progress'),
  respawn_anchor_charges: I18n.t('cadeditor.ui.labels.respawn_anchor_charges'),
  bloom: I18n.t('cadeditor.ui.labels.blooming'),
  can_summon: I18n.t('cadeditor.ui.labels.summon'),
  shrieking: I18n.t('cadeditor.ui.labels.shrieking'),
  lit_candle: I18n.t('cadeditor.ui.labels.lit_2'),
  cauldron_level: I18n.t('cadeditor.ui.labels.water_level')
};
/* WE_VAL */
Labels.blockVal = {
  true: I18n.t('cadeditor.ui.labels.yes'),
  false: I18n.t('cadeditor.ui.labels.no'),
  north: I18n.t('cadeditor.ui.labels.north_2'),
  south: I18n.t('cadeditor.ui.labels.south_2'),
  east: I18n.t('cadeditor.ui.labels.east_2'),
  west: I18n.t('cadeditor.ui.labels.west_2'),
  up: I18n.t('cadeditor.ui.labels.up_2'),
  down: I18n.t('cadeditor.ui.labels.down_2'),
  left: I18n.t('cadeditor.ui.labels.left'),
  right: I18n.t('cadeditor.ui.labels.right'),
  top: I18n.t('cadeditor.ui.labels.up_2'),
  bottom: I18n.t('cadeditor.ui.labels.down_2'),
  single: I18n.t('cadeditor.ui.labels.single'),
  double: I18n.t('cadeditor.ui.labels.double'),
  lower: I18n.t('cadeditor.ui.labels.lower_half'),
  upper: I18n.t('cadeditor.ui.labels.upper_half'),
  floor: I18n.t('cadeditor.ui.labels.floor'),
  wall: I18n.t('cadeditor.ui.labels.wall_2'),
  ceiling: I18n.t('cadeditor.ui.labels.ceiling'),
  x: I18n.t('cadeditor.ui.labels.x_axis'),
  y: I18n.t('cadeditor.ui.labels.y_axis'),
  z: I18n.t('cadeditor.ui.labels.z_axis'),
  none: I18n.t('cadeditor.ui.common.none'),
  low: I18n.t('cadeditor.ui.labels.low'),
  tall: I18n.t('cadeditor.ui.labels.high'),
  straight: I18n.t('cadeditor.ui.labels.straight'),
  inner_left: I18n.t('cadeditor.ui.labels.inner_left'),
  inner_right: I18n.t('cadeditor.ui.labels.inner_right'),
  outer_left: I18n.t('cadeditor.ui.labels.outer_left'),
  outer_right: I18n.t('cadeditor.ui.labels.outer_right'),
  north_south: I18n.t('cadeditor.ui.labels.north_south'),
  east_west: I18n.t('cadeditor.ui.labels.east_west'),
  ascending_east: I18n.t('cadeditor.ui.labels.ascending_east'),
  ascending_west: I18n.t('cadeditor.ui.labels.ascending_west'),
  ascending_north: I18n.t('cadeditor.ui.labels.ascending_north'),
  ascending_south: I18n.t('cadeditor.ui.labels.ascending_south'),
  side: I18n.t('cadeditor.ui.labels.side'),
  save: I18n.t('cadeditor.ui.common.save'),
  load: I18n.t('cadeditor.ui.labels.load'),
  corner: I18n.t('cadeditor.ui.labels.corner'),
  data: I18n.t('cadeditor.ui.labels.data'),
  compare: I18n.t('cadeditor.ui.labels.compare'),
  subtract: I18n.t('cadeditor.ui.labels.subtract'),
  inactive: I18n.t('cadeditor.ui.labels.inactive'),
  active: I18n.t('cadeditor.ui.labels.powered'),
  cooldown: I18n.t('cadeditor.ui.labels.cooldown'),
  head: I18n.t('cadeditor.ui.labels.head_3'),
  foot: I18n.t('cadeditor.ui.labels.foot'),
  normal: I18n.t('cadeditor.ui.labels.normal'),
  sticky: I18n.t('cadeditor.ui.labels.sticky'),
  wall_hanging: I18n.t('cadeditor.ui.labels.wall_hanging')
};
/* ENCH_TAG_ZH */
Labels.enchTag = {
  curse: I18n.t('cadeditor.ui.labels.curse'),
  treasure: I18n.t('cadeditor.ui.labels.treasure'),
  tradeable: I18n.t('cadeditor.ui.labels.villager_trades'),
  non_treasure: I18n.t('cadeditor.ui.labels.non_treasure'),
  in_enchanting_table: I18n.t('cadeditor.ui.labels.enchanting_table'),
  on_random_loot: I18n.t('cadeditor.ui.labels.random_loot'),
  on_traded_equipment: I18n.t('cadeditor.ui.labels.traded_equipment'),
  on_mob_spawn_equipment: I18n.t('cadeditor.ui.labels.mob_equipment'),
  double_trade_price: I18n.t('cadeditor.ui.labels.double_trade_price'),
  smelts_loot: I18n.t('cadeditor.ui.labels.smelts_loot')
};
/* 稀有度的短名：由 Labels.rarity 派生，不再单独手写一份（原 pages.js 的 RARITY_ZH） */
Labels.rarityZh = {};
(function () {
  for (var i = 0; i < Labels.rarity.length; i++) Labels.rarityZh[Labels.rarity[i].v] = Labels.rarity[i].label;
})();

/* 保险库里「玩家预设」的分区名（和后端 sections 的取值一一对应） */
Labels.vaultSection = {
  inventory: I18n.t('cadeditor.ui.labels.inventory'),
  equipment: I18n.t('cadeditor.ui.eschema.equipment'),
  ender: I18n.t('cadeditor.ui.labels.ender_chest'),
  attributes: I18n.t('cadeditor.ui.eschema.attributes'),
  effects: I18n.t('cadeditor.ui.eschema.status_effects'),
  game_mode: I18n.t('cadeditor.ui.labels.game_mode'),
  block: I18n.t('cadeditor.ui.labels.block_state_data')
};
