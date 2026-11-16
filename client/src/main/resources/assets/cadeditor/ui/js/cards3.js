/* 卡片库 · 第三部分：食物 / 药水 / 效果、容器、书本、烟花 */

/* ---------- 时长 ---------- */
function fmtDur(ticks) {
  if (Number(ticks) === -1) return I18n.t('cadeditor.ui.cards3.infinite');
  var s = ticks / 20,
    m = Math.floor(s / 60),
    r = Math.round(s - m * 60);
  if (s >= 3600) return I18n.t('cadeditor.ui.cards3.hour_minutes', Math.floor(s / 3600), Math.floor((s % 3600) / 60));
  return m + ':' + (r < 10 ? '0' : '') + r;
}
var EFFECT_KIND_COLOR = I18n.keyed({
  'cadeditor.ui.picker.positive': '#7ed957',
  'cadeditor.ui.picker.negative': '#ff6b6b',
  'cadeditor.ui.picker.neutral': '#ffd166'
});
function effectEntries() {
  return Reg.effects().map(function (e) {
    return {
      v: e.full,
      label: e.name,
      sub: (EFFECT_CAT_ZH[e.cat] || e.cat) + (e.desc ? ' · ' + e.desc : ''),
      icon: function () {
        return effectIcon(e.full, 20);
      }
    };
  });
}

/* ---------- 状态效果列表 ----------
   getList() -> 效果数组；setList(arr)。o.mode: 'full'（等级/时长/粒子/图标/环境）或 'stew'（只有 id 与时长）。
   折叠态是游戏里的样子（图标 + 名称 + 等级 + 时长），点开编辑；可拖拽排序、右键菜单。 */
function kEffectList(getList, setList, o) {
  o = o || {};
  var full = o.mode !== 'stew';
  var wrap = h('div', { class: 'k-effects' }),
    list = h('div', { class: 'k-sortlist' }),
    openIdx = -1;
  function draw() {
    clear(list);
    var arr = getList();
    arr.forEach(function (fx, i) {
      var id = shortId(fx.id || ''),
        info = EFIDX[id],
        isOpen = openIdx === i;
      var lvl = (fx.amplifier || 0) + 1,
        dur = fx.duration === undefined ? (full ? 0 : 160) : fx.duration;
      var row = xRow({
        grip: true,
        chevron: true,
        icon: effectIcon(id, 22),
        title: (info ? info.name : id) + (full && lvl > 1 ? ' ' + levelText(lvl) : ''),
        sub: (info ? info.kind : I18n.t('cadeditor.ui.cards3.modded_effects')) + ' · ' + fmtDur(dur),
        onDelete: function () {
          arr.splice(i, 1);
          setList(arr);
          openIdx = -1;
          draw();
        },
        open: isOpen,
        onHead: function () {
          openIdx = isOpen ? -1 : i;
          draw();
        }
      });
      var head = row.firstChild;
      if (isOpen) {
        var body = h('div', { class: 'k-xbody' });
        if (full) {
          var lv = kNumber(lvl, {
            min: 1,
            max: 256,
            warnMax: 256,
            softMax: 10,
            step: 1,
            noSlider: false,
            presets: [
              { v: 1, label: 'I' },
              { v: 2, label: 'II' },
              { v: 3, label: 'III' },
              { v: 5, label: 'V' },
              { v: 10, label: 'X' },
              { v: 256, label: '256' }
            ],
            onChange: function (n) {
              arr[i].amplifier = n - 1;
              setList(arr);
              head.querySelector('.z').textContent = (info ? info.name : id) + (n > 1 ? ' ' + levelText(n) : '');
            }
          });
          body.appendChild(
            fieldRow(I18n.t('cadeditor.ui.cards3.amplifier'), lv.el, I18n.t('cadeditor.ui.cards3.enter_1_i_level'))
          );
        }
        var inf = Number(fx.duration) === -1;
        var secs = kNumber(effectSecondsFromTicks(dur), {
          min: -1,
          softMin: 0,
          max: 1e8,
          softMax: 600,
          step: 1,
          dec: 2,
          unit: I18n.t('cadeditor.ui.cards2.sec'),
          validate: function (n) {
            return n < 0 && n !== -1 ? I18n.t('cadeditor.ui.cards3.negatives_only_support_1_permanent') : '';
          },
          presets: [
            { v: 3, label: I18n.t('cadeditor.ui.cards3.n3_sec') },
            { v: 8, label: I18n.t('cadeditor.ui.cards3.n8_sec') },
            { v: 30, label: I18n.t('cadeditor.ui.cards3.n30_sec') },
            { v: 90, label: '1:30' },
            { v: 180, label: '3:00' },
            { v: 480, label: '8:00' },
            { v: 1800, label: I18n.t('cadeditor.ui.cards3.n30_min') },
            { v: -1, label: I18n.t('cadeditor.ui.cards3.infinite') }
          ],
          onChange: function (n) {
            arr[i].duration = effectTicksFromSeconds(n);
            setList(arr);
            head.querySelector('.s').textContent =
              (info ? info.kind : I18n.t('cadeditor.ui.cards3.modded_effects')) + ' · ' + fmtDur(arr[i].duration);
            if (n === -1) draw();
          }
        });
        var infTg = kToggle(
          inf,
          function (on) {
            arr[i].duration = on ? -1 : 600;
            setList(arr);
            draw();
          },
          I18n.t('cadeditor.ui.cards3.infinite_duration')
        );
        if (!inf)
          body.appendChild(
            fieldRow(
              I18n.t('cadeditor.ui.cards3.duration'),
              secs.el,
              I18n.t('cadeditor.ui.cards3.n1_permanent_20_1_seconds')
            )
          );
        body.appendChild(h('div', { class: 'k-fxlist' }, [infTg.el]));
        if (full) {
          var t1 = kToggle(
            fx.show_particles !== false,
            function (on) {
              arr[i].show_particles = on;
              setList(arr);
            },
            I18n.t('cadeditor.ui.cards3.show_particles')
          );
          var t2 = kToggle(
            fx.show_icon !== false && (fx.show_icon === undefined ? fx.show_particles !== false : fx.show_icon),
            function (on) {
              arr[i].show_icon = on;
              setList(arr);
            },
            I18n.t('cadeditor.ui.cards3.display_effect_icon_corner_screen')
          );
          var t3 = kToggle(
            !!fx.ambient,
            function (on) {
              arr[i].ambient = on;
              setList(arr);
            },
            I18n.t('cadeditor.ui.cards3.ambient_fainter_particles')
          );
          body.appendChild(h('div', { class: 'k-fxlist' }, [t1.el, t2.el, t3.el]));
        }
        row.appendChild(body);
      }
      onContext(row, function () {
        return [
          {
            label: I18n.t('cadeditor.ui.common.copy'),
            icon: 'copy',
            run: function () {
              arr.splice(i + 1, 0, clone(fx));
              setList(arr);
              draw();
            }
          },
          { sep: 1 },
          {
            label: I18n.t('cadeditor.ui.common.delete'),
            icon: 'trash',
            danger: 1,
            run: function () {
              arr.splice(i, 1);
              setList(arr);
              draw();
            }
          }
        ];
      });
      list.appendChild(row);
    });
    if (!arr.length) list.appendChild(xEmpty(o.empty || I18n.t('cadeditor.ui.cards3.effects_yet')));
  }
  kSortable(list, {
    onMove: function (from, to) {
      var arr = getList();
      var x = arr.splice(from, 1)[0];
      arr.splice(to, 0, x);
      setList(arr);
      openIdx = -1;
      draw();
    }
  });
  var add = xAdd(I18n.t('cadeditor.ui.cards3.add_status_effect'));
  activate(add, function () {
    var present = {},
      values = {};
    getList().forEach(function (fx) {
      var id = Reg.full(fx.id);
      present[id] = 1;
      values[id] = {
        level: (fx.amplifier || 0) + 1,
        seconds: fx.duration === undefined ? (full ? 0 : 8) : effectSecondsFromTicks(fx.duration)
      };
    });
    openEffectPicker({
      present: present,
      values: values,
      full: full,
      onConfirm: function (ids, vals, edit) {
        var arr = pickerSyncList(
          getList(),
          ids,
          function (fx) {
            return fx.id;
          },
          function (id) {
            var v = (vals && vals[id]) || {},
              ticks = effectTicksFromSeconds(v.seconds || (full ? 30 : 8));
            return full
              ? { id: id, amplifier: Math.max(0, (v.level || 1) - 1), duration: ticks, show_particles: true }
              : { id: id, duration: ticks };
          },
          function (fx, id) {
            var dirty = (edit && edit.changes[id]) || {},
              v = (vals && vals[id]) || {};
            if (dirty.seconds) fx.duration = effectTicksFromSeconds(v.seconds);
            if (full && dirty.level) fx.amplifier = v.level - 1;
          }
        );
        setList(arr);
        openIdx = arr.length - 1;
        draw();
      }
    });
  });
  wrap.appendChild(h('div', { class: 'k-scrollbox tall' }, [list]));
  wrap.appendChild(add);
  draw();
  return { el: wrap, redraw: draw };
}

