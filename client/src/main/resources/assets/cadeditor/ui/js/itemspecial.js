/* 物品形态的特殊数据：盔甲架、展示框（entity_data），告示牌、命令方块（block_entity_data），刷怪蛋 / 刷怪笼里村民类生物的交易。
   类型与 id 一律由物品决定：item_meta.placed_entity（物品类放出的实体）、block_entity_type（方块实体类），不从名字猜。
   表单只改自己管的字段；其余字段（未知键、long、类型化数组、特殊浮点）原样保留，并在「其它字段」里用通用字段表编辑。
   世界编辑侧用同一套姿势预设、锁定位、告示牌一面和交易窗（worldentity.js / worldview.js）。 */

function isMeta() {
  var m = Reg.live() ? Reg.itemMeta(Ctx.doc().id) : false;
  return m || {};
}
/* 物品放出的实体类型（ArmorStandItem / HangingEntityItem 的事实） */
function isPlaced() {
  return isMeta().placed_entity || '';
}
/* 物品方块的方块实体类型 */
function isBlockType() {
  return isMeta().block_entity_type || '';
}
function isFlagOn(v) {
  return v === true || (v !== false && v !== undefined && v !== null && nbtNumberValue(v) !== 0);
}
/* 写回实体数据：id 固定为物品放出的类型；除 id 外没有字段就去掉这个组件 */
function isEntGet() {
  var ed = Ctx.get('entity_data');
  return isObj(ed) ? ed : {};
}
function isEntSet(o) {
  isWriteTyped('entity_data', o, isPlaced(), I18n.t('cadeditor.ui.spawn.entity_data'));
}
function isBlkGet() {
  var v = Ctx.get('block_entity_data');
  return isObj(v) ? v : {};
}
function isBlkSet(o) {
  isWriteTyped('block_entity_data', o, isBlockType(), I18n.t('cadeditor.ui.pages.block_entity_data'));
}
function isWriteTyped(cid, o, type, label) {
  var rest = Object.keys(o).filter(function (k) {
    return k !== 'id';
  });
  if (!rest.length) {
    if (Ctx.modified(cid)) Ctx.disable(cid, { structural: false });
    return;
  }
  if (type) o.id = type;
  Ctx.setSmart(cid, o, { label: label });
}
function isEntIo() {
  return {
    get: isEntGet,
    set: function (o) {
      isEntSet(o);
    },
    redraw: eggRedraw
  };
}
/* 数据里写的类型和物品不符时提示：游戏按物品的类型读，类型不符的数据会被忽略。表单写回时改成物品的类型 */
function isTypeNote(body, data, type) {
  if (typeof data.id === 'string' && type && Reg.full(data.id) !== Reg.full(type))
    body.appendChild(kHint(I18n.t('cadeditor.ui.itemspecial.type_mismatch', data.id, type), 'warn'));
}
/* 三个角度写成 float 列表（Rotations 的保存类型） */
function isFloatList(arr) {
  return nbtNote(
    '[' +
      arr
        .map(function (n) {
          return nbtNum(+n, { k: 'num', t: 'f', raw: '', v: NaN });
        })
        .join(',') +
      ']'
  );
}
/* 一行开关：值缺省时显示 def */
function isToggle(title, sub, key, get, put, def) {
  var v = get()[key];
  return xToggle({
    title: title,
    sub: sub,
    tip: key,
    value: v === undefined ? !!def : isFlagOn(v),
    onChange: function (on) {
      var o = clone(get());
      o[key] = on;
      put(o);
    }
  });
}
/* 名字（文本组件）：复用富文本编辑器 */
function isNameRow(title, get, put) {
  var cur = get().CustomName;
  var r = kRich(cur === undefined || cur === null ? '' : cur, {
    placeholder: I18n.t('cadeditor.ui.eschema.leave_blank_name'),
    onChange: function (v, empty) {
      var o = clone(get());
      if (empty) delete o.CustomName;
      else nbtPut(o, 'CustomName', v);
      put(o);
    }
  });
  return h('div', { class: 'is-name' }, [h('div', { class: 'k-sub', text: title, title: 'CustomName' }), r.el]);
}
function isSchema(type) {
  return type ? Reg.entitySchema(type) : null;
}
function isView(type, g) {
  var s = isSchema(type);
  return (s && s.views && s.views[g] && s.views[g].fields) || {};
}

