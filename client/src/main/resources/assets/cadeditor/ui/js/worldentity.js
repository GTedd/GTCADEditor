/* 世界实体的规范化区段（docs/world-entity-contract.md）：盔甲架姿势、展示框 / 画、展示实体（物品 / 方块 / 文字）、村民交易、乘客。
   world.views.<组> 是只读的当前值；页面只把改过的字段放进 apply.entity.<区段>。乘客操作是独立的 apply.riding，不能和别的修改混在一起。
   范围、枚举、默认值读 views.<组>.schema（真实 Codec / loader 探针）；游戏没有给出范围的字段不设限。 */
WE.ent = {};
WE.offers = null;
function weEntReset() {
  WE.ent = {};
  WE.offers = null;
}
function evGroup(g) {
  var v = WE.w && WE.w.views && WE.w.views[g];
  return v && typeof v === 'object' ? v : null;
}
function evVal(g) {
  var v = evGroup(g);
  if (!v) return {};
  if (v.value && typeof v.value === 'object') return v.value;
  var o = {};
  Object.keys(v).forEach(function (k) {
    if (k !== 'schema' && k !== 'snbt') o[k] = v[k];
  });
  return o;
}
function evFields(g) {
  var v = evGroup(g),
    s = v && v.schema;
  if (!s && WE.w && WE.w.schema && WE.w.schema[g]) s = WE.w.schema[g];
  return s ? s.fields || s : {};
}
function evGet(g, k) {
  return weDraftGet(WE.ent, g, k, evVal(g));
}
function evSet(g, k, v, part) {
  if (g === 'player' && typeof wpCommandTrack === 'function') wpCommandTrack(k, v, part);
  weDraftSet(WE.ent, g, k, v, evVal(g));
  if (g === 'dropped_item' && k === 'Item') weHeroLive();
  if (g === 'pose') weHeroLive(); /* 左侧 3D 盔甲架跟着姿势和外观开关动 */
}
/* 预览盔甲架的姿势串：与 EditorStandPreview 的属性格式一致 */
function evStandAttr() {
  var F = evFields('pose'),
    out = [];
  EV_PARTS.forEach(function (pp) {
    var c = evGet('pose', pp[0]);
    if (!Array.isArray(c)) c = (F[pp[0]] && F[pp[0]].default) || null;
    if (Array.isArray(c) && c.length >= 3)
      out.push(
        pp[0] +
          '=' +
          [0, 1, 2]
            .map(function (i) {
              var n = +c[i];
              return isFinite(n) ? n : 0;
            })
            .join(',')
      );
  });
  ['ShowArms', 'Small', 'NoBasePlate'].forEach(function (k) {
    var v = evGet('pose', k);
    if (typeof v === 'boolean') out.push(k + '=' + (v ? 1 : 0));
  });
  return out.join(';');
}
function evDirty() {
  return (
    !!WE.w &&
    (Object.keys(WE.ent).length > 0 ||
      (typeof wpCommandIntentDirty === 'function' && wpCommandIntentDirty()) ||
      (typeof wpSlotsDirty === 'function' && wpSlotsDirty() > 0) ||
      (WE.offers !== null && JSON.stringify(WE.offers) !== JSON.stringify(evOffersOrig())))
  );
}
function evOffersOrig() {
  var t = evGroup('trades');
  return t && t.offers ? t.offers : [];
}
function evMsg(msg) {
  var out = {},
    any = false;
  Object.keys(WE.ent).forEach(function (g) {
    out[g] = clone(WE.ent[g]);
    any = true;
  });
  if (WE.offers !== null && JSON.stringify(WE.offers) !== JSON.stringify(evOffersOrig())) {
    out.offers = clone(WE.offers);
    any = true;
  }
  if (typeof wpMsg === 'function') {
    wpMsg(out);
    if (out.player) any = true;
  }
  if (any) msg.entity = out;
}
function evNum(label, v, o, on) {
  o = o || {};
  return xNum({
    title: label,
    sub: o.sub,
    value: v,
    min: o.min,
    max: o.max,
    softMin: o.softMin,
    softMax: o.softMax,
    step: o.step,
    dec: o.dec,
    unit: o.unit,
    noSlider: o.noSlider !== false && o.softMax === undefined,
    onChange: on
  });
}
function evBool(label, v, sub, on) {
  return xToggle({ title: label, sub: sub, value: v, onChange: on });
}
function evStack(cur, onSet, o) {
  o = o || {};
  var has = cur && cur.id && !cur.empty;
  var btn = kItemBtn(has ? cur : null, null, o.placeholder);
  function norm(st) {
    var s = clone(st);
    delete s.slot;
    delete s.label;
    return s;
  }
  activate(btn, function () {
    pickItem(
      btn,
      function (id) {
        onSet({ id: fullId(id), count: 1, comps: {}, removed: {} });
        kPopClose();
      },
      {
        onStack: function (st) {
          onSet(norm(st));
          kPopClose();
        }
      }
    );
  });
  var kids = [btn];
  if (has)
    kids.push(
      kBtn(
        I18n.t('cadeditor.ui.cards3.edit_item'),
        function () {
          openNestedItem(cur, {
            title: I18n.t('cadeditor.ui.cards3.edit_item'),
            valid: nestedDraftGuard(),
            commit: function (st) {
              onSet(norm(st));
            },
            render: weRedrawBody
          });
        },
        { icon: 'edit' }
      )
    );
  if (has && o.clear !== false)
    kids.push(
      kBtn(
        I18n.t('cadeditor.ui.common.clear'),
        function () {
          onSet(o.empty);
        },
        { icon: 'trash' }
      )
    );
  return h('div', { class: 'k-row' }, kids);
}

