/* 卡片库 · 第二部分：属性、近战 / 工具、盔甲 */

/* 下拉选择按钮：entries=[{v,label,sub,icon()}]；可手输 ID（o.custom=true 时目录里多一行"使用自定义 ID"） */
function kSelect(entries, value, onPick, o) {
  o = o || {};
  var btn = h('div', { class: 'k-btn k-sel' }),
    cur = value;
  function paint() {
    clear(btn);
    var e = null;
    entries.forEach(function (x) {
      if (x.v === cur) e = x;
    });
    if (e && e.icon) btn.appendChild(e.icon());
    btn.appendChild(h('span', { text: e ? e.label : o.empty || cur || I18n.t('cadeditor.ui.cards2.select') }));
    btn.appendChild(uiIcon('down', 10));
  }
  activate(btn, function () {
    pickFrom(
      btn,
      entries,
      function (x) {
        cur = x.v;
        paint();
        onPick(x.v, x);
      },
      { width: o.width || 250, placeholder: o.placeholder }
    );
  });
  paint();
  return {
    el: btn,
    set: function (v) {
      cur = v;
      paint();
    }
  };
}

/* ==================== 属性 ==================== */
/* 属性图标：优先用原版的精灵（心、护甲）、状态效果图和物品图，没有对应的才退回通用图标 */
var ATTR_VIS = {
  armor: ['spr', 'hud/armor_full'],
  max_health: ['spr', 'hud/heart/full'],
  max_absorption: ['spr', 'hud/heart/absorbing_full'],
  attack_damage: ['eff', 'strength'],
  attack_speed: ['eff', 'haste'],
  movement_speed: ['eff', 'speed'],
  luck: ['eff', 'luck'],
  armor_toughness: ['eff', 'resistance'],
  jump_strength: ['eff', 'jump_boost'],
  safe_fall_distance: ['eff', 'slow_falling'],
  burning_time: ['eff', 'fire_resistance'],
  oxygen_bonus: ['eff', 'water_breathing'],
  water_movement_efficiency: ['eff', 'dolphins_grace'],
  mining_efficiency: ['eff', 'haste'],
  block_break_speed: ['eff', 'haste'],
  submerged_mining_speed: ['eff', 'conduit_power'],
  knockback_resistance: ['item', 'netherite_chestplate'],
  attack_knockback: ['item', 'mace'],
  block_interaction_range: ['item', 'iron_pickaxe'],
  entity_interaction_range: ['item', 'spyglass'],
  fall_damage_multiplier: ['item', 'feather'],
  scale: ['item', 'brewing_stand'],
  step_height: ['item', 'oak_stairs'],
  gravity: ['item', 'anvil'],
  sneaking_speed: ['item', 'leather_boots'],
  sweeping_damage_ratio: ['item', 'iron_sword']
};
function attrIconEl(t) {
  var v = ATTR_VIS[shortId(t)];
  if (!v) return uiIcon('sliders', 16);
  if (v[0] === 'spr') {
    var sp = h('sprite', { src: 'minecraft:' + v[1] });
    sp.setAttribute('style', 'width:18px;height:18px');
    return sp;
  }
  return v[0] === 'eff' ? effectIcon(v[1], 16) : itemIcon(v[1], 16);
}
var ATTR_SLOT_ICON = Labels.slotIcon;
function attrName(t) {
  var a = ATIDX[shortId(t)];
  return a ? a.name : shortId(t);
}
function attrFull(t) {
  return fullId(String(t));
}
var AMT_LIMIT = 2048;

function modsList() {
  return Ctx.get('attribute_modifiers') || [];
}
function saveMods(list) {
  Ctx.setSmart('attribute_modifiers', list, { label: I18n.t('cadeditor.ui.cards2.edit_attribute') });
}
/* 新修饰器的 ID：cadeditor:<属性>_<序号>，跳过已经占用的序号（同一种属性可以有多条） */
function nextModId(type, list) {
  var base = 'cadeditor:' + shortId(type).replace(/[^a-z0-9_./-]/g, '_') + '_',
    n = list.length + 1;
  while (
    list.some(function (m) {
      return m.id === base + n;
    })
  )
    n++;
  return base + n;
}
function slotHit(m, slots) {
  var s = m.slot || 'any';
  return s === 'any' || slots.indexOf(s) >= 0;
}
function attrSum(type, slots) {
  var s = 0;
  modsList().forEach(function (m) {
    if (shortId(m.type) === type && m.operation === 'add_value' && slotHit(m, slots)) s += nbtNumberValue(m.amount);
  });
  return s;
}
function attrAmountSchema() {
  if (typeof Reg !== 'undefined' && !Reg.preview()) Reg.askSchema();
  var c = CIDX.attribute_modifiers,
    nodes = [];
  if (c && c.schema) liveRangeNodes(c.schema, ['[]', 'amount'], 0, nodes);
  return (
    nodes.filter(function (n) {
      return n.live && n.t === 'num';
    })[0] || null
  );
}
/* 把某属性在这些槽位的"总值"调整为 target（base 为玩家基础值）；只改主修饰器，其余保持原样 */
function setAttrTotal(type, slots, target, base, make) {
  var list = modsList(),
    prim = -1,
    others = 0;
  list.forEach(function (m, i) {
    if (prim < 0 && m.id === make.id && shortId(m.type) === type && m.operation === 'add_value' && slotHit(m, slots))
      prim = i;
  });
  if (prim < 0)
    list.forEach(function (m, i) {
      if (prim < 0 && shortId(m.type) === type && m.operation === 'add_value' && slotHit(m, slots)) prim = i;
    });
  list.forEach(function (m, i) {
    if (i !== prim && shortId(m.type) === type && m.operation === 'add_value' && slotHit(m, slots))
      others += nbtNumberValue(m.amount);
  });
  var amt = nbtNumberValue(target) - base - others;
  if (isFinite(amt)) amt = +amt.toFixed(6);
  else {
    var sc = attrAmountSchema();
    if (!sc || !(isNaN(amt) ? sc.allowNaN : amt > 0 ? sc.allowPositiveInfinity : sc.allowNegativeInfinity))
      throw new Error(I18n.t('cadeditor.ui.cards2.codec_game_allow_modifier_special'));
    amt = nbtSpecialScalar(amt, sc.nbtType);
  }
  if (prim >= 0) list[prim].amount = amt;
  else {
    var taken = list.some(function (m) {
      return m.id === make.id;
    });
    list.push({
      type: attrFull(type),
      id: taken ? nextModId(type, list) : make.id,
      amount: amt,
      operation: 'add_value',
      slot: make.slot
    });
  }
  saveMods(list);
}

/* 条形图标（心、护甲等）：超过 cap 个后显示 ×N，数值很大也不会撑爆 */
/* 原版 HUD 精灵：心、饥饿、护甲（全 / 半） */
var SPR = {
  heart: ['minecraft:hud/heart/full', 'minecraft:hud/heart/half'],
  food: ['minecraft:hud/food_full', 'minecraft:hud/food_half'],
  armor: ['minecraft:hud/armor_full', 'minecraft:hud/armor_half']
};
function iconBar(cls) {
  var el = h('div', { class: 'k-hearts ' + (cls || '') });
  return {
    el: el,
    set: function (points, cap) {
      clear(el);
      cap = cap || 10;
      if (!isFinite(points)) return;
      var full = Math.floor(points / 2),
        half = points % 2 >= 1;
      var shown = Math.min(full, cap);
      var sp = SPR[cls === 'k-food' ? 'food' : cls === 'k-armorbar' ? 'armor' : 'heart'];
      for (var i = 0; i < shown; i++) el.appendChild(h('sprite', { src: sp[0] }));
      if (half && shown < cap) el.appendChild(h('sprite', { src: sp[1] }));
      if (full > cap) el.appendChild(h('span', { class: 'k-sub', text: '  × ' + fmtInt(full) }));
      if (points <= 0) el.appendChild(h('span', { class: 'k-sub', text: I18n.t('cadeditor.ui.common.none') }));
    }
  };
}

