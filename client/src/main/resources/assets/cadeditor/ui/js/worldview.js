/* 世界方块的规范化视图和方块状态（docs/world-block-edit.md）。
   视图 world.views.<组> = {value, snbt, schema}：value 是游戏真实 Codec 的 JSON，页面只提交改过的顶层字段（apply.views.<组>）；
   方块状态 world.block_state_schema = [{name,type,values,default,current}]，提交 apply.block_state 里改过的属性。
   数据范围、行数、颜色都读 schema，不在这里写死。 */
var WEV = {};
WE.views = {};
WE.bstate = {};
WE.btype = '';
WE.upd = true;
WE.face = 'front';
function weResetEdits() {
  WE.views = {};
  WE.bstate = {};
  WE.btype = '';
}
function weViews() {
  return (WE.w && WE.w.views) || {};
}
function weViewGroups() {
  var v = weViews(),
    groups = Object.keys(v);
  return groups.filter(function (g) {
    if (g === 'unsupported' || g === 'generic' || !v[g] || !v[g].value) return false;
    // Legacy raw helpers (e.g. bees) coexist with normalized form groups.
    // Do not claim a field is raw-only when a real form already covers it.
    if (
      !v[g].schema &&
      groups.some(function (other) {
        var entry = v[other],
          fields = entry && entry.schema && entry.schema.fields;
        return (
          other !== g &&
          typeof WEV[other] === 'function' &&
          fields &&
          Object.prototype.hasOwnProperty.call(fields, g) &&
          entry.value &&
          Object.prototype.hasOwnProperty.call(entry.value, g)
        );
      })
    )
      return false;
    return true;
  });
}
var WE_VIEW_TYPED = new WeakMap();
function weViewOrig(g) {
  var v = weViews()[g];
  if (!v || !v.value) return {};
  var cached = WE_VIEW_TYPED.get(v);
  if (cached) return cached;
  var fields = (v.schema && v.schema.fields) || {},
    texts = {},
    ast = null;
  Object.keys(fields).forEach(function (key) {
    if (!fields[key].wire_snbt || v.value[key] === null || v.value[key] === undefined) return;
    if (!ast) ast = nbtParse(v.snbt);
    if (ast.k === 'obj' && ast.map[key]) texts[key] = nbtPrint(ast.map[key], false);
  });
  cached = nbtHydrate(v.value, texts);
  WE_VIEW_TYPED.set(v, cached);
  return cached;
}
/* 草稿存储（方块视图 WE.views、实体 / 玩家 WE.ent 共用）：只记和原值不同的字段，改回原值就删掉；改完刷新顶栏 / 底栏 */
function weDraftGet(store, g, k, orig) {
  var e = store[g];
  if (e && Object.prototype.hasOwnProperty.call(e, k)) return e[k];
  return orig[k];
}
function weVal(g, k) {
  var orig = weViewOrig(g),
    e = WE.views[g];
  return nbtTake(e && Object.prototype.hasOwnProperty.call(e, k) ? e : orig, k);
}
function weNorm(v) {
  return JSON.stringify(v === undefined ? null : v) + (v === undefined || v === null ? '' : '\n' + nbtMerge(v, null));
}
function weDraftSet(store, g, k, v, orig) {
  var e = store[g] || (store[g] = {});
  if (weNorm(v) === weNorm(nbtTake(orig, k))) delete e[k];
  else nbtPut(e, k, v);
  if (!Object.keys(e).length) delete store[g];
  weMarkDirty();
}
function weSetV(g, k, v) {
  weDraftSet(WE.views, g, k, v, weViewOrig(g));
  if (k === 'minecraft:profile') weHeroLive();
}
function weViewField(g, k) {
  var s = weViews()[g];
  return s && s.schema && s.schema.fields ? s.schema.fields[k] || {} : {};
}
function weStateSchema() {
  return (WE.w && WE.w.block_state_schema) || [];
}
function weTypeSchema() {
  var t = WE.w && WE.w.block_type_schema;
  return Array.isArray(t)
    ? t.map(function (x) {
        return typeof x === 'string' ? x : x.id;
      })
    : [];
}
function weStateCur(p) {
  return WE.bstate[p.name] !== undefined ? WE.bstate[p.name] : p.current;
}
function weViewsDirty() {
  return (
    !!WE.w &&
    (Object.keys(WE.views).length > 0 || Object.keys(WE.bstate).length > 0 || !!(WE.btype && WE.btype !== WE.w.block))
  );
}
function weViewsMsg(msg) {
  var vg = Object.keys(WE.views);
  if (vg.length) {
    msg.views = {};
    vg.forEach(function (g) {
      msg.views[g] = clone(WE.views[g]);
      Object.keys(WE.views[g]).forEach(function (k) {
        if (!weViewField(g, k).wire_snbt || WE.views[g][k] === null) return;
        if (!msg.views_snbt) msg.views_snbt = {};
        if (!msg.views_snbt[g]) msg.views_snbt[g] = {};
        msg.views_snbt[g][k] = nbtMerge(nbtTake(WE.views[g], k), null);
      });
    });
  }
  var bs = {},
    any = false;
  weStateSchema().forEach(function (p) {
    if (WE.bstate[p.name] !== undefined && WE.bstate[p.name] !== p.current) {
      bs[p.name] = WE.bstate[p.name];
      any = true;
    }
  });
  if (any) msg.block_state = bs;
  if (WE.btype && WE.btype !== WE.w.block) msg.block_type = WE.btype;
  if ((any || msg.block_type) && !WE.upd) msg.updateNeighbors = false;
}

var WEV_INFO = {
  generic: [I18n.t('cadeditor.ui.worldedit.other_settings'), 'sliders'],
  sign: [I18n.t('cadeditor.ui.worldview.sign'), 'edit'],
  banner: [I18n.t('cadeditor.ui.pages.banner_patterns'), 'banner'],
  beehive: [I18n.t('cadeditor.ui.worldview.bee'), 'flower'],
  lectern: [I18n.t('cadeditor.ui.worldview.lectern'), 'book_open'],
  jukebox: [I18n.t('cadeditor.ui.worldview.jukebox'), 'music'],
  decorated_pot: [I18n.t('cadeditor.ui.worldview.decorated_pot'), 'gem'],
  chiseled_bookshelf: [I18n.t('cadeditor.ui.worldview.chiseled_bookshelf'), 'book'],
  command_block: [I18n.t('cadeditor.ui.screens.command'), 'terminal'],
  skull: [I18n.t('cadeditor.ui.worldview.head'), 'skull'],
  furnace: [I18n.t('cadeditor.ui.worldview.furnace_progress'), 'furnace'],
  brewing_stand: [I18n.t('cadeditor.ui.worldview.brewing_progress'), 'flask'],
  campfire: [I18n.t('cadeditor.ui.worldview.campfire'), 'campfire'],
  nameable: [I18n.t('cadeditor.ui.cards1.name'), 'tag'],
  hopper: [I18n.t('cadeditor.ui.worldview.hopper'), 'sliders'],
  beacon: [I18n.t('cadeditor.ui.worldview.beacon'), 'sparkle'],
  crafter: [I18n.t('cadeditor.ui.worldview.crafter'), 'grid'],
  conduit: [I18n.t('cadeditor.ui.worldview.conduit'), 'sparkle'],
  end_gateway: [I18n.t('cadeditor.ui.worldview.end_gateway'), 'wind'],
  structure_block: [I18n.t('cadeditor.ui.worldview.structure_block'), 'cube'],
  jigsaw: [I18n.t('cadeditor.ui.worldview.jigsaw_block'), 'link'],
  sculk_sensor: [I18n.t('cadeditor.ui.worldview.sculk_sensor'), 'sparkle'],
  sculk_shrieker: [I18n.t('cadeditor.ui.worldview.sculk_shrieker'), 'sparkle'],
  sculk_catalyst: [I18n.t('cadeditor.ui.worldview.sculk_catalyst'), 'sparkle'],
  bell: [I18n.t('cadeditor.ui.worldview.bell'), 'bell'],
  vault: [I18n.t('cadeditor.ui.worldview.vault_block'), 'chest']
};
function weViewTabInfo() {
  var g = weViewGroups(),
    n = g.length === 1 && WEV_INFO[g[0]] ? WEV_INFO[g[0]] : null;
  return { label: n ? n[0] : I18n.t('cadeditor.ui.worldview.block_settings'), icon: n ? n[1] : 'sliders' };
}