/* ---------- 盔甲架姿势 ---------- */
var EV_PARTS = [
  ['Head', I18n.t('cadeditor.ui.labels.head_3')],
  ['Body', I18n.t('cadeditor.ui.labels.body')],
  ['LeftArm', I18n.t('cadeditor.ui.worldentity.left_arm')],
  ['RightArm', I18n.t('cadeditor.ui.worldentity.right_arm')],
  ['LeftLeg', I18n.t('cadeditor.ui.worldentity.left_leg')],
  ['RightLeg', I18n.t('cadeditor.ui.worldentity.right_leg')]
];
/* 编辑器自带的造型，依 EV_PARTS 排列；不是游戏注册表或原版默认值。世界盔甲架和盔甲架物品共用这张表。 */
function evPreset(key, label, angles) {
  return { key: key, label: label, angles: angles };
}
var EV_POSE_PRESETS = [
  evPreset('standing', I18n.t('cadeditor.ui.worldentity.standing'), [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]),
  evPreset('waving', I18n.t('cadeditor.ui.worldentity.waving'), [
    [0, -15, 0],
    [0, 0, 0],
    [0, 0, -5],
    [-150, 0, 25],
    [0, 0, 0],
    [0, 0, 0]
  ]),
  evPreset('saluting', I18n.t('cadeditor.ui.worldentity.saluting'), [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [-110, -15, 30],
    [0, 0, 0],
    [0, 0, 0]
  ]),
  evPreset('cheering', I18n.t('cadeditor.ui.worldentity.cheering'), [
    [-15, 0, 0],
    [0, 0, 0],
    [-165, 0, -15],
    [-165, 0, 15],
    [0, 0, -5],
    [0, 0, 5]
  ]),
  evPreset('sitting', I18n.t('cadeditor.ui.worldentity.sitting'), [
    [0, 0, 0],
    [0, 0, 0],
    [-10, 0, -5],
    [-10, 0, 5],
    [-90, 0, 0],
    [-90, 0, 0]
  ]),
  evPreset('walking', I18n.t('cadeditor.ui.worldentity.walking'), [
    [0, 0, 0],
    [0, 0, 0],
    [-35, 0, 0],
    [35, 0, 0],
    [35, 0, 0],
    [-35, 0, 0]
  ]),
  evPreset('running', I18n.t('cadeditor.ui.worldentity.running'), [
    [10, 0, 0],
    [15, 0, 0],
    [-65, 0, -10],
    [65, 0, 10],
    [55, 0, 0],
    [-55, 0, 0]
  ]),
  evPreset('bowing', I18n.t('cadeditor.ui.worldentity.bowing'), [
    [30, 0, 0],
    [45, 0, 0],
    [0, 0, -5],
    [0, 0, 5],
    [0, 0, 0],
    [0, 0, 0]
  ]),
  evPreset('pointing', I18n.t('cadeditor.ui.worldentity.pose_pointing'), [
    [0, -10, 0],
    [0, 0, 0],
    [5, 0, -5],
    [-90, -12, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]),
  evPreset('thinking', I18n.t('cadeditor.ui.worldentity.pose_thinking'), [
    [12, 0, -8],
    [0, 0, 0],
    [-35, 25, 0],
    [-125, 35, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]),
  evPreset('arms_out', I18n.t('cadeditor.ui.worldentity.pose_arms_out'), [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, -90],
    [0, 0, 90],
    [0, 0, -4],
    [0, 0, 4]
  ]),
  evPreset('zombie', I18n.t('cadeditor.ui.worldentity.pose_zombie'), [
    [5, 0, 0],
    [0, 0, 0],
    [-90, 4, 0],
    [-90, -4, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]),
  evPreset('lunge', I18n.t('cadeditor.ui.worldentity.pose_lunge'), [
    [0, 0, 0],
    [5, 0, 0],
    [-30, 0, -10],
    [20, 0, 10],
    [-45, 0, 0],
    [30, 0, 0]
  ]),
  evPreset('dancing', I18n.t('cadeditor.ui.worldentity.pose_dancing'), [
    [0, 20, 10],
    [0, 0, 0],
    [-140, 0, -30],
    [20, 0, 40],
    [0, 0, -15],
    [-20, 0, 10]
  ]),
  evPreset('attacking', I18n.t('cadeditor.ui.worldentity.pose_attacking'), [
    [0, 10, 0],
    [0, 10, 0],
    [-30, 0, -10],
    [-100, 0, 20],
    [-10, 0, 0],
    [10, 0, 0]
  ]),
  evPreset('shielding', I18n.t('cadeditor.ui.worldentity.pose_shielding'), [
    [0, -5, 0],
    [0, 0, 0],
    [-90, 40, 0],
    [-50, 0, 10],
    [0, 0, -3],
    [0, 0, 3]
  ]),
  evPreset('archer', I18n.t('cadeditor.ui.worldentity.pose_archer'), [
    [0, -30, 0],
    [0, -5, 0],
    [-90, 45, 0],
    [-90, -5, 0],
    [0, 0, -3],
    [0, 0, 3]
  ]),
  evPreset('raise_hand', I18n.t('cadeditor.ui.worldentity.pose_raise_hand'), [
    [-10, 0, 0],
    [0, 0, 0],
    [0, 0, -5],
    [-170, 0, 5],
    [0, 0, 0],
    [0, 0, 0]
  ]),
  evPreset('sad', I18n.t('cadeditor.ui.worldentity.pose_sad'), [
    [35, 0, 0],
    [8, 0, 0],
    [5, 0, -3],
    [5, 0, 3],
    [0, 0, 0],
    [0, 0, 0]
  ]),
  evPreset('climbing', I18n.t('cadeditor.ui.worldentity.pose_climbing'), [
    [-20, 0, 0],
    [0, 0, 0],
    [-160, 0, 0],
    [-110, 0, 0],
    [-40, 0, 0],
    [10, 0, 0]
  ])
];
/* 预设按钮一行 + 「重置」。onPick(预设)，重置时 onPick(null) */
function standPresetRow(onPick) {
  var presets = EV_POSE_PRESETS.map(function (preset) {
    var b = kBtn(
      preset.label,
      function () {
        onPick(preset);
      },
      { title: I18n.t('cadeditor.ui.worldentity.apply_positions_display_arms', preset.label) }
    );
    b.setAttribute('data-preset', preset.key);
    return b;
  });
  presets.push(
    kBtn(
      I18n.t('cadeditor.ui.common.reset'),
      function () {
        onPick(null);
      },
      { icon: 'undo', title: I18n.t('cadeditor.ui.worldentity.reset_all_body_parts_default') }
    )
  );
  return h('div', { class: 'k-row wrap stand-presets' }, presets);
}
/* 六个部位的角度行（可展开改 X / Y / Z）。世界盔甲架和盔甲架物品共用。
   io = { get(部位)→[x,y,z]|undefined, def(部位)→默认角度, set(部位, 角度), openKey 展开记忆前缀, redraw() } */
function standPoseRows(body, io) {
  EV_PARTS.forEach(function (pp) {
    var key = pp[0],
      def = io.def(key) || [0, 0, 0],
      cur = io.get(key);
    cur = (Array.isArray(cur) ? cur : def).slice(0, 3).map(function (n) {
      n = nbtNumberValue(n);
      return isFinite(n) ? n : 0;
    });
    var k = io.openKey + key,
      open = !!UIOpen[k];
    function setAxis(i, v) {
      var n = io.get(key);
      n = (Array.isArray(n) ? n : def).slice(0, 3).map(nbtNumberValue);
      n[i] = v;
      io.set(key, n);
    }
    body.appendChild(
      xRow({
        icon: false,
        title: pp[1],
        sub: 'X ' + fmtNum(cur[0]) + '°  Y ' + fmtNum(cur[1]) + '°  Z ' + fmtNum(cur[2]) + '°',
        chevron: true,
        open: open,
        onHead: function () {
          UIOpen[k] = !UIOpen[k];
          io.redraw();
        },
        body: function () {
          var rows = [
            I18n.t('cadeditor.ui.worldentity.x_pitch'),
            I18n.t('cadeditor.ui.worldentity.y_yaw'),
            I18n.t('cadeditor.ui.worldentity.z_roll')
          ].map(function (nm, i) {
            var n = kNumber(cur[i], {
              softMin: -180,
              softMax: 180,
              step: 1,
              dec: 1,
              unit: '°',
              onChange: function (v) {
                setAxis(i, v);
              }
            });
            return xField(null, nm, n.el);
          });
          rows.push(
            h('div', { class: 'x2f' }, [
              h('div', { class: 'grow' }),
              kBtn(
                I18n.t('cadeditor.ui.common.reset'),
                function () {
                  io.set(key, def.slice());
                  io.redraw();
                },
                { icon: 'undo' }
              )
            ])
          );
          return rows;
        }
      })
    );
  });
}
/* 槽位锁定（DisabledSlots）：每个槽三个位——锁定 / 禁止取出 / 禁止放入。位号来自游戏（schema 的 slots / offsets），
   没有 schema 时才用离线回退表。不认识的位原样保留。世界盔甲架和盔甲架物品共用。 */
var STAND_LOCK_FALLBACK = {
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
var STAND_LOCK_ORDER = ['head', 'chest', 'legs', 'feet', 'mainhand', 'offhand'];
function standLockInfo(field) {
  var f = field && Array.isArray(field.slots) && field.slots.length && field.offsets ? field : STAND_LOCK_FALLBACK;
  var slots = f.slots.slice().sort(function (a, b) {
    var i = STAND_LOCK_ORDER.indexOf(a.slot),
      j = STAND_LOCK_ORDER.indexOf(b.slot);
    return (i < 0 ? 99 : i) - (j < 0 ? 99 : j);
  });
  return { slots: slots, offsets: f.offsets };
}
/* 这些槽位三个位合起来的掩码（全锁 / 全解只动这些位） */
function standLockAll(info) {
  var m = 0;
  info.slots.forEach(function (s) {
    ['lock', 'take', 'put'].forEach(function (k) {
      m |= 1 << (s.bit + info.offsets[k]);
    });
  });
  return m | 0;
}
/* o = { info, value()→整数, set(整数) }。一行数值 + 全锁 / 全解，每个槽一行三个开关 */
function standLockEditor(o) {
  var info = o.info,
    box = h('div', { class: 'stand-locks' }),
    all = standLockAll(info);
  function val() {
    var v = nbtNumberValue(o.value());
    return isFinite(v) ? v | 0 : 0;
  }
  function put(n) {
    o.set(n | 0);
    draw();
  }
  function draw() {
    clear(box);
    var cur = val();
    var num = xNumCtl(
      cur,
      {
        min: -2147483648,
        max: 2147483647,
        step: 1,
        noSlider: true,
        onChange: function (v) {
          put(Math.round(v));
        }
      },
      true
    );
    box.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.worldentity.lock_value'),
        tip: 'DisabledSlots',
        right: h('div', { class: 'k-row' }, [
          num.el,
          kBtn(
            I18n.t('cadeditor.ui.worldentity.lock_all'),
            function () {
              put(val() | all);
            },
            { icon: 'lock' }
          ),
          kBtn(
            I18n.t('cadeditor.ui.worldentity.unlock_all'),
            function () {
              put(val() & ~all);
            },
            { icon: 'undo' }
          )
        ])
      })
    );
    info.slots.forEach(function (s) {
      var toggles = [
        ['lock', I18n.t('cadeditor.ui.worldentity.lock_slot')],
        ['take', I18n.t('cadeditor.ui.worldentity.lock_take')],
        ['put', I18n.t('cadeditor.ui.worldentity.lock_put')]
      ].map(function (t) {
        var bit = 1 << (s.bit + info.offsets[t[0]]);
        var tg = kToggle(
          (cur & bit) !== 0,
          function (on) {
            put(on ? val() | bit : val() & ~bit);
          },
          t[1]
        );
        tg.el.setAttribute('data-lock', s.slot + ':' + t[0]);
        return tg.el;
      });
      box.appendChild(
        xRow({
          icon: false,
          title: (ES_SLOT[s.slot] || [humanId(s.slot)])[0],
          tip: s.slot,
          right: h('div', { class: 'k-row stand-lockrow' }, toggles)
        })
      );
    });
    box.appendChild(kHint(I18n.t('cadeditor.ui.worldentity.lock_hint')));
  }
  draw();
  return box;
}
function evPosePreset(preset) {
  var F = evFields('pose'),
    orig = evVal('pose');
  EV_PARTS.forEach(function (pp, i) {
    var key = pp[0],
      angles = preset ? preset.angles[i] : F[key] && F[key].default;
    if (Array.isArray(angles)) weDraftSet(WE.ent, 'pose', key, angles.slice(), orig);
  });
  if (preset && ('ShowArms' in orig || F.ShowArms)) weDraftSet(WE.ent, 'pose', 'ShowArms', true, orig);
  weHeroLive();
  weRedrawBody();
}
function evPoseTab(body) {
  var F = evFields('pose');
  body.appendChild(
    xSec(
      'user',
      I18n.t('cadeditor.ui.worldentity.pose_presets'),
      I18n.t('cadeditor.ui.worldentity.select_preset_fine_tune')
    )
  );
  body.appendChild(standPresetRow(evPosePreset));
  body.appendChild(
    xSec('user', I18n.t('cadeditor.ui.worldedit.pose'), I18n.t('cadeditor.ui.worldentity.angle_degrees'))
  );
  standPoseRows(body, {
    openKey: 'we:pose:',
    get: function (key) {
      return evGet('pose', key);
    },
    def: function (key) {
      return F[key] && F[key].default;
    },
    set: function (key, angles) {
      evSet('pose', key, angles);
    },
    redraw: weRender
  });
  body.appendChild(xSec('sliders', I18n.t('cadeditor.ui.worldedit.state')));
  [
    ['ShowArms', I18n.t('cadeditor.ui.labels.show_arms'), I18n.t('cadeditor.ui.labels.arms_hold_items')],
    ['Small', I18n.t('cadeditor.ui.worldentity.small'), I18n.t('cadeditor.ui.worldentity.half_size')],
    ['NoBasePlate', I18n.t('cadeditor.ui.worldentity.base_plate'), ''],
    ['Invisible', I18n.t('cadeditor.ui.worldentity.invisible'), ''],
    [
      'Marker',
      I18n.t('cadeditor.ui.worldentity.hitbox'),
      I18n.t('cadeditor.ui.worldentity.cannot_targeted_block_movement')
    ]
  ].forEach(function (f) {
    if (!(f[0] in evVal('pose')) && !F[f[0]]) return;
    body.appendChild(
      evBool(f[1], evGet('pose', f[0]), f[2], function (on) {
        evSet('pose', f[0], on);
      })
    );
  });
  body.appendChild(kHint(I18n.t('cadeditor.ui.worldentity.one_hand_one_body_attribute')));
  if ('DisabledSlots' in evVal('pose') || F.DisabledSlots) {
    body.appendChild(
      xSec('lock', I18n.t('cadeditor.ui.worldentity.slot_locks'), I18n.t('cadeditor.ui.worldentity.slot_locks_sub'))
    );
    body.appendChild(
      standLockEditor({
        info: standLockInfo(F.DisabledSlots),
        value: function () {
          var v = evGet('pose', 'DisabledSlots');
          return typeof v === 'number' ? v : (F.DisabledSlots && F.DisabledSlots.default) || 0;
        },
        set: function (n) {
          evSet('pose', 'DisabledSlots', n);
        }
      })
    );
  }
}