/* ---------- 盔甲架物品 ---------- */
/* 预览姿势串（与 EditorStandPreview 同一格式）；三个外观开关总是带上，预览元素复用时不会残留上一次的状态 */
function standAttrOf(data, F) {
  var pose = isObj(data.Pose) ? data.Pose : {},
    out = [];
  EV_PARTS.forEach(function (pp) {
    var c = pose[pp[0]];
    if (!Array.isArray(c)) c = (F[pp[0]] && F[pp[0]].default) || null;
    if (Array.isArray(c) && c.length >= 3)
      out.push(
        pp[0] +
          '=' +
          [0, 1, 2]
            .map(function (i) {
              var n = +nbtNumberValue(c[i]);
              return isFinite(n) ? n : 0;
            })
            .join(',')
      );
  });
  ['ShowArms', 'Small', 'NoBasePlate'].forEach(function (k) {
    var on = data[k] === undefined ? !!(F[k] && F[k].default) : isFlagOn(data[k]);
    out.push(k + '=' + (on ? 1 : 0));
  });
  return out.join(';');
}
function standPreviewData(type) {
  var data = clone(isEntGet());
  data.__cad_stand = standAttrOf(data, isView(type, 'pose'));
  return data;
}
/* 改角度不重画整页：卡片里的 3D 预览就地更新 */
function standLive(type) {
  var el = $('edbody') && $('edbody').querySelector('.is-stand-ent');
  if (!el) return;
  try {
    heroEntity(type, standPreviewData(type), el);
  } catch (e) {
    if (typeof EditorDiag !== 'undefined') EditorDiag.error('preview.stand.item', e);
  }
}
function standWrite(type, fn, redraw) {
  var o = clone(isEntGet());
  fn(o);
  isEntSet(o);
  if (redraw) eggRedraw();
  else standLive(type);
}
CARDS.standPose = function () {
  var type = isPlaced(),
    card = eggCard(
      'standPose',
      'user',
      I18n.t('cadeditor.ui.worldedit.pose'),
      I18n.t('cadeditor.ui.itemspecial.stand_pose_desc'),
      ['entity_data']
    );
  isTypeNote(card.body, isEntGet(), type);
  var s = esReady(type, card.body);
  if (!s) return card;
  var F = isView(type, 'pose');
  var ent = heroEntity(type, standPreviewData(type), null);
  ent.classList.add('is-stand-ent');
  card.body.appendChild(h('div', { class: 'ed-stage ent is-stand-stage' }, [h('div', { class: 'plate' }), ent]));
  card.body.appendChild(xSec('user', I18n.t('cadeditor.ui.worldentity.pose_presets')));
  card.body.appendChild(
    standPresetRow(function (preset) {
      standWrite(
        type,
        function (o) {
          var pose = isObj(o.Pose) ? o.Pose : {};
          EV_PARTS.forEach(function (pp, i) {
            if (preset) nbtPut(pose, pp[0], isFloatList(preset.angles[i]));
            else delete pose[pp[0]];
          });
          if (Object.keys(pose).length) o.Pose = pose;
          else delete o.Pose;
          if (preset) o.ShowArms = true;
        },
        true
      );
    })
  );
  card.body.appendChild(
    xSec(
      'user',
      I18n.t('cadeditor.ui.worldentity.angle_degrees'),
      I18n.t('cadeditor.ui.itemspecial.pose_unset_default')
    )
  );
  standPoseRows(card.body, {
    openKey: 'is:pose:',
    get: function (key) {
      var p = isEntGet().Pose;
      return isObj(p) && Array.isArray(p[key]) ? p[key] : undefined;
    },
    def: function (key) {
      return F[key] && F[key].default;
    },
    set: function (key, angles) {
      standWrite(type, function (o) {
        var pose = isObj(o.Pose) ? o.Pose : {};
        nbtPut(pose, key, isFloatList(angles));
        o.Pose = pose;
      });
    },
    redraw: eggRedraw
  });
  return card;
};
/* 八个开关：游戏 schema 给的默认值；不认识的字段不在这里显示 */
var STAND_FLAGS = [
  ['Small', I18n.t('cadeditor.ui.worldentity.small'), I18n.t('cadeditor.ui.worldentity.half_size')],
  ['ShowArms', I18n.t('cadeditor.ui.labels.show_arms'), I18n.t('cadeditor.ui.labels.arms_hold_items')],
  ['NoBasePlate', I18n.t('cadeditor.ui.worldentity.base_plate'), ''],
  ['Invisible', I18n.t('cadeditor.ui.worldentity.invisible'), ''],
  ['NoGravity', I18n.t('cadeditor.ui.labels.gravity'), ''],
  ['Invulnerable', I18n.t('cadeditor.ui.labels.invulnerable'), ''],
  ['CustomNameVisible', I18n.t('cadeditor.ui.labels.always_show_name'), ''],
  [
    'Marker',
    I18n.t('cadeditor.ui.worldentity.hitbox'),
    I18n.t('cadeditor.ui.worldentity.cannot_targeted_block_movement')
  ]
];
CARDS.standFlags = function () {
  var type = isPlaced(),
    card = eggCard(
      'standFlags',
      'sliders',
      I18n.t('cadeditor.ui.eschema.common_settings'),
      I18n.t('cadeditor.ui.itemspecial.stand_flags_desc'),
      []
    );
  var s = esReady(type, card.body);
  if (!s) return card;
  var F = isView(type, 'pose'),
    tpl = esTemplate(s) || {};
  card.body.appendChild(isNameRow(I18n.t('cadeditor.ui.labels.name'), isEntGet, isEntSet));
  var list = h('div', { class: 'x-list' });
  STAND_FLAGS.forEach(function (f) {
    var def = F[f[0]] && F[f[0]].default !== undefined ? F[f[0]].default : isFlagOn(tpl[f[0]]);
    list.appendChild(
      isToggle(
        f[1],
        f[2],
        f[0],
        isEntGet,
        function (o) {
          isEntSet(o);
          standLive(type);
        },
        def
      )
    );
  });
  card.body.appendChild(list);
  var scale = (s.attributes || []).filter(function (a) {
    return a.id === 'minecraft:scale';
  });
  if (scale.length) {
    card.body.appendChild(xSec('sliders', I18n.t('cadeditor.ui.eschema.size')));
    card.body.appendChild(esAttrList({ id: s.id, attributes: scale }, isEntIo()));
  }
  return card;
};
CARDS.standGear = function () {
  var type = isPlaced(),
    card = eggCard(
      'standGear',
      'helmet',
      I18n.t('cadeditor.ui.eschema.equipment'),
      I18n.t('cadeditor.ui.itemspecial.stand_gear_desc'),
      []
    );
  var s = esReady(type, card.body);
  if (!s) return card;
  var F = isView(type, 'pose');
  card.body.appendChild(esGearGrid(s, isEntIo(), type));
  card.body.appendChild(
    xSec('lock', I18n.t('cadeditor.ui.worldentity.slot_locks'), I18n.t('cadeditor.ui.worldentity.slot_locks_sub'))
  );
  card.body.appendChild(
    standLockEditor({
      info: standLockInfo(F.DisabledSlots),
      value: function () {
        var v = isEntGet().DisabledSlots;
        return v !== undefined ? v : (F.DisabledSlots && F.DisabledSlots.default) || 0;
      },
      set: function (n) {
        var o = clone(isEntGet());
        nbtSetTyped(o, 'DisabledSlots', n, 'i');
        isEntSet(o);
      }
    })
  );
  return card;
};