/* 通用"数值型属性"卡片：显示总值（含玩家基础值），改动写回主修饰器 */
function attrCard(o) {
  function total() {
    return o.base + attrSum(o.type, o.slots());
  }
  if (!Reg.preview() && (o.base === null || !Reg.table('equipment_slot_groups'))) {
    var waiting = kCard(
      {
        id: 'attr-' + o.type,
        icon: uiIcon(o.icon, 16),
        title: o.title,
        desc: o.desc,
        comps: ['attribute_modifiers'],
        value: function () {
          return I18n.t('cadeditor.ui.cards1.loading');
        }
      },
      Ctx
    );
    waiting.body.appendChild(kHint(I18n.t('cadeditor.ui.cards2.reading_player_foundation_attribute_take')));
    return waiting;
  }
  var card = kCard(
    {
      id: 'attr-' + o.type,
      icon: uiIcon(o.icon, 16),
      title: o.title,
      desc: o.desc,
      comps: ['attribute_modifiers'],
      value: function () {
        return isFinite(total()) ? fmtNum(+total().toFixed(2)) + (o.unit ? ' ' + o.unit : '') : numLabel(total());
      },
      summary: function () {
        return isFinite(total()) && o.brief ? o.brief(total()) : '';
      }
    },
    Ctx
  );
  var presets = (o.presets || []).slice(),
    sc = attrAmountSchema();
  if (sc && sc.allowNaN)
    presets.push({ v: NaN, label: 'NaN', title: I18n.t('cadeditor.ui.cards2.non_value_double_nan') });
  if (sc && sc.allowPositiveInfinity)
    presets.push({ v: Infinity, label: '∞', title: I18n.t('cadeditor.ui.cards2.positive_double_infinity') });
  if (sc && sc.allowNegativeInfinity)
    presets.push({ v: -Infinity, label: '−∞', title: I18n.t('cadeditor.ui.cards2.negative_double_infinity') });
  var num = kNumber(total(), {
    special: attrAmountSchema,
    min: -1e15,
    max: 1e15,
    warnMax: o.warnMax,
    warnWhy: o.warnWhy,
    softMin: o.softMin,
    softMax: o.softMax,
    step: o.step,
    dec: o.dec,
    big: true,
    unit: o.unit,
    presets: presets,
    onChange: function (v) {
      setAttrTotal(o.type, o.slots(), v, o.base, { id: o.id, slot: o.slot() });
    }
  });
  var eff = kEffect('');
  card.body.appendChild(num.el);
  if (o.extra) card.body.appendChild(o.extra.el);
  card.body.appendChild(eff.el);
  card.live.push(function () {
    var t = total();
    num.set(t);
    if (o.extra && o.extra.update) o.extra.update(t);
    eff.set(isFinite(t) && o.effect ? o.effect(t) : '', isFinite(t) && o.tone ? o.tone(t) : '');
  });
  card.live[card.live.length - 1]();
  return card;
}

/* 主手拿着时生效的装备槽组：来自游戏的 equipment_slot_groups（哪些组包含主手，不含 any），离线 / 没到时才用 mainhand + hand */
function meleeSlots() {
  var g = Reg.live() ? Reg.table('equipment_slot_groups') : null;
  if (!g) return ['mainhand', 'hand'];
  var out = g
    .filter(function (x) {
      return x.id !== 'any' && x.slots.indexOf('mainhand') >= 0;
    })
    .map(function (x) {
      return x.id;
    });
  return out.length ? out : ['mainhand', 'hand'];
}
CARDS.attackDamage = function () {
  var hearts = iconBar();
  var presets = [],
    base = Reg.baseAttr('minecraft:player', 'attack_damage', Reg.preview() ? 1 : null),
    max = Reg.attrMax('attack_damage', null);
  TIER_TOOLS.forEach(function (id) {
    var m = Ctx.protoItem(id, 'attribute_modifiers');
    if (!m || base === null) return;
    m.forEach(function (x) {
      if (x.type === 'minecraft:attack_damage')
        presets.push({
          v: base + x.amount,
          label: nameOfItem(id).replace(I18n.t('cadeditor.ui.cards2.sword'), '') + ' ' + fmtNum(base + x.amount)
        });
    });
  });
  presets.push({ v: 100, label: '100' }, { v: 1000, label: '1000' });
  if (max !== null) presets.push({ v: max, label: I18n.t('cadeditor.ui.cards2.cap', fmtNum(max)) });
  return attrCard({
    type: 'attack_damage',
    icon: 'sword',
    brief: function (t) {
      return I18n.t('cadeditor.ui.cards2.heart', bigOrNum(+(t / 2).toFixed(1)));
    },
    title: I18n.t('cadeditor.ui.cards2.attack_damage'),
    desc: I18n.t('cadeditor.ui.cards2.damage_including_current_player_base'),
    base: base,
    slots: function () {
      return meleeSlots();
    },
    slot: function () {
      return 'mainhand';
    },
    id: 'minecraft:base_attack_damage',
    warnMax: max === null ? undefined : max + (base || 0),
    warnWhy: max === null ? '' : I18n.t('cadeditor.ui.cards2.attack_damage_attribute_value_ceiling', fmtNum(max)),
    softMin: 0,
    softMax: 30,
    step: 0.5,
    unit: I18n.t('cadeditor.ui.cards2.points'),
    presets: presets,
    effect: function (t) {
      return I18n.t(
        'cadeditor.ui.cards2.corresponding_heart',
        bigOrNum(t / 2),
        t >= 20
          ? I18n.t('cadeditor.ui.cards2.second_kill_ordinary_mob_zombies')
          : t >= 4
            ? I18n.t('cadeditor.ui.cards2.about_killed_zombie', Math.ceil(20 / Math.max(t, 1)))
            : ''
      );
    },
    tone: function (t) {
      return max !== null && t > max + (base || 0) ? 'warn' : '';
    },
    extra: {
      el: hearts.el,
      update: function (t) {
        hearts.set(Math.max(0, t), 10);
      }
    }
  });
};
function bigOrNum(n) {
  n = nbtNumberValue(n);
  if (!isFinite(n)) return numLabel(n);
  var b = bigText(n);
  return b ? fmtInt(n) + '（' + b + '）' : fmtNum(n);
}

CARDS.attackSpeed = function () {
  return attrCard({
    type: 'attack_speed',
    icon: 'bolt',
    brief: function (t) {
      return t > 0 ? I18n.t('cadeditor.ui.cards2.about_1_sec', +(1 / t).toFixed(2)) : '';
    },
    title: I18n.t('cadeditor.ui.cards2.attack_speed'),
    desc: I18n.t('cadeditor.ui.cards2.full_swings_made_several_times'),
    base: Reg.baseAttr('minecraft:player', 'attack_speed', Reg.preview() ? 4 : null),
    slots: function () {
      return meleeSlots();
    },
    slot: function () {
      return 'mainhand';
    },
    id: 'minecraft:base_attack_speed',
    warnMax: Reg.attrMax('attack_speed', undefined),
    warnWhy: I18n.t('cadeditor.ui.cards2.more_current_attack_speed_attribute'),
    softMin: 0.1,
    softMax: 4,
    step: 0.1,
    unit: I18n.t('cadeditor.ui.cards2.attacks_sec'),
    dec: 2,
    presets: [
      { v: 0.8, label: '0.8' },
      { v: 1, label: '1.0' },
      { v: 1.6, label: '1.6' },
      { v: 4, label: '4' },
      { v: 100, label: '100' }
    ],
    effect: function (t) {
      return t <= 0
        ? I18n.t('cadeditor.ui.cards2.attack_speed_0_failure_complete')
        : I18n.t('cadeditor.ui.cards2.s_maximum_complete_attack_per', fmtNum(1 / t), fmtNum(t));
    },
    tone: function (t) {
      return t <= 0 ? 'warn' : '';
    }
  });
};