/* ---------- 展示框 / 荧光展示框 ---------- */
function evFrameTab(body) {
  var F = evFields('item_frame'),
    v = evVal('item_frame');
  body.appendChild(xSec('image', I18n.t('cadeditor.ui.worldedit.item_frame')));
  var cur = evGet('item_frame', 'item');
  body.appendChild(
    xRow({
      icon: false,
      title: I18n.t('cadeditor.ui.worldentity.item_frame'),
      right: evStack(
        cur,
        function (st) {
          evSet('item_frame', 'item', st);
          weRender();
        },
        { empty: { empty: true } }
      )
    })
  );
  var rotMax = F.ItemRotation && F.ItemRotation.max !== undefined ? F.ItemRotation.max : 7;
  body.appendChild(
    evNum(
      I18n.t('cadeditor.ui.worldentity.item_rotation_steps'),
      evGet('item_frame', 'ItemRotation'),
      { min: 0, max: rotMax, sub: I18n.t('cadeditor.ui.worldentity.n45_per_grid_total_inbound', rotMax + 1) },
      function (x) {
        evSet('item_frame', 'ItemRotation', x);
      }
    )
  );
  body.appendChild(
    evBool(
      I18n.t('cadeditor.ui.worldentity.invisible_frame'),
      evGet('item_frame', 'Invisible'),
      I18n.t('cadeditor.ui.worldentity.show_only_item_inside'),
      function (on) {
        evSet('item_frame', 'Invisible', on);
      }
    )
  );
  body.appendChild(
    evBool(
      I18n.t('cadeditor.ui.forms.fixed'),
      evGet('item_frame', 'Fixed'),
      I18n.t('cadeditor.ui.worldentity.prevent_rotating_removing_item'),
      function (on) {
        evSet('item_frame', 'Fixed', on);
      }
    )
  );
  body.appendChild(
    evNum(
      I18n.t('cadeditor.ui.worldentity.probability_dropping_item_shot_down'),
      evGet('item_frame', 'ItemDropChance'),
      { step: 0.1, dec: 3, sub: I18n.t('cadeditor.ui.worldentity.n1_guarantees_drop') },
      function (x) {
        evSet('item_frame', 'ItemDropChance', x);
      }
    )
  );
  /* 挂好的展示框朝向决定挂的位置，和画一样由服务端锁定（WorldNbt.protect）；这里只显示。物品形态的展示框可以改 */
  if (v.Facing !== undefined)
    body.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.labels.facing'),
        sub: I18n.t('cadeditor.ui.worldentity.we_t_change_direction_hang'),
        tip: 'Facing',
        right: h('span', { class: 'k-sub', text: frameFacingLabel(v.Facing, F.Facing) })
      })
    );
}
/* 展示框朝向的显示名：选项（值 → 方向名）来自 schema（Direction.LEGACY_ID_CODEC），没有时用离线回退表 */
var FRAME_FACING_FALLBACK = [
  { value: 0, name: 'down' },
  { value: 1, name: 'up' },
  { value: 2, name: 'north' },
  { value: 3, name: 'south' },
  { value: 4, name: 'west' },
  { value: 5, name: 'east' }
];
function frameFacingOptions(field) {
  var list = field && Array.isArray(field.options) && field.options.length ? field.options : FRAME_FACING_FALLBACK;
  return list.map(function (o) {
    return { v: o.value, label: Labels.blockVal[o.name] || humanId(o.name), name: o.name };
  });
}
function frameFacingLabel(value, field) {
  var n = nbtNumberValue(value),
    hit = frameFacingOptions(field).filter(function (o) {
      return o.v === n;
    })[0];
  return hit ? hit.label : String(n);
}
function evPaintingTab(body) {
  body.appendChild(xSec('image', I18n.t('cadeditor.ui.worldedit.painting')));
  var sel = kRegSelect({
    reg: 'painting_variant',
    value: evGet('painting', 'variant') || '',
    title: I18n.t('cadeditor.ui.worldentity.choose_painting'),
    onChange: function (id) {
      evSet('painting', 'variant', id);
    }
  });
  body.appendChild(
    xRow({
      icon: false,
      title: I18n.t('cadeditor.ui.worldentity.artwork'),
      sub: I18n.t('cadeditor.ui.worldentity.we_t_change_direction_hang'),
      right: sel.el
    })
  );
}