/* ---------- 展示框物品 ---------- */
CARDS.frameForm = function () {
  var type = isPlaced(),
    card = eggCard(
      'frameForm',
      'image',
      I18n.t('cadeditor.ui.worldedit.item_frame'),
      I18n.t('cadeditor.ui.itemspecial.frame_desc'),
      ['entity_data']
    );
  var data = isEntGet();
  isTypeNote(card.body, data, type);
  var s = esReady(type, card.body);
  if (!s) return card;
  var F = isView(type, 'item_frame'),
    tpl = esTemplate(s) || {};
  function write(fn, redraw) {
    var o = clone(isEntGet());
    fn(o);
    isEntSet(o);
    if (redraw) eggRedraw();
  }
  function def(key, fb) {
    return F[key] && F[key].default !== undefined ? F[key].default : tpl[key] !== undefined ? tpl[key] : fb;
  }
  card.body.appendChild(
    xRow({
      icon: false,
      title: I18n.t('cadeditor.ui.worldentity.item_frame'),
      tip: 'Item',
      right: wvItem(
        isObj(data.Item) && data.Item.id ? data.Item : null,
        function (item) {
          write(function (o) {
            if (item) nbtPut(o, 'Item', item);
            else delete o.Item;
          }, true);
        },
        eggRedraw
      )
    })
  );
  var rotMax = F.ItemRotation && F.ItemRotation.max !== undefined ? F.ItemRotation.max : 7;
  card.body.appendChild(
    xNum({
      title: I18n.t('cadeditor.ui.worldentity.item_rotation_steps'),
      sub: I18n.t('cadeditor.ui.worldentity.n45_per_grid_total_inbound', rotMax + 1),
      tip: 'ItemRotation',
      value:
        data.ItemRotation !== undefined ? nbtNumberValue(data.ItemRotation) : nbtNumberValue(def('ItemRotation', 0)),
      min: 0,
      max: rotMax,
      onChange: function (x) {
        write(function (o) {
          nbtSetTyped(o, 'ItemRotation', x, 'b');
        });
      }
    })
  );
  card.body.appendChild(
    xNum({
      title: I18n.t('cadeditor.ui.worldentity.probability_dropping_item_shot_down'),
      sub: I18n.t('cadeditor.ui.worldentity.n1_guarantees_drop'),
      tip: 'ItemDropChance',
      value:
        data.ItemDropChance !== undefined
          ? nbtNumberValue(data.ItemDropChance)
          : nbtNumberValue(def('ItemDropChance', 1)),
      step: 0.1,
      dec: 3,
      onChange: function (x) {
        write(function (o) {
          nbtSetTyped(o, 'ItemDropChance', x, 'f');
        });
      }
    })
  );
  [
    [
      'Invisible',
      I18n.t('cadeditor.ui.worldentity.invisible_frame'),
      I18n.t('cadeditor.ui.worldentity.show_only_item_inside')
    ],
    ['Fixed', I18n.t('cadeditor.ui.forms.fixed'), I18n.t('cadeditor.ui.worldentity.prevent_rotating_removing_item')],
    ['Invulnerable', I18n.t('cadeditor.ui.labels.invulnerable'), '']
  ].forEach(function (f) {
    card.body.appendChild(isToggle(f[1], f[2], f[0], isEntGet, isEntSet, isFlagOn(def(f[0], false))));
  });
  /* 朝向：放置时按这个方向挂上；不设就朝向点到的那一面 */
  var facing = data.Facing === undefined ? 'unset' : nbtNumberValue(data.Facing);
  card.body.appendChild(
    xSeg({
      title: I18n.t('cadeditor.ui.labels.facing'),
      sub: I18n.t('cadeditor.ui.itemspecial.frame_facing_sub'),
      tip: 'Facing',
      options: [{ v: 'unset', label: I18n.t('cadeditor.ui.common.unset') }].concat(frameFacingOptions(F.Facing)),
      value: facing,
      onChange: function (v) {
        write(function (o) {
          if (v === 'unset') delete o.Facing;
          else nbtSetTyped(o, 'Facing', v, 'b');
        });
      }
    })
  );
  card.body.appendChild(isNameRow(I18n.t('cadeditor.ui.labels.name'), isEntGet, isEntSet));
  return card;
};