/* ---------- 小零件 ---------- */
function wvNum(g, k, label, o) {
  o = o || {};
  var f = weViewField(g, k);
  return xNum({
    title: label,
    sub: o.sub || undefined,
    range: true,
    value: weVal(g, k),
    min: f.min,
    max: f.max,
    unit: o.unit,
    onChange: function (x) {
      weSetV(g, k, x);
    }
  });
}
function wvToggle(g, k, label, sub) {
  return xToggle({
    title: label,
    sub: sub,
    value: weVal(g, k),
    onChange: function (on) {
      weSetV(g, k, on);
    }
  });
}
/* 命令输入框（命令方块、命令方块矿车，世界和物品形态共用）接 A 包的 CommandAssist：语法检查与补全。
   同一位置（scope，可以是字符串或文档对象）重画时先断开上一个；顶层页面上已经不在 DOM 里的也一并断开（嵌套编辑时父页面只是暂时摘下，不动它） */
var CMD_ASSIST = [];
function cmdAssistAttach(ta, scope, onApply) {
  var top = typeof NestedItem === 'undefined' || !NestedItem;
  CMD_ASSIST = CMD_ASSIST.filter(function (a) {
    if (a.scope !== scope && !(top && a.ta.isConnected === false)) return true;
    try {
      a.detach();
    } catch (e) {
      if (typeof EditorDiag !== 'undefined') EditorDiag.error('command.assist.detach', e);
    }
    return false;
  });
  if (typeof CommandAssist === 'undefined' || !CommandAssist || typeof CommandAssist.attach !== 'function') return null;
  try {
    var detach = CommandAssist.attach(ta, { onApply: onApply });
    if (typeof detach === 'function') CMD_ASSIST.push({ ta: ta, scope: scope, detach: detach });
    return detach || null;
  } catch (e) {
    if (typeof EditorDiag !== 'undefined') EditorDiag.error('command.assist.attach', e);
    return null;
  }
}
/* ItemStack（id / count / components）字段：选一件，或清空。refresh：嵌套编辑回来后重画（默认重画世界页） */
function wvItem(cur, onSet, refresh) {
  var has = cur && cur.id;
  var btn = kItemBtn(has ? cur : null);
  activate(btn, function () {
    pickItem(
      btn,
      function (id) {
        onSet({ id: fullId(id), count: 1 });
        kPopClose();
      },
      {
        onStack: function (stack) {
          onSet(vaultNested(stack));
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
          editNestedStack(cur, I18n.t('cadeditor.ui.cards3.edit_item'), onSet, refresh || weRedrawBody);
        },
        { icon: 'edit' }
      )
    );
  if (has)
    kids.push(
      kBtn(
        I18n.t('cadeditor.ui.common.clear'),
        function () {
          onSet(null);
        },
        { icon: 'trash' }
      )
    );
  return h('div', { class: 'k-row' }, kids);
}

/* ---------- 告示牌 / 悬挂告示牌 ---------- */
/* 告示牌的一面：正 / 反切换、按行富文本、颜色、发光文字（世界告示牌和告示牌物品共用）。
   o = { lines, face:'front'|'back', onFace(v), get(面键)→SignText（可缺字段）, put(面键, SignText, 改了字), redraw() } */
var SIGN_DEFAULT_COLOR = 'black'; /* SignText 缺 color 时的原版默认 */
function signFaceEditor(body, o) {
  var face = o.face === 'back' ? 'back_text' : 'front_text',
    n = o.lines || 4;
  body.appendChild(
    xSec(
      'edit',
      I18n.t('cadeditor.ui.cards4.text'),
      undefined,
      kSeg(
        [
          { v: 'front', label: I18n.t('cadeditor.ui.picker.positive') },
          { v: 'back', label: I18n.t('cadeditor.ui.world.back') }
        ],
        o.face === 'back' ? 'back' : 'front',
        o.onFace
      ).el
    )
  );
  function cur() {
    var x = o.get(face);
    return clone(isObj(x) ? x : { messages: [] });
  }
  function setFace(fn, text) {
    var x = cur();
    if (!Array.isArray(x.messages)) x.messages = [];
    while (x.messages.length < n) x.messages.push('');
    fn(x);
    o.put(face, x, !!text);
  }
  var msgs = cur().messages || [];
  /* 和名称、说明文字同一个文本编辑器：选中文字直接改颜色、粗体、精灵图；每行独立保存 */
  var padded = [];
  for (var k = 0; k < n; k++) padded.push(msgs[k] === undefined ? '' : msgs[k]);
  var last = null;
  var doc = kRichDoc(padded, {
    lines: n,
    preview: false,
    height: n * 16 + 12,
    placeholder: I18n.t('cadeditor.ui.worldview.up_line_about_15_word', n),
    onChange: function (v) {
      if (!last) return;
      var lines = [];
      for (var j = 0; j < n; j++) if (JSON.stringify(v[j]) !== JSON.stringify(last[j])) lines.push(j);
      last = v.slice();
      if (!lines.length) return;
      setFace(function (x) {
        lines.forEach(function (j) {
          x.messages[j] = v[j];
        });
      }, true);
    }
  });
  last = doc
    ? doc.lineRuns().map(function (r) {
        return tcBuild({}, r);
      })
    : [];
  while (last.length < n) last.push('');
  if (doc) body.appendChild(h('div', { class: 'we-signdoc' }, [doc.el]));
  else
    for (var i = 0; i < n; i++)
      (function (i) {
        var inp = kInput(msgText(msgs[i]), function () {}, { placeholder: I18n.t('cadeditor.ui.cards1.line', i + 1) });
        inp.classList.add('we-line');
        inp.addEventListener('change', function () {
          setFace(function (x) {
            x.messages[i] = textMsg(inp.value);
          }, true);
        });
        body.appendChild(
          h('div', { class: 'x2r' }, [h('span', { class: 'x2l' }, [h('span', { text: String(i + 1) })]), inp])
        );
      })(i);
  var now = cur();
  body.appendChild(
    xRow({
      icon: false,
      title: I18n.t('cadeditor.ui.worldview.sign_color'),
      tip: 'color',
      right: dyeButton(now.color || SIGN_DEFAULT_COLOR, function (c) {
        setFace(function (x) {
          x.color = c;
        });
        if (o.redraw) o.redraw();
      })
    })
  );
  body.appendChild(
    xToggle({
      title: I18n.t('cadeditor.ui.worldview.glowing_text'),
      sub: I18n.t('cadeditor.ui.worldview.glow_ink_sac_effect'),
      tip: 'has_glowing_text',
      value: now.has_glowing_text,
      onChange: function (on) {
        setFace(function (x) {
          x.has_glowing_text = on;
        });
      }
    })
  );
  return doc;
}
WEV.sign = function (body, g) {
  var fs = weViewField(g, WE.face === 'back' ? 'back_text' : 'front_text');
  var doc = signFaceEditor(body, {
    lines: fs.messages_length || 4,
    face: WE.face,
    onFace: function (v) {
      WE.face = v;
      weRender();
    },
    get: function (key) {
      return weVal(g, key);
    },
    put: function (key, x, text) {
      weSetV(g, key, x);
      /* 涂过蜡的牌子改字：同一笔取消涂蜡 */
      if (text && weVal(g, 'is_waxed')) {
        weSetV(g, 'is_waxed', false);
        toast(I18n.t('cadeditor.ui.worldview.waxed_billboard_cannot_changed_waxing'), 'info');
        weRender();
      }
    },
    redraw: weRender
  });
  body.appendChild(xSec('lock', I18n.t('cadeditor.ui.worldview.waxed')));
  body.appendChild(
    wvToggle(
      g,
      'is_waxed',
      I18n.t('cadeditor.ui.worldview.waxed'),
      I18n.t('cadeditor.ui.worldview.waxed_billboards_t_changed')
    )
  );
  if (!doc) body.appendChild(kHint(I18n.t('cadeditor.ui.worldview.billboard_button_event_press_text')));
};

/* ---------- 旗帜图案 ---------- */
WEV.banner = function (body, g) {
  var list = clone(weVal(g, 'patterns') || []);
  var base = weViews()[g].schema && weViews()[g].schema.base_color;
  body.appendChild(
    xSec(
      'banner',
      I18n.t('cadeditor.ui.cards2.pattern'),
      I18n.t(
        'cadeditor.ui.worldview.layer',
        list.length,
        base
          ? I18n.t('cadeditor.ui.worldview.base_color', (EDATA.L && EDATA.L.color && EDATA.L.color[base]) || base)
          : ''
      )
    )
  );
  function save() {
    weSetV(g, 'patterns', clone(list));
  }
  list.forEach(function (p, i) {
    var sel = kRegSelect({
      reg: 'banner_pattern',
      value: p.pattern,
      title: I18n.t('cadeditor.ui.banner.choose_pattern'),
      onChange: function (id) {
        list[i].pattern = id;
        save();
      }
    });
    var col = dyeButton(p.color || 'white', function (c) {
      list[i].color = c;
      save();
      weRender();
    });
    var rm = kBtn(
      '',
      function () {
        list.splice(i, 1);
        save();
        weRender();
      },
      { icon: 'trash', title: I18n.t('cadeditor.ui.worldview.remove_layer') }
    );
    body.appendChild(
      h('div', { class: 'k-row we-row' }, [h('span', { class: 'k-sub', text: String(i + 1) }), sel.el, col, rm])
    );
  });
  body.appendChild(
    xAdd(I18n.t('cadeditor.ui.worldview.add_pattern_layer'), function () {
      list.push({ pattern: 'minecraft:stripe_bottom', color: 'white' });
      save();
      weRender();
    })
  );
};

/* ---------- 蜂箱 / 蜂巢 ---------- */
WEV.beehive = function (body, g) {
  var list = clone(weVal(g, 'bees') || []),
    f = weViewField(g, 'bees'),
    max = f.vanilla_max_occupants;
  body.appendChild(
    xSec(
      'flower',
      I18n.t('cadeditor.ui.worldview.bees_inside'),
      I18n.t('cadeditor.ui.worldview.only', list.length + (max ? ' / ' + max : ''))
    )
  );
  function save() {
    weSetV(g, 'bees', clone(list));
  }
  list.forEach(function (b, i) {
    var ed = b.entity_data || {};
    var t1 = kNumber(b.ticks_in_hive || 0, {
      min: 0,
      noSlider: true,
      step: 20,
      unit: I18n.t('cadeditor.ui.cards2.ticks'),
      onChange: function (v) {
        list[i].ticks_in_hive = v;
        save();
      }
    });
    var t2 = kNumber(b.min_ticks_in_hive === undefined ? 600 : b.min_ticks_in_hive, {
      min: 0,
      noSlider: true,
      step: 20,
      unit: I18n.t('cadeditor.ui.cards2.ticks'),
      onChange: function (v) {
        list[i].min_ticks_in_hive = v;
        save();
      }
    });
    var rm = kBtn(
      I18n.t('cadeditor.ui.worldview.release'),
      function () {
        list.splice(i, 1);
        save();
        weRender();
      },
      { icon: 'trash', title: I18n.t('cadeditor.ui.worldview.release_bee') }
    );
    body.appendChild(
      xRow({
        icon: entityIcon(ed.id || 'minecraft:bee', 22),
        title: I18n.t('cadeditor.ui.world.bee', i + 1),
        sub: I18n.t(
          'cadeditor.ui.worldview.inside_ticks_minimum_stay_ticks',
          b.ticks_in_hive || 0,
          b.min_ticks_in_hive === undefined ? 600 : b.min_ticks_in_hive
        ),
        chevron: true,
        open: !!UIOpen['we:bee:' + i],
        onHead: function () {
          UIOpen['we:bee:' + i] = !UIOpen['we:bee:' + i];
          weRender();
        },
        body: function () {
          return [
            esEntityHeader({
              id: ed.id || 'minecraft:bee',
              snbtText: function () {
                var e = clone(list[i].entity_data || {});
                if (!e.id) e.id = 'minecraft:bee';
                return nbtMerge(e, null);
              },
              onPick: function (id) {
                list[i].entity_data = Object.assign(clone(list[i].entity_data), { id: id });
                save();
                weRender();
              },
              onEntityNbt: function (snbt) {
                list[i].entity_data = vaultEntityObj(snbt);
                save();
                weRender();
              }
            }),
            xField('clock', I18n.t('cadeditor.ui.worldview.time_inside'), t1.el),
            xField('hourglass', I18n.t('cadeditor.ui.worldview.minimum_stay'), t2.el),
            h('div', { class: 'x2f' }, [h('div', { class: 'grow' }), rm])
          ];
        }
      })
    );
  });
  if (!max || list.length < max)
    body.appendChild(
      xAdd(I18n.t('cadeditor.ui.worldview.add_bee'), function () {
        list.push({ entity_data: { id: 'minecraft:bee' }, ticks_in_hive: 0, min_ticks_in_hive: 600 });
        save();
        weRender();
      })
    );
  body.appendChild(kHint(I18n.t('cadeditor.ui.worldview.honey_level_changed_block_status')));
};

/* ---------- 讲台 / 唱片机 ---------- */
WEV.lectern = function (body, g) {
  body.appendChild(xSec('book_open', I18n.t('cadeditor.ui.pages.book')));
  body.appendChild(
    xRow({
      icon: false,
      title: I18n.t('cadeditor.ui.worldview.book'),
      sub: I18n.t('cadeditor.ui.worldview.only_books_pens_books'),
      right: wvItem(weVal(g, 'Book'), function (v) {
        weSetV(g, 'Book', v);
        weRender();
      })
    })
  );
  body.appendChild(
    wvNum(g, 'Page', I18n.t('cadeditor.ui.worldview.page_number'), {
      sub: I18n.t('cadeditor.ui.worldview.play_own_page_number_empty')
    })
  );
};
WEV.jukebox = function (body, g) {
  body.appendChild(xSec('music', I18n.t('cadeditor.ui.picker.record')));
  body.appendChild(
    xRow({
      icon: false,
      title: I18n.t('cadeditor.ui.worldview.playing_item'),
      sub: I18n.t('cadeditor.ui.worldview.requires_jukebox_playable_component'),
      tip: I18n.t('cadeditor.ui.worldview.minecraft_jukebox_playable_open_ended'),
      right: wvItem(weVal(g, 'RecordItem'), function (v) {
        weSetV(g, 'RecordItem', v);
        weRender();
      })
    })
  );
};
/* Explicit patches/removals precede actual game defaults. Unknown is not unsupported. */
function wvJukeboxProblem(stack) {
  if (!stack || stack.empty || !stack.id || Reg.full(stack.id) === 'minecraft:air') return '';
  var cid = 'minecraft:jukebox_playable',
    short = 'jukebox_playable',
    c = stack.components || stack.comps || {},
    removed = stack.removed || {};
  var missing = I18n.t('cadeditor.ui.worldview.item_missing_minecraft_jukebox_playable');
  if (c['!' + cid] !== undefined || c['!' + short] !== undefined || removed[cid] || removed[short]) return missing;
  if (Object.prototype.hasOwnProperty.call(c, cid) || Object.prototype.hasOwnProperty.call(c, short)) return '';
  var meta = Reg.itemMeta(stack.id);
  if (meta && typeof meta.jukebox_playable === 'boolean') return meta.jukebox_playable ? '' : missing;
  var defaults = Reg.defaultsOf(stack.id);
  if (defaults) return defaults[cid] !== undefined || defaults[short] !== undefined ? '' : missing;
  return I18n.t('cadeditor.ui.worldview.reading_item_playback_component');
}
function weViewProblems() {
  var problems = [],
    j = WE.views && WE.views.jukebox;
  if (j && Object.prototype.hasOwnProperty.call(j, 'RecordItem')) {
    var p = wvJukeboxProblem(j.RecordItem);
    if (p) problems.push(p);
  }
  if (WE.w && WE.w.type === 'minecraft:jukebox')
    Object.keys(WE.slots || {}).forEach(function (k) {
      var p = wvJukeboxProblem(WE.slots[k]);
      if (p && problems.indexOf(p) < 0) problems.push(p);
    });
  return problems;
}

/* ---------- 纹饰陶罐：后 / 左 / 右 / 前 ---------- */
WEV.decorated_pot = function (body, g) {
  var cur = clone(weVal(g, 'sherds') || []);
  while (cur.length < 4) cur.push('minecraft:brick');
  var names = [
    I18n.t('cadeditor.ui.worldview.back'),
    I18n.t('cadeditor.ui.labels.left'),
    I18n.t('cadeditor.ui.labels.right'),
    I18n.t('cadeditor.ui.worldview.front')
  ];
  body.appendChild(
    xSec('gem', I18n.t('cadeditor.ui.worldview.pot_decorations'), I18n.t('cadeditor.ui.worldview.pottery_sherd_brick'))
  );
  names.forEach(function (nm, i) {
    var id = cur[i],
      btn = h('div', { class: 'k-btn' }, [itemIcon(shortId(id), 22), h('span', { text: nameOfItem(id) })]);
    activate(btn, function () {
      pickItem(btn, function (x) {
        cur[i] = fullId(x);
        weSetV(g, 'sherds', cur.slice());
        kPopClose();
        weRender();
      });
    });
    body.appendChild(xRow({ icon: false, title: I18n.t('cadeditor.ui.worldview.paste', nm), right: btn }));
  });
  body.appendChild(kHint(I18n.t('cadeditor.ui.worldview.what_s_pot_pottery_container')));
};
WEV.chiseled_bookshelf = function (body, g) {
  body.appendChild(xSec('book', I18n.t('cadeditor.ui.worldview.chiseled_bookshelf')));
  body.appendChild(
    wvNum(g, 'last_interacted_slot', I18n.t('cadeditor.ui.worldview.last_interacted_slot'), {
      sub: I18n.t('cadeditor.ui.worldview.n1_means_interaction_yet')
    })
  );
  body.appendChild(kHint(I18n.t('cadeditor.ui.worldview.six_books_placed_container_page')));
};

/* ---------- 命令方块：模式 + 命令 ---------- */
WEV.command_block = function (body, g) {
  var types = weTypeSchema();
  if (types.length > 1) {
    var NAMES = {
      'minecraft:command_block': I18n.t('cadeditor.ui.worldview.impulse'),
      'minecraft:repeating_command_block': I18n.t('cadeditor.ui.worldview.repeat'),
      'minecraft:chain_command_block': I18n.t('cadeditor.ui.worldview.chain')
    };
    body.appendChild(xSec('terminal', I18n.t('cadeditor.ui.labels.mode')));
    body.appendChild(
      h('div', { class: 'k-row' }, [
        kSeg(
          types.map(function (t) {
            return { v: t, label: NAMES[t] || humanId(shortId(t)) };
          }),
          WE.btype || WE.w.block,
          function (v) {
            WE.btype = v === WE.w.block ? '' : v;
            weMarkDirty();
          }
        ).el
      ])
    );
  }
  body.appendChild(xSec('code', I18n.t('cadeditor.ui.screens.command')));
  var ta = h('textarea', {
    class: 'ed-snbt we-cmd',
    spellcheck: 'false',
    placeholder: I18n.t('cadeditor.ui.worldview.say_hi_omitted_beginning')
  });
  ta.value = weVal(g, 'Command') || '';
  ta.addEventListener('change', function () {
    weSetV(g, 'Command', ta.value);
  });
  body.appendChild(ta);
  cmdAssistAttach(ta, 'world:command_block', function (text) {
    ta.value = text;
    weSetV(g, 'Command', text);
  });
  body.appendChild(
    wvToggle(
      g,
      'auto',
      I18n.t('cadeditor.ui.worldview.always_active'),
      I18n.t('cadeditor.ui.worldview.without_red_stone_s_going')
    )
  );
  body.appendChild(
    wvToggle(
      g,
      'TrackOutput',
      I18n.t('cadeditor.ui.worldview.track_previous_output'),
      I18n.t('cadeditor.ui.worldview.command_after_off_block_t')
    )
  );
  body.appendChild(
    wvToggle(
      g,
      'powered',
      I18n.t('cadeditor.ui.worldview.powered'),
      I18n.t('cadeditor.ui.worldview.receiving_redstone_signal')
    )
  );
  var cond = weStateSchema().filter(function (p) {
    return p.name === 'conditional';
  })[0];
  if (cond)
    body.appendChild(
      xToggle({
        title: I18n.t('cadeditor.ui.labels.conditional'),
        sub: I18n.t('cadeditor.ui.worldview.only_one_back_block_successful'),
        value: weStateCur(cond) === 'true',
        onChange: function (on) {
          var v = on ? 'true' : 'false';
          if (v === cond.current) delete WE.bstate.conditional;
          else WE.bstate.conditional = v;
          weMarkDirty();
        }
      })
    );
};

/* ---------- 头颅 ---------- */
WEV.skull = function (body, g) {
  var prof = weVal(g, 'minecraft:profile'),
    simple =
      prof === null ||
      prof === undefined ||
      typeof prof === 'string' ||
      (typeof prof === 'object' &&
        Object.keys(prof).every(function (k) {
          return k === 'name';
        }));
  body.appendChild(xSec('skull', I18n.t('cadeditor.ui.worldview.head')));
  if (simple) {
    var nm = typeof prof === 'string' ? prof : (prof && prof.name) || '';
    var owner = WE.w,
      previewTimer = null;
    var ownerRow = xText({
      title: I18n.t('cadeditor.ui.worldview.head_owner'),
      sub: I18n.t('cadeditor.ui.worldview.enter_preview_skin_after_player'),
      value: nm,
      placeholder: I18n.t('cadeditor.ui.screens.player_name'),
      cls: 'we-in',
      onInput: function (t) {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(function () {
          if (WE.w === owner && ownerRow.parentNode) {
            var v = t.trim();
            weHeroLive(v ? { name: v } : null);
          }
        }, 500);
      },
      onCommit: function (t) {
        clearTimeout(previewTimer);
        var v = t.trim();
        weSetV(g, 'minecraft:profile', v ? { name: v } : null);
      }
    });
    body.appendChild(ownerRow);
  } else
    body.appendChild(
      xRow({
        icon: false,
        title: I18n.t('cadeditor.ui.worldview.head_owner'),
        sub: I18n.t('cadeditor.ui.worldview.data_skin_change_here_clear'),
        right: kBtn(
          I18n.t('cadeditor.ui.picker.clear'),
          function () {
            weSetV(g, 'minecraft:profile', null);
            weRender();
          },
          { icon: 'trash' }
        )
      })
    );
  body.appendChild(
    xText({
      title: I18n.t('cadeditor.ui.cards1.name'),
      value: msgText(weVal(g, 'minecraft:custom_name')),
      placeholder: I18n.t('cadeditor.ui.worldplayer.custom_name_optional'),
      cls: 'we-in',
      onCommit: function (t) {
        weSetV(g, 'minecraft:custom_name', t ? textMsg(t) : null);
      }
    })
  );
};

/* ---------- 熔炉 / 酿造台 / 营火：计时 ---------- */
WEV.furnace = function (body, g) {
  body.appendChild(
    xSec('furnace', I18n.t('cadeditor.ui.worldview.progress'), I18n.t('cadeditor.ui.worldview.unit_game_ticks_20_1'))
  );
  body.appendChild(
    wvNum(g, 'cooking_time_spent', I18n.t('cadeditor.ui.worldview.cooking_time_elapsed'), {
      unit: I18n.t('cadeditor.ui.cards2.ticks')
    })
  );
  body.appendChild(
    wvNum(g, 'cooking_total_time', I18n.t('cadeditor.ui.worldview.total_cooking_time'), {
      unit: I18n.t('cadeditor.ui.cards2.ticks')
    })
  );
  body.appendChild(
    wvNum(g, 'lit_time_remaining', I18n.t('cadeditor.ui.worldview.burn_time_remaining'), {
      unit: I18n.t('cadeditor.ui.cards2.ticks')
    })
  );
  body.appendChild(
    wvNum(g, 'lit_total_time', I18n.t('cadeditor.ui.worldview.total_fuel_burn_time'), {
      unit: I18n.t('cadeditor.ui.cards2.ticks')
    })
  );
  body.appendChild(kHint(I18n.t('cadeditor.ui.worldview.game_runs_own_push_change')));
};
WEV.brewing_stand = function (body, g) {
  body.appendChild(xSec('flask', I18n.t('cadeditor.ui.worldview.progress')));
  body.appendChild(
    wvNum(g, 'BrewTime', I18n.t('cadeditor.ui.worldview.brewing_time_remaining'), {
      unit: I18n.t('cadeditor.ui.cards2.ticks')
    })
  );
  body.appendChild(wvNum(g, 'Fuel', I18n.t('cadeditor.ui.worldview.blaze_powder_fuel')));
};
WEV.campfire = function (body, g) {
  var n = weViewField(g, 'CookingTimes').length || 4;
  var a = clone(weVal(g, 'CookingTimes') || []),
    b = clone(weVal(g, 'CookingTotalTimes') || []);
  body.appendChild(
    xSec('campfire', I18n.t('cadeditor.ui.worldview.cooking_slots'), I18n.t('cadeditor.ui.worldview.unit_game_ticks'))
  );
  for (var i = 0; i < n; i++)
    (function (i) {
      var x = kNumber(a[i] || 0, {
        min: 0,
        noSlider: true,
        step: 20,
        unit: I18n.t('cadeditor.ui.cards2.ticks'),
        onChange: function (v) {
          a[i] = v;
          weSetV(g, 'CookingTimes', a.slice());
        }
      });
      var y = kNumber(b[i] || 0, {
        min: 0,
        noSlider: true,
        step: 20,
        unit: I18n.t('cadeditor.ui.cards2.ticks'),
        onChange: function (v) {
          b[i] = v;
          weSetV(g, 'CookingTotalTimes', b.slice());
        }
      });
      body.appendChild(
        xRow({
          icon: false,
          title: I18n.t('cadeditor.ui.worldview.barbecue_slot', i + 1),
          sub: I18n.t('cadeditor.ui.worldview.cooked_total_cooking_time'),
          right: h('div', { class: 'k-row' }, [x.el, y.el])
        })
      );
    })(i);
};

/* ---------- 自定义名称（所有能改名的方块：箱子、熔炉、漏斗、附魔台……）---------- */
WEV.nameable = function (body, g) {
  body.appendChild(
    xSec('tag', I18n.t('cadeditor.ui.cards1.name'), I18n.t('cadeditor.ui.worldview.leave_empty_using_block_original'))
  );
  var cur = weVal(g, 'CustomName');
  var r = kRich(cur === undefined || cur === null ? '' : cur, {
    placeholder: I18n.t('cadeditor.ui.worldview.enter_new_name_leaving_empty'),
    onChange: function (v, empty) {
      weSetV(g, 'CustomName', empty ? null : v);
    }
  });
  body.appendChild(r.el);
};

/* ---------- 漏斗：搬运冷却 ---------- */
WEV.hopper = function (body, g) {
  body.appendChild(
    xSec('sliders', I18n.t('cadeditor.ui.worldview.transfer'), I18n.t('cadeditor.ui.worldview.unit_game_ticks_20_1'))
  );
  body.appendChild(
    xNum({
      title: I18n.t('cadeditor.ui.worldview.transfer_cooldown'),
      sub: I18n.t('cadeditor.ui.worldview.delay_until_next_transfer_0'),
      value: weVal(g, 'TransferCooldown'),
      def: 0,
      step: 1,
      unit: I18n.t('cadeditor.ui.cards2.ticks'),
      onChange: function (x) {
        weSetV(g, 'TransferCooldown', x);
      }
    })
  );
  body.appendChild(kHint(I18n.t('cadeditor.ui.worldview.game_runs_own_countdown_change')));
};

/* ---------- 信标：主 / 副效果（候选来自游戏），等级只读 ---------- */
WEV.beacon = function (body, g) {
  body.appendChild(
    xSec(
      'sparkle',
      I18n.t('cadeditor.ui.picker.effect'),
      I18n.t('cadeditor.ui.worldview.write_beacons_selected_clear_effect')
    )
  );
  [
    [
      'primary_effect',
      I18n.t('cadeditor.ui.worldview.primary_effect'),
      I18n.t('cadeditor.ui.worldview.effects_available_beacon_level_1')
    ],
    [
      'secondary_effect',
      I18n.t('cadeditor.ui.worldview.secondary_effect'),
      I18n.t('cadeditor.ui.worldview.four_tier_pyramids_only_same')
    ]
  ].forEach(function (d) {
    var key = d[0],
      cands = (weViewField(g, key).candidates || []).slice(),
      cur = weVal(g, key) || '';
    if (cur && cands.indexOf(cur) < 0) cands.push(cur);
    var entries = cands.map(function (id) {
      return {
        v: id,
        label: Reg.nameOf('mob_effects', id) || (EFIDX[shortId(id)] || {}).name || humanId(shortId(id)),
        sub: id,
        icon: function () {
          return effectIcon(id, 16);
        }
      };
    });
    var sel = kSelect(
      entries,
      cur || null,
      function (v) {
        weSetV(g, key, v);
        weRender();
      },
      {
        width: 240,
        empty: I18n.t('cadeditor.ui.pages.none'),
        placeholder: I18n.t('cadeditor.ui.worldview.search_effects')
      }
    );
    var right = [sel.el];
    if (cur)
      right.push(
        kBtn(
          I18n.t('cadeditor.ui.picker.clear'),
          function () {
            weSetV(g, key, null);
            weRender();
          },
          { icon: 'trash' }
        )
      );
    body.appendChild(xRow({ icon: false, title: d[1], sub: d[2], right: h('div', { class: 'k-row' }, right) }));
  });
  var lv = weViewOrig(g).Levels;
  body.appendChild(
    xRow({
      icon: false,
      title: I18n.t('cadeditor.ui.worldview.pyramid_level'),
      sub: I18n.t('cadeditor.ui.worldview.pyramid_below_t_changed_directly'),
      right: h('span', { class: 'k-sub', text: String(lv === undefined ? 0 : lv) })
    })
  );
};

/* ---------- 合成器：禁用格子 + 触发状态 ---------- */
WEV.crafter = function (body, g) {
  var f = weViewField(g, 'disabled_slots'),
    max = f.item_max === undefined ? 8 : f.item_max,
    min = f.item_min === undefined ? 0 : f.item_min;
  var cur = clone(weVal(g, 'disabled_slots') || []);
  function filled(i) {
    var s = ((WE.w.container && WE.w.container.slots) || []).filter(function (x) {
      return x.slot === i;
    })[0];
    return !!s && !s.stack.empty;
  }
  body.appendChild(
    xSec(
      'grid',
      I18n.t('cadeditor.ui.worldview.disabled_slots'),
      I18n.t('cadeditor.ui.worldview.click_disable_restore_only_spaces')
    )
  );
  var grid = h('div', { class: 'k-cgrid tray', style: 'grid-template-columns:repeat(3,34px)' });
  for (var i = min; i <= max; i++)
    (function (i) {
      var off = cur.indexOf(i) >= 0,
        cell = h(
          'div',
          {
            class: 'slot s34' + (off ? ' sel' : ''),
            title: I18n.t(
              'cadeditor.ui.worldview.grid',
              i + 1,
              off
                ? I18n.t('cadeditor.ui.worldview.disabled')
                : filled(i)
                  ? I18n.t('cadeditor.ui.worldview.s_something_t_disabled')
                  : ''
            )
          },
          off ? [uiIcon('close', 14)] : []
        );
      activate(cell, function () {
        if (cur.indexOf(i) < 0 && filled(i)) {
          toast(I18n.t('cadeditor.ui.worldview.s_something_gerry_container_page'), 'warn');
          return;
        }
        var next =
          cur.indexOf(i) >= 0
            ? cur.filter(function (x) {
                return x !== i;
              })
            : cur.concat([i]);
        next.sort(function (a, b) {
          return a - b;
        });
        weSetV(g, 'disabled_slots', next);
        weRender();
      });
      grid.appendChild(cell);
    })(i);
  body.appendChild(grid);
  body.appendChild(
    wvToggle(
      g,
      'triggered',
      I18n.t('cadeditor.ui.labels.triggered'),
      I18n.t('cadeditor.ui.worldview.trigger_status_recorded_synthesizer_red')
    )
  );
};

/* ---------- 只读行：给出当前值，没有任何控件 ---------- */
function wvReadonly(label, text, sub) {
  return xRow({ icon: false, title: label, sub: sub, right: h('span', { class: 'k-sub', text: text }) });
}
/* 文本字段（失焦 / 回车才写草稿） */
function wvText(g, k, label, o) {
  o = o || {};
  var v = weVal(g, k);
  return xText({
    title: label,
    sub: o.sub,
    value: v === undefined || v === null ? '' : String(v),
    placeholder: o.placeholder,
    onCommit: function (t) {
      weSetV(g, k, t);
    }
  });
}
/* 整数字段当前值超出 JS 能精确表示的范围时，不在这里改（会被四舍五入），提示去「数据」页 */
function wvBigInt(g, k, label, o) {
  o = o || {};
  var v = weVal(g, k);
  if (weViewField(g, k).wire_snbt) {
    var meta = nbtMeta(v),
      raw = meta && meta.scalar ? meta.scalar.raw.replace(/[lL]$/, '') : String(v === undefined ? 0 : v);
    if (Math.abs(Number(v)) > 9007199254740991)
      return xText({
        title: label,
        sub: o.sub,
        value: raw,
        cls: 'we-in',
        onCommit: function (text) {
          if (!/^[+-]?\d+$/.test(text.trim())) {
            toast(I18n.t('cadeditor.ui.worldview.enter_complete_integer'), 'error');
            return;
          }
          weSetV(g, k, parseSnbt(text.trim() + 'L'));
        }
      });
    return xNum({
      title: label,
      sub: o.sub,
      value: Number(v) || 0,
      step: 1,
      unit: o.unit,
      noSlider: true,
      onChange: function (x) {
        weSetV(g, k, parseSnbt(String(x) + 'L'));
      }
    });
  }
  if (typeof v === 'number' && !(Math.abs(v) <= 9007199254740991))
    return wvReadonly(label, String(v), I18n.t('cadeditor.ui.worldview.value_too_high_change_data'));
  return xNum({
    title: label,
    sub: o.sub,
    value: typeof v === 'number' ? v : 0,
    step: 1,
    unit: o.unit,
    noSlider: true,
    onChange: function (x) {
      weSetV(g, k, x);
    }
  });
}
/* 候选来自后端 schema.fields.KEY.candidates 的枚举字段（大小写按候选原样写回） */
var WV_ENUM = {
  none: I18n.t('cadeditor.ui.common.none'),
  clockwise_90: I18n.t('cadeditor.ui.worldview.n90_clockwise'),
  clockwise_180: '180°',
  counterclockwise_90: I18n.t('cadeditor.ui.worldview.n90_counterclockwise'),
  left_right: I18n.t('cadeditor.ui.worldview.left_right'),
  front_back: I18n.t('cadeditor.ui.worldview.front_back'),
  save: I18n.t('cadeditor.ui.common.save'),
  load: I18n.t('cadeditor.ui.worldview.load'),
  corner: I18n.t('cadeditor.ui.worldview.corner'),
  data: I18n.t('cadeditor.ui.labels.data'),
  rollable: I18n.t('cadeditor.ui.worldview.scrollable'),
  aligned: I18n.t('cadeditor.ui.worldentity.alignment')
};
function wvEnum(g, k, label, o) {
  o = o || {};
  var cands = weViewField(g, k).candidates || [],
    cur = weVal(g, k);
  if (!cands.length) return wvText(g, k, label, o);
  var opts = cands.map(function (c) {
    return { v: c, label: WV_ENUM[String(c).toLowerCase()] || String(c) };
  });
  if (cands.length <= 4)
    return xSeg({
      title: label,
      sub: o.sub,
      options: opts,
      value: cur,
      onChange: function (x) {
        weSetV(g, k, x);
      }
    });
  return xSelect({
    title: label,
    sub: o.sub,
    options: opts,
    value: cur,
    width: 180,
    onChange: function (x) {
      weSetV(g, k, x);
    }
  });
}

/* ---------- 潮涌核心（只读） ---------- */
WEV.conduit = function (body, g) {
  var v = weViewOrig(g);
  body.appendChild(
    xSec(
      'sparkle',
      I18n.t('cadeditor.ui.worldview.conduit'),
      I18n.t('cadeditor.ui.worldview.computed_game_each_tick_read')
    )
  );
  body.appendChild(
    wvReadonly(
      I18n.t('cadeditor.ui.worldview.active'),
      v.Active ? I18n.t('cadeditor.ui.labels.yes') : I18n.t('cadeditor.ui.labels.no')
    )
  );
  body.appendChild(
    wvReadonly(
      I18n.t('cadeditor.ui.worldview.attacking'),
      v.Hunting ? I18n.t('cadeditor.ui.labels.yes') : I18n.t('cadeditor.ui.labels.no')
    )
  );
  body.appendChild(
    wvReadonly(
      I18n.t('cadeditor.ui.worldview.target'),
      v.Target ? I18n.t('cadeditor.ui.worldview.yes') : I18n.t('cadeditor.ui.worldentity.none_2')
    )
  );
};
/* ---------- 末地折跃门 ---------- */
WEV.end_gateway = function (body, g) {
  var ep = weVal(g, 'exit_portal'),
    has = Array.isArray(ep) && ep.length === 3;
  body.appendChild(xSec('wind', I18n.t('cadeditor.ui.worldview.end_gateway')));
  body.appendChild(
    xToggle({
      title: I18n.t('cadeditor.ui.worldview.exit_position'),
      sub: I18n.t('cadeditor.ui.worldview.turn_off_default_exit_game'),
      value: has,
      onChange: function (on) {
        weSetV(g, 'exit_portal', on ? [0, 64, 0] : null);
        weRender();
      }
    })
  );
  if (has)
    ['X', 'Y', 'Z'].forEach(function (ax, i) {
      body.appendChild(
        xNum({
          title: I18n.t('cadeditor.ui.worldview.text', ax),
          value: ep[i],
          step: 1,
          noSlider: true,
          onChange: function (x) {
            var a = (weVal(g, 'exit_portal') || ep).slice();
            a[i] = x;
            weSetV(g, 'exit_portal', a);
          }
        })
      );
    });
  body.appendChild(
    wvToggle(
      g,
      'ExactTeleport',
      I18n.t('cadeditor.ui.worldview.exact_teleport'),
      I18n.t('cadeditor.ui.worldview.teleport_directly_exit_without_searching')
    )
  );
  body.appendChild(
    wvBigInt(g, 'Age', I18n.t('cadeditor.ui.worldentity.age'), { unit: I18n.t('cadeditor.ui.cards2.ticks') })
  );
};
/* ---------- 结构方块 ---------- */
WEV.structure_block = function (body, g) {
  body.appendChild(xSec('cube', I18n.t('cadeditor.ui.worldview.structure')));
  body.appendChild(
    wvText(g, 'name', I18n.t('cadeditor.ui.labels.name'), {
      sub: I18n.t('cadeditor.ui.worldview.write_resource_id_e_g')
    })
  );
  body.appendChild(wvText(g, 'author', I18n.t('cadeditor.ui.cards3.author')));
  body.appendChild(wvText(g, 'metadata', I18n.t('cadeditor.ui.worldview.data_marker')));
  body.appendChild(wvEnum(g, 'mode', I18n.t('cadeditor.ui.labels.mode')));
  body.appendChild(xSec('target', I18n.t('cadeditor.ui.forms.range_2'), I18n.t('cadeditor.ui.worldview.unit_blocks')));
  ['posX', 'posY', 'posZ'].forEach(function (k, i) {
    body.appendChild(wvNum(g, k, I18n.t('cadeditor.ui.worldview.offset', 'XYZ'.charAt(i))));
  });
  ['sizeX', 'sizeY', 'sizeZ'].forEach(function (k, i) {
    body.appendChild(wvNum(g, k, I18n.t('cadeditor.ui.worldview.size', 'XYZ'.charAt(i))));
  });
  body.appendChild(xSec('sliders', I18n.t('cadeditor.ui.worldview.place')));
  body.appendChild(wvEnum(g, 'rotation', I18n.t('cadeditor.ui.labels.rotation')));
  body.appendChild(wvEnum(g, 'mirror', I18n.t('cadeditor.ui.worldview.mirror')));
  body.appendChild(
    xNum({
      title: I18n.t('cadeditor.ui.worldview.integrity'),
      sub: I18n.t('cadeditor.ui.worldview.n1_place_all'),
      value: typeof weVal(g, 'integrity') === 'number' ? weVal(g, 'integrity') : 1,
      step: 0.05,
      dec: 3,
      noSlider: true,
      onChange: function (x) {
        weSetV(g, 'integrity', x);
      }
    })
  );
  body.appendChild(wvBigInt(g, 'seed', I18n.t('cadeditor.ui.world.random_seed')));
  body.appendChild(wvToggle(g, 'ignoreEntities', I18n.t('cadeditor.ui.worldview.ignore_entities')));
  body.appendChild(wvToggle(g, 'showair', I18n.t('cadeditor.ui.worldview.show_air')));
  body.appendChild(wvToggle(g, 'showboundingbox', I18n.t('cadeditor.ui.worldview.show_bounding_box')));
  body.appendChild(
    wvToggle(
      g,
      'powered',
      I18n.t('cadeditor.ui.worldview.powered'),
      I18n.t('cadeditor.ui.worldview.receiving_redstone_signal')
    )
  );
};
/* ---------- 拼图方块 ---------- */
WEV.jigsaw = function (body, g) {
  body.appendChild(xSec('link', I18n.t('cadeditor.ui.worldview.jigsaw')));
  body.appendChild(
    wvText(g, 'name', I18n.t('cadeditor.ui.labels.name'), { sub: I18n.t('cadeditor.ui.worldview.resource_id') })
  );
  body.appendChild(
    wvText(g, 'target', I18n.t('cadeditor.ui.worldview.target_connector_name'), {
      sub: I18n.t('cadeditor.ui.worldview.resource_id')
    })
  );
  body.appendChild(
    wvText(g, 'pool', I18n.t('cadeditor.ui.worldview.template_pool'), {
      sub: I18n.t('cadeditor.ui.worldview.resource_id_t_pool_yet')
    })
  );
  body.appendChild(
    wvText(g, 'final_state', I18n.t('cadeditor.ui.worldview.final_state_after_generation'), {
      sub: I18n.t('cadeditor.ui.worldview.block_id_game_doesn_t')
    })
  );
  body.appendChild(wvEnum(g, 'joint', I18n.t('cadeditor.ui.worldview.joint')));
};
/* ---------- 幽匿感测体 / 校频幽匿感测体 / 幽匿尖啸体 ---------- */
WEV.sculk_sensor = function (body, g) {
  body.appendChild(xSec('sparkle', I18n.t('cadeditor.ui.worldview.vibration')));
  body.appendChild(wvNum(g, 'last_vibration_frequency', I18n.t('cadeditor.ui.worldview.last_vibration_frequency')));
  body.appendChild(
    wvNum(g, 'listener.event_delay', I18n.t('cadeditor.ui.worldview.event_delay'), {
      unit: I18n.t('cadeditor.ui.cards2.ticks')
    })
  );
};
WEV.sculk_shrieker = function (body, g) {
  body.appendChild(xSec('sparkle', I18n.t('cadeditor.ui.labels.shrieking')));
  body.appendChild(wvNum(g, 'warning_level', I18n.t('cadeditor.ui.worldview.warning_level')));
  body.appendChild(
    wvNum(g, 'listener.event_delay', I18n.t('cadeditor.ui.worldview.event_delay'), {
      unit: I18n.t('cadeditor.ui.cards2.ticks')
    })
  );
  body.appendChild(kHint(I18n.t('cadeditor.ui.worldview.call_guards_they_squeezing_block')));
};
WEV.sculk_catalyst = function (body, g) {
  var c = weViewOrig(g).cursors;
  body.appendChild(
    xSec(
      'sparkle',
      I18n.t('cadeditor.ui.worldview.sculk_catalyst'),
      I18n.t('cadeditor.ui.worldview.spreading_charge_game_pipe_cannot')
    )
  );
  body.appendChild(
    wvReadonly(
      I18n.t('cadeditor.ui.worldview.spreading'),
      I18n.t('cadeditor.ui.cards1.text', Array.isArray(c) ? c.length : 0)
    )
  );
};
/* ---------- 钟（只读） ---------- */
WEV.bell = function (body, g) {
  var v = weViewOrig(g);
  body.appendChild(
    xSec('bell', I18n.t('cadeditor.ui.worldview.bell'), I18n.t('cadeditor.ui.worldview.game_doesn_t_save_s'))
  );
  body.appendChild(
    wvReadonly(
      I18n.t('cadeditor.ui.worldview.shaking'),
      v.shaking ? I18n.t('cadeditor.ui.labels.yes') : I18n.t('cadeditor.ui.labels.no')
    )
  );
  body.appendChild(
    wvReadonly(
      I18n.t('cadeditor.ui.worldview.shake_timer'),
      String(typeof v.ticks === 'number' ? v.ticks : 0),
      I18n.t('cadeditor.ui.cards2.ticks')
    )
  );
};
/* ---------- 试炼宝库 / 不祥宝库（安全子集） ---------- */
WEV.vault = function (body, g) {
  body.appendChild(
    xSec(
      'chest',
      I18n.t('cadeditor.ui.worldview.vault_block'),
      I18n.t('cadeditor.ui.worldview.only_changed_rest_data_page')
    )
  );
  body.appendChild(
    xRow({
      icon: false,
      title: I18n.t('cadeditor.ui.world.key_item'),
      sub: I18n.t('cadeditor.ui.worldview.clear_key_required'),
      right: wvItem(weVal(g, 'config.key_item'), function (v) {
        weSetV(g, 'config.key_item', v);
        weRender();
      })
    })
  );
  var lt = kRegSelect({
    reg: 'loot_table',
    value: weVal(g, 'config.loot_table') || '',
    title: I18n.t('cadeditor.ui.spawn.choose_loot_table'),
    empty: I18n.t('cadeditor.ui.banner.selected'),
    onChange: function (x) {
      if (x) weSetV(g, 'config.loot_table', x);
    }
  });
  body.appendChild(xRow({ icon: false, title: I18n.t('cadeditor.ui.spawn.loot_table'), right: lt.el }));
  body.appendChild(
    xNum({
      title: I18n.t('cadeditor.ui.spawn.activation_range'),
      sub: I18n.t('cadeditor.ui.worldview.player_range_react_t_more'),
      value: weVal(g, 'config.activation_range'),
      def: 4,
      step: 0.5,
      dec: 3,
      unit: I18n.t('cadeditor.ui.cards2.blocks'),
      noSlider: true,
      onChange: function (x) {
        weSetV(g, 'config.activation_range', x);
      }
    })
  );
  body.appendChild(
    xNum({
      title: I18n.t('cadeditor.ui.worldview.deactivation_distance'),
      value: weVal(g, 'config.deactivation_range'),
      def: 4.5,
      step: 0.5,
      dec: 3,
      unit: I18n.t('cadeditor.ui.cards2.blocks'),
      noSlider: true,
      onChange: function (x) {
        weSetV(g, 'config.deactivation_range', x);
      }
    })
  );
  var rp = weViewOrig(g)['server_data.rewarded_players'];
  body.appendChild(
    wvReadonly(
      I18n.t('cadeditor.ui.worldview.players_already_rewarded'),
      I18n.t('cadeditor.ui.worldview.text_2', Array.isArray(rp) ? rp.length : 0),
      I18n.t('cadeditor.ui.worldentity.read_only')
    )
  );
};

function weViewTab(body) {
  var gs = weViewGroups();
  if (!gs.length) {
    body.appendChild(xEmpty(I18n.t('cadeditor.ui.worldview.block_special_settings')));
    return;
  }
  gs.forEach(function (g) {
    var fn = WEV[g];
    if (fn) fn(body, g);
    else body.appendChild(xEmpty(I18n.t('cadeditor.ui.worldview.only_edited_data_page_time', g)));
  });
}

/* ---------- 方块状态：属性名 / 取值的中文名（界面文字；游戏本身没有这些翻译，认不得的原样显示） ---------- */
var WE_PROP = Labels.blockProp;
var WE_VAL = Labels.blockVal;
function wePropName(n) {
  return WE_PROP[n] || humanId(n);
}
function wePropVal(v) {
  return WE_VAL[v] !== undefined ? WE_VAL[v] : v;
}

/* ---------- 方块状态 ---------- */
function weStateRow(p) {
  var cur = weStateCur(p),
    nm = p.name;
  function set(v) {
    if (v === p.current) delete WE.bstate[nm];
    else WE.bstate[nm] = v;
    weMarkDirty();
    weHeroLive();
  }
  var ctl;
  if (p.type === 'boolean')
    ctl = kToggle(cur === 'true', function (on) {
      set(on ? 'true' : 'false');
    }).el;
  else if (p.values.length <= 5)
    ctl = kSeg(
      p.values.map(function (v) {
        return { v: v, label: wePropVal(v) };
      }),
      cur,
      set
    ).el;
  else
    ctl = kSelect(
      p.values.map(function (v) {
        return { v: v, label: wePropVal(v) };
      }),
      cur,
      set,
      { width: 200 }
    ).el;
  return xRow({
    icon: false,
    title: wePropName(nm),
    sub: p.default !== undefined ? I18n.t('cadeditor.ui.eschema.default', wePropVal(p.default)) : '',
    tip: nm,
    right: ctl
  });
}
function weStateTab(body) {
  var sc = weStateSchema();
  body.appendChild(
    xSec(
      'sliders',
      I18n.t('cadeditor.ui.rules.block_state'),
      sc.length ? I18n.t('cadeditor.ui.cards2.entries', sc.length) : ''
    )
  );
  if (!sc.length) body.appendChild(xEmpty(I18n.t('cadeditor.ui.worldview.block_doesn_t_state_change')));
  sc.forEach(function (p) {
    body.appendChild(weStateRow(p));
  });
  body.appendChild(
    xToggle({
      title: I18n.t('cadeditor.ui.worldview.notify_neighboring_blocks'),
      sub: I18n.t('cadeditor.ui.worldview.modification_won_t_trigger_surrounding'),
      value: WE.upd,
      onChange: function (on) {
        WE.upd = on;
      }
    })
  );
}