/* 其它属性（自由添加 / 编辑所有修饰器）：折叠态是预览行，点开编辑，可拖拽排序 */
var OPMODES = Labels.opLong;
function modSummary(m) {
  var add = m.operation === 'add_value',
    amount = nbtNumberValue(m.amount);
  if (!isFinite(amount)) return numLabel(amount);
  var v = add ? amount : amount * 100;
  return (v >= 0 ? '+' : '') + bigOrNum(+v.toFixed(3)) + (add ? '' : '%');
}
/* 列出全部修饰器，包括武器、工具和盔甲自带的那几条（攻击伤害、护甲值……），它们也可以改数值、计算方式和生效部位 */
CARDS.extraAttrs = function (title) {
  var card = kCard(
    {
      id: 'xattrs',
      icon: 'sliders',
      title: title || I18n.t('cadeditor.ui.cards1.attribute_modifiers'),
      desc: I18n.t('cadeditor.ui.cards2.add_equipment_attribute_holding'),
      comps: ['attribute_modifiers'],
      span: 2,
      value: function () {
        var n = modsList().length;
        return n ? I18n.t('cadeditor.ui.cards2.entries', n) : '';
      }
    },
    Ctx
  );
  var list = h('div', { class: 'k-sortlist' });
  var openIdx = -1;
  function draw() {
    clear(list);
    var all = modsList(),
      n = 0;
    all.forEach(function (m, idx) {
      var t = shortId(m.type);
      n++;
      var info = ATIDX[t],
        isAdd = m.operation === 'add_value',
        isOpen = openIdx === idx;
      /* 一行里直接改数值；展开才出现“计算方式 / 生效位置 / 删除” */
      var val = nbtNumberValue(m.amount) * (isAdd ? 1 : 100),
        headRef = null;
      var num = xNumCtl(
        isFinite(val) ? +val.toFixed(4) : val,
        {
          special: attrAmountSchema,
          min: -1e15,
          max: 1e15,
          step: isAdd ? 0.5 : 5,
          unit: isAdd ? '' : '%',
          noSlider: true,
          onChange: function (v) {
            var amount = nbtNumberValue(v) / (isAdd ? 1 : 100);
            nbtPut(
              all[idx],
              'amount',
              isFinite(amount) ? amount : nbtSpecialScalar(amount, attrAmountSchema().nbtType)
            );
            saveMods(all);
          }
        },
        true
      );
      var row = xRow({
        grip: true,
        chevron: true,
        icon: attrIconEl(t),
        title: attrName(t),
        sub: attributeSlotLabel(m.slot) + (isAdd ? '' : I18n.t('cadeditor.ui.cards2.multiplier')),
        tip: info ? info.desc : I18n.t('cadeditor.ui.cards2.mod_attribute', m.type),
        right: num.el,
        onDelete: function () {
          all.splice(idx, 1);
          openIdx = -1;
          saveMods(all);
          draw();
        },
        open: isOpen,
        onHead: function () {
          openIdx = isOpen ? -1 : idx;
          draw();
        }
      });
      if (isOpen) {
        var opsel = {
          el: combo({
            options: function () {
              return Reg.enumOptions('attribute_operation', OPMODES);
            },
            value: m.operation || '',
            free: true,
            onPick: function (v) {
              all[idx].operation = v;
              saveMods(all);
              draw();
            }
          })
        };
        var slotSel = {
          el: combo({
            options: attributeSlotOptions,
            value: m.slot || 'any',
            free: true,
            placeholder: I18n.t('cadeditor.ui.cards2.read_slot_manual_input'),
            onPick: function (v) {
              all[idx].slot = v;
              saveMods(all);
              draw();
            }
          })
        };
        row.appendChild(
          h('div', { class: 'k-xbody x2' }, [
            h('div', { class: 'x2r' }, [
              h('span', { class: 'x2l' }, [
                uiIcon('sliders', 14),
                h('span', { text: I18n.t('cadeditor.ui.cards2.operation') })
              ]),
              opsel.el
            ]),
            h('div', { class: 'x2r' }, [
              h('span', { class: 'x2l' }, [
                uiIcon('pin', 14),
                h('span', { text: I18n.t('cadeditor.ui.cards2.active_slots') })
              ]),
              slotSel.el
            ]),
            h('div', { class: 'x2f' }, [
              h('span', { class: 'k-sub', text: isAdd ? '' : I18n.t('cadeditor.ui.cards2.proportional_10_means_10') })
            ])
          ])
        );
      }
      onContext(row, function () {
        return [
          {
            label: I18n.t('cadeditor.ui.cards2.duplicate'),
            icon: 'copy',
            run: function () {
              var copy = clone(m);
              copy.id = nextModId(m.type, all);
              all.splice(idx + 1, 0, copy);
              openIdx = idx + 1;
              saveMods(all);
              draw();
            }
          },
          { sep: 1 },
          {
            label: I18n.t('cadeditor.ui.common.delete'),
            icon: 'trash',
            danger: 1,
            run: function () {
              all.splice(idx, 1);
              saveMods(all);
              draw();
            }
          }
        ];
      });
      list.appendChild(row);
    });
    if (!n) list.appendChild(xEmpty(I18n.t('cadeditor.ui.cards2.extra_attribute_added')));
  }
  kSortable(list, {
    onMove: function (from, to) {
      var all = modsList(),
        x = all.splice(from, 1)[0];
      all.splice(to, 0, x);
      openIdx = -1;
      saveMods(all);
      draw();
    }
  });
  var add = xAdd(I18n.t('cadeditor.ui.cards2.add_attribute_modifier'));
  activate(add, function () {
    /* 同一种属性可以有多条修饰器：这里只新增，不按属性类型同步或删除已有的 */
    openAttrPicker({
      onConfirm: function (ids) {
        var l = modsList();
        var slot = Ctx.kind() === 'armor' ? (Ctx.get('equippable') || {}).slot || 'any' : 'mainhand';
        ids.forEach(function (id) {
          var full = Reg.full(id);
          l.push({ type: full, id: nextModId(full, l), amount: 1, operation: 'add_value', slot: slot });
        });
        openIdx = l.length - 1;
        saveMods(l);
        draw();
      }
    });
  });
  card.body.appendChild(h('div', { class: 'k-scrollbox tall' }, [list]));
  card.body.appendChild(add);
  draw();
  card.live.push(function () {
    var key = JSON.stringify(modsList());
    if (card._key !== key) {
      card._key = key;
      if (!list.querySelector('.k-xrow.open')) draw();
    }
  });
  return card;
};

/* ==================== 近战 / 武器 ==================== */
CARDS.weapon = function () {
  var card = kCard(
    {
      id: 'weapon',
      icon: 'swords',
      title: I18n.t('cadeditor.ui.cards2.weapon_properties'),
      desc: I18n.t('cadeditor.ui.cards2.attack_effect_durability_enemy_shield'),
      comps: ['weapon']
    },
    Ctx
  );
  var v = Ctx.get('weapon');
  if (!v)
    return enableBox(
      card,
      [I18n.t('cadeditor.ui.cards2.item_weapon'), I18n.t('cadeditor.ui.cards2.enabled_attack_consume_durability_set')],
      I18n.t('cadeditor.ui.cards2.make_weapon'),
      function () {
        Ctx.enable('weapon', {}, I18n.t('cadeditor.ui.cards2.make_weapon'));
      }
    );
  var per = codecNumber(codecField(v, 'weapon', 'item_damage_per_attack', 1), {
    min: 0,
    max: 2147483647,
    softMax: 10,
    step: 1,
    presets: [
      { v: 0, label: I18n.t('cadeditor.ui.cards2.n0_durability_loss') },
      { v: 1, label: '1' },
      { v: 2, label: '2' }
    ],
    onChange: function (n) {
      var w = Ctx.get('weapon') || {};
      w.item_damage_per_attack = n;
      Ctx.setSmart('weapon', w, { label: I18n.t('cadeditor.ui.cards2.durability_cost_per_attack') });
    }
  });
  var dis = codecNumber(codecField(v, 'weapon', 'disable_blocking_for_seconds', 0), {
    min: 0,
    max: 3.4e38,
    softMax: 10,
    step: 0.5,
    dec: 1,
    unit: I18n.t('cadeditor.ui.cards2.sec'),
    presets: [
      { v: 0, label: I18n.t('cadeditor.ui.cards2.n0_shield_disabling') },
      { v: 5, label: I18n.t('cadeditor.ui.cards2.n5_axe') },
      { v: 10, label: '10' }
    ],
    onChange: function (n) {
      var w = Ctx.get('weapon') || {};
      w.disable_blocking_for_seconds = n;
      Ctx.setSmart('weapon', w, { label: I18n.t('cadeditor.ui.cards2.shield_disable_time') });
    }
  });
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards2.durability_lost_per_attack'),
      per.el,
      I18n.t('cadeditor.ui.cards2.n0_durability_lost_attacks')
    )
  );
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards2.disable_target_s_shield'),
      dis.el,
      I18n.t('cadeditor.ui.cards2.attack_s_shielded_player_i')
    )
  );
  card.live.push(function () {
    var w = Ctx.get('weapon');
    if (w) {
      per.set(codecField(w, 'weapon', 'item_damage_per_attack', 1));
      dis.set(codecField(w, 'weapon', 'disable_blocking_for_seconds', 0));
    }
  });
  return card;
};