/* ---------- 告示牌物品 ---------- */
var IS_SIGN_FACE = 'front';
CARDS.signForm = function () {
  var meta = isMeta(),
    card = eggCard(
      'signForm',
      'edit',
      I18n.t('cadeditor.ui.worldview.sign'),
      I18n.t('cadeditor.ui.itemspecial.sign_desc'),
      ['block_entity_data']
    );
  isTypeNote(card.body, isBlkGet(), meta.block_entity_type);
  var doc = signFaceEditor(card.body, {
    lines: meta.sign_lines || 4,
    face: IS_SIGN_FACE,
    onFace: function (v) {
      IS_SIGN_FACE = v;
      eggRedraw();
    },
    get: function (key) {
      return isBlkGet()[key];
    },
    put: function (key, x) {
      var o = clone(isBlkGet());
      nbtPut(o, key, x);
      isBlkSet(o);
    },
    redraw: eggRedraw
  });
  card.body.appendChild(
    isToggle(
      I18n.t('cadeditor.ui.worldview.waxed'),
      I18n.t('cadeditor.ui.worldview.waxed_billboards_t_changed'),
      'is_waxed',
      isBlkGet,
      isBlkSet,
      false
    )
  );
  if (!doc) card.body.appendChild(kHint(I18n.t('cadeditor.ui.worldview.billboard_button_event_press_text')));
  return card;
};