/* ---------- 食物 ---------- */
CARDS.food = function () {
  var card = kCard(
    {
      id: 'food',
      icon: itemIcon('cooked_beef', 18),
      title: I18n.t('cadeditor.ui.cards3.food'),
      desc: I18n.t('cadeditor.ui.cards3.how_much_eat_food_level'),
      comps: ['food'],
      value: function () {
        var f = Ctx.get('food');
        return f ? I18n.t('cadeditor.ui.cards3.hunger', bigOrNum(f.nutrition)) : '';
      }
    },
    Ctx
  );
  var v = Ctx.get('food');
  if (!v)
    return enableBox(
      card,
      [I18n.t('cadeditor.ui.cards3.food_values_set'), I18n.t('cadeditor.ui.cards3.use_adjust_use_settings')],
      I18n.t('cadeditor.ui.cards3.enable_food_values'),
      function () {
        Ctx.enable('food', { nutrition: 4, saturation: 2.4 }, I18n.t('cadeditor.ui.cards3.enable_food_values'));
      }
    );
  function put(k, val) {
    var o = Ctx.get('food') || { nutrition: 4, saturation: 2.4 };
    o[k] = val;
    Ctx.setSmart('food', o, { label: I18n.t('cadeditor.ui.cards3.food') });
  }
  var bar = iconBar('k-food');
  var nut = kNumber(v.nutrition, {
    min: 0,
    max: 2147483647,
    softMax: 20,
    step: 1,
    big: true,
    unit: I18n.t('cadeditor.ui.cards2.points'),
    presets: [
      { v: 1, label: '1' },
      { v: 2, label: '2' },
      { v: 5, label: '5' },
      { v: 8, label: '8' },
      { v: 20, label: '20' }
    ].concat(presetsFromItems(['apple', 'bread', 'cooked_beef'], 'food', 'nutrition')),
    onChange: function (n) {
      put('nutrition', n);
    }
  });
  var sat = kNumber(v.saturation, {
    min: -3.4e38,
    max: 3.4e38,
    softMax: 20,
    step: 0.5,
    dec: 2,
    unit: I18n.t('cadeditor.ui.cards2.points'),
    presets: [
      { v: 0, label: '0' },
      { v: 2.4, label: '2.4' },
      { v: 6, label: '6' },
      { v: 12.8, label: '12.8' },
      { v: 20, label: '20' }
    ].concat(presetsFromItems(['apple', 'bread', 'cooked_beef'], 'food', 'saturation')),
    onChange: function (n) {
      put('saturation', n);
    }
  });
  var always = codecToggle(
    codecField(v, 'food', 'can_always_eat', false),
    function (on) {
      put('can_always_eat', on);
    },
    I18n.t('cadeditor.ui.cards3.eat_re_full')
  );
  var eff = kEffect('');
  card.body.appendChild(
    fieldRow(I18n.t('cadeditor.ui.cards3.food_restored'), nut.el, I18n.t('cadeditor.ui.cards3.every_2_o_clock_chicken'))
  );
  card.body.appendChild(bar.el);
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards3.saturation_restored'),
      sat.el,
      I18n.t('cadeditor.ui.cards3.higher_saturation_longer_feeling_being')
    )
  );
  card.body.appendChild(always.el);
  card.body.appendChild(eff.el);
  card.live.push(function () {
    var f = Ctx.get('food');
    if (!f) return;
    nut.set(f.nutrition);
    sat.set(f.saturation);
    always.set(!!f.can_always_eat);
    bar.set(Math.max(0, f.nutrition), 10);
    eff.set(
      I18n.t(
        'cadeditor.ui.cards3.take_bite_hungry_bars_chicken',
        bigOrNum(f.nutrition),
        bigOrNum(f.nutrition / 2),
        bigOrNum(f.saturation),
        f.nutrition >= 20 ? I18n.t('cadeditor.ui.cards3.fills_hunger_one_bite') : ''
      )
    );
  });
  return card;
};

var ANIMS = [
  ['none', I18n.t('cadeditor.ui.common.none'), 'close'],
  ['eat', I18n.t('cadeditor.ui.cards3.eat'), 'apple'],
  ['drink', I18n.t('cadeditor.ui.cards3.drink'), 'potion_round'],
  ['block', I18n.t('cadeditor.ui.cards3.block'), 'shield'],
  ['bow', I18n.t('cadeditor.ui.cards3.bow'), 'bow'],
  ['trident', I18n.t('cadeditor.ui.cards3.throw'), 'trident'],
  ['spear', I18n.t('cadeditor.ui.cards3.spear'), 'spear'],
  ['crossbow', I18n.t('cadeditor.ui.cards3.load'), 'crossbow'],
  ['spyglass', I18n.t('cadeditor.ui.cards3.spyglass'), 'eye'],
  ['toot_horn', I18n.t('cadeditor.ui.cards3.toot_horn'), 'horn'],
  ['brush', I18n.t('cadeditor.ui.cards3.brush'), 'brush'],
  ['bundle', I18n.t('cadeditor.ui.cards3.bundle'), 'bag']
];
var SOUNDS = [
  { v: 'minecraft:entity.generic.eat', label: I18n.t('cadeditor.ui.cards3.eating') },
  { v: 'minecraft:entity.generic.drink', label: I18n.t('cadeditor.ui.cards3.drinking') },
  { v: 'minecraft:item.honey_bottle.drink', label: I18n.t('cadeditor.ui.cards3.drinking_honey') },
  { v: 'minecraft:entity.player.burp', label: I18n.t('cadeditor.ui.cards3.burp') },
  { v: 'minecraft:entity.strider.eat', label: I18n.t('cadeditor.ui.cards3.strider_eating') },
  { v: 'minecraft:entity.fox.eat', label: I18n.t('cadeditor.ui.cards3.fox_eating') }
];
CARDS.consumable = function () {
  var card = kCard(
    {
      id: 'consume',
      icon: itemIcon('golden_apple', 18),
      title: I18n.t('cadeditor.ui.cards3.use_settings'),
      desc: I18n.t('cadeditor.ui.cards3.duration_animation_sound'),
      comps: ['consumable'],
      span: 2
    },
    Ctx
  );
  var v = Ctx.get('consumable');
  if (!v)
    return enableBox(
      card,
      [I18n.t('cadeditor.ui.cards3.use_behavior_set'), I18n.t('cadeditor.ui.cards3.enabled_set_length_use_actions')],
      I18n.t('cadeditor.ui.common.enabled'),
      function () {
        Ctx.enable('consumable', {}, I18n.t('cadeditor.ui.cards3.enable_use_settings'));
      }
    );
  function put(fn, label) {
    var o = Ctx.get('consumable') || {};
    fn(o);
    Ctx.setSmart('consumable', o, { label: label || I18n.t('cadeditor.ui.cards3.use_behavior') });
  }
  var secs = codecNumber(codecField(v, 'consumable', 'consume_seconds', 1.6), {
    min: 0,
    max: 3.4e38,
    softMax: 10,
    step: 0.1,
    dec: 2,
    big: true,
    unit: I18n.t('cadeditor.ui.cards2.sec'),
    presets: [
      { v: 0.8, label: I18n.t('cadeditor.ui.cards3.n0_8_fast_eating') },
      { v: 1.6, label: '1.6' },
      { v: 3.2, label: '3.2' },
      { v: 5, label: '5' },
      { v: 30, label: '30' }
    ],
    onChange: function (n) {
      put(function (o) {
        o.consume_seconds = n;
      }, I18n.t('cadeditor.ui.cards3.consume_duration'));
    }
  });
  function animations() {
    return (
      Reg.options('enum:use_animation') ||
      (Reg.preview()
        ? ANIMS.map(function (a) {
            return {
              v: a[0],
              label: a[1],
              icon: function () {
                return uiIcon(a[2], 20);
              }
            };
          })
        : [])
    );
  }
  var anim = kTiles(
    animations(),
    codecField(v, 'consumable', 'animation', 'eat'),
    function (x) {
      put(function (o) {
        o.animation = x;
      }, I18n.t('cadeditor.ui.cards3.use_animation'));
    },
    { cols: 6 }
  );
  var snd = kSoundField(codecField(v, 'consumable', 'sound', 'minecraft:entity.generic.eat') || '', function (x) {
    put(function (o) {
      o.sound = x;
    }, I18n.t('cadeditor.ui.cards3.use_sound'));
  });
  var part = codecToggle(
    codecField(v, 'consumable', 'has_consume_particles', true),
    function (on) {
      put(function (o) {
        o.has_consume_particles = on;
      });
    },
    I18n.t('cadeditor.ui.cards3.show_particles_consuming')
  );
  card.body.appendChild(fieldRow(I18n.t('cadeditor.ui.cards3.hold_duration'), secs.el));
  card.body.appendChild(fieldRow(I18n.t('cadeditor.ui.cards3.animation'), anim.el));
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards3.custom_animation'),
      combo({
        options: animations,
        value: v.animation || '',
        free: true,
        onPick: function (x) {
          put(function (o) {
            o.animation = x;
          });
        }
      })
    )
  );
  card.body.appendChild(fieldRow(I18n.t('cadeditor.ui.cards3.sound'), snd.el));
  card.body.appendChild(part.el);
  card.live.push(function () {
    var o = Ctx.get('consumable');
    if (o) {
      secs.set(codecField(o, 'consumable', 'consume_seconds', 1.6));
      anim.set(codecField(o, 'consumable', 'animation', 'eat'));
      part.set(codecField(o, 'consumable', 'has_consume_particles', true) === true);
    }
  });
  return card;
};