/* ---------- 展示实体 ---------- */
function evVec(label, g, path, idx3, defv) {
  var cur = evGet(g, 'transformation');
  cur = cur && typeof cur === 'object' ? cur : {};
  var arr = Array.isArray(cur[path]) ? cur[path].slice() : defv.slice();
  var cells = [];
  arr.forEach(function (x, i) {
    var inp = kInput(fmtNum(x), function () {}, {});
    inp.classList.add('we-vnum');
    inp.addEventListener('change', function () {
      var v = Number(inp.value.replace(/,/g, '.'));
      if (isNaN(v)) {
        inp.value = fmtNum(x);
        return;
      }
      var t = clone(evGet(g, 'transformation') || {});
      var a = Array.isArray(t[path]) ? t[path].slice() : defv.slice();
      a[i] = v;
      t[path] = a;
      ['translation', 'scale', 'left_rotation', 'right_rotation'].forEach(function (k) {
        if (!Array.isArray(t[k])) t[k] = k === 'scale' ? [1, 1, 1] : k === 'translation' ? [0, 0, 0] : [0, 0, 0, 1];
      });
      evSet(g, 'transformation', t);
    });
    cells.push(
      h('div', { class: 'we-cell' }, [
        h('span', { class: 'k-sub', text: idx3 ? ['X', 'Y', 'Z'][i] : ['X', 'Y', 'Z', 'W'][i] }),
        inp
      ])
    );
  });
  return xField(null, label, h('div', { class: 'we-vec' }, cells));
}
function evDisplayTab(body) {
  var g = 'display',
    F = evFields(g),
    v = evVal(g),
    isText = 'text' in v || 'alignment' in v,
    isItem = 'item_display' in v || (v.item && !('block_state' in v)),
    isBlock = 'block_state' in v;
  body.appendChild(xSec('cube', I18n.t('cadeditor.ui.worldentity.position_size')));
  var kt = 'we:disp:xf';
  body.appendChild(
    xRow({
      icon: false,
      title: I18n.t('cadeditor.ui.worldentity.transform'),
      sub: I18n.t('cadeditor.ui.worldentity.offset_scaling_rotation_four_dollars'),
      chevron: true,
      open: UIOpen[kt] !== false,
      onHead: function () {
        UIOpen[kt] = UIOpen[kt] === false;
        weRender();
      },
      body: function () {
        return [
          evVec(I18n.t('cadeditor.ui.worldentity.offset'), g, 'translation', true, [0, 0, 0]),
          evVec(I18n.t('cadeditor.ui.worldentity.scale'), g, 'scale', true, [1, 1, 1]),
          evVec(I18n.t('cadeditor.ui.worldentity.left_rotation'), g, 'left_rotation', false, [0, 0, 0, 1]),
          evVec(I18n.t('cadeditor.ui.worldentity.right_rotation'), g, 'right_rotation', false, [0, 0, 0, 1])
        ];
      }
    })
  );
  var bills = (F.billboard && F.billboard.options) || ['fixed', 'vertical', 'horizontal', 'center'];
  var BN = {
    fixed: I18n.t('cadeditor.ui.forms.fixed'),
    vertical: I18n.t('cadeditor.ui.worldentity.vertical_axis'),
    horizontal: I18n.t('cadeditor.ui.worldentity.horizontal_axis'),
    center: I18n.t('cadeditor.ui.worldentity.billboard')
  };
  body.appendChild(
    xSeg({
      title: I18n.t('cadeditor.ui.labels.facing'),
      sub: I18n.t('cadeditor.ui.worldentity.want_follow_player_perspective'),
      options: bills.map(function (b) {
        return { v: b, label: BN[b] || b };
      }),
      value: evGet(g, 'billboard') || 'fixed',
      onChange: function (x) {
        evSet(g, 'billboard', x);
      }
    })
  );
  var br = evGet(g, 'brightness'),
    brOn = br && typeof br === 'object';
  body.appendChild(
    evBool(
      I18n.t('cadeditor.ui.worldentity.fixed_brightness'),
      brOn,
      I18n.t('cadeditor.ui.worldentity.ignore_ambient_lighting'),
      function (on) {
        evSet(g, 'brightness', on ? { block: 15, sky: 15 } : null);
        weRender();
      }
    )
  );
  if (brOn) {
    body.appendChild(
      evNum(
        I18n.t('cadeditor.ui.worldentity.block_light'),
        br.block,
        { min: 0, max: 15, softMin: 0, softMax: 15, noSlider: false },
        function (x) {
          evSet(g, 'brightness', { block: x, sky: (evGet(g, 'brightness') || br).sky });
        }
      )
    );
    body.appendChild(
      evNum(
        I18n.t('cadeditor.ui.worldentity.sky_light'),
        br.sky,
        { min: 0, max: 15, softMin: 0, softMax: 15, noSlider: false },
        function (x) {
          evSet(g, 'brightness', { block: (evGet(g, 'brightness') || br).block, sky: x });
        }
      )
    );
  }
  body.appendChild(xSec('eye', I18n.t('cadeditor.ui.screens.display')));
  [
    [
      'view_range',
      I18n.t('cadeditor.ui.worldentity.view_range'),
      I18n.t('cadeditor.ui.worldentity.multiplier_relative_default')
    ],
    [
      'width',
      I18n.t('cadeditor.ui.worldentity.width'),
      I18n.t('cadeditor.ui.worldentity.culling_size_0_disables_culling')
    ],
    [
      'height',
      I18n.t('cadeditor.ui.worldentity.height'),
      I18n.t('cadeditor.ui.worldentity.culling_size_0_disables_culling')
    ],
    ['shadow_radius', I18n.t('cadeditor.ui.worldentity.shadow_radius'), ''],
    ['shadow_strength', I18n.t('cadeditor.ui.worldentity.shadow_opacity'), '']
  ].forEach(function (f) {
    if (!(f[0] in v)) return;
    body.appendChild(
      evNum(f[1], evGet(g, f[0]), { step: 0.1, dec: 3, sub: f[2] }, function (x) {
        evSet(g, f[0], x);
      })
    );
  });
  if ('glow_color_override' in v)
    body.appendChild(
      evNum(
        I18n.t('cadeditor.ui.worldentity.glow_color'),
        evGet(g, 'glow_color_override'),
        { sub: I18n.t('cadeditor.ui.worldentity.integer_colour_1_means_overwrite') },
        function (x) {
          evSet(g, 'glow_color_override', x);
        }
      )
    );
  body.appendChild(xSec('clock', I18n.t('cadeditor.ui.worldentity.animation')));
  body.appendChild(
    evNum(
      I18n.t('cadeditor.ui.worldentity.interpolation_duration'),
      evGet(g, 'interpolation_duration'),
      { unit: I18n.t('cadeditor.ui.cards2.ticks'), sub: I18n.t('cadeditor.ui.worldentity.how_long_take_smooth_out') },
      function (x) {
        evSet(g, 'interpolation_duration', x);
      }
    )
  );
  body.appendChild(
    evNum(
      I18n.t('cadeditor.ui.worldentity.movement_interpolation'),
      evGet(g, 'teleport_duration'),
      { unit: I18n.t('cadeditor.ui.cards2.ticks'), sub: I18n.t('cadeditor.ui.worldentity.game_retains_most_59') },
      function (x) {
        evSet(g, 'teleport_duration', x);
      }
    )
  );
  if (isItem) {
    body.appendChild(xSec('sword', I18n.t('cadeditor.ui.worldentity.displayed_item')));
    body.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.pages.item_2'),
        right: evStack(
          evGet(g, 'item'),
          function (st) {
            evSet(g, 'item', st);
            weRender();
          },
          { empty: null }
        )
      })
    );
    var ctx = (F.item_display && F.item_display.options) || [
      'none',
      'thirdperson_lefthand',
      'thirdperson_righthand',
      'firstperson_lefthand',
      'firstperson_righthand',
      'head',
      'gui',
      'ground',
      'fixed',
      'on_shelf'
    ];
    body.appendChild(
      xSelect({
        title: I18n.t('cadeditor.ui.worldentity.display_mode'),
        sub: I18n.t('cadeditor.ui.worldentity.position_different_model_posture_item'),
        options: ctx.map(function (c) {
          return { v: c, label: c };
        }),
        value: evGet(g, 'item_display') || 'none',
        width: 200,
        onChange: function (x) {
          evSet(g, 'item_display', x);
        }
      })
    );
  }
  if (isBlock) {
    body.appendChild(xSec('cube_grass', I18n.t('cadeditor.ui.worldentity.displayed_block')));
    var bs = evGet(g, 'block_state') || { Name: 'minecraft:air' };
    var sel = kRegSelect({
      reg: 'block',
      value: bs.Name,
      title: I18n.t('cadeditor.ui.picker.choose_block'),
      onChange: function (id) {
        evSet(g, 'block_state', { Name: id });
      }
    });
    body.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.picker.block'),
        sub: bs.Properties ? I18n.t('cadeditor.ui.worldentity.block_status_block_cleared') : '',
        right: sel.el
      })
    );
  }
  if (isText) {
    body.appendChild(xSec('chat', I18n.t('cadeditor.ui.cards4.text')));
    var ta = h('textarea', {
      class: 'ed-snbt we-cmd',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.worldentity.text_text_component_json_text')
    });
    ta.value = msgText(evGet(g, 'text'));
    ta.addEventListener('change', function () {
      evSet(g, 'text', textMsg(ta.value));
    });
    body.appendChild(ta);
    var al = (F.alignment && F.alignment.options) || ['center', 'left', 'right'],
      AN = {
        center: I18n.t('cadeditor.ui.worldentity.center'),
        left: I18n.t('cadeditor.ui.worldentity.left'),
        right: I18n.t('cadeditor.ui.worldentity.right')
      };
    body.appendChild(
      xSeg({
        title: I18n.t('cadeditor.ui.worldentity.alignment'),
        options: al.map(function (a) {
          return { v: a, label: AN[a] || a };
        }),
        value: evGet(g, 'alignment') || 'center',
        onChange: function (x) {
          evSet(g, 'alignment', x);
        }
      })
    );
    body.appendChild(
      evNum(
        I18n.t('cadeditor.ui.worldentity.line_width'),
        evGet(g, 'line_width'),
        {
          unit: I18n.t('cadeditor.ui.worldentity.pixels'),
          sub: I18n.t('cadeditor.ui.worldentity.wrap_lines_beyond_width')
        },
        function (x) {
          evSet(g, 'line_width', x);
        }
      )
    );
    var op = evGet(g, 'text_opacity'),
      op255 = typeof op === 'number' ? (op < 0 ? op + 256 : op) : 255;
    body.appendChild(
      evNum(
        I18n.t('cadeditor.ui.worldentity.text_opacity'),
        op255,
        {
          min: 0,
          max: 255,
          softMin: 0,
          softMax: 255,
          noSlider: false,
          sub: I18n.t('cadeditor.ui.worldentity.n0_full_transparency_255_opaque')
        },
        function (x) {
          evSet(g, 'text_opacity', x > 127 ? x - 256 : x);
        }
      )
    );
    body.appendChild(
      evBool(I18n.t('cadeditor.ui.worldentity.text_shadow'), evGet(g, 'shadow'), '', function (on) {
        evSet(g, 'shadow', on);
      })
    );
    body.appendChild(
      evBool(I18n.t('cadeditor.ui.worldentity.visible_through_blocks'), evGet(g, 'see_through'), '', function (on) {
        evSet(g, 'see_through', on);
      })
    );
    body.appendChild(
      evBool(
        I18n.t('cadeditor.ui.worldentity.use_default_background'),
        evGet(g, 'default_background'),
        I18n.t('cadeditor.ui.worldentity.same_semi_transparent_bottom_chat'),
        function (on) {
          evSet(g, 'default_background', on);
        }
      )
    );
    body.appendChild(
      evNum(
        I18n.t('cadeditor.ui.worldentity.background_color'),
        evGet(g, 'background'),
        { sub: I18n.t('cadeditor.ui.worldentity.integer_argb_16777216_opaque_black') },
        function (x) {
          evSet(g, 'background', x);
        }
      )
    );
  }
}

/* ---------- 杂项实体视图：掉落物 / 下落方块 / TNT / 苦力怕 / 末影人 / 药水云 / 经验球 / 箭 / 交互实体
   后端视图和字段范围见 docs/world-entity-contract.md（P2-2 ~ P2-5）。范围读 schema.fields，游戏没给的不设限。 ---------- */