/* ---------- 命令方块物品 ---------- */
function cmdDefaults() {
  var t = isMeta().block_entity_default_nbt;
  if (typeof t !== 'string') return {};
  try {
    return parseSnbt(t);
  } catch (e) {
    return {};
  }
}
var CMD_FLAGS = [
  ['auto', I18n.t('cadeditor.ui.worldview.always_active'), I18n.t('cadeditor.ui.worldview.without_red_stone_s_going')],
  ['powered', I18n.t('cadeditor.ui.worldview.powered'), I18n.t('cadeditor.ui.worldview.receiving_redstone_signal')],
  [
    'conditionMet',
    I18n.t('cadeditor.ui.itemspecial.condition_met'),
    I18n.t('cadeditor.ui.itemspecial.condition_met_sub')
  ],
  [
    'TrackOutput',
    I18n.t('cadeditor.ui.worldview.track_previous_output'),
    I18n.t('cadeditor.ui.worldview.command_after_off_block_t')
  ],
  [
    'UpdateLastExecution',
    I18n.t('cadeditor.ui.itemspecial.once_per_tick'),
    I18n.t('cadeditor.ui.itemspecial.once_per_tick_sub')
  ]
];
CARDS.cmdBlockForm = function () {
  var meta = isMeta(),
    card = eggCard(
      'cmdBlockForm',
      'terminal',
      I18n.t('cadeditor.ui.itemspecial.kind_command'),
      I18n.t('cadeditor.ui.itemspecial.command_desc'),
      ['block_entity_data']
    );
  var data = isBlkGet(),
    defs = cmdDefaults();
  isTypeNote(card.body, data, meta.block_entity_type);
  /* 普通 / 连锁 / 循环：同一种方块实体，换的是物品；候选是游戏里方块为命令方块的物品 */
  var kinds = Array.isArray(meta.command_block_items) ? meta.command_block_items : [];
  if (kinds.length > 1) {
    kinds.forEach(function (id) {
      Reg.itemMeta(id); // 先取元信息，换物品后页面直接按命令方块排
    });
    /* 与世界编辑的命令方块一致：区块标题 + 短名称，窄窗口里也放得下；模组命令方块回退到物品名 */
    var NAMES = {
      'minecraft:command_block': I18n.t('cadeditor.ui.worldview.impulse'),
      'minecraft:repeating_command_block': I18n.t('cadeditor.ui.worldview.repeat'),
      'minecraft:chain_command_block': I18n.t('cadeditor.ui.worldview.chain')
    };
    var modeSec = xSec('terminal', I18n.t('cadeditor.ui.labels.mode'));
    modeSec.setAttribute('data-tip', I18n.t('cadeditor.ui.itemspecial.command_mode_sub'));
    card.body.appendChild(modeSec);
    card.body.appendChild(
      h('div', { class: 'k-row wrap' }, [
        kSeg(
          kinds.map(function (id) {
            return { v: id, label: NAMES[fullId(id)] || nameOfItem(id) };
          }),
          fullId(Ctx.doc().id),
          function (id) {
            if (fullId(id) !== fullId(Ctx.doc().id)) Store.setItem(fullId(id));
          }
        ).el
      ])
    );
  }
  function write(fn) {
    var o = clone(isBlkGet());
    fn(o);
    isBlkSet(o);
  }
  card.body.appendChild(xSec('code', I18n.t('cadeditor.ui.screens.command')));
  var ta = h('textarea', {
    class: 'ed-snbt we-cmd',
    spellcheck: 'false',
    placeholder: I18n.t('cadeditor.ui.worldview.say_hi_omitted_beginning')
  });
  ta.value = typeof data.Command === 'string' ? data.Command : '';
  function putCommand(text) {
    write(function (o) {
      o.Command = text;
    });
  }
  ta.addEventListener('change', function () {
    putCommand(ta.value);
  });
  card.body.appendChild(ta);
  cmdAssistAttach(ta, Store.doc(), function (text) {
    ta.value = text;
    putCommand(text);
  });
  card.body.appendChild(isNameRow(I18n.t('cadeditor.ui.labels.name'), isBlkGet, isBlkSet));
  card.body.appendChild(xSec('sliders', I18n.t('cadeditor.ui.worldedit.state')));
  CMD_FLAGS.forEach(function (f) {
    card.body.appendChild(isToggle(f[1], f[2], f[0], isBlkGet, isBlkSet, isFlagOn(defs[f[0]])));
  });
  card.body.appendChild(
    xNum({
      title: I18n.t('cadeditor.ui.itemspecial.success_count'),
      tip: 'SuccessCount',
      value:
        data.SuccessCount !== undefined ? nbtNumberValue(data.SuccessCount) : nbtNumberValue(defs.SuccessCount || 0),
      step: 1,
      onChange: function (x) {
        write(function (o) {
          nbtSetTyped(o, 'SuccessCount', Math.round(x), 'i');
        });
      }
    })
  );
  /* 上次执行的游戏刻（long）：按文本输入，保住 long 的精度；留空就去掉 */
  var err = worldError();
  var last = kInput(
    data.LastExecution === undefined ? '' : toSnbt(data.LastExecution, null, false).replace(/[lL]$/, ''),
    function () {},
    {
      placeholder: I18n.t('cadeditor.ui.common.unset'),
      onCommit: function (v) {
        var t = String(v).trim();
        if (t && !/^[+-]?[0-9]+$/.test(t)) {
          err.textContent = I18n.t('cadeditor.ui.eschema.enter_integer');
          return;
        }
        err.textContent = '';
        write(function (o) {
          if (!t) delete o.LastExecution;
          else nbtPut(o, 'LastExecution', parseSnbtUser(t + 'L'));
        });
      }
    }
  );
  card.body.appendChild(
    xRow({ icon: false, title: I18n.t('cadeditor.ui.itemspecial.last_execution'), tip: 'LastExecution', right: last })
  );
  card.body.appendChild(err);
  var lo = data.LastOutput;
  var out = kRich(lo === undefined || lo === null ? '' : lo, {
    placeholder: I18n.t('cadeditor.ui.worldentity.none'),
    onChange: function (v, empty) {
      write(function (o) {
        if (empty) delete o.LastOutput;
        else nbtPut(o, 'LastOutput', v);
      });
    }
  });
  card.body.appendChild(
    h('div', { class: 'is-name' }, [
      h('div', { class: 'k-sub', text: I18n.t('cadeditor.ui.worldentity.previous_output'), title: 'LastOutput' }),
      out.el
    ])
  );
  if (meta.block_entity_op_only) card.body.appendChild(kHint(I18n.t('cadeditor.ui.itemspecial.op_only_nbt'), 'note'));
  return card;
};