/* ---------- 使用结束后的效果 ---------- */
var CE_TYPES = [
  {
    v: 'minecraft:apply_effects',
    label: I18n.t('cadeditor.ui.cards3.apply_status_effects'),
    sub: I18n.t('cadeditor.ui.cards3.like_regenerative_absorbing_golden')
  },
  {
    v: 'minecraft:remove_effects',
    label: I18n.t('cadeditor.ui.cards3.remove_selected_effects'),
    sub: I18n.t('cadeditor.ui.cards3.example_milk_removal_some_effect')
  },
  {
    v: 'minecraft:clear_all_effects',
    label: I18n.t('cadeditor.ui.cards3.clear_all_effects'),
    sub: I18n.t('cadeditor.ui.cards3.milk')
  },
  {
    v: 'minecraft:teleport_randomly',
    label: I18n.t('cadeditor.ui.cards3.random_teleport'),
    sub: I18n.t('cadeditor.ui.cards3.chorus_fruit')
  },
  { v: 'minecraft:play_sound', label: I18n.t('cadeditor.ui.cards3.play_sound'), sub: '' }
];
function ceLabel(t) {
  for (var i = 0; i < CE_TYPES.length; i++) if (CE_TYPES[i].v === t) return CE_TYPES[i].label;
  return t;
}
function ceSummary(e) {
  if (e.type === 'minecraft:apply_effects') {
    var n = (e.effects || []).map(function (x) {
      var i = EFIDX[shortId(x.id || '')];
      return (i ? i.name : shortId(x.id || '?')) + (x.amplifier ? ' ' + levelText(x.amplifier + 1) : '');
    });
    return (
      n.join('、') +
      (e.probability !== undefined && e.probability < 1
        ? I18n.t('cadeditor.ui.cards3.probability', Math.round(e.probability * 100))
        : '')
    );
  }
  if (e.type === 'minecraft:teleport_randomly')
    return e.diameter === undefined
      ? I18n.t('cadeditor.ui.cards3.use_default_range_current_game')
      : I18n.t('cadeditor.ui.cards3.radius_approximately_grid', fmtNum(e.diameter / 2));
  if (e.type === 'minecraft:remove_effects') {
    var r = e.effects;
    var l = Array.isArray(r) ? r : [r];
    return l
      .map(function (x) {
        var i = EFIDX[shortId(typeof x === 'string' ? x : '')];
        return i ? i.name : String(x);
      })
      .join('、');
  }
  if (e.type === 'minecraft:play_sound')
    return typeof e.sound === 'string' ? e.sound : I18n.t('cadeditor.ui.cards3.custom_sound');
  return '';
}
function kConsumeEffects(getList, setList, cid) {
  cid = cid || 'consumable';
  var prefix = cid === 'death_protection' ? 'death_effects[]' : 'on_consume_effects[]';
  var wrap = h('div', { class: 'k-effects' }),
    list = h('div', { class: 'k-sortlist' }),
    openIdx = -1;
  function draw() {
    clear(list);
    var arr = getList();
    arr.forEach(function (e, i) {
      var isOpen = openIdx === i;
      var row = xRow({
        grip: true,
        chevron: true,
        icon: false,
        title: ceLabel(e.type),
        sub: ceSummary(e),
        onDelete: function () {
          arr.splice(i, 1);
          setList(arr);
          openIdx = -1;
          draw();
        },
        open: isOpen,
        onHead: function () {
          openIdx = isOpen ? -1 : i;
          draw();
        }
      });
      // Nested effect edits refresh this existing parent, not a stale/global head.
      // An empty result initially has no subtitle node, so create it on first edit.
      var head = row.firstChild;
      function summary() {
        var sub = head.querySelector('.s');
        if (!sub) {
          sub = h('div', { class: 's' });
          head.querySelector('.tx').appendChild(sub);
        }
        sub.textContent = ceSummary(arr[i]);
      }
      if (isOpen) {
        var body = h('div', { class: 'k-xbody' });
        if (e.type === 'minecraft:apply_effects') {
          var probability = codecField(e, cid, 'probability', 1);
          if (e.probability === undefined) probability = Reg.codecDefault(cid, prefix + '.probability', 1);
          var prob = codecNumber(probability === undefined ? undefined : Math.round(probability * 100), {
            min: 0,
            max: 100,
            softMax: 100,
            step: 5,
            unit: '%',
            presets: [
              { v: 100, label: I18n.t('cadeditor.ui.cards3.always') },
              { v: 50, label: '50%' },
              { v: 10, label: '10%' }
            ],
            onChange: function (n) {
              arr[i].probability = n / 100;
              setList(arr);
              summary();
            }
          });
          var fx = kEffectList(
            function () {
              return arr[i].effects || (arr[i].effects = []);
            },
            function (l) {
              arr[i].effects = l;
              setList(arr);
              summary();
            },
            { empty: I18n.t('cadeditor.ui.cards3.effects_yet_add_one_below') }
          );
          body.appendChild(fieldRow(I18n.t('cadeditor.ui.cards3.trigger_chance'), prob.el));
          body.appendChild(fieldRow(I18n.t('cadeditor.ui.cards3.effects_add'), fx.el));
        } else if (e.type === 'minecraft:teleport_randomly') {
          var dia = codecNumber(
            e.diameter !== undefined ? e.diameter : Reg.codecDefault(cid, prefix + '.diameter', 16),
            {
              min: 0,
              max: 3.4e38,
              warnMax: 1000,
              warnWhy: I18n.t('cadeditor.ui.cards3.very_large_range_may_fail'),
              softMax: 64,
              step: 1,
              unit: I18n.t('cadeditor.ui.cards2.blocks'),
              presets: [
                { v: 16, label: '16' },
                { v: 32, label: '32' },
                { v: 128, label: '128' }
              ],
              onChange: function (n) {
                arr[i].diameter = n;
                setList(arr);
                summary();
              }
            }
          );
          body.appendChild(
            fieldRow(
              I18n.t('cadeditor.ui.cards3.teleport_diameter'),
              dia.el,
              I18n.t('cadeditor.ui.cards3.centered_current_position')
            )
          );
        } else if (e.type === 'minecraft:remove_effects') {
          var ids = Array.isArray(e.effects) ? e.effects.slice() : e.effects ? [e.effects] : [];
          var chips = h('div', { class: 'k-chips' });
          (function paint() {
            clear(chips);
            ids.forEach(function (id, k) {
              var rn = Reg.nameOf('mob_effects', id) || (EFIDX[shortId(id)] || {}).name;
              var c = h('div', { class: 'k-chip on' }, [effectIcon(id, 16), rn || id]);
              var x = h('span', { class: 'x', text: ' ×' });
              x.addEventListener('click', function (ev) {
                ev.stopPropagation();
                ids.splice(k, 1);
                arr[i].effects = ids.slice();
                setList(arr);
                paint();
                summary();
              });
              c.appendChild(x);
              chips.appendChild(c);
            });
            var add = h('div', { class: 'k-chip' }, [uiIcon('plus', 12), I18n.t('cadeditor.ui.cards3.add')]);
            activate(add, function () {
              var pres = {};
              ids.forEach(function (x) {
                pres[Reg.full(x)] = 1;
              });
              openEffectPicker({
                present: pres,
                noParams: true,
                onConfirm: function (nids) {
                  ids = nids.slice();
                  arr[i].effects = ids.slice();
                  setList(arr);
                  paint();
                  summary();
                }
              });
            });
            chips.appendChild(add);
          })();
          body.appendChild(fieldRow(I18n.t('cadeditor.ui.cards3.effects_remove'), chips));
        } else if (e.type === 'minecraft:play_sound') {
          body.appendChild(
            fieldRow(
              I18n.t('cadeditor.ui.cards3.sound_2'),
              kSoundField(typeof e.sound === 'string' ? e.sound : '', function (t) {
                arr[i].sound = t;
                setList(arr);
              }).el
            )
          );
        } else body.appendChild(kHint(I18n.t('cadeditor.ui.cards3.extra_setting_item')));
        row.appendChild(body);
      }
      list.appendChild(row);
    });
    if (!arr.length) list.appendChild(xEmpty(I18n.t('cadeditor.ui.cards3.nothing_happens_end_use')));
  }
  kSortable(list, {
    onMove: function (from, to) {
      var arr = getList();
      var x = arr.splice(from, 1)[0];
      arr.splice(to, 0, x);
      setList(arr);
      openIdx = -1;
      draw();
    }
  });
  var add = xAdd(I18n.t('cadeditor.ui.cards3.add_outcome'));
  activate(add, function () {
    pickFrom(
      add,
      Reg.options('enum:consume_effect_type') || (Reg.preview() ? CE_TYPES : []),
      function (en) {
        var arr = getList(),
          e = { type: en.v };
        if (en.v === 'minecraft:apply_effects') {
          e.effects = [];
        } else if (en.v === 'minecraft:remove_effects') e.effects = [];
        else if (en.v === 'minecraft:play_sound') e.sound = '';
        arr.push(e);
        setList(arr);
        openIdx = arr.length - 1;
        draw();
      },
      {
        width: 280,
        manual: {
          label: I18n.t('cadeditor.ui.cards3.manual_input_effect_type_id'),
          parse: function (s) {
            return Reg.full(s);
          }
        }
      }
    );
  });
  wrap.appendChild(h('div', { class: 'k-scrollbox tall' }, [list]));
  wrap.appendChild(add);
  draw();
  return { el: wrap, redraw: draw };
}
CARDS.consumeEffects = function () {
  var card = kCard(
    {
      id: 'consumefx',
      icon: 'flask',
      title: I18n.t('cadeditor.ui.cards3.effects_after_use'),
      desc: I18n.t('cadeditor.ui.cards3.triggered_use_finishes'),
      comps: ['consumable'],
      span: 2,
      toggle: false
    },
    Ctx
  );
  var v = Ctx.get('consumable');
  if (!v) {
    card.el.classList.add('off');
    card.el.querySelector('.k-cdesc').textContent = I18n.t('cadeditor.ui.cards3.use_settings_enabled_first');
    return card;
  }
  var ce = kConsumeEffects(
    function () {
      var o = Ctx.get('consumable') || {};
      return (o.on_consume_effects || []).slice();
    },
    function (l) {
      var o = Ctx.get('consumable') || {};
      o.on_consume_effects = l;
      Ctx.setSmart('consumable', o, { label: I18n.t('cadeditor.ui.cards3.use_effects') });
    }
  );
  card.body.appendChild(ce.el);
  return card;
};