var EV_SIMPLE = [
  ['dropped_item', I18n.t('cadeditor.ui.worldentity.item_entity'), 'sword'],
  ['falling_block', I18n.t('cadeditor.ui.worldentity.falling_block'), 'cube'],
  ['tnt', 'TNT', 'flame'],
  ['creeper', I18n.t('cadeditor.ui.worldentity.creeper'), 'flame'],
  ['enderman', I18n.t('cadeditor.ui.worldentity.enderman'), 'cube'],
  ['area_effect_cloud', I18n.t('cadeditor.ui.worldentity.area_effect_cloud'), 'flask'],
  ['experience_orb', I18n.t('cadeditor.ui.worldentity.experience_orb'), 'sparkle'],
  ['arrow', I18n.t('cadeditor.ui.worldentity.arrow'), 'sword'],
  ['interaction', I18n.t('cadeditor.ui.worldentity.interaction'), 'sliders'],
  ['horse', I18n.t('cadeditor.ui.worldentity.taming_riding'), 'paw'],
  ['chested', I18n.t('cadeditor.ui.worldentity.pack_animal_chest'), 'chest'],
  ['vehicle_container', I18n.t('cadeditor.ui.worldentity.vehicle_container'), 'chest'],
  ['minecart_display', I18n.t('cadeditor.ui.worldentity.minecart_display_block'), 'cube'],
  ['minecart_command', I18n.t('cadeditor.ui.worldentity.command_block_minecart'), 'terminal'],
  ['boat_type', I18n.t('cadeditor.ui.worldentity.boat'), 'cart'],
  ['zombie_conversion', I18n.t('cadeditor.ui.worldentity.zombie_villager_conversion'), 'clock']
];
function evSimpleGroups() {
  return EV_SIMPLE.filter(function (g) {
    return evGroup(g[0]);
  });
}
function evSimpleTabInfo() {
  var g = evSimpleGroups();
  return g.length === 1
    ? { label: g[0][1], icon: g[0][2] }
    : { label: I18n.t('cadeditor.ui.worldentity.entity_settings'), icon: 'sliders' };
}
/* 范围来自后端的字段元数据的数值行：o = { sub, unit, step, dec, def, nullAt（等于这个值时发 null）} */
function evNumF(g, k, label, o) {
  o = o || {};
  var f = evFields(g)[k] || {},
    cur = evGet(g, k);
  return evNum(
    label,
    typeof cur === 'number' ? cur : o.def,
    { min: f.min, max: f.max, step: o.step, dec: o.dec, unit: o.unit, sub: o.sub },
    function (x) {
      evSet(g, k, o.nullAt !== undefined && x === o.nullAt ? null : x);
    }
  );
}
/* 一片格子，绑定到视图里的 [{slot, stack}] 列表（驮兽箱子的 Items、载具容器的 slots）：省略的格子 = 清空；草稿只在和原值不同时提交 */
function evSlotList(g, key, count) {
  function list() {
    var v = evGet(g, key);
    return Array.isArray(v) ? v : [];
  }
  function stackAt(i) {
    var e = list().filter(function (x) {
      return x.slot === i;
    })[0];
    return e && e.stack && !e.stack.empty ? e.stack : { empty: true };
  }
  var ix = [];
  for (var i = 0; i < count; i++) ix.push(i);
  function setSlot(i, st) {
    var l = list().filter(function (x) {
      return x.slot !== i;
    });
    if (st && !st.empty && st.id) {
      var s = clone(st);
      delete s.slot;
      delete s.label;
      l.push({ slot: i, stack: s });
    }
    l.sort(function (a, b) {
      return a.slot - b.slot;
    });
    evSet(g, key, l);
    weMarkDirty();
  }
  var grid = kSlotGrid({
    tight: true,
    indices: ix,
    cols: count <= 9 ? count : 9,
    stackOf: stackAt,
    titleOf: function (i) {
      return I18n.t('cadeditor.ui.slots.grid', i + 1);
    },
    set: setSlot
  });
  grid.setSlot = setSlot;
  return grid;
}
var EV_PICKUP = {
  DISALLOWED: I18n.t('cadeditor.ui.worldentity.cannot_pick_up'),
  ALLOWED: I18n.t('cadeditor.ui.worldentity.anyone_pick_up'),
  CREATIVE_ONLY: I18n.t('cadeditor.ui.worldentity.only_creative_players_pick_up')
};
function evSimpleTab(body) {
  var gs = evSimpleGroups();
  if (!gs.length) {
    body.appendChild(xEmpty(I18n.t('cadeditor.ui.worldentity.entity_special_settings')));
    return;
  }
  gs.forEach(function (info) {
    var fn = EV_SIMPLE_TAB[info[0]];
    if (fn) {
      body.appendChild(xSec(info[2], info[1]));
      fn(body);
    }
  });
}
var EV_SIMPLE_TAB = {
  /* 马 / 驴 / 骡 / 羊驼等：驯服状态、驯服进度、主人。鞍和身体装备在「属性」页的装备格里（同一次应用里先驯服再上鞍也可以） */
  horse: function (body) {
    var g = 'horse',
      own = evGroup(g) || {},
      cur = evGet(g, 'Owner') || '',
      players = own.players || [];
    body.appendChild(
      evBool(I18n.t('cadeditor.ui.worldentity.tamed'), evGet(g, 'Tame'), '', function (on) {
        evSet(g, 'Tame', on);
      })
    );
    body.appendChild(
      evNumF(g, 'Temper', I18n.t('cadeditor.ui.worldentity.taming_progress'), {
        sub: I18n.t('cadeditor.ui.worldentity.higher_values_make_taming_easier')
      })
    );
    var entries = players.map(function (p) {
      return { v: p.uuid, label: p.name, sub: p.uuid };
    });
    if (
      cur &&
      !entries.some(function (e) {
        return e.v === cur;
      })
    )
      entries.push({ v: cur, label: I18n.t('cadeditor.ui.worldentity.offline_player'), sub: cur });
    var sel = kSelect(
      entries,
      cur || null,
      function (v) {
        evSet(g, 'Owner', v);
        weRender();
      },
      {
        width: 240,
        empty: I18n.t('cadeditor.ui.pages.none'),
        placeholder: I18n.t('cadeditor.ui.worldentity.search_online_players')
      }
    );
    var right = [sel.el];
    if (cur)
      right.push(
        kBtn(
          I18n.t('cadeditor.ui.picker.clear'),
          function () {
            evSet(g, 'Owner', null);
            weRender();
          },
          { icon: 'trash' }
        )
      );
    body.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.worldentity.owner'),
        sub: I18n.t('cadeditor.ui.worldentity.clearing_untame_entity'),
        right: h('div', { class: 'k-row' }, right)
      })
    );
    body.appendChild(kHint(I18n.t('cadeditor.ui.worldentity.saddle_horses_attribute_page_equipment')));
  },
  chested: function (body) {
    var g = 'chested',
      own = evGroup(g) || {},
      cap = typeof own.capacity === 'number' ? own.capacity : 0,
      on = evGet(g, 'ChestedHorse');
    body.appendChild(
      evBool(
        I18n.t('cadeditor.ui.worldentity.chest'),
        on,
        I18n.t('cadeditor.ui.worldentity.get_rid_box_ll_lose'),
        function (v) {
          evSet(g, 'ChestedHorse', v);
          if (!v) evSet(g, 'Items', []);
          weRender();
        }
      )
    );
    if (on && cap > 0) {
      body.appendChild(evSlotList(g, 'Items', cap));
    } else if (on) body.appendChild(kHint(I18n.t('cadeditor.ui.worldentity.box_grids_moment')));
  },
  vehicle_container: function (body) {
    var g = 'vehicle_container',
      own = evGroup(g) || {};
    if (own.unresolved_loot) {
      body.appendChild(kHint(I18n.t('cadeditor.ui.worldentity.s_still_loot_hasn_t')));
      return;
    }
    body.appendChild(evSlotList(g, 'slots', own.size || 0));
  },
  minecart_display: function (body) {
    var g = 'minecart_display',
      off = evGet(g, 'DisplayOffset');
    body.appendChild(
      kBlockState(
        evGet(g, 'DisplayState'),
        function (v) {
          evSet(g, 'DisplayState', v);
          weRender();
        },
        {
          label: I18n.t('cadeditor.ui.worldentity.display_block'),
          sub: I18n.t('cadeditor.ui.worldentity.clear_mine_truck'),
          allowNone: true,
          empty: I18n.t('cadeditor.ui.worldentity.unchanged')
        }
      )
    );
    body.appendChild(
      evNum(
        I18n.t('cadeditor.ui.worldentity.display_height_offset'),
        typeof off === 'number' ? off : 6,
        { sub: I18n.t('cadeditor.ui.worldentity.default_6') },
        function (x) {
          evSet(g, 'DisplayOffset', x);
        }
      )
    );
    if (typeof off === 'number')
      body.appendChild(
        xRow({
          icon: false,
          title: I18n.t('cadeditor.ui.worldentity.reset_offset'),
          right: kBtn(
            I18n.t('cadeditor.ui.drafts.restore'),
            function () {
              evSet(g, 'DisplayOffset', null);
              weRender();
            },
            { icon: 'undo' }
          )
        })
      );
  },
  minecart_command: function (body) {
    var g = 'minecart_command',
      own = evGroup(g) || {};
    var ta = h('textarea', {
      class: 'ed-snbt we-cmd',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.worldentity.command_without_writing_beginning')
    });
    ta.value = String(evGet(g, 'Command') || '');
    ta.addEventListener('change', function () {
      evSet(g, 'Command', ta.value);
    });
    body.appendChild(xRow({ icon: false, title: I18n.t('cadeditor.ui.screens.command') }));
    body.appendChild(ta);
    cmdAssistAttach(ta, 'world:minecart', function (text) {
      ta.value = text;
      evSet(g, 'Command', text);
    });
    var lo = own.LastOutput;
    body.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.worldentity.previous_output'),
        sub: I18n.t('cadeditor.ui.worldentity.read_only'),
        right: h('span', { class: 'k-sub', text: lo ? msgText(lo) : I18n.t('cadeditor.ui.worldentity.none') })
      })
    );
  },
  boat_type: function (body) {
    var own = evGroup('boat_type') || {};
    body.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.worldentity.type'),
        sub: I18n.t('cadeditor.ui.worldentity.entity_type_changed'),
        right: h('span', { class: 'k-sub', text: own.entityType ? entityName(own.entityType) : '' })
      })
    );
  },
  zombie_conversion: function (body) {
    var own = evGroup('zombie_conversion') || {},
      t = own.ConversionTime;
    body.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.worldentity.conversion_countdown'),
        sub: I18n.t('cadeditor.ui.worldentity.read_only'),
        right: h('span', {
          class: 'k-sub',
          text:
            typeof t === 'number' && t >= 0
              ? I18n.t('cadeditor.ui.worldentity.moment', t)
              : I18n.t('cadeditor.ui.worldentity.converting')
        })
      })
    );
  },
  dropped_item: function (body) {
    var g = 'dropped_item',
      st = evGet(g, 'Item') || { id: 'minecraft:stone', count: 1, comps: {}, removed: {} };
    body.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.pages.item_2'),
        right: evStack(
          st,
          function (s) {
            evSet(g, 'Item', s);
            weRender();
          },
          { clear: false }
        )
      })
    );
    body.appendChild(
      evNum(I18n.t('cadeditor.ui.pages.count'), st.count, { min: 1, max: 99 }, function (x) {
        var n = clone(evGet(g, 'Item') || st);
        n.count = x;
        evSet(g, 'Item', n);
      })
    );
    body.appendChild(
      evNumF(g, 'PickupDelay', I18n.t('cadeditor.ui.worldentity.pickup_delay'), {
        unit: I18n.t('cadeditor.ui.cards2.ticks'),
        sub: I18n.t('cadeditor.ui.worldentity.n32767_never_pick_up')
      })
    );
    body.appendChild(
      evNumF(g, 'Age', I18n.t('cadeditor.ui.worldentity.age'), {
        unit: I18n.t('cadeditor.ui.cards2.ticks'),
        sub: I18n.t('cadeditor.ui.worldentity.n6000_disappears_32768_never_disappears')
      })
    );
  },
  falling_block: function (body) {
    var g = 'falling_block';
    body.appendChild(
      kBlockState(
        evGet(g, 'BlockState'),
        function (v) {
          evSet(g, 'BlockState', v || { Name: 'minecraft:sand' });
        },
        { label: I18n.t('cadeditor.ui.picker.block'), title: I18n.t('cadeditor.ui.picker.choose_block') }
      )
    );
    body.appendChild(
      evNumF(g, 'Time', I18n.t('cadeditor.ui.worldentity.time_since_dropped'), {
        unit: I18n.t('cadeditor.ui.cards2.ticks')
      })
    );
    body.appendChild(
      evNumF(g, 'FallHurtAmount', I18n.t('cadeditor.ui.worldentity.damage_per_block_fallen'), { step: 0.1, dec: 3 })
    );
    body.appendChild(evNumF(g, 'FallHurtMax', I18n.t('cadeditor.ui.worldentity.max_falling_damage')));
    body.appendChild(
      evBool(I18n.t('cadeditor.ui.worldentity.drop_item_landing'), evGet(g, 'DropItem'), '', function (on) {
        evSet(g, 'DropItem', on);
      })
    );
    body.appendChild(
      evBool(I18n.t('cadeditor.ui.worldentity.damage_entities_impact'), evGet(g, 'HurtEntities'), '', function (on) {
        evSet(g, 'HurtEntities', on);
      })
    );
    body.appendChild(
      evBool(I18n.t('cadeditor.ui.worldentity.cancel_drop'), evGet(g, 'CancelDrop'), '', function (on) {
        evSet(g, 'CancelDrop', on);
      })
    );
  },
  tnt: function (body) {
    body.appendChild(
      evNumF('tnt', 'fuse', I18n.t('cadeditor.ui.worldentity.fuse'), {
        unit: I18n.t('cadeditor.ui.cards2.ticks'),
        sub: I18n.t('cadeditor.ui.worldentity.n20_min_1_seconds_count')
      })
    );
  },
  creeper: function (body) {
    body.appendChild(
      evNumF('creeper', 'Fuse', I18n.t('cadeditor.ui.worldentity.ignition_countdown'), {
        unit: I18n.t('cadeditor.ui.cards2.ticks'),
        sub: I18n.t('cadeditor.ui.worldentity.delay_ignition_explosion')
      })
    );
    body.appendChild(evNumF('creeper', 'ExplosionRadius', I18n.t('cadeditor.ui.worldentity.explosion_power')));
  },
  enderman: function (body) {
    var g = 'enderman';
    body.appendChild(
      kBlockState(
        evGet(g, 'carriedBlockState'),
        function (v) {
          evSet(g, 'carriedBlockState', v);
        },
        {
          label: I18n.t('cadeditor.ui.worldentity.held_block'),
          sub: I18n.t('cadeditor.ui.worldentity.clear_holding_nothing'),
          allowNone: true,
          empty: I18n.t('cadeditor.ui.worldentity.holding_nothing')
        }
      )
    );
  },
  area_effect_cloud: function (body) {
    var g = 'area_effect_cloud',
      pc = evGet(g, 'potion_contents');
    var pot = typeof pc === 'string' ? pc : (pc && pc.potion) || '';
    var sel = kRegSelect({
      reg: 'potion',
      value: pot,
      title: I18n.t('cadeditor.ui.worldentity.choose_potion'),
      empty: I18n.t('cadeditor.ui.pages.none'),
      allowClear: true,
      onChange: function (id) {
        var o = pc && typeof pc === 'object' ? clone(pc) : {};
        if (id) o.potion = id;
        else delete o.potion;
        evSet(g, 'potion_contents', Object.keys(o).length ? o : null);
      }
    });
    var extra =
      pc && typeof pc === 'object' && Array.isArray(pc.custom_effects) && pc.custom_effects.length
        ? I18n.t('cadeditor.ui.worldentity.another_custom_effect_changed_data', pc.custom_effects.length)
        : '';
    body.appendChild(xRow({ icon: false, title: I18n.t('cadeditor.ui.cards3.potion'), right: sel.el }));
    if (extra) body.appendChild(kHint(extra));
    body.appendChild(evNumF(g, 'Radius', I18n.t('cadeditor.ui.worldentity.radius'), { step: 0.1, dec: 3 }));
    body.appendChild(
      evNumF(g, 'RadiusOnUse', I18n.t('cadeditor.ui.worldentity.radius_change_per_application'), { step: 0.1, dec: 3 })
    );
    body.appendChild(
      evNumF(g, 'RadiusPerTick', I18n.t('cadeditor.ui.worldentity.radius_change_per_tick'), { step: 0.01, dec: 4 })
    );
    body.appendChild(
      evNumF(g, 'Duration', I18n.t('cadeditor.ui.worldentity.total_duration'), {
        unit: I18n.t('cadeditor.ui.cards2.ticks')
      })
    );
    body.appendChild(
      evNumF(g, 'Age', I18n.t('cadeditor.ui.worldentity.age'), { unit: I18n.t('cadeditor.ui.cards2.ticks') })
    );
    body.appendChild(
      evNumF(g, 'WaitTime', I18n.t('cadeditor.ui.worldentity.delay_before_activation'), {
        unit: I18n.t('cadeditor.ui.cards2.ticks')
      })
    );
    body.appendChild(
      evNumF(g, 'ReapplicationDelay', I18n.t('cadeditor.ui.worldentity.delay_between_applications_same_entity'), {
        unit: I18n.t('cadeditor.ui.cards2.ticks')
      })
    );
    body.appendChild(
      evNumF(g, 'DurationOnUse', I18n.t('cadeditor.ui.worldentity.duration_change_per_application'), {
        unit: I18n.t('cadeditor.ui.cards2.ticks')
      })
    );
    var ds = evGet(g, 'potion_duration_scale');
    body.appendChild(
      evNum(
        I18n.t('cadeditor.ui.worldentity.effect_duration_multiplier'),
        typeof ds === 'number' ? ds : 1,
        { step: 0.1, dec: 3, sub: I18n.t('cadeditor.ui.worldentity.n1_unchanged') },
        function (x) {
          evSet(g, 'potion_duration_scale', x === 1 ? null : x);
        }
      )
    );
  },
  experience_orb: function (body) {
    body.appendChild(evNumF('experience_orb', 'Value', I18n.t('cadeditor.ui.worldentity.experience')));
  },
  arrow: function (body) {
    var g = 'arrow',
      opts = (evFields(g).pickup || {}).options || [];
    body.appendChild(evNumF(g, 'damage', I18n.t('cadeditor.ui.worldentity.damage'), { step: 0.5, dec: 3 }));
    if (opts.length)
      body.appendChild(
        xSeg({
          title: I18n.t('cadeditor.ui.worldentity.pickup_mode'),
          options: opts.map(function (o) {
            return { v: o.value, label: EV_PICKUP[o.label] || o.label };
          }),
          value: evGet(g, 'pickup'),
          onChange: function (x) {
            evSet(g, 'pickup', x);
          }
        })
      );
  },
  interaction: function (body) {
    var g = 'interaction';
    body.appendChild(evNumF(g, 'width', I18n.t('cadeditor.ui.worldentity.width'), { step: 0.1, dec: 3 }));
    body.appendChild(evNumF(g, 'height', I18n.t('cadeditor.ui.worldentity.height'), { step: 0.1, dec: 3 }));
    body.appendChild(
      evBool(
        I18n.t('cadeditor.ui.worldentity.respond_clicks'),
        evGet(g, 'response'),
        I18n.t('cadeditor.ui.worldentity.light_game_give_feedback'),
        function (on) {
          evSet(g, 'response', on);
        }
      )
    );
  }
};