CARDS.reach = function () {
  var card = kCard(
    {
      id: 'reach',
      icon: 'target',
      title: I18n.t('cadeditor.ui.cards2.attack_range'),
      desc: I18n.t('cadeditor.ui.cards2.how_far_away_hit_enemy'),
      comps: ['attack_range']
    },
    Ctx
  );
  var v = Ctx.get('attack_range');
  var base = v || {};
  function put(k) {
    return function (n) {
      var o = Ctx.get('attack_range') || {};
      o[k] = n;
      Ctx.setSmart('attack_range', o, { label: I18n.t('cadeditor.ui.cards2.attack_range') });
    };
  }
  var mx = codecNumber(codecField(base, 'attack_range', 'max_reach', 3), {
    min: 0,
    max: 1e6,
    warnMax: 64,
    warnWhy: I18n.t('cadeditor.ui.cards2.vanilla_maximum_64_blocks'),
    softMax: 10,
    step: 0.5,
    dec: 1,
    unit: I18n.t('cadeditor.ui.cards2.blocks'),
    presets: [
      { v: 3, label: I18n.t('cadeditor.ui.cards2.n3_normal') },
      { v: 4.5, label: '4.5' },
      { v: 6, label: '6' },
      { v: 12, label: '12' },
      { v: 64, label: '64' }
    ],
    onChange: put('max_reach')
  });
  var mn = codecNumber(codecField(base, 'attack_range', 'min_reach', 0), {
    min: 0,
    max: 1e6,
    warnMax: 64,
    warnWhy: I18n.t('cadeditor.ui.cards2.vanilla_maximum_64_blocks'),
    softMax: 5,
    step: 0.5,
    dec: 1,
    unit: I18n.t('cadeditor.ui.cards2.blocks'),
    presets: [
      { v: 0, label: '0' },
      { v: 2, label: I18n.t('cadeditor.ui.cards2.n2_spear_blind_spot') }
    ],
    onChange: put('min_reach')
  });
  var hb = codecNumber(codecField(base, 'attack_range', 'hitbox_margin', 0.3), {
    min: 0,
    max: 1e3,
    warnMax: 1,
    warnWhy: I18n.t('cadeditor.ui.cards2.vanilla_range_0_1'),
    softMax: 1,
    step: 0.05,
    dec: 2,
    unit: I18n.t('cadeditor.ui.cards2.blocks'),
    onChange: put('hitbox_margin')
  });
  card.body.appendChild(
    fieldRow(I18n.t('cadeditor.ui.cards2.maximum_reach'), mx.el, I18n.t('cadeditor.ui.cards2.measured_eyes'))
  );
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards2.minimum_distance'),
      mn.el,
      I18n.t('cadeditor.ui.cards2.targets_closer_cannot_hit')
    )
  );
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards2.hitbox_expansion'),
      hb.el,
      I18n.t('cadeditor.ui.cards2.larger_values_make_targets_easier')
    )
  );
  card.live.push(function () {
    var o = Ctx.get('attack_range');
    if (o) {
      mx.set(codecField(o, 'attack_range', 'max_reach', 3));
      mn.set(codecField(o, 'attack_range', 'min_reach', 0));
      hb.set(codecField(o, 'attack_range', 'hitbox_margin', 0.3));
    }
  });
  if (!v) card.body.appendChild(kHint(I18n.t('cadeditor.ui.cards2.item_carry_own_attack_distance')));
  return card;
};

CARDS.swing = function () {
  var card = kCard(
    {
      id: 'swing',
      icon: 'wand',
      title: I18n.t('cadeditor.ui.cards2.swing_animation'),
      desc: I18n.t('cadeditor.ui.cards2.animation_attack_arm_used'),
      comps: ['swing_animation']
    },
    Ctx
  );
  var v = Ctx.get('swing_animation') || {};
  function put(k, val) {
    var o = Ctx.get('swing_animation') || {};
    o[k] = val;
    Ctx.setSmart('swing_animation', o, { label: I18n.t('cadeditor.ui.cards2.swing_animation') });
  }
  function swingOptions() {
    return Reg.codecOptions('swing_animation', 'type', [
      { v: 'whack', label: I18n.t('cadeditor.ui.cards2.swing') },
      { v: 'stab', label: I18n.t('cadeditor.ui.cards2.stab') },
      { v: 'none', label: I18n.t('cadeditor.ui.cards2.none') }
    ]);
  }
  var options = swingOptions(),
    seg = options.length
      ? kSeg(options, codecField(v, 'swing_animation', 'type', 'whack'), function (x) {
          put('type', x);
        })
      : null;
  var manual = combo({
    options: swingOptions,
    value: codecField(v, 'swing_animation', 'type', 'whack'),
    free: true,
    placeholder: I18n.t('cadeditor.ui.cards2.select_enter_animation'),
    onPick: function (x) {
      put('type', x);
    }
  });
  var dur = codecNumber(codecField(v, 'swing_animation', 'duration', 6), {
    min: 1,
    max: 2147483647,
    softMax: 40,
    step: 1,
    unit: I18n.t('cadeditor.ui.cards2.ticks'),
    presets: [
      { v: 6, label: '6' },
      { v: 10, label: '10' },
      { v: 20, label: I18n.t('cadeditor.ui.cards2.n20_slow') }
    ],
    onChange: function (n) {
      put('duration', n);
    }
  });
  if (seg) card.body.appendChild(seg.el);
  card.body.appendChild(manual);
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards2.animation_duration'),
      dur.el,
      I18n.t('cadeditor.ui.cards2.n20_moment_1_seconds')
    )
  );
  card.live.push(function () {
    var o = Ctx.get('swing_animation');
    if (o) {
      if (seg) seg.set(codecField(o, 'swing_animation', 'type', 'whack'));
      dur.set(codecField(o, 'swing_animation', 'duration', 6));
    }
  });
  return card;
};

CARDS.cooldown = function () {
  var card = kCard(
    {
      id: 'cooldown',
      icon: 'clock',
      title: I18n.t('cadeditor.ui.cards2.use_cooldown'),
      desc: I18n.t('cadeditor.ui.cards2.how_long_take_wait_one'),
      comps: ['use_cooldown']
    },
    Ctx
  );
  var v = Ctx.get('use_cooldown');
  if (!v)
    return enableBox(
      card,
      [I18n.t('cadeditor.ui.cards2.use_cooldown_2'), I18n.t('cadeditor.ui.cards2.enabled_use_one_time_enter')],
      I18n.t('cadeditor.ui.cards2.add_cooldown'),
      function () {
        Ctx.enable('use_cooldown', { seconds: 1 }, I18n.t('cadeditor.ui.cards2.add_use_cooldown'));
      }
    );
  var sec = kNumber(v.seconds, {
    min: 0.05,
    max: 3.4e38,
    softMax: 60,
    step: 0.5,
    dec: 2,
    unit: I18n.t('cadeditor.ui.cards2.sec'),
    presets: [
      { v: 1, label: '1' },
      { v: 5, label: '5' },
      { v: 15, label: '15' },
      { v: 60, label: '60' }
    ],
    onChange: function (n) {
      var o = Ctx.get('use_cooldown') || { seconds: 1 };
      o.seconds = n;
      Ctx.setSmart('use_cooldown', o, { label: I18n.t('cadeditor.ui.cards2.use_cooldown') });
    }
  });
  card.body.appendChild(sec.el);
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards2.shared_cooldown_group'),
      kInput(
        v.cooldown_group || '',
        function (t) {
          var o = Ctx.get('use_cooldown') || { seconds: 1 };
          if (t) o.cooldown_group = t;
          else delete o.cooldown_group;
          Ctx.setSmart('use_cooldown', o, { label: I18n.t('cadeditor.ui.cards2.cooldown_group') });
        },
        { placeholder: I18n.t('cadeditor.ui.cards2.leave_empty_individual_item_categories') }
      ),
      I18n.t('cadeditor.ui.cards2.fill_same_name_multiple_items')
    )
  );
  card.live.push(function () {
    var o = Ctx.get('use_cooldown');
    if (o) sec.set(o.seconds);
  });
  return card;
};