CARDS.remainder = function () {
  var card = kCard(
    {
      id: 'remainder',
      icon: 'bucket',
      title: I18n.t('cadeditor.ui.cards3.use_remainder'),
      desc: I18n.t('cadeditor.ui.cards3.after_ve_finished_what_left'),
      comps: ['use_remainder']
    },
    Ctx
  );
  var v = Ctx.get('use_remainder'),
    holder = h('div', { class: 'k-row wrap' });
  function put(o) {
    Ctx.setSmart('use_remainder', o, { label: I18n.t('cadeditor.ui.cards3.use_remainder_2') });
  }
  function draw() {
    clear(holder);
    var cur = Ctx.get('use_remainder');
    var btn = h(
      'div',
      { class: 'k-btn' },
      cur
        ? [itemIcon(cur.id, 20), h('span', { text: nameOfItem(cur.id) }), uiIcon('down', 10)]
        : [uiIcon('plus', 12), h('span', { text: I18n.t('cadeditor.ui.cards3.choose_remainder_item') })]
    );
    activate(btn, function () {
      pickItem(
        btn,
        function (id) {
          var o = Ctx.get('use_remainder') || { count: 1 };
          o.id = fullId(id);
          if (!o.count) o.count = 1;
          put(o);
          draw();
        },
        {
          onStack: function (st) {
            NBT_FORCE.use_remainder = true;
            put(vaultNested(st));
            draw();
          }
        }
      );
    });
    holder.appendChild(btn);
    if (cur) {
      var cnt = kNumber(cur.count || 1, {
        min: 1,
        max: 99,
        noSlider: true,
        step: 1,
        unit: I18n.t('cadeditor.ui.cards3.items'),
        onChange: function (n) {
          var o = Ctx.get('use_remainder');
          o.count = n;
          put(o);
        }
      });
      holder.appendChild(cnt.el);
      holder.appendChild(
        kBtn(
          I18n.t('cadeditor.ui.cards3.remainder'),
          function () {
            Ctx.disable('use_remainder', { structural: false });
            draw();
          },
          { cls: 'dng' }
        )
      );
    }
  }
  draw();
  card.body.appendChild(holder);
  return card;
};

/* ---------- 药水 ---------- */
var POTION_IDS = [
  'water',
  'mundane',
  'thick',
  'awkward',
  'night_vision',
  'invisibility',
  'leaping',
  'fire_resistance',
  'swiftness',
  'slowness',
  'turtle_master',
  'water_breathing',
  'healing',
  'harming',
  'poison',
  'regeneration',
  'strength',
  'weakness',
  'luck',
  'slow_falling',
  'wind_charged',
  'weaving',
  'oozing',
  'infested'
];
var POTION_VARIANTS = {
  night_vision: 1,
  invisibility: 1,
  leaping: 2,
  fire_resistance: 1,
  swiftness: 2,
  slowness: 2,
  turtle_master: 2,
  water_breathing: 1,
  healing: 3,
  harming: 3,
  poison: 2,
  regeneration: 2,
  strength: 2,
  weakness: 1,
  slow_falling: 1
};
function potionEntries() {
  var out = [];
  POTION_IDS.forEach(function (p) {
    var name = EDATA.L.potion[p] || p;
    out.push({ v: p, label: name, sub: 'minecraft:' + p });
    var vr = POTION_VARIANTS[p] || 0;
    if (vr === 1 || vr === 2)
      out.push({ v: 'long_' + p, label: I18n.t('cadeditor.ui.cards3.extension', name), sub: 'minecraft:long_' + p });
    if (vr === 2 || vr === 3) out.push({ v: 'strong_' + p, label: name + '（II）', sub: 'minecraft:strong_' + p });
  });
  return out;
}
function potionName(id) {
  var rn = Reg.nameOf2 && Reg.nameOf2('potion', id);
  if (rn) return rn;
  id = shortId(id || '');
  var m = /^(long|strong)_(.+)$/.exec(id);
  var base = m ? m[2] : id;
  var n = EDATA.L.potion[base] || id;
  return n + (m ? (m[1] === 'long' ? I18n.t('cadeditor.ui.cards3.extended') : '（II）') : '');
}
function potionObj() {
  var v = Ctx.get('potion_contents');
  if (v === undefined) return { custom_effects: [] };
  if (typeof v === 'string') return { potion: v, custom_effects: [] };
  return v;
}
CARDS.potion = function () {
  var card = kCard(
    {
      id: 'potion',
      icon: itemIcon('potion', 18),
      title: I18n.t('cadeditor.ui.cards3.potion'),
      desc: I18n.t('cadeditor.ui.cards3.basic_potion_class_superimpose_custom'),
      comps: ['potion_contents'],
      span: 2
    },
    Ctx
  );
  var v = potionObj();
  function put(fn) {
    var o = potionObj();
    fn(o);
    if (
      !o.potion &&
      (!o.custom_effects || !o.custom_effects.length) &&
      o.custom_color === undefined &&
      !o.custom_name
    ) {
      Ctx.disable('potion_contents', { structural: false });
      return;
    }
    var out = {};
    if (o.potion) out.potion = o.potion;
    if (o.custom_color !== undefined) out.custom_color = o.custom_color;
    if (o.custom_effects && o.custom_effects.length) out.custom_effects = o.custom_effects;
    if (o.custom_name) out.custom_name = o.custom_name;
    Ctx.setSmart('potion_contents', out, { label: I18n.t('cadeditor.ui.cards3.potion') });
  }
  var entries = potionEntries();
  var psel = kRegSelect({
    reg: 'potion',
    value: v.potion ? Reg.full(v.potion) : '',
    title: I18n.t('cadeditor.ui.cards3.choose_base_potion'),
    empty: I18n.t('cadeditor.ui.cards3.foundation_potion_only_custom_effects'),
    allowClear: true,
    fallback: entries.map(function (e) {
      return { v: 'minecraft:' + e.v, label: e.label, sub: e.sub };
    }),
    icon: function (e) {
      return itemIcon('potion', 16);
    },
    onChange: function (x) {
      put(function (o) {
        if (x) o.potion = x;
        else delete o.potion;
      });
    }
  });
  card.body.appendChild(fieldRow(I18n.t('cadeditor.ui.cards3.base_potion'), psel.el));
  var col = kColor(
    typeof v.custom_color === 'number' ? v.custom_color : null,
    function (c) {
      put(function (o) {
        if (c === null) delete o.custom_color;
        else o.custom_color = c;
      });
    },
    { allowNone: true }
  );
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards3.potion_color'),
      col.el,
      I18n.t('cadeditor.ui.cards3.selected_press_potion_effect')
    )
  );
  var fx = kEffectList(
    function () {
      return potionObj().custom_effects || [];
    },
    function (l) {
      put(function (o) {
        o.custom_effects = l;
      });
    },
    { empty: I18n.t('cadeditor.ui.cards3.custom_effects') }
  );
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards3.custom_effects_2'),
      fx.el,
      I18n.t('cadeditor.ui.cards3.added_base_potion_effects')
    )
  );
  card.live.push(function () {
    var o = potionObj();
    psel.set(o.potion ? Reg.full(o.potion) : '');
  });
  return card;
};

CARDS.stew = function () {
  var card = kCard(
    {
      id: 'stew',
      icon: itemIcon('suspicious_stew', 18),
      title: I18n.t('cadeditor.ui.cards3.suspicious_stew_effects'),
      desc: I18n.t('cadeditor.ui.cards3.effect_eating_stew'),
      comps: ['suspicious_stew_effects'],
      span: 2
    },
    Ctx
  );
  var fx = kEffectList(
    function () {
      return Ctx.get('suspicious_stew_effects') || [];
    },
    function (l) {
      Ctx.setSmart('suspicious_stew_effects', l, { label: I18n.t('cadeditor.ui.cards3.stew_effects') });
    },
    { mode: 'stew', empty: I18n.t('cadeditor.ui.cards3.effects') }
  );
  card.body.appendChild(fx.el);
  return card;
};