/* ---------- 关系：主人（可改）、队伍和拴绳（只读） ---------- */
function evHasRelations() {
  var team = evGroup('team'),
    leash = evGroup('leash');
  return !!evGroup('owner') || !!(leash && leash.data) || !!(team && team.name);
}
function evRelationTab(body) {
  var own = evGroup('owner');
  if (own) {
    var cur = evGet('owner', 'Owner') || '',
      players = own.players || [];
    body.appendChild(xSec('user', I18n.t('cadeditor.ui.worldentity.owner')));
    if (own.available === false)
      body.appendChild(
        xRow({
          icon: false,
          title: I18n.t('cadeditor.ui.worldentity.owner'),
          sub: I18n.t('cadeditor.ui.worldentity.server_t_replaced_just_clean'),
          right: h('span', { class: 'k-sub', text: cur || I18n.t('cadeditor.ui.pages.none') })
        })
      );
    var entries = players.map(function (p) {
      return { v: p.uuid, label: p.name, sub: p.uuid };
    });
    if (
      cur &&
      !entries.some(function (e) {
        return e.v === cur;
      })
    )
      entries.push({ v: cur, label: I18n.t('cadeditor.ui.worldentity.offline_player'), sub: cur });
    var sel = kSelect(
      entries,
      cur || null,
      function (v) {
        evSet('owner', 'Owner', v);
        weRender();
      },
      {
        width: 240,
        empty: I18n.t('cadeditor.ui.pages.none'),
        placeholder: I18n.t('cadeditor.ui.worldentity.search_online_players')
      }
    );
    var right = [sel.el];
    if (cur)
      right.push(
        kBtn(
          I18n.t('cadeditor.ui.picker.clear'),
          function () {
            evSet('owner', 'Owner', null);
            weRender();
          },
          { icon: 'trash' }
        )
      );
    body.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.vaultworld.player'),
        sub: I18n.t('cadeditor.ui.worldentity.only_online_cleared_out_longer'),
        right: h('div', { class: 'k-row' }, right)
      })
    );
  }
  var team = evGroup('team'),
    leash = evGroup('leash');
  body.appendChild(xSec('users', I18n.t('cadeditor.ui.worldentity.read_only')));
  if (team)
    body.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.worldentity.team'),
        sub: team.available === false ? I18n.t('cadeditor.ui.worldentity.world_scoreboard') : '',
        right: h('span', { class: 'k-sub', text: team.name || I18n.t('cadeditor.ui.worldentity.team_2') })
      })
    );
  if (leash)
    body.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.worldentity.leash'),
        sub: leash.data ? I18n.t('cadeditor.ui.worldentity.attaching_detaching_editable_yet') : '',
        right: h('span', {
          class: 'k-sub',
          text: leash.data ? I18n.t('cadeditor.ui.worldentity.leashed') : I18n.t('cadeditor.ui.worldentity.leashed_2')
        })
      })
    );
}