/* ==================== 工具 ==================== */
var TOOL_GROUPS = [
  {
    v: '#minecraft:mineable/pickaxe',
    label: I18n.t('cadeditor.ui.cards2.pickaxe_blocks'),
    sub: I18n.t('cadeditor.ui.cards2.stone_ores_anvils')
  },
  {
    v: '#minecraft:mineable/axe',
    label: I18n.t('cadeditor.ui.cards2.axe_blocks'),
    sub: I18n.t('cadeditor.ui.cards2.logs_planks_chests')
  },
  {
    v: '#minecraft:mineable/shovel',
    label: I18n.t('cadeditor.ui.cards2.shovel_blocks'),
    sub: I18n.t('cadeditor.ui.cards2.dirt_sand_snow')
  },
  {
    v: '#minecraft:mineable/hoe',
    label: I18n.t('cadeditor.ui.cards2.hoe_blocks'),
    sub: I18n.t('cadeditor.ui.cards2.leafs_haystacks_sponges')
  },
  { v: 'minecraft:cobweb', label: I18n.t('cadeditor.ui.cards2.cobweb'), sub: '' },
  { v: '#minecraft:wool', label: I18n.t('cadeditor.ui.cards2.wool'), sub: '' },
  { v: '#minecraft:leaves', label: I18n.t('cadeditor.ui.cards2.leaves'), sub: '' },
  {
    v: '#minecraft:sword_efficient',
    label: I18n.t('cadeditor.ui.cards2.blocks_mined_faster_swords'),
    sub: I18n.t('cadeditor.ui.cards2.bamboo_plants')
  },
  {
    v: '#minecraft:sword_instantly_mines',
    label: I18n.t('cadeditor.ui.cards2.blocks_instantly_mined_swords'),
    sub: ''
  },
  {
    v: '#minecraft:incorrect_for_diamond_tool',
    label: I18n.t('cadeditor.ui.cards2.cannot_mined_even_diamond_tools'),
    sub: I18n.t('cadeditor.ui.cards2.sets_tool_requirement_drops')
  }
];
function groupLabel(b) {
  if (typeof b === 'string') {
    var m = /^#minecraft:incorrect_for_(w+)_tool$/.exec(b);
    if (m)
      return I18n.t(
        'cadeditor.ui.cards2.level_undrawn_block',
        {
          wooden: I18n.t('cadeditor.ui.cards2.wood'),
          stone: I18n.t('cadeditor.ui.cards2.stone'),
          iron: I18n.t('cadeditor.ui.cards2.iron'),
          gold: I18n.t('cadeditor.ui.cards2.gold'),
          diamond: I18n.t('cadeditor.ui.cards1.diamond'),
          netherite: I18n.t('cadeditor.ui.cards2.netherite'),
          copper: I18n.t('cadeditor.ui.cards2.copper')
        }[m[1]] || m[1]
      );
  }
  var key = typeof b === 'string' ? b : Array.isArray(b) ? b.join(',') : '';
  for (var i = 0; i < TOOL_GROUPS.length; i++) if (TOOL_GROUPS[i].v === key) return TOOL_GROUPS[i].label;
  if (Array.isArray(b))
    return b
      .map(function (x) {
        return x.replace('minecraft:', '');
      })
      .join('、');
  return typeof b === 'string' ? b.replace('minecraft:', '') : '?';
}
var TOOL_BATCH_SEQ = 0;
CARDS.tool = function () {
  var card = kCard(
    {
      id: 'tool',
      icon: itemIcon('diamond_pickaxe', 18),
      title: I18n.t('cadeditor.ui.cards2.tool_properties'),
      desc: I18n.t('cadeditor.ui.cards2.dig_block_how_fast_how'),
      comps: ['tool'],
      span: 2
    },
    Ctx
  );
  var v = Ctx.get('tool');
  if (!v)
    return enableBox(
      card,
      [I18n.t('cadeditor.ui.cards2.item_t_tool'), I18n.t('cadeditor.ui.cards2.enabled_set_up_block_digs')],
      I18n.t('cadeditor.ui.cards2.make_tool'),
      function () {
        Ctx.enable('tool', { rules: [] }, I18n.t('cadeditor.ui.cards2.make_tool'));
      }
    );
  function put(fn, label, atomic) {
    var o = clone(Ctx.get('tool') || { rules: [] });
    fn(o);
    seenRules = clone(o.rules || []);
    Ctx.setSmart('tool', o, {
      label: label || I18n.t('cadeditor.ui.cards2.tool_properties'),
      key: atomic ? '-batch-' + ++TOOL_BATCH_SEQ : ''
    });
    refreshSummaries();
  }
  var def = codecNumber(codecField(v, 'tool', 'default_mining_speed', 1), {
    min: 0,
    max: 3.4e38,
    softMax: 30,
    step: 0.5,
    dec: 2,
    big: true,
    presets: [
      { v: 1, label: I18n.t('cadeditor.ui.cards2.n1_hand') },
      { v: 4, label: '4' },
      { v: 8, label: '8' },
      { v: 12, label: '12' },
      { v: 1000, label: I18n.t('cadeditor.ui.cards2.n1000_instant') }
    ],
    onChange: function (n) {
      put(function (o) {
        o.default_mining_speed = n;
      }, I18n.t('cadeditor.ui.cards2.default_mining_speed'));
    }
  });
  var dpb = codecNumber(codecField(v, 'tool', 'damage_per_block', 1), {
    min: 0,
    max: 2147483647,
    softMax: 5,
    step: 1,
    presets: [
      { v: 0, label: I18n.t('cadeditor.ui.cards2.n0_durability_loss') },
      { v: 1, label: '1' },
      { v: 2, label: '2' }
    ],
    onChange: function (n) {
      put(function (o) {
        o.damage_per_block = n;
      }, I18n.t('cadeditor.ui.cards2.durability_cost_per_block'));
    }
  });
  var cc = codecToggle(
    codecField(v, 'tool', 'can_destroy_blocks_in_creative', true),
    function (on) {
      put(function (o) {
        o.can_destroy_blocks_in_creative = on;
      }, I18n.t('cadeditor.ui.cards2.mining_creative_mode'));
    },
    I18n.t('cadeditor.ui.cards2.creative_mode_used_dig_block')
  );
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards2.mining_speed_other_blocks'),
      def.el,
      I18n.t('cadeditor.ui.cards2.selected_rules_below_block')
    )
  );
  var rules = h('div', { class: 'k-sortlist' }),
    openIdx = -1,
    seenRules = clone(v.rules || []);
  function summary(r) {
    return (
      (r.speed === undefined
        ? I18n.t('cadeditor.ui.cards2.keep_speed')
        : I18n.t('cadeditor.ui.cards2.speed_x', bigOrNum(r.speed))) +
      (r.correct_for_drops === undefined
        ? ''
        : r.correct_for_drops
          ? I18n.t('cadeditor.ui.cards2.correct_tool')
          : I18n.t('cadeditor.ui.cards2.incorrect_tool'))
    );
  }
  function refreshSummaries() {
    if (!rules) return;
    var list = (Ctx.get('tool') || {}).rules || [];
    Array.prototype.forEach.call(rules.children, function (row, i) {
      var sub = row.querySelector('.s');
      if (sub && list[i]) sub.textContent = summary(list[i]);
    });
  }
  function drawRules() {
    clear(rules);
    var o = Ctx.get('tool') || { rules: [] };
    (o.rules || []).forEach(function (r, i) {
      var isOpen = openIdx === i;
      var row = xRow({
        grip: true,
        chevron: true,
        icon: false,
        title: groupLabel(r.blocks),
        sub: summary(r),
        onDelete: function () {
          put(function (t) {
            t.rules.splice(i, 1);
          });
          openIdx = -1;
          drawRules();
        },
        open: isOpen,
        onHead: function () {
          openIdx = isOpen ? -1 : i;
          drawRules();
        }
      });
      if (isOpen) {
        var sp = kNumber(r.speed === undefined ? 1 : r.speed, {
          min: 0,
          max: 3.4e38,
          softMax: 30,
          step: 0.5,
          dec: 2,
          preservePrecision: true,
          noSlider: true,
          unit: I18n.t('cadeditor.ui.cards2.text'),
          onChange: function (n) {
            put(function (t) {
              t.rules[i].speed = n;
            });
          }
        });
        var drops = kSeg(
          [
            { v: 'inherit', label: I18n.t('cadeditor.ui.cards2.keep_default') },
            { v: 'yes', label: I18n.t('cadeditor.ui.cards2.correct_tool_2') },
            { v: 'no', label: I18n.t('cadeditor.ui.cards2.incorrect_tool_2') }
          ],
          r.correct_for_drops === undefined ? 'inherit' : r.correct_for_drops ? 'yes' : 'no',
          function (x) {
            put(function (t) {
              if (x === 'inherit') delete t.rules[i].correct_for_drops;
              else t.rules[i].correct_for_drops = x === 'yes';
            });
          }
        );
        row.appendChild(
          h('div', { class: 'k-xbody' }, [
            fieldRow(
              I18n.t('cadeditor.ui.cards2.mining_speed_blocks'),
              sp.el,
              typeof r.blocks === 'string' ? r.blocks : ''
            ),
            fieldRow(
              I18n.t('cadeditor.ui.cards2.correct_tool_drops'),
              drops.el,
              I18n.t('cadeditor.ui.cards2.block_only_affects_requests_correct')
            )
          ])
        );
      }
      rules.appendChild(row);
    });
    if (!(o.rules || []).length) rules.appendChild(xEmpty(I18n.t('cadeditor.ui.cards2.mining_rule_all_block_treated')));
    refreshSummaries();
  }
  kSortable(rules, {
    onMove: function (from, to) {
      put(function (t) {
        var x = t.rules.splice(from, 1)[0];
        t.rules.splice(to, 0, x);
      });
      openIdx = -1;
      drawRules();
    }
  });
  var add = xAdd(I18n.t('cadeditor.ui.cards2.choose_mining_rule'));
  activate(add, function () {
    var owner = Store.doc(),
      source = clone(Ctx.get('tool')),
      selected = {},
      speedTouched = false,
      checking = false,
      drop = (source.rules || []).length ? 'keep' : 'yes';
    (source.rules || []).forEach(function (r) {
      (Array.isArray(r.blocks) ? r.blocks : [r.blocks]).forEach(function (id) {
        selected[pickerId(id)] = 1;
      });
    });
    var speed = kNumber(4, {
      min: 0,
      max: 3.4e38,
      step: 0.5,
      dec: 2,
      preservePrecision: true,
      noSlider: true,
      onChange: function () {
        if (!checking) speedTouched = true;
      }
    });
    var speedInput = speed.el.querySelector('input');
    speedInput.addEventListener('input', function () {
      speedTouched = true;
    });
    if (Object.keys(selected).length) {
      speedInput.value = '';
      speedInput.setAttribute('placeholder', I18n.t('cadeditor.ui.cards2.keep'));
      setTip(speedInput, I18n.t('cadeditor.ui.cards2.rules_keep_speed_settings_uniform'));
    }
    var drops = combo({
      value: drop,
      options: [
        { v: 'keep', label: I18n.t('cadeditor.ui.cards2.keep_default_requirement') },
        { v: 'yes', label: I18n.t('cadeditor.ui.cards2.correct_tool_2') },
        { v: 'no', label: I18n.t('cadeditor.ui.cards2.incorrect_tool_2') },
        { v: 'inherit', label: I18n.t('cadeditor.ui.cards2.keep_default_requirement_2') }
      ],
      onPick: function (x) {
        drop = x;
      }
    });
    var controls = h('div', { class: 'pk-ctl tool-pick-settings' }, [
      h('div', { class: 'tool-pick-field' }, [
        h('span', { class: 'k-sub', text: I18n.t('cadeditor.ui.cards2.speed') }),
        speed.el
      ]),
      h('div', { class: 'tool-pick-field' }, [
        h('span', { class: 'k-sub', text: I18n.t('cadeditor.ui.cards2.drop_requirement') }),
        drops
      ])
    ]);
    openTagPicker({
      title: I18n.t('cadeditor.ui.cards2.choose_mining_rule'),
      multi: true,
      selected: selected,
      controls: controls,
      validateConfirm: function () {
        if (Store.doc() !== owner || !deepEq(Ctx.get('tool'), source)) {
          toast(I18n.t('cadeditor.ui.cards2.mining_rules_changed_re_select'), 'warn');
          return false;
        }
        checking = true;
        try {
          return speed.commitInput();
        } finally {
          checking = false;
        }
      },
      tagsReg: 'block',
      entryReg: 'block',
      quick: keepKnownTags(TOOL_GROUPS, 'block').map(function (g) {
        return { v: g.v, label: g.label, sub: g.sub };
      }),
      entryIcon: function (e) {
        return itemIcon(shortId(e.v), 16);
      },
      onConfirm: function (ids) {
        if (Store.doc() !== owner || !Ctx.get('tool')) return;
        var wanted = {},
          have = {};
        ids.forEach(function (id) {
          wanted[pickerId(id)] = true;
        });
        function settings(rule, fresh) {
          if (fresh || speedTouched) rule.speed = speed.get();
          if (drop === 'inherit') delete rule.correct_for_drops;
          else if (drop !== 'keep' || fresh) rule.correct_for_drops = drop !== 'no';
          return rule;
        }
        put(
          function (t) {
            var next = [];
            (t.rules || []).forEach(function (r) {
              var blocks = (Array.isArray(r.blocks) ? r.blocks : [r.blocks]).filter(function (id) {
                return wanted[pickerId(id)];
              });
              if (!blocks.length) return;
              blocks.forEach(function (id) {
                have[pickerId(id)] = true;
              });
              if (Array.isArray(r.blocks) && blocks.length !== r.blocks.length) r.blocks = blocks;
              next.push(settings(r, false));
            });
            ids.forEach(function (id) {
              id = pickerId(id);
              if (!have[id]) {
                have[id] = true;
                next.push(settings({ blocks: id }, true));
              }
            });
            t.rules = next;
          },
          I18n.t('cadeditor.ui.cards2.choose_mining_rule'),
          true
        );
        openIdx = -1;
        drawRules();
      }
    });
  });
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards2.mining_rules'),
      h('div', { class: 'k-scrollbox' }, [rules]),
      I18n.t('cadeditor.ui.cards2.first_rule_first_drag_order')
    )
  );
  card.body.appendChild(add);
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards2.durability_lost_per_block'),
      dpb.el,
      I18n.t('cadeditor.ui.cards2.durability_points')
    )
  );
  card.body.appendChild(cc.el);
  drawRules();
  card.live.push(function () {
    var o = Ctx.get('tool');
    if (o) {
      def.set(codecField(o, 'tool', 'default_mining_speed', 1));
      dpb.set(codecField(o, 'tool', 'damage_per_block', 1));
      if (!deepEq(seenRules, o.rules || [])) {
        openIdx = -1;
        seenRules = clone(o.rules || []);
        drawRules();
      }
    }
  });
  return card;
};