CARDS.deathProtection = function () {
  var card = kCard(
    {
      id: 'totem',
      icon: itemIcon('totem_of_undying', 18),
      title: I18n.t('cadeditor.ui.cards3.death_protection'),
      desc: I18n.t('cadeditor.ui.cards3.damage_counterbalanced_triggers_effects'),
      comps: ['death_protection'],
      span: 2
    },
    Ctx
  );
  var v = Ctx.get('death_protection');
  if (!v)
    return enableBox(
      card,
      [
        I18n.t('cadeditor.ui.cards3.death_protection_2'),
        I18n.t('cadeditor.ui.cards3.enabled_fatal_damage_comes_temporarily')
      ],
      I18n.t('cadeditor.ui.cards3.make_totem'),
      function () {
        var effects = Ctx.protoItem('minecraft:totem_of_undying', 'death_protection');
        if (effects === undefined) {
          toast(I18n.t('cadeditor.ui.cards3.reads_actual_death_protection_effect'), 'warn');
          return;
        }
        Ctx.enable('death_protection', effects, I18n.t('cadeditor.ui.cards3.make_totem'));
      }
    );
  var ce = kConsumeEffects(
    function () {
      var o = Ctx.get('death_protection') || {};
      return (o.death_effects || []).slice();
    },
    function (l) {
      var o = Ctx.get('death_protection') || {};
      o.death_effects = l;
      Ctx.setSmart('death_protection', o, { label: I18n.t('cadeditor.ui.cards3.death_protection') });
    },
    'death_protection'
  );
  card.body.appendChild(fieldRow(I18n.t('cadeditor.ui.cards3.effects_after_revival'), ce.el));
  card.body.appendChild(
    kBtn(
      I18n.t('cadeditor.ui.cards3.remove_death_protection'),
      function () {
        Ctx.disable('death_protection');
      },
      { cls: 'dng', icon: 'trash' }
    )
  );
  return card;
};

/* ==================== 容器 ==================== */
var SLOT_COUNT = {
  chest: 27,
  trapped_chest: 27,
  barrel: 27,
  dispenser: 9,
  dropper: 9,
  crafter: 9,
  hopper: 5,
  furnace: 3,
  blast_furnace: 3,
  smoker: 3,
  brewing_stand: 5,
  chiseled_bookshelf: 6,
  decorated_pot: 1,
  campfire: 4,
  soul_campfire: 4
};
/* 容器格数：优先用游戏里真实的 Container 大小（item_meta.container_size）；仅浏览器样例预览使用内置表 */
function slotCountFor(id) {
  var m = Reg.live() ? Reg.itemMeta(id) : false;
  if (m && typeof m.container_size === 'number') return m.container_size;
  if (!Reg.preview()) return null;
  id = shortId(id);
  if (SLOT_COUNT[id] !== undefined) return SLOT_COUNT[id];
  if (/shelf$/.test(id)) return 3;
  return 27;
}
/* 收纳袋总容量：游戏里的归一化分数（item_meta.bundle_capacity），默认 1 */
function bundleCapacity() {
  var m = Reg.live() ? Reg.itemMeta(Ctx.doc().id) : false;
  return m && m.bundle_capacity && m.bundle_capacity.denominator
    ? m.bundle_capacity.numerator / m.bundle_capacity.denominator
    : Reg.preview()
      ? 1
      : null;
}
function stackWeight(st) {
  var ms = protoOf(st.id).max_stack_size;
  if (typeof ms !== 'number') return Reg.preview() ? (st.count || 1) / 64 : null;
  return (st.count || 1) / ms;
}
/* Native nested ItemStack -> editor wire, preserving per-value NBT references, removals and extension fields. */
function nestedItemWire(item) {
  var wire = { id: item.id, count: item.count || 1, comps: {}, removed: {}, component_snbt: {} };
  Object.keys(item.components || {}).forEach(function (key) {
    if (key.charAt(0) === '!') {
      nbtOwn(wire.removed, shortId(key.slice(1)), 1);
      return;
    }
    var cid = shortId(key),
      value = nbtTake(item.components, key);
    nbtOwn(wire.comps, cid, clone(value));
    nbtOwn(wire.component_snbt, cid, nbtMerge(value, null));
  });
  return wire;
}
function editNestedStack(item, title, commit, refresh) {
  if (!item || !item.id) return;
  var valid = nestedDraftGuard(),
    original = clone(item);
  openNestedItem(nestedItemWire(item), {
    title: title,
    valid: valid,
    commit: function (wire) {
      var packed = vaultNested(wire),
        next = clone(original);
      next.id = packed.id;
      next.count = packed.count;
      if (packed.components) next.components = packed.components;
      else delete next.components;
      commit(next);
    },
    render: function () {
      if (refresh) refresh();
      if (!weActive() && Store.doc()) {
        drawHero();
        drawTopbar();
        drawFooter();
        if (!NestedItem && typeof Drafts !== 'undefined') Drafts.touch();
      }
    }
  });
}
CARDS.container = function () {
  var n = slotCountFor(Ctx.doc().id);
  var card = kCard(
    {
      id: 'container',
      icon: 'chest',
      title: I18n.t('cadeditor.ui.cards3.items_inside'),
      desc: I18n.t('cadeditor.ui.cards3.click_grid_put_modify_item'),
      comps: ['container'],
      span: 2,
      value: function () {
        var l = Ctx.get('container');
        return l && l.length ? I18n.t('cadeditor.ui.cards3.item', l.length) : '';
      }
    },
    Ctx
  );
  function list() {
    return Ctx.get('container') || [];
  }
  var knownSize = n !== null;
  n = Math.max(
    n || 0,
    list().reduce(function (max, e) {
      return Number.isInteger(e.slot) && e.slot >= 0 && e.slot < 256 ? Math.max(max, e.slot + 1) : max;
    }, 0)
  );
  function save(l) {
    l.sort(function (a, b) {
      return a.slot - b.slot;
    });
    if (!l.length) Ctx.disable('container', { structural: false });
    else Ctx.setSmart('container', l, { label: I18n.t('cadeditor.ui.cards3.container_contents') });
  }
  function stackAt(i) {
    var l = list(),
      r = null;
    l.forEach(function (e) {
      if (e.slot === i) r = e;
    });
    return r;
  }
  /* 物品页存的是嵌套格式 {slot, item:{id,count,components}}；格子只认视图，这里做适配 */
  function viewOf(i) {
    var e = stackAt(i);
    return e ? { id: e.item.id, count: e.item.count, marked: !!e.item.components, _item: e.item } : null;
  }
  var grid;
  function edit(cell, i) {
    kStackPop(cell, viewOf(i), {
      closeOnPick: false,
      editLabel: I18n.t('cadeditor.ui.cards3.edit_item'),
      onEdit: stackAt(i)
        ? function () {
            editNestedStack(
              stackAt(i).item,
              I18n.t('cadeditor.ui.cards3.container', i + 1),
              function (next) {
                var l = list();
                l.forEach(function (x) {
                  if (x.slot === i) x.item = next;
                });
                save(l);
              },
              function () {
                grid.repaint();
              }
            );
          }
        : null,
      onPick: function (id) {
        var l = list(),
          e = stackAt(i);
        if (e) {
          e.item.id = fullId(id);
          l = l.map(function (x) {
            return x.slot === i ? e : x;
          });
        } else l.push({ slot: i, item: { id: fullId(id), count: 1 } });
        save(l);
        grid.repaint();
      },
      onStack: function (st) {
        var l = list(),
          item = vaultNested(st);
        NBT_FORCE.container = true;
        if (stackAt(i))
          l = l.map(function (x) {
            return x.slot === i ? { slot: i, item: item } : x;
          });
        else l.push({ slot: i, item: item });
        save(l);
        grid.repaint();
      },
      onCount: function (v) {
        var l = list();
        l.forEach(function (x) {
          if (x.slot === i) x.item.count = v;
        });
        save(l);
        grid.repaint();
      },
      onClear: function () {
        save(
          list().filter(function (x) {
            return x.slot !== i;
          })
        );
        grid.repaint();
      }
    });
  }
  var ix = [];
  for (var k0 = 0; k0 < n; k0++) ix.push(k0);
  grid = kSlotGrid({
    indices: ix,
    cols: slotCols(n),
    col: 34,
    bare: true,
    plain: true,
    noSuffix: true,
    markTitle: I18n.t('cadeditor.ui.cards3.item_own_component_data'),
    stackOf: viewOf,
    titleOf: function (i) {
      return I18n.t('cadeditor.ui.cards3.spaces', i + 1);
    },
    edit: edit,
    redraw: function () {
      grid.repaint();
    },
    menu: function (i, cell) {
      var e = stackAt(i);
      return [
        {
          label: I18n.t('cadeditor.ui.cards3.edit'),
          icon: 'edit',
          run: function () {
            edit(cell, i);
          }
        },
        {
          label: I18n.t('cadeditor.ui.cards3.copy_next_empty_slot'),
          icon: 'copy',
          dis: !e,
          run: function () {
            var l = list();
            for (var k = 0; k < n; k++) {
              if (!stackAt(k)) {
                l.push({ slot: k, item: clone(e.item) });
                break;
              }
            }
            save(l);
            grid.repaint();
          }
        },
        { sep: 1 },
        {
          label: I18n.t('cadeditor.ui.common.clear'),
          icon: 'trash',
          danger: 1,
          dis: !e,
          run: function () {
            save(
              list().filter(function (x) {
                return x.slot !== i;
              })
            );
            grid.repaint();
          }
        }
      ];
    },
    ref: function (i) {
      return {
        group: card,
        i: i,
        get: function () {
          return viewOf(i);
        },
        set: function (st) {
          var l = list().filter(function (x) {
            return x.slot !== i;
          });
          if (st && st.id && !st.empty)
            l.push({ slot: i, item: st._item ? clone(st._item) : { id: st.id, count: st.count || 1 } });
          save(l);
        },
        swap: function (o) {
          var j = o.i,
            l = list();
          l.forEach(function (x) {
            if (x.slot === i) x.slot = j;
            else if (x.slot === j) x.slot = i;
          });
          save(l);
        }
      };
    }
  });
  card.live.push(function () {
    grid.repaint();
  });

  card.body.appendChild(grid);
  if (!knownSize) {
    card.body.appendChild(kHint(I18n.t('cadeditor.ui.cards3.container_grid_number_read_item')));
    var manualSlot = 0,
      slotInput = kNumber(0, {
        min: 0,
        max: 255,
        step: 1,
        noSlider: true,
        onChange: function (v) {
          manualSlot = v;
        }
      });
    var manualEdit = kBtn(I18n.t('cadeditor.ui.cards3.edit_selected_slot'), function () {
      edit(manualEdit, manualSlot);
    });
    card.body.appendChild(h('div', { class: 'k-row' }, [slotInput.el, manualEdit]));
  }
  card.body.appendChild(
    kBtn(
      I18n.t('cadeditor.ui.cards3.clear_all'),
      function () {
        Ctx.disable('container', { structural: false });
        grid.repaint();
      },
      { cls: 'dng', icon: 'trash' }
    )
  );
  return card;
};