/* ---------- 其它字段：通用字段表（表单不管的键），保留作高级入口 ---------- */
var IS_OWNED = {
  stand: [
    'Pose',
    'Small',
    'ShowArms',
    'NoBasePlate',
    'Invisible',
    'NoGravity',
    'Invulnerable',
    'CustomNameVisible',
    'Marker',
    'CustomName',
    'equipment',
    'drop_chances',
    'DisabledSlots'
  ],
  frame: ['Item', 'ItemRotation', 'ItemDropChance', 'Invisible', 'Fixed', 'Invulnerable', 'Facing', 'CustomName'],
  sign: ['front_text', 'back_text', 'is_waxed'],
  cmdblock: [
    'Command',
    'CustomName',
    'auto',
    'powered',
    'conditionMet',
    'TrackOutput',
    'UpdateLastExecution',
    'SuccessCount',
    'LastExecution',
    'LastOutput'
  ]
};
CARDS.specialRest = function (cid) {
  var ent = cid === 'entity_data',
    get = ent ? isEntGet : isBlkGet,
    set = ent ? isEntSet : isBlkSet,
    type = ent ? isPlaced() : isBlockType(),
    owned = {};
  (IS_OWNED[Ctx.kind()] || []).forEach(function (k) {
    owned[k] = 1;
  });
  var card = kCard(
    {
      id: 'specialRest-' + cid,
      icon: 'code',
      title: I18n.t('cadeditor.ui.spawn.other_data'),
      desc: I18n.t('cadeditor.ui.itemspecial.other_fields_desc'),
      comps: [],
      span: 2
    },
    Ctx
  );
  var cur = get(),
    rest = {};
  Object.keys(cur).forEach(function (k) {
    if (k !== 'id' && !owned[k]) nbtPut(rest, k, nbtTake(cur, k));
  });
  var mapEl = worldMap(
    rest,
    function (x) {
      if (Object.prototype.hasOwnProperty.call(x, 'id'))
        throw new Error(I18n.t('cadeditor.ui.world.type_modified_top_selection'));
      Object.keys(x).forEach(function (k) {
        if (owned[k]) throw new Error(I18n.t('cadeditor.ui.spawn.change_card_above', k));
      });
      var base = get(),
        o = clone(x);
      Object.keys(base).forEach(function (k) {
        if (owned[k]) nbtPut(o, k, nbtTake(base, k));
      });
      set(o);
    },
    false
  );
  var sug = ent
    ? kBtn(
        I18n.t('cadeditor.ui.spawn.common_fields'),
        function () {
          suggestEntityFields(
            type,
            function (k) {
              return !!owned[k] || Object.prototype.hasOwnProperty.call(get(), k);
            },
            function (k, val) {
              try {
                mapEl.addField(k, val);
              } catch (e) {
                toast(e.message || String(e), 'warn');
              }
            },
            sug
          );
        },
        { title: I18n.t('cadeditor.ui.world.pick_field_default_data_entity') }
      )
    : null;
  if (sug) card.body.appendChild(h('div', { class: 'egg-datahd' }, [h('div', { class: 'grow' }), sug]));
  card.body.appendChild(mapEl);
  card.body.appendChild(Valid.badge(cid));
  return card;
};