/* ==================== 盔甲 ==================== */
var EQ_SLOTS = Labels.slotChoices;
var EQ_SOUNDS = [
  { v: 'minecraft:item.armor.equip_generic', label: I18n.t('cadeditor.ui.cards2.general') },
  { v: 'minecraft:item.armor.equip_leather', label: I18n.t('cadeditor.ui.cards1.leather') },
  { v: 'minecraft:item.armor.equip_chain', label: I18n.t('cadeditor.ui.cards2.chain') },
  { v: 'minecraft:item.armor.equip_iron', label: I18n.t('cadeditor.ui.cards2.iron') },
  { v: 'minecraft:item.armor.equip_gold', label: I18n.t('cadeditor.ui.cards2.gold') },
  { v: 'minecraft:item.armor.equip_diamond', label: I18n.t('cadeditor.ui.cards1.diamond') },
  { v: 'minecraft:item.armor.equip_netherite', label: I18n.t('cadeditor.ui.cards2.netherite') },
  { v: 'minecraft:item.armor.equip_turtle', label: I18n.t('cadeditor.ui.cards2.turtle_shell') },
  { v: 'minecraft:item.armor.equip_elytra', label: I18n.t('cadeditor.ui.cards2.elytra') }
];
var EQ_ASSETS = [
  { v: 'minecraft:leather', label: I18n.t('cadeditor.ui.cards1.leather') },
  { v: 'minecraft:chainmail', label: I18n.t('cadeditor.ui.cards2.chain') },
  { v: 'minecraft:iron', label: I18n.t('cadeditor.ui.cards2.iron') },
  { v: 'minecraft:gold', label: I18n.t('cadeditor.ui.cards2.gold') },
  { v: 'minecraft:diamond', label: I18n.t('cadeditor.ui.cards1.diamond') },
  { v: 'minecraft:netherite', label: I18n.t('cadeditor.ui.cards2.netherite') },
  { v: 'minecraft:copper', label: I18n.t('cadeditor.ui.cards2.copper') },
  { v: 'minecraft:turtle_scute', label: I18n.t('cadeditor.ui.cards2.turtle_shell') },
  { v: 'minecraft:elytra', label: I18n.t('cadeditor.ui.cards2.elytra') }
];
CARDS.equip = function () {
  var card = kCard(
    {
      id: 'equip',
      icon: 'helmet',
      title: I18n.t('cadeditor.ui.cards2.equipment_slots_behavior'),
      desc: I18n.t('cadeditor.ui.cards2.what_part_worn_how_wear'),
      comps: ['equippable'],
      span: 2
    },
    Ctx
  );
  var v = Ctx.get('equippable');
  function slots() {
    var live = Reg.options('enum:equipment_slot');
    return live || (Reg.preview() ? EQ_SLOTS : []);
  }
  if (!v)
    return enableBox(
      card,
      [I18n.t('cadeditor.ui.cards2.item_cannot_equipped'), I18n.t('cadeditor.ui.cards2.enabled_choose_place_wear')],
      I18n.t('cadeditor.ui.cards2.make_equippable'),
      function () {
        pickFrom(
          card.el,
          slots(),
          function (s) {
            Ctx.enable('equippable', { slot: s.v }, I18n.t('cadeditor.ui.cards2.make_equippable'));
          },
          {
            manual: {
              label: I18n.t('cadeditor.ui.cards2.enter_equipment_slot'),
              parse: function (s) {
                return s;
              }
            }
          }
        );
      }
    );
  function put(fn, label) {
    var o = Ctx.get('equippable') || {};
    fn(o);
    Ctx.setSmart('equippable', o, { label: label || I18n.t('cadeditor.ui.cards2.equipment_settings') });
  }
  var slot = kTiles(
    slots().map(function (s) {
      return {
        v: s.v,
        label: s.label,
        sub: s.sub,
        icon:
          s.icon ||
          function () {
            return uiIcon('grid', 16);
          }
      };
    }),
    v.slot,
    function (x) {
      put(function (o) {
        o.slot = x;
      }, I18n.t('cadeditor.ui.cards2.equipment_slot'));
    },
    { cols: 8 }
  );
  card.body.appendChild(fieldRow(I18n.t('cadeditor.ui.cards2.slot'), slot.el));
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards2.custom_slot'),
      combo({
        options: slots,
        free: true,
        value: v.slot || '',
        onPick: function (x) {
          put(function (o) {
            o.slot = x;
          });
        }
      })
    )
  );
  var look = kRegSelect({
    reg: 'equipment_asset',
    value: v.asset_id || '',
    title: I18n.t('cadeditor.ui.cards2.choose_equipment_appearance'),
    empty: I18n.t('cadeditor.ui.cards2.default_equipment_texture'),
    allowClear: true,
    fallback: EQ_ASSETS,
    onChange: function (x) {
      put(function (o) {
        if (x) o.asset_id = x;
        else delete o.asset_id;
      }, I18n.t('cadeditor.ui.cards2.equipment_appearance'));
    }
  });
  var snd = kSoundField(
    codecField(v, 'equippable', 'equip_sound', 'minecraft:item.armor.equip_generic') || '',
    function (x) {
      put(function (o) {
        o.equip_sound = x;
      }, I18n.t('cadeditor.ui.cards2.equip_sound'));
    }
  );
  card.body.appendChild(
    h('div', { class: 'k-row wrap' }, [
      fieldRow(
        I18n.t('cadeditor.ui.cards2.equipment_appearance'),
        look.el,
        I18n.t('cadeditor.ui.cards2.texture_used_equipped')
      ),
      fieldRow(I18n.t('cadeditor.ui.cards2.equip_sound'), snd.el)
    ])
  );
  var T = [
    ['dispensable', I18n.t('cadeditor.ui.cards2.dispensers_equip_item'), true],
    ['swappable', I18n.t('cadeditor.ui.cards2.right_click_holding_equip'), true],
    ['damage_on_hurt', I18n.t('cadeditor.ui.cards2.lose_durability_damaged'), true],
    ['equip_on_interact', I18n.t('cadeditor.ui.cards2.wear_right_horses_dogs'), false],
    ['can_be_sheared', I18n.t('cadeditor.ui.cards2.removed_shears'), false]
  ];
  var togs = h('div', { class: 'k-fxlist' });
  T.forEach(function (t) {
    var tg = codecToggle(
      codecField(v, 'equippable', t[0], t[2]),
      function (on) {
        put(function (o) {
          o[t[0]] = on;
        });
      },
      t[1]
    );
    togs.appendChild(tg.el);
  });
  card.body.appendChild(togs);
  card.live.push(function () {
    var o = Ctx.get('equippable');
    if (o) slot.set(o.slot);
  });
  return card;
};