CARDS.bundle = function () {
  var initialCapacity = bundleCapacity();
  var card = kCard(
    {
      id: 'bundle',
      icon: 'bag',
      title: I18n.t('cadeditor.ui.cards3.bundle_contents'),
      desc:
        initialCapacity === null
          ? I18n.t('cadeditor.ui.cards3.what_s_bag_capacity_being')
          : I18n.t('cadeditor.ui.cards3.something_bag_total_weight_cannot', fmtNum(initialCapacity)),
      comps: ['bundle_contents'],
      span: 2
    },
    Ctx
  );
  var row = h('div', { class: 'k-cgrid' }),
    bar = h('div', { class: 'k-meter' }, [h('i', {})]),
    eff = kEffect('');
  function list() {
    return Ctx.get('bundle_contents') || [];
  }
  function save(l) {
    if (!l.length) Ctx.disable('bundle_contents', { structural: false });
    else Ctx.setSmart('bundle_contents', l, { label: I18n.t('cadeditor.ui.cards3.bundle_contents') });
  }
  function viewOf(i) {
    var st = list()[i];
    return st ? { id: st.id, count: st.count, marked: false, _st: st } : null;
  }
  function draw() {
    var len = list().length,
      ix = [];
    for (var k = 0; k < len; k++) ix.push(k);
    var g = kSlotGrid({
      indices: ix,
      bare: true,
      plain: true,
      noSuffix: true,
      stackOf: viewOf,
      redraw: draw,
      edit: function (cell, i) {
        var st = list()[i];
        kStackPop(cell, viewOf(i), {
          pick: false,
          plain: true,
          editLabel: I18n.t('cadeditor.ui.cards3.edit_item'),
          width: 230,
          maxHeight: null,
          countLabel: I18n.t('cadeditor.ui.cards3.count', nameOfItem(st.id)),
          clearLabel: I18n.t('cadeditor.ui.cards3.take_out'),
          onEdit: function () {
            editNestedStack(
              list()[i],
              I18n.t('cadeditor.ui.cards3.bundle_2', i + 1),
              function (next) {
                var l = list();
                l[i] = next;
                save(l);
              },
              draw
            );
          },
          onCount: function (v) {
            var l = list();
            l[i].count = v;
            save(l);
            draw();
          },
          onClear: function () {
            var l = list();
            l.splice(i, 1);
            save(l);
            draw();
          }
        });
      },
      ref: function (i) {
        return {
          group: card,
          i: i,
          get: function () {
            return viewOf(i);
          },
          set: function (st) {
            var l = list();
            if (!st || st.empty || !st.id) l.splice(i, 1);
            else l[i] = st._st ? clone(st._st) : { id: st.id, count: st.count || 1 };
            save(l);
          },
          swap: function (o) {
            var l = list(),
              t = l[i];
            l[i] = l[o.i];
            l[o.i] = t;
            save(l);
          }
        };
      }
    });
    clear(row);
    while (g.firstChild) row.appendChild(g.firstChild);
    var add = h('div', { class: 'slot s34 addslot', title: I18n.t('cadeditor.ui.cards3.add_item') }, [
      uiIcon('plus', 14)
    ]);
    activate(add, function () {
      pickItem(
        add,
        function (id) {
          var l = list();
          l.push({ id: fullId(id), count: 1 });
          save(l);
          draw();
        },
        {
          onStack: function (st) {
            var l = list();
            l.push(vaultNested(st));
            NBT_FORCE.bundle_contents = true;
            save(l);
            draw();
          }
        }
      );
    });
    row.appendChild(add);
    var cap = bundleCapacity(),
      weights = list().map(stackWeight);
    if (
      cap === null ||
      weights.some(function (w) {
        return w === null;
      })
    ) {
      bar.firstChild.style.width = '0%';
      eff.set(I18n.t('cadeditor.ui.cards3.reading_capacity_item_stack_ceiling'), '');
      return;
    }
    var w =
      weights.reduce(function (s, weight) {
        return s + weight;
      }, 0) / cap;
    bar.firstChild.style.width = Math.min(100, w * 100) + '%';
    bar.className = 'k-meter' + (w > 1 ? ' bad' : w > 0.85 ? ' warn' : '');
    eff.set(
      I18n.t(
        'cadeditor.ui.cards3.text',
        Math.round(w * 100),
        w > 1 ? I18n.t('cadeditor.ui.cards3.more_100_game_may_able') : ''
      ),
      w > 1 ? 'warn' : ''
    );
  }
  draw();
  card.live.push(draw);
  card.body.appendChild(row);
  card.body.appendChild(bar);
  card.body.appendChild(eff.el);
  return card;
};