/* ---------- 村民 / 流浪商人交易（只有服务端能改） ---------- */
function evOffers() {
  if (WE.offers === null) WE.offers = clone(evOffersOrig());
  return WE.offers;
}
function evTradePreview(offer) {
  function stack(st) {
    if (!st || !st.id) return h('span', { class: 'k-sub', text: I18n.t('cadeditor.ui.worldentity.selected') });
    var icon = stackUiIcon(st, 20);
    if (icon.tagName && icon.tagName.toLowerCase() === 'item') icon.setAttribute('count', '1');
    return h('div', { class: 'trade-summary-stack' }, [
      icon,
      stackUiName(st),
      h('span', { class: 'trade-count', text: '× ' + (st.count || 1) })
    ]);
  }
  return h('div', { class: 'trade-summary' }, [
    h('div', { class: 'trade-summary-side' }, [
      h('span', { class: 'k-sub', text: I18n.t('cadeditor.ui.worldentity.pay') }),
      stack(offer.buy),
      offer.buyB ? h('span', { class: 'k-sub', text: '+' }) : null,
      offer.buyB ? stack(offer.buyB) : null
    ]),
    h('span', { class: 'trade-arrow', text: '→' }),
    h('div', { class: 'trade-summary-side' }, [
      h('span', { class: 'k-sub', text: I18n.t('cadeditor.ui.worldentity.receive') }),
      stack(offer.sell)
    ])
  ]);
}
/* 交易编辑窗（世界村民和物品形态的刷怪蛋 / 刷怪笼共用）。offer 的物品是 wire 栈 {id,count,comps,removed}。
   env = { valid()→这条交易仍属于打开它的草稿, mark() 写回草稿, closed() 关窗后重画 } */