function slotsOfEquip() {
  var e = Ctx.get('equippable');
  return e ? [e.slot, 'armor'] : ['head', 'chest', 'legs', 'feet', 'armor'];
}
function slotKey() {
  var e = Ctx.get('equippable');
  return e ? e.slot : 'chest';
}
var PIECE_ID = Labels.armorPiece;
CARDS.armorValue = function () {
  var bar = iconBar('k-armorbar');
  return attrCard({
    type: 'armor',
    icon: 'chestplate',
    title: I18n.t('cadeditor.ui.cards2.armor'),
    desc: I18n.t('cadeditor.ui.cards2.reduce_most_damage_exposure_point'),
    base: 0,
    slots: slotsOfEquip,
    slot: slotKey,
    id: 'minecraft:armor.' + (PIECE_ID[slotKey()] || 'chestplate'),
    warnMax: 30,
    warnWhy: I18n.t('cadeditor.ui.cards2.armour_attribute_yes_vanilla_minecraft'),
    softMin: 0,
    softMax: 30,
    step: 1,
    unit: I18n.t('cadeditor.ui.cards2.points'),
    presets: [
      { v: 0, label: '0' },
      { v: 2, label: I18n.t('cadeditor.ui.cards2.leather_2') },
      { v: 5, label: I18n.t('cadeditor.ui.cards2.iron_5') },
      { v: 6, label: I18n.t('cadeditor.ui.cards2.diamond_6') },
      { v: 8, label: I18n.t('cadeditor.ui.cards2.chestplate_8') },
      { v: 30, label: I18n.t('cadeditor.ui.cards2.n30_maximum') }
    ],
    effect: function (t) {
      return t > 30
        ? I18n.t('cadeditor.ui.cards2.armor_attribute_calculated_maximum_30')
        : I18n.t('cadeditor.ui.cards2.each_armor_point_reduces_physical');
    },
    tone: function (t) {
      return t > 30 ? 'warn' : '';
    },
    extra: {
      el: bar.el,
      update: function (t) {
        bar.set(Math.max(0, t), 10);
      }
    }
  });
};
CARDS.armorToughness = function () {
  return attrCard({
    type: 'armor_toughness',
    icon: 'shield',
    title: I18n.t('cadeditor.ui.cards2.armor_toughness'),
    desc: I18n.t('cadeditor.ui.cards2.additional_injury_face_height_damage'),
    base: 0,
    slots: slotsOfEquip,
    slot: slotKey,
    id: 'minecraft:armor.' + (PIECE_ID[slotKey()] || 'chestplate'),
    warnMax: 20,
    warnWhy: I18n.t('cadeditor.ui.cards2.armor_resilience_vanilla_minecraft_press'),
    softMin: 0,
    softMax: 8,
    step: 0.5,
    unit: I18n.t('cadeditor.ui.cards2.points'),
    presets: [
      { v: 0, label: '0' },
      { v: 1, label: '1' },
      { v: 2, label: I18n.t('cadeditor.ui.cards2.diamond_2') },
      { v: 3, label: I18n.t('cadeditor.ui.cards2.netherite_3') }
    ],
    effect: function (t) {
      return t > 20
        ? I18n.t('cadeditor.ui.cards2.armor_resiliency_20_point')
        : I18n.t('cadeditor.ui.cards2.more_resilient_more_trauma_get');
    },
    tone: function (t) {
      return t > 20 ? 'warn' : '';
    }
  });
};
CARDS.knockbackResist = function () {
  return attrCard({
    type: 'knockback_resistance',
    icon: 'anvil',
    title: I18n.t('cadeditor.ui.cards2.knockback_resistance'),
    desc: I18n.t('cadeditor.ui.cards2.how_much_strength_offset_knockback'),
    base: 0,
    slots: slotsOfEquip,
    slot: slotKey,
    id: 'minecraft:armor.knockback_resistance',
    warnMax: 1,
    warnWhy: I18n.t('cadeditor.ui.cards2.knockback_resistance_vanilla_minecraft'),
    softMin: 0,
    softMax: 1,
    step: 0.05,
    dec: 2,
    unit: '',
    presets: [
      { v: 0, label: '0' },
      { v: 0.1, label: I18n.t('cadeditor.ui.cards2.netherite_0_1') },
      { v: 0.25, label: '0.25' },
      { v: 1, label: I18n.t('cadeditor.ui.cards2.n1_immune') }
    ],
    effect: function (t) {
      return t >= 1
        ? I18n.t('cadeditor.ui.cards2.knockback_completely_immune_fully')
        : I18n.t('cadeditor.ui.cards2.knockback_resistance_each_four_stacks', Math.round(t * 100));
    }
  });
};