/* ==================== 书 ==================== */
CARDS.writtenBook = function () {
  var cid = 'written_book_content';
  var card = kCard(
    {
      id: 'wbook',
      icon: 'book_open',
      title: I18n.t('cadeditor.ui.cards3.written_book'),
      desc: I18n.t('cadeditor.ui.cards3.title_author_text_each_page'),
      comps: [cid],
      span: 2,
      value: function () {
        var v = Ctx.get(cid);
        return v && Array.isArray(v.pages) ? I18n.t('cadeditor.ui.cards3.page', v.pages.length) : '';
      }
    },
    Ctx
  );
  var v = Ctx.get(cid);
  if (!v)
    return enableBox(
      card,
      [I18n.t('cadeditor.ui.cards3.book_empty'), I18n.t('cadeditor.ui.cards3.enables_write_title_content')],
      I18n.t('cadeditor.ui.cards3.start_writing'),
      function () {
        Ctx.enable(
          cid,
          {
            title: I18n.t('cadeditor.ui.cards3.new_book'),
            author: I18n.t('cadeditor.ui.cards3.me'),
            generation: 0,
            pages: [I18n.t('cadeditor.ui.cards3.first_page')]
          },
          I18n.t('cadeditor.ui.cards3.start_writing_2')
        );
      }
    );
  function put(fn, label) {
    var o = clone(Ctx.get(cid) || { pages: [] });
    fn(o);
    Ctx.setSmart(cid, o, { label: label || I18n.t('cadeditor.ui.cards3.written_book') });
  }
  function rawTitle(t) {
    return typeof t === 'string' ? t : bookFiltered(t) && typeof t.raw === 'string' ? t.raw : '';
  }
  var titleMax = function () {
    return Reg.codecFact(cid, ['$.title', '$.title.raw'], 'max_length', 32);
  };
  var title = kInput(
    rawTitle(v.title),
    function (t) {
      put(function (o) {
        if (bookFiltered(o.title)) o.title.raw = t;
        else o.title = t;
      }, I18n.t('cadeditor.ui.cards3.book_title'));
      paintTitle();
    },
    { placeholder: I18n.t('cadeditor.ui.cards3.book_title') }
  );
  var titleCount = h('span', { class: 'k-rdcount' });
  function paintTitle() {
    var m = titleMax(),
      n = title.value.length;
    titleCount.textContent = n + (typeof m === 'number' ? ' / ' + m : m === undefined ? ' / …' : '');
    titleCount.classList.toggle('bad', typeof m === 'number' && n > m);
  }
  var author = kInput(
    typeof v.author === 'string' ? v.author : '',
    function (t) {
      put(function (o) {
        o.author = t;
      }, I18n.t('cadeditor.ui.cards3.author'));
    },
    { placeholder: I18n.t('cadeditor.ui.cards3.author') }
  );
  var gen = kSeg(
    [
      { v: 0, label: I18n.t('cadeditor.ui.cards3.original') },
      { v: 1, label: I18n.t('cadeditor.ui.cards3.copy') },
      { v: 2, label: I18n.t('cadeditor.ui.cards3.copy_copy') },
      { v: 3, label: I18n.t('cadeditor.ui.cards3.tattered') }
    ],
    codecField(v, cid, 'generation', 0) || 0,
    function (x) {
      put(function (o) {
        o.generation = x;
      }, I18n.t('cadeditor.ui.cards3.book_generation'));
    }
  );
  setTip(gen.el, I18n.t('cadeditor.ui.cards3.copy_junk_t_copied_synthetics'));
  var resolved = codecToggle(
    codecField(v, cid, 'resolved', false),
    function (on) {
      put(function (o) {
        o.resolved = on;
      }, I18n.t('cadeditor.ui.cards3.resolved'));
    },
    I18n.t('cadeditor.ui.cards3.resolved')
  );
  setTip(resolved.el, I18n.t('cadeditor.ui.cards3.off_player_first_opens_book'));
  card.body.appendChild(
    h('div', { class: 'k-book-meta' }, [
      h('label', { class: 'k-book-f' }, [
        h('span', { class: 'lt', text: I18n.t('cadeditor.ui.cards3.book_title') }),
        title,
        titleCount
      ]),
      h('label', { class: 'k-book-f' }, [
        h('span', { class: 'lt', text: I18n.t('cadeditor.ui.cards3.author') }),
        author
      ]),
      h('div', { class: 'k-book-f' }, [
        h('span', { class: 'lt', text: I18n.t('cadeditor.ui.cards3.version') }),
        gen.el,
        resolved.el
      ])
    ])
  );
  if (bookFiltered(v.title) && v.title.filtered !== undefined)
    card.body.appendChild(kHint(I18n.t('cadeditor.ui.cards3.title_also_filter_text_retained')));
  var book = kBookEditor({
    kind: 'written',
    key: 'book:written',
    get: function () {
      var o = Ctx.get(cid);
      return o && o.pages;
    },
    save: function (pages, label) {
      put(function (o) {
        o.pages = pages;
      }, label);
    },
    maxPages: function () {
      var m = Reg.codecFact(cid, ['$.pages'], 'max_size', null);
      return typeof m === 'number' && m < 2147483647 ? m : null;
    }
  });
  card.body.appendChild(book.el);
  paintTitle();
  card.live.push(function () {
    var o = Ctx.get(cid);
    if (!o) return;
    if (document.activeElement !== title && title.value !== rawTitle(o.title)) title.value = rawTitle(o.title);
    if (document.activeElement !== author && author.value !== (o.author || '')) author.value = o.author || '';
    gen.set(codecField(o, cid, 'generation', 0) || 0);
    resolved.set(codecField(o, cid, 'resolved', false) === true);
    paintTitle();
    book.refresh();
  });
  var off = Reg.on(function () {
    if (!document.body.contains(card.el)) {
      off();
      return;
    }
    paintTitle();
    book.refresh();
  });
  return card;
};
CARDS.writableBook = function () {
  var cid = 'writable_book_content';
  var card = kCard(
    {
      id: 'wrbook',
      icon: 'book_open',
      title: I18n.t('cadeditor.ui.cards3.writable_book_contents'),
      desc: I18n.t('cadeditor.ui.cards3.books_signed_color_code_per'),
      comps: [cid],
      span: 2,
      value: function () {
        var v = Ctx.get(cid);
        return v && Array.isArray(v.pages) ? I18n.t('cadeditor.ui.cards3.page', v.pages.length) : '';
      }
    },
    Ctx
  );
  var book = kBookEditor({
    kind: 'writable',
    key: 'book:writable',
    get: function () {
      var o = Ctx.get(cid);
      return o && o.pages;
    },
    save: function (pages, label) {
      var o = clone(Ctx.get(cid) || {});
      o.pages = pages;
      Ctx.setSmart(cid, o, { label: label || I18n.t('cadeditor.ui.cards3.book_quill') });
    },
    maxPages: function () {
      return Reg.codecFact(cid, ['$.pages'], 'max_size', 100);
    },
    maxChars: function () {
      return Reg.codecFact(cid, ['$.pages[]', '$.pages[].raw'], 'max_length', 1024);
    }
  });
  card.body.appendChild(book.el);
  card.live.push(function () {
    book.refresh();
  });
  var off = Reg.on(function () {
    if (!document.body.contains(card.el)) {
      off();
      return;
    }
    book.refresh();
  });
  return card;
};