function tradeEditModal(offer, index, env) {
  var priceOpen = false;
  var host = h('div', { class: 'trade-edit-body' });
  function valid() {
    return env.valid();
  }
  function mark() {
    if (!valid()) {
      toast(I18n.t('cadeditor.ui.worldentity.trading_target_updated_open_again'), 'warn');
      return false;
    }
    env.mark();
    return true;
  }
  function stackEditor(key, optional) {
    var cur = offer[key],
      has = cur && cur.id;
    function put(st) {
      if (!valid()) {
        toast(I18n.t('cadeditor.ui.worldentity.trading_target_updated_open_again'), 'warn');
        return;
      }
      if (!st) delete offer[key];
      else {
        var next = clone(st);
        delete next.slot;
        delete next.label;
        if (cur && next.id !== cur.id) delete next.cost_predicate_snbt;
        offer[key] = next;
      }
      mark();
    }
    var label =
      key === 'sell'
        ? I18n.t('cadeditor.ui.worldentity.receive')
        : optional
          ? I18n.t('cadeditor.ui.worldentity.additional_payment')
          : I18n.t('cadeditor.ui.worldentity.pay');
    if (!has && optional) {
      var addCost = kBtn(
        I18n.t('cadeditor.ui.worldentity.add_second_cost'),
        function () {
          choose(addCost);
        },
        { icon: 'plus', cls: 'trade-add-cost' }
      );
      return addCost;
    }
    var pick = kItemBtn(has ? cur : null, null);
    function choose(anchor) {
      pickItem(
        anchor,
        function (id) {
          put({ id: fullId(id), count: (cur && cur.count) || 1, comps: {}, removed: {} });
          paint();
        },
        {
          onStack: function (st) {
            put(st);
            paint();
          }
        }
      );
    }
    activate(pick, function () {
      choose(pick);
    });
    var controls = [];
    if (has) {
      var qty = kNumber(cur.count || 1, {
        min: 1,
        noSlider: true,
        step: 1,
        onChange: function (v) {
          if (valid()) {
            cur.count = v;
            var icon = pick.querySelector('item');
            if (icon) icon.setAttribute('count', String(v));
            mark();
          }
        }
      });
      var field = qty.el.querySelector('input');
      if (field) field.setAttribute('aria-label', I18n.t('cadeditor.ui.worldentity.count', label));
      controls.push(
        h('span', {
          class: 'k-sub',
          text: key === 'sell' ? I18n.t('cadeditor.ui.pages.count') : I18n.t('cadeditor.ui.worldentity.base_count'),
          title:
            key === 'sell'
              ? I18n.t('cadeditor.ui.worldentity.count_received')
              : I18n.t('cadeditor.ui.worldentity.real_deal_also_influenced_price')
        }),
        qty.el,
        kBtn(
          I18n.t('cadeditor.ui.common.edit'),
          function () {
            if (!valid()) {
              mark();
              return;
            }
            var parentValid = nestedDraftGuard();
            openNestedItem(cur, {
              title: I18n.t('cadeditor.ui.worldentity.transaction', label),
              valid: function (session) {
                return valid() && parentValid(session);
              },
              commit: put,
              render: paint
            });
          },
          { icon: 'edit', title: I18n.t('cadeditor.ui.worldentity.edit_name_item_component_nbt') }
        )
      );
      if (optional)
        controls.push(
          kDelete(function () {
            put(null);
            paint();
          }, I18n.t('cadeditor.ui.worldentity.remove_second_cost'))
        );
    }
    return h('div', { class: 'trade-item-editor' }, [
      optional ? h('span', { class: 'k-sub', text: I18n.t('cadeditor.ui.worldentity.additional_payment_2') }) : null,
      pick,
      h('div', { class: 'trade-item-controls' }, controls)
    ]);
  }
  function num(label, key, options) {
    options = options || {};
    var n = kNumber(typeof offer[key] === 'number' ? offer[key] : 0, {
      min: options.min,
      step: options.step || 1,
      dec: options.dec,
      noSlider: true,
      onChange: function (v) {
        if (valid()) {
          offer[key] = v;
          mark();
        }
      }
    });
    return xField(null, label, n.el);
  }
  function paint() {
    clear(host);
    var pay = h('div', { class: 'trade-edit-side' }, [
      h('div', { class: 'trade-side-title', text: I18n.t('cadeditor.ui.worldentity.pay') }),
      stackEditor('buy', false),
      stackEditor('buyB', true)
    ]);
    var gain = h('div', { class: 'trade-edit-side' }, [
      h('div', { class: 'trade-side-title', text: I18n.t('cadeditor.ui.worldentity.receive') }),
      stackEditor('sell', false)
    ]);
    host.appendChild(
      h('div', { class: 'trade-edit-flow' }, [pay, h('div', { class: 'trade-arrow', text: '→' }), gain])
    );
    host.appendChild(
      h('div', { class: 'trade-settings' }, [
        num(I18n.t('cadeditor.ui.worldentity.uses'), 'uses', { min: 0 }),
        num(I18n.t('cadeditor.ui.worldentity.max_uses'), 'maxUses', { min: 0 }),
        num(I18n.t('cadeditor.ui.worldentity.villager_xp'), 'xp', { min: 0 }),
        xField(
          null,
          I18n.t('cadeditor.ui.worldentity.player_receives_xp'),
          kToggle(offer.rewardExp !== false, function (on) {
            if (valid()) {
              offer.rewardExp = on;
              mark();
            }
          }).el
        )
      ])
    );
    host.appendChild(
      xRow({
        icon: uiIcon('coins', 14),
        title: I18n.t('cadeditor.ui.worldentity.special_price'),
        sub: I18n.t('cadeditor.ui.worldentity.demand_discounts_price_multiplier'),
        chevron: true,
        open: priceOpen,
        onHead: function () {
          priceOpen = !priceOpen;
          paint();
        },
        body: function () {
          return [
            num(I18n.t('cadeditor.ui.worldentity.price_multiplier'), 'priceMultiplier', { step: 0.01, dec: 3 }),
            num(I18n.t('cadeditor.ui.worldentity.demand'), 'demand'),
            num(I18n.t('cadeditor.ui.worldentity.special_price_adjustment'), 'specialPrice')
          ];
        }
      })
    );
  }
  paint();
  var modal = openModal(
    modalShell(
      I18n.t('cadeditor.ui.worldentity.transaction_2', index + 1),
      I18n.t('cadeditor.ui.worldentity.changes_saved_parent_draft'),
      [host],
      [h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.done'), closeModal, { cls: 'pri' })],
      'trade-editor'
    ),
    true
  );
  modal.onEditorClose = function () {
    if (valid() && !NestedItem && env.closed) env.closed();
  };
  return modal;
}
function openTradeDraft(offer, index) {
  var owner = WE.w,
    offers = WE.offers;
  return tradeEditModal(offer, index, {
    valid: function () {
      return WE.w === owner && WE.offers === offers && offers.indexOf(offer) >= 0;
    },
    mark: weMarkDirty,
    closed: weRedrawBody
  });
}
/* 新交易的起始内容：编辑器给的样板，不是游戏数据 */
function tradeTemplate() {
  return {
    buy: { id: 'minecraft:emerald', count: 1, comps: {}, removed: {} },
    sell: { id: 'minecraft:bread', count: 1, comps: {}, removed: {} },
    uses: 0,
    maxUses: 12,
    rewardExp: true,
    xp: 1,
    priceMultiplier: 0.05,
    demand: 0,
    specialPrice: 0
  };
}
/* 交易列表（世界村民页和物品形态共用）：每条一行「你支付 → 你获得」，点开编辑窗。
   o = { list, mark() 写回, redraw() 重画, open(offer, i) 打开编辑窗, max（条数上限，默认 256）, create()→新交易 } */
function tradeListRows(body, o) {
  var list = o.list,
    max = o.max || 256;
  list.forEach(function (offer, i) {
    var row = xRow({
      icon: false,
      title: '',
      sub: I18n.t('cadeditor.ui.worldentity.text', offer.uses || 0, offer.maxUses || 0),
      right: kBtn(
        I18n.t('cadeditor.ui.common.edit'),
        function () {
          o.open(offer, i);
        },
        { icon: 'edit' }
      ),
      onDelete: function () {
        list.splice(i, 1);
        o.mark();
        o.redraw();
      },
      onHead: function () {
        o.open(offer, i);
      }
    });
    row.classList.add('trade-list-row');
    row.querySelector('.z').appendChild(evTradePreview(offer));
    body.appendChild(row);
  });
  if (list.length < max)
    body.appendChild(
      xAdd(I18n.t('cadeditor.ui.worldentity.add_trade'), function () {
        var offer = o.create ? o.create() : tradeTemplate();
        list.push(offer);
        o.mark();
        o.redraw();
        o.open(offer, list.length - 1);
      })
    );
}
function evTradeTab(body) {
  var t = evGroup('trades');
  if (!t || t.available === false) {
    body.appendChild(
      xEmpty((t && t.reason) || I18n.t('cadeditor.ui.worldentity.transaction_only_modified_server_built'))
    );
    return;
  }
  var list = evOffers();
  body.appendChild(
    xSec('coins', I18n.t('cadeditor.ui.worldedit.trades'), I18n.t('cadeditor.ui.worldentity.bar', list.length))
  );
  tradeListRows(body, { list: list, mark: weMarkDirty, redraw: weRender, open: openTradeDraft });
  body.appendChild(kHint(I18n.t('cadeditor.ui.worldentity.closes_game_transaction_ui_applies')));
}

/* ---------- 乘客 / 骑乘：每一步都是单独的 apply.riding，立刻提交 ---------- */
function evRideSend(riding, note) {
  if (weDirty()) {
    toast(I18n.t('cadeditor.ui.worldentity.applicable_changes_passenger_changes'), 'info');
    return;
  }
  weSend(
    'apply',
    { requestId: 'w-' + Date.now() + '-' + ++WE.seq, slot: clone(WE.w.slot), riding: riding },
    note || I18n.t('cadeditor.ui.worldedit.submitted_game_waiting_response')
  );
}
function evRidingTab(body) {
  var r = evGroup('riding') || {},
    ps = r.passengers || [],
    vh = r.vehicle;
  body.appendChild(xSec('users', I18n.t('cadeditor.ui.worldentity.riding')));
  if (vh)
    body.appendChild(
      xRow({
        icon: entityIcon(vh.type, 22),
        title: I18n.t('cadeditor.ui.worldentity.rideing', vh.summary || entityName(vh.type)),
        sub: shortId(vh.type),
        right: kBtn(
          I18n.t('cadeditor.ui.worldentity.dismount'),
          function () {
            evRideSend({ action: 'dismount' }, I18n.t('cadeditor.ui.worldentity.dismounting'));
          },
          { icon: 'down' }
        )
      })
    );
  else body.appendChild(kHint(I18n.t('cadeditor.ui.worldentity.riding_another_entity')));
  /* 乘客卡片：头部右侧放「添加」和「全部赶下去」，列表在下面，添加表单点「添加」才展开 */
  var addOpen = WE.rideAddOpen === undefined ? !ps.length : !!WE.rideAddOpen,
    addBox = h('div', { class: 'wp-addbox' });
  var acts = h('span', { class: 'wp-acts' }, [
    ps.length
      ? kBtn(
          I18n.t('cadeditor.ui.worldentity.eject_all_passengers'),
          function () {
            evRideSend({ action: 'eject' }, I18n.t('cadeditor.ui.worldentity.ejecting_all_passengers'));
          },
          { icon: 'close', title: I18n.t('cadeditor.ui.worldentity.dismiss_only_riding_mob_deleted') }
        )
      : null,
    kBtn(
      I18n.t('cadeditor.ui.cards3.add'),
      function () {
        addOpen = !addOpen;
        WE.rideAddOpen = addOpen;
        if (addOpen) {
          addBox.style.display = '';
          uiSlide(addBox, true);
        } else
          uiSlide(addBox, false, function () {
            addBox.style.display = 'none';
          });
      },
      { icon: 'plus', cls: 'pri', title: I18n.t('cadeditor.ui.worldentity.add_passenger') }
    )
  ]);
  body.appendChild(
    xSec(
      'paw',
      I18n.t('cadeditor.ui.worldedit.passengers'),
      ps.length ? I18n.t('cadeditor.ui.cards1.text', ps.length) : I18n.t('cadeditor.ui.worldentity.none_2'),
      acts
    )
  );
  function node(p, depth) {
    body.appendChild(
      xRow({
        icon: entityIcon(p.type, 22),
        title: (depth ? '↳ ' : '') + (p.summary || entityName(p.type)),
        sub:
          shortId(p.type) +
          (p.passengers && p.passengers.length ? I18n.t('cadeditor.ui.worldentity.carrying', p.passengers.length) : ''),
        tip: p.uuid,
        right: kBtn(
          I18n.t('cadeditor.ui.worldentity.eject'),
          function () {
            evRideSend({ action: 'remove', uuid: p.uuid }, I18n.t('cadeditor.ui.worldentity.dismounting'));
          },
          { icon: 'close', title: I18n.t('cadeditor.ui.worldentity.dismiss_only_riding_mob_deleted') }
        )
      })
    );
    (p.passengers || []).forEach(function (c) {
      node(c, depth + 1);
    });
  }
  if (!ps.length) body.appendChild(xEmpty(I18n.t('cadeditor.ui.worldentity.passengers')));
  ps.forEach(function (p) {
    node(p, 0);
  });
  var type = WE.rideType || 'minecraft:chicken',
    data = WE.rideData || '';
  addBox.appendChild(
    esEntityHeader({
      id: type,
      snbtText: function () {
        var e = vaultEntityObj(WE.rideData || '{}');
        e.id = WE.rideType || type;
        return nbtMerge(e, null);
      },
      onPick: function (id) {
        if (WE.rideType !== id) WE.rideData = '';
        WE.rideType = id;
        weRedrawBody();
      },
      onEntityNbt: function (snbt) {
        try {
          var payload = vaultEntityPayload(snbt);
          WE.rideType = payload.type;
          WE.rideData = payload.snbt;
          weRedrawBody();
        } catch (e) {
          toast(e.message || I18n.t('cadeditor.ui.worldentity.could_read_entity_data'), 'error');
        }
      }
    })
  );
  var inp = kInput(data, function () {}, {
    placeholder: I18n.t('cadeditor.ui.worldentity.selectable_data_example_customname_kick'),
    onCommit: function (t) {
      WE.rideData = t;
    }
  });
  inp.classList.add('we-in');
  addBox.appendChild(
    xRow({
      icon: false,
      title: I18n.t('cadeditor.ui.worldentity.initial_data'),
      sub: I18n.t('cadeditor.ui.worldentity.snbt_optional'),
      right: inp
    })
  );
  addBox.appendChild(
    h('div', { class: 'k-row' }, [
      kBtn(
        I18n.t('cadeditor.ui.worldentity.add'),
        function () {
          var act = { action: 'add', type: WE.rideType || 'minecraft:chicken' };
          if ((WE.rideData || '').trim()) act.entity_data = WE.rideData.trim();
          evRideSend(act, I18n.t('cadeditor.ui.worldentity.adding_passenger'));
        },
        { cls: 'pri', icon: 'plus' }
      )
    ])
  );
  addBox.appendChild(kHint(I18n.t('cadeditor.ui.worldentity.modification_riding_relationship_cannot')));
  addBox.insertBefore(kHint(I18n.t('cadeditor.ui.worldentity.new_mob_decide_they_ride')), addBox.firstChild);
  addBox.style.display = addOpen ? '' : 'none';
  body.appendChild(addBox);
}