var TRIM_MATS = [
  'amethyst',
  'copper',
  'diamond',
  'emerald',
  'gold',
  'iron',
  'lapis',
  'netherite',
  'quartz',
  'redstone',
  'resin'
];
var TRIM_ICON = {
  amethyst: 'amethyst_shard',
  copper: 'copper_ingot',
  diamond: 'diamond',
  emerald: 'emerald',
  gold: 'gold_ingot',
  iron: 'iron_ingot',
  lapis: 'lapis_lazuli',
  netherite: 'netherite_ingot',
  quartz: 'quartz',
  redstone: 'redstone',
  resin: 'resin_brick'
};
CARDS.trim = function () {
  var card = kCard(
    {
      id: 'trim',
      icon: itemIcon('netherite_upgrade_smithing_template', 18),
      title: I18n.t('cadeditor.ui.cards1.armor_trim'),
      desc: I18n.t('cadeditor.ui.cards2.armor_surface_pattern_color'),
      comps: ['trim'],
      toggle: true,
      eager: true
    },
    Ctx
  );
  card.make = function () {
    openRegPick({
      reg: 'trim_material',
      title: I18n.t('cadeditor.ui.cards2.choose_trim_material'),
      onPick: function (material) {
        openRegPick({
          reg: 'trim_pattern',
          title: I18n.t('cadeditor.ui.cards2.choose_trim_pattern'),
          onPick: function (pattern) {
            Ctx.enable('trim', { material: material, pattern: pattern }, I18n.t('cadeditor.ui.cards2.add_trim'));
          }
        });
      }
    });
  };
  var v = Ctx.get('trim');
  if (!v) {
    card.el.classList.add('off');
    return card;
  }
  function put(key, x) {
    var o = Ctx.get('trim') || {};
    o[key] = x;
    Ctx.setSmart('trim', o, { label: I18n.t('cadeditor.ui.cards1.armor_trim') });
  }
  var picks = h('div', { class: 'trim-picks' });
  function trimPick(label, reg, key) {
    var art = h('div', { class: 'trim-pick-image' }, [refIcon(reg, v[key] || '', 32)]);
    var select = kRegSelect({
      reg: reg,
      value: v[key] || '',
      title: I18n.t('cadeditor.ui.cards2.select_trim', label),
      empty: I18n.t('cadeditor.ui.banner.selected'),
      onChange: function (x) {
        if (x) {
          put(key, x);
          clear(art);
          art.appendChild(refIcon(reg, x, 32));
        }
      }
    });
    return h('div', { class: 'trim-pick' }, [art, kHint(label), select.el]);
  }
  picks.appendChild(trimPick(I18n.t('cadeditor.ui.cards2.material'), 'trim_material', 'material'));
  picks.appendChild(trimPick(I18n.t('cadeditor.ui.cards2.pattern'), 'trim_pattern', 'pattern'));
  card.body.appendChild(picks);
  return card;
};

CARDS.dye = function () {
  var card = kCard(
    {
      id: 'dye',
      icon: 'palette',
      title: I18n.t('cadeditor.ui.cards1.dye'),
      desc: I18n.t('cadeditor.ui.cards2.colour_leather_type_item_points'),
      comps: ['dyed_color']
    },
    Ctx
  );
  var v = Ctx.get('dyed_color');
  var col = kColor(
    typeof v === 'number'
      ? v
      : Array.isArray(v)
        ? (Math.round(v[0] * 255) << 16) | (Math.round(v[1] * 255) << 8) | Math.round(v[2] * 255)
        : Reg.preview()
          ? 0xa06540
          : null,
    function (c) {
      Ctx.set('dyed_color', c, { label: I18n.t('cadeditor.ui.cards1.dye') });
    }
  );
  card.body.appendChild(col.el);
  card.live.push(function () {
    var x = Ctx.get('dyed_color');
    if (typeof x === 'number') col.set(x);
  });
  return card;
};

CARDS.glider = function () {
  return kCard(
    {
      id: 'glider',
      icon: 'feather',
      title: I18n.t('cadeditor.ui.cards2.gliding'),
      desc: I18n.t('cadeditor.ui.cards2.like_elytra_glide_wear_space'),
      comps: ['glider'],
      bare: true,
      toggle: {
        get: function () {
          return Ctx.has('glider');
        },
        set: function (on) {
          Ctx.setPresence('glider', on, {
            label: on ? I18n.t('cadeditor.ui.cards2.allow_gliding') : I18n.t('cadeditor.ui.cards2.remove_gliding')
          });
        }
      }
    },
    Ctx
  );
};

regEnumTable(
  'equipment_slot',
  EQ_SLOTS,
  function (x) {
    return x.v;
  },
  function (id, n) {
    return {
      v: id,
      label: n,
      sub: '',
      icon: function () {
        return uiIcon('grid', 20);
      }
    };
  }
);
regEnumTable(
  'attribute_operation',
  OPMODES,
  function (x) {
    return x.v;
  },
  function (id, n) {
    return { v: id, label: n, title: id };
  }
);