/* ---------- 村民类交易（刷怪蛋、刷怪笼里的生物）：Offers.Recipes ⇄ 交易编辑窗的 wire 交易 ----------
   没改的交易、物品、数值原样写回（保住类型和未知键）；改过的才按 MerchantOffers 的类型重写。缺省值来自游戏（views.trades.offer_defaults）。 */
var IT_OFFER_BASE = new WeakMap(),
  IT_TRADES = {};
var IT_TRADE_NUM = { uses: 'i', maxUses: 'i', xp: 'i', demand: 'i', specialPrice: 'i', priceMultiplier: 'f' };
function tradeWireKey(w) {
  return w && w.id
    ? JSON.stringify([w.id, w.count || 1, Object.keys(w.removed || {}).sort()]) + '\n' + nbtMerge(w.comps || {}, null)
    : '';
}
function tradeDefaults(schema) {
  var t = schema && schema.views && schema.views.trades,
    d = t && t.offer_defaults;
  return d && !d.error ? d : null;
}
/* 这只生物有交易：真实的 trades 视图（商人、僵尸村民），或者已经带着 Offers */
function itemTradeApplies(schema, data) {
  return !!((schema && schema.views && schema.views.trades) || (isObj(data) && isObj(data.Offers)));
}
function tradeFromRecipe(r, defs) {
  var offer = {},
    base = { src: r, wire: {}, shown: {} };
  ['buy', 'buyB', 'sell'].forEach(function (k) {
    if (isObj(r[k]) && typeof r[k].id === 'string') {
      offer[k] = nestedItemWire(r[k]);
      base.wire[k] = tradeWireKey(offer[k]);
    }
  });
  Object.keys(IT_TRADE_NUM).forEach(function (k) {
    var v = r[k] !== undefined ? nbtNumberValue(r[k]) : defs && typeof defs[k] === 'number' ? defs[k] : undefined;
    if (v !== undefined) offer[k] = v;
    base.shown[k] = v;
  });
  offer.rewardExp =
    r.rewardExp !== undefined ? isFlagOn(r.rewardExp) : !defs || defs.rewardExp === undefined || !!defs.rewardExp;
  base.shown.rewardExp = offer.rewardExp;
  IT_OFFER_BASE.set(offer, base);
  return offer;
}
function tradeToRecipe(offer) {
  var base = IT_OFFER_BASE.get(offer),
    r = base ? clone(base.src) : {},
    dropped = false;
  ['buy', 'buyB', 'sell'].forEach(function (k) {
    var w = offer[k];
    if (!w || !w.id) {
      delete r[k];
      return;
    }
    if (base && base.wire[k] === tradeWireKey(w)) return;
    var packed = vaultNested(w);
    /* 支付物品是「完全匹配」条件（ItemCost），只能列出要求的组件，不能写「去掉某组件」 */
    if (k !== 'sell' && packed.components) {
      Object.keys(packed.components).forEach(function (c) {
        if (c.charAt(0) === '!') {
          delete packed.components[c];
          dropped = true;
        }
      });
      if (!Object.keys(packed.components).length) delete packed.components;
    }
    r[k] = packed;
  });
  Object.keys(IT_TRADE_NUM).forEach(function (k) {
    if (typeof offer[k] !== 'number' || (base && base.shown[k] === offer[k])) return;
    nbtSetTyped(r, k, offer[k], IT_TRADE_NUM[k]);
  });
  if (!(base && base.shown.rewardExp === offer.rewardExp)) r.rewardExp = offer.rewardExp !== false;
  if (dropped) toast(I18n.t('cadeditor.ui.itemspecial.trade_cost_removed_ignored'), 'warn');
  return r;
}
function itemTradeState(key, data, defs) {
  var offers = isObj(data.Offers) ? data.Offers : null,
    text = offers ? nbtMerge(offers, null) : '',
    doc = Store.doc(),
    st = IT_TRADES[key];
  if (st && st.doc === doc && st.text === text) return st;
  var recipes = offers && Array.isArray(offers.Recipes) ? offers.Recipes : [];
  st = IT_TRADES[key] = {
    doc: doc,
    text: text,
    list: recipes.map(function (r) {
      return tradeFromRecipe(isObj(r) ? r : {}, defs);
    })
  };
  return st;
}
/* 交易区。o = { key 区分位置, schema, get()→实体复合数据, set(实体复合数据), redraw() }。返回元素 */
function itemTradeSection(o) {
  var box = h('div', { class: 'is-trades' }),
    defs = tradeDefaults(o.schema),
    st = itemTradeState(o.key, o.get(), defs);
  function write() {
    var data = clone(o.get()),
      offers = isObj(data.Offers) ? clone(data.Offers) : {};
    if (st.list.length) {
      offers.Recipes = st.list.map(tradeToRecipe);
      nbtPut(data, 'Offers', offers);
    } else {
      delete offers.Recipes;
      if (Object.keys(offers).length) nbtPut(data, 'Offers', offers);
      else delete data.Offers;
    }
    o.set(data);
    var now = o.get();
    st.text = isObj(now.Offers) ? nbtMerge(now.Offers, null) : '';
  }
  function open(offer, i) {
    tradeEditModal(offer, i, {
      valid: function () {
        return Store.doc() === st.doc && IT_TRADES[o.key] === st && st.list.indexOf(offer) >= 0;
      },
      mark: write,
      closed: o.redraw
    });
  }
  tradeListRows(box, { list: st.list, mark: write, redraw: o.redraw, open: open });
  return box;
}
/* 刷怪蛋：村民数据（职业、等级、经验）+ 交易 */
CARDS.eggTrades = function () {
  var id = eggCur(),
    s = id ? Reg.entitySchema(id) : null;
  if (!s || !s.available || !itemTradeApplies(s, eggData())) return null;
  var card = eggCard(
    'eggTrades',
    'coins',
    I18n.t('cadeditor.ui.worldedit.trades'),
    I18n.t('cadeditor.ui.itemspecial.egg_trades_desc')
  );
  var tpl = esTemplate(s),
    io = eggIo(),
    edit = esEditor(io),
    jobs = (s.variants || []).filter(function (v) {
      return /villager\/(profession|level)$/.test(String(v.id));
    });
  if (jobs.length || (tpl && tpl.Xp !== undefined)) {
    var list = h('div', { class: 'x-list' });
    jobs.forEach(function (v) {
      list.appendChild(esVariantRow(v, io, tpl, edit, s.id));
    });
    if (tpl && tpl.Xp !== undefined) {
      var xp = eggData().Xp;
      list.appendChild(
        xNum({
          title: I18n.t('cadeditor.ui.itemspecial.villager_xp'),
          tip: 'Xp',
          value: xp !== undefined ? nbtNumberValue(xp) : nbtNumberValue(tpl.Xp),
          min: 0,
          step: 1,
          onChange: function (x) {
            edit(function (obj) {
              nbtSetTyped(obj, 'Xp', Math.round(x), 'i');
            });
          }
        })
      );
    }
    card.body.appendChild(xSec('user', I18n.t('cadeditor.ui.itemspecial.villager_data')));
    card.body.appendChild(list);
  }
  card.body.appendChild(xSec('coins', I18n.t('cadeditor.ui.worldedit.trades')));
  card.body.appendChild(itemTradeSection({ key: 'egg', schema: s, get: eggData, set: eggWrite, redraw: eggRedraw }));
  return card;
};