/* ==================== 烟花 ==================== */
var FW_SHAPES = [
  { v: 'small_ball', label: I18n.t('cadeditor.ui.cards3.small_ball') },
  { v: 'large_ball', label: I18n.t('cadeditor.ui.cards3.large_ball') },
  { v: 'star', label: I18n.t('cadeditor.ui.cards3.star') },
  { v: 'creeper', label: I18n.t('cadeditor.ui.cards3.creeper_face') },
  { v: 'burst', label: I18n.t('cadeditor.ui.cards3.burst') }
];
function kColorList(list, onChange, addLabel) {
  var wrap = h('div', { class: 'k-chips' });
  var page = { page: 0 },
    pager = h('div', { class: 'k-row wrap', style: 'width:100%' });
  function draw() {
    clear(wrap);
    var range = kListPage(list.length, page, pager, draw);
    list.slice(range.start, range.end).forEach(function (c, index) {
      var i = range.start + index;
      var chip = h('div', { class: 'k-chip' }, [
        h('span', { class: 'k-colorchip small', style: 'background:' + hex6(c) }),
        hex6(c)
      ]);
      activate(chip, function () {
        kColorPop(
          chip,
          c,
          function (n) {
            list[i] = n;
            onChange(list);
            draw();
          },
          {
            width: 270,
            extra: [
              kBtn(
                I18n.t('cadeditor.ui.cards3.remove_color'),
                function () {
                  list.splice(i, 1);
                  onChange(list);
                  kPopClose();
                  draw();
                },
                { cls: 'dng', icon: 'trash' }
              )
            ]
          }
        );
      });
      wrap.appendChild(chip);
    });
    var add = h('div', { class: 'k-chip' }, [uiIcon('plus', 12), addLabel || I18n.t('cadeditor.ui.cards3.add_color')]);
    activate(add, function () {
      list.push(0xff5555);
      page.page = Math.floor((list.length - 1) / 24);
      onChange(list);
      draw();
    });
    wrap.appendChild(add);
    if (list.length > 24) wrap.appendChild(pager);
  }
  draw();
  return { el: wrap };
}
function explosionEditor(ex, onChange) {
  var box = h('div', { class: 'k-xbody' });
  var shape = combo({
    options: function () {
      return Reg.codecOptions('firework_explosion', 'shape', FW_SHAPES);
    },
    value: ex.shape || '',
    free: true,
    placeholder: I18n.t('cadeditor.ui.cards3.select_enter_shape'),
    onPick: function (x) {
      ex.shape = x;
      onChange();
    }
  });
  var colors = kColorList(codecField(ex, 'firework_explosion', 'colors', []) || [], function (l) {
    ex.colors = l;
    onChange();
  });
  var fade = kColorList(
    codecField(ex, 'firework_explosion', 'fade_colors', []) || [],
    function (l) {
      ex.fade_colors = l;
      onChange();
    },
    I18n.t('cadeditor.ui.cards3.add_fade_color')
  );
  var tr = codecToggle(
      codecField(ex, 'firework_explosion', 'has_trail', false),
      function (on) {
        ex.has_trail = on;
        onChange();
      },
      I18n.t('cadeditor.ui.cards3.trail')
    ),
    tw = codecToggle(
      codecField(ex, 'firework_explosion', 'has_twinkle', false),
      function (on) {
        ex.has_twinkle = on;
        onChange();
      },
      I18n.t('cadeditor.ui.cards3.twinkle')
    );
  box.appendChild(fieldRow(I18n.t('cadeditor.ui.cards3.shape'), shape));
  box.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards3.primary_colors'),
      colors.el,
      I18n.t('cadeditor.ui.cards3.choose_more_mix_randomly')
    )
  );
  box.appendChild(
    fieldRow(I18n.t('cadeditor.ui.cards3.fade_colors'), fade.el, I18n.t('cadeditor.ui.cards3.started_turn_colors'))
  );
  box.appendChild(h('div', { class: 'k-row wrap' }, [tr.el, tw.el]));
  return box;
}
CARDS.fireworks = function () {
  var card = kCard(
    {
      id: 'fireworks',
      icon: itemIcon('firework_rocket', 18),
      title: I18n.t('cadeditor.ui.cards3.firework_rocket'),
      desc: I18n.t('cadeditor.ui.cards3.flight_duration_explosions'),
      comps: ['fireworks'],
      span: 2
    },
    Ctx
  );
  var v = Ctx.get('fireworks') || {};
  function put(fn) {
    var o = Ctx.get('fireworks') || {};
    fn(o);
    Ctx.setSmart('fireworks', o, { label: I18n.t('cadeditor.ui.cards3.fireworks') });
  }
  var fd = codecNumber(codecField(v, 'fireworks', 'flight_duration', 1), {
    min: 0,
    max: 255,
    softMax: 5,
    step: 1,
    presets: [
      { v: 1, label: I18n.t('cadeditor.ui.cards3.n1_short') },
      { v: 2, label: '2' },
      { v: 3, label: I18n.t('cadeditor.ui.cards3.n3_long') }
    ],
    onChange: function (n) {
      put(function (o) {
        o.flight_duration = n;
      });
    }
  });
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.cards3.flight_duration'),
      fd.el,
      I18n.t('cadeditor.ui.cards3.larger_value_higher_flight_vanilla')
    )
  );
  var list = h('div', { class: 'k-sortlist' }),
    openIdx = -1,
    page = { page: 0 },
    pager = h('div', { class: 'k-row wrap' });
  function draw() {
    clear(list);
    var o = Ctx.get('fireworks') || { explosions: [] };
    var entries = o.explosions || [],
      range = kListPage(entries.length, page, pager, draw);
    entries.slice(range.start, range.end).forEach(function (ex, index) {
      var i = range.start + index;
      var isOpen = openIdx === i;
      var row = xRow({
        grip: true,
        chevron: true,
        icon: false,
        title: I18n.t(
          'cadeditor.ui.cards3.explosion',
          i + 1,
          (
            FW_SHAPES.filter(function (s) {
              return s.v === ex.shape;
            })[0] || { label: '?' }
          ).label
        ),
        sub: I18n.t(
          'cadeditor.ui.cards3.colour',
          (ex.colors || []).length,
          ex.has_trail ? I18n.t('cadeditor.ui.cards3.trail_2') : '',
          ex.has_twinkle ? I18n.t('cadeditor.ui.cards3.twinkle_2') : ''
        ),
        onDelete: function () {
          put(function (oo) {
            oo.explosions.splice(i, 1);
          });
          openIdx = -1;
          draw();
        },
        open: isOpen,
        onHead: function () {
          openIdx = isOpen ? -1 : i;
          draw();
        }
      });
      if (isOpen) {
        var ed = explosionEditor(ex, function () {
          put(function (oo) {
            oo.explosions[i] = ex;
          });
        });
        row.appendChild(ed);
      }
      list.appendChild(row);
    });
    if (!(o.explosions || []).length) list.appendChild(xEmpty(I18n.t('cadeditor.ui.cards3.explosions')));
  }
  kSortable(list, {
    onMove: function (from, to) {
      from += page.page * 24;
      to += page.page * 24;
      put(function (o) {
        var x = o.explosions.splice(from, 1)[0];
        o.explosions.splice(to, 0, x);
      });
      openIdx = -1;
      draw();
    }
  });
  var add = xAdd(I18n.t('cadeditor.ui.cards3.add_explosion'));
  activate(add, function () {
    pickFrom(
      add,
      Reg.codecOptions('firework_explosion', 'shape', FW_SHAPES),
      function (entry) {
        put(function (o) {
          (o.explosions = o.explosions || []).push({ shape: entry.v, colors: [0xff5555] });
        });
        openIdx = (Ctx.get('fireworks').explosions || []).length - 1;
        page.page = Math.floor(openIdx / 24);
        draw();
      },
      {
        manual: {
          label: I18n.t('cadeditor.ui.cards3.enter_shape_id'),
          parse: function (t) {
            return t;
          }
        }
      }
    );
  });
  card.body.appendChild(
    fieldRow(I18n.t('cadeditor.ui.cards3.explosions_2'), h('div', { class: 'k-scrollbox tall' }, [list]))
  );
  card.body.appendChild(pager);
  card.body.appendChild(add);
  draw();
  return card;
};
CARDS.fireworkStar = function () {
  var card = kCard(
    {
      id: 'fwstar',
      icon: itemIcon('firework_star', 18),
      title: I18n.t('cadeditor.ui.cards3.firework_star'),
      desc: I18n.t('cadeditor.ui.cards3.star_s_explosion'),
      comps: ['firework_explosion'],
      span: 2
    },
    Ctx
  );
  var v = Ctx.get('firework_explosion');
  if (!v)
    return enableBox(
      card,
      [I18n.t('cadeditor.ui.cards3.explosion_set'), I18n.t('cadeditor.ui.cards3.select_current_game_supported_shape')],
      I18n.t('cadeditor.ui.cards3.set_explosion'),
      function () {
        pickFrom(
          card.body,
          Reg.codecOptions('firework_explosion', 'shape', FW_SHAPES),
          function (entry) {
            Ctx.enable(
              'firework_explosion',
              { shape: entry.v, colors: [0xff5555] },
              I18n.t('cadeditor.ui.cards3.configure_firework_star')
            );
          },
          {
            manual: {
              label: I18n.t('cadeditor.ui.cards3.enter_shape_id'),
              parse: function (t) {
                return t;
              }
            }
          }
        );
      }
    );
  var ex = clone(v);
  var box = explosionEditor(ex, function () {
    Ctx.setSmart('firework_explosion', clone(ex), { label: I18n.t('cadeditor.ui.cards3.firework_star') });
  });
  card.body.appendChild(box);
  return card;
};

/* ==================== 使用时的行为（use_effects）：三项设置，不再用通用表单 ==================== */
CARDS.useEffects = function () {
  var cid = 'use_effects';
  var card = kCard(
    {
      id: 'use-effects',
      icon: 'play',
      title: I18n.t('cadeditor.ui.cards3.use'),
      desc: I18n.t('cadeditor.ui.cards3.movement_vibration'),
      comps: [cid],
      toggle: true
    },
    Ctx
  );
  var v = Ctx.get(cid);
  if (!v)
    return enableBox(
      card,
      [
        I18n.t('cadeditor.ui.cards3.item_doesn_t_separate_use'),
        I18n.t('cadeditor.ui.cards3.enabled_change_speed_running_moving')
      ],
      I18n.t('cadeditor.ui.common.enabled'),
      function () {
        Ctx.enable(cid, {}, I18n.t('cadeditor.ui.cards3.enable_behavior_use'));
      }
    );
  function put(fn, label) {
    var o = clone(Ctx.get(cid) || {});
    fn(o);
    Ctx.setSmart(cid, o, { label: label || I18n.t('cadeditor.ui.cards3.behavior_use') });
  }
  var sprint = codecToggle(
    codecField(v, 'use_effects', 'can_sprint', false),
    function (on) {
      put(function (o) {
        o.can_sprint = on;
      }, I18n.t('cadeditor.ui.cards3.allow_sprinting_use'));
    },
    I18n.t('cadeditor.ui.cards3.allow_sprinting_use_2')
  );
  var vib = codecToggle(
    codecField(v, 'use_effects', 'interact_vibrations', true),
    function (on) {
      put(function (o) {
        o.interact_vibrations = on;
      }, I18n.t('cadeditor.ui.cards3.emit_vibration_use'));
    },
    I18n.t('cadeditor.ui.cards3.interactive_vibrating_use_heard_hidden')
  );
  var spd = codecNumber(codecField(v, 'use_effects', 'speed_multiplier', 0.2), {
    min: 0,
    max: 1,
    step: 0.05,
    dec: 2,
    unit: I18n.t('cadeditor.ui.cards2.text'),
    presets: [
      { v: 0, label: I18n.t('cadeditor.ui.cards3.n0_stand_still') },
      { v: 0.2, label: '0.2' },
      { v: 0.5, label: '0.5' },
      { v: 1, label: I18n.t('cadeditor.ui.cards3.n1_slowdown') }
    ],
    onChange: function (n) {
      put(function (o) {
        o.speed_multiplier = n;
      }, I18n.t('cadeditor.ui.cards3.movement_multiplier_use'));
    }
  });
  card.body.appendChild(sprint.el);
  card.body.appendChild(vib.el);
  card.body.appendChild(fieldRow(I18n.t('cadeditor.ui.cards3.movement_speed_use'), spd.el));
  card.live.push(function () {
    var o = Ctx.get(cid) || {};
    sprint.set(codecField(o, 'use_effects', 'can_sprint', false) === true);
    vib.set(codecField(o, 'use_effects', 'interact_vibrations', true) === true);
    spd.set(codecField(o, 'use_effects', 'speed_multiplier', 0.2));
  });
  return card;
};

regEnumTable(
  'use_animation',
  ANIMS,
  function (x) {
    return x[0];
  },
  function (id, n) {
    return [id, n, 'grid'];
  }
);
regEnumTable(
  'firework_shape',
  FW_SHAPES,
  function (x) {
    return x.v;
  },
  function (id, n) {
    return { v: id, label: n };
  }
);
regEnumTable(
  'consume_effect_type',
  CE_TYPES,
  function (x) {
    return x.v;
  },
  function (id, n) {
    return { v: id, label: n, sub: '' };
  }
);
