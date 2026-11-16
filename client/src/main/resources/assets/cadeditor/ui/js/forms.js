/* 表单渲染：按结构定义（EDATA.comps[].schema）自动生成控件，常用组件有专用控件。
   每个控件函数：w(sc, val, commit, ctx) -> 元素；commit(新值, {key}) 把改动交给父级。 */

/* ---------- DOM 小工具 ---------- */
function h(tag, props, kids) {
  var el = document.createElement(tag),
    k;
  props = props || {};
  for (k in props) {
    var v = props[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k === 'title') {
      if (v !== '') el.setAttribute('data-tip', String(v));
    } // 原生 title 由 Oriel 自己画，会和 tip.js 的自绘提示叠在一起；一律写成 data-tip
    else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.substring(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  if (kids)
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  return el;
}
/* 悬停提示一律走这里（或 h() 的 title 参数），不要直接写原生的 title 属性：Oriel 会把它画成原版提示框，和自绘提示同时出现。空文字 = 去掉提示 */
function setTip(el, text) {
  if (text === undefined || text === null || text === '') el.removeAttribute('data-tip');
  else el.setAttribute('data-tip', String(text));
}
function icon(name, extra) {
  return h('img', {
    class: 'o-ico' + (extra ? ' ' + extra : ''),
    src: 'oriel:textures/icons/' + name + '.png',
    alt: ''
  });
}
function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}
function onKey(el, map) {
  el.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && e.repeat) {
      e.preventDefault();
      return;
    }
    var f = map[e.key];
    if (f) {
      if (f(e) !== false) e.preventDefault();
    }
  });
}
function activate(el, fn) {
  el.setAttribute('tabindex', '0');
  el.addEventListener('click', function (e) {
    fn(e);
    if (typeof uiClick === 'function') uiClick(el);
  });
  el.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn(e);
      if (typeof uiClick === 'function') uiClick(el);
    }
  });
}

/* 展开/折叠状态跨重绘保留 */
var UIOpen = {};

/* ---------- 带候选的选择（通用表单用） ----------
   options = [{v,label,sub}] 或返回它的函数；free=true 允许写入列表里没有的值（搜索框回车）；
   reset=true 选完后按钮回到占位文字（用于「添加…」）。弹出层用公共的 pickFrom，和 kSelect 同一套外观。 */
function combo(o) {
  var cur = o.value === undefined || o.value === null ? '' : String(o.value);
  var btn = h('div', { class: 'k-btn k-sel' });
  function opts() {
    return typeof o.options === 'function' ? o.options() : o.options;
  }
  function paint() {
    clear(btn);
    var e = null;
    if (cur !== '')
      opts().forEach(function (x) {
        if (String(x.v) === cur) e = x;
      });
    btn.appendChild(h('span', { text: e ? e.label : cur || o.placeholder || I18n.t('cadeditor.ui.cards2.select') }));
    btn.appendChild(uiIcon('down', 10));
  }
  activate(btn, function () {
    pickFrom(
      btn,
      opts(),
      function (x) {
        if (!o.reset) {
          cur = String(x.v);
          paint();
        }
        o.onPick(x.v, x.manual ? null : x);
      },
      {
        width: 260,
        placeholder: o.placeholder,
        manual: o.free
          ? {
              label: I18n.t('cadeditor.ui.forms.values_found_list_used'),
              parse: function (t) {
                return t;
              }
            }
          : null
      }
    );
  });
  paint();
  return btn;
}

/* 注册表候选 */
function registryOptions(reg) {
  /* 候选来自游戏实时注册表（含模组）；没有宿主时，有内置清单的退回内置数据，其余只能手动输入。返回函数：数据到达后下一次展开自动是最新的 */
  var off =
    reg === 'item'
      ? EDATA.items.map(function (i) {
          return { v: 'minecraft:' + i, label: humanId(i), sub: i };
        })
      : reg === 'enchantment'
        ? EDATA.enchants.map(function (e) {
            return { v: 'minecraft:' + e.id, label: e.name, sub: e.id };
          })
        : reg === 'attribute'
          ? EDATA.attrs.map(function (a) {
              return { v: 'minecraft:' + a.id, label: a.name, sub: a.id };
            })
          : reg === 'mob_effect'
            ? EDATA.effects.map(function (a) {
                return { v: 'minecraft:' + a.id, label: a.name, sub: a.id };
              })
            : reg === 'data_component_type'
              ? EDATA.comps.map(function (c) {
                  return { v: 'minecraft:' + c.id, label: c.name, sub: c.id };
                })
              : null;
  return function () {
    return Reg.options(reg) || (Reg.preview() ? off : null) || [];
  };
}
var REG_HINT = {
  sound_event: I18n.t('cadeditor.ui.forms.sound_id_like_minecraft_entity'),
  block: I18n.t('cadeditor.ui.forms.block_id_like_minecraft_stone'),
  entity_type: I18n.t('cadeditor.ui.forms.entity_id'),
  damage_type: I18n.t('cadeditor.ui.forms.damage_type_id'),
  instrument: I18n.t('cadeditor.ui.forms.instrument_id'),
  jukebox_song: I18n.t('cadeditor.ui.forms.jukebox_song_id'),
  trim_material: I18n.t('cadeditor.ui.forms.trim_material_id'),
  trim_pattern: I18n.t('cadeditor.ui.forms.trim_pattern_id'),
  banner_pattern: I18n.t('cadeditor.ui.forms.banner_pattern_id'),
  recipe: I18n.t('cadeditor.ui.forms.recipe_id'),
  potion: I18n.t('cadeditor.ui.forms.potion_id'),
  loot_table: I18n.t('cadeditor.ui.forms.loot_table_id'),
  map_decoration_type: I18n.t('cadeditor.ui.forms.map_decoration_type')
};

/* ---------- 默认值 ---------- */
function formDefault(f) {
  return typeof Reg !== 'undefined' ? Reg.fieldDefault(f) : undefined;
}
function defaultFor(sc) {
  if (!sc) return null;
  switch (sc.t) {
    case 'bool':
      return false;
    case 'int':
    case 'num': {
      var v = 0;
      if (sc.min !== undefined && v < sc.min) v = sc.min;
      if (sc.max !== undefined && v > sc.max) v = sc.max;
      return v;
    }
    case 'str':
      return sc.en && Reg.preview() ? sc.en[0] : '';
    case 'text':
      return '';
    case 'obj': {
      var o = {};
      sc.f.forEach(function (f) {
        if (f.r) o[f.k] = formDefault(f) !== undefined ? clone(formDefault(f)) : defaultFor(f.s);
      });
      return o;
    }
    case 'arr':
      return [];
    case 'map':
      return {};
    case 'union':
      return defaultFor(sc.a[0]);
    case 'dunion': {
      if (!Reg.preview()) return {};
      var k = Object.keys(sc.br)[0],
        b = defaultFor(sc.br[k]);
      if (isObj(b)) b[sc.disc] = k;
      return b;
    }
    default:
      return {};
  }
}
function altLabel(a) {
  switch (a.t) {
    case 'str':
      return a.tag ? I18n.t('cadeditor.ui.forms.tag') : a.reg ? 'ID' : I18n.t('cadeditor.ui.code.text');
    case 'int':
    case 'num':
      return I18n.t('cadeditor.ui.forms.value');
    case 'bool':
      return I18n.t('cadeditor.ui.cards4.toggle');
    case 'arr':
      return I18n.t('cadeditor.ui.forms.list');
    case 'text':
      return I18n.t('cadeditor.ui.code.text');
    default:
      return I18n.t('cadeditor.ui.forms.object');
  }
}
function summarize(sc, v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return I18n.t('cadeditor.ui.cards2.entries', v.length);
  var ks = Object.keys(v)
    .slice(0, 3)
    .map(function (k) {
      var x = v[k];
      return k + '=' + (isObj(x) || Array.isArray(x) ? '…' : String(x));
    });
  return ks.join(' ');
}

/* ---------- 基础控件 ---------- */
function wBool(sc, val, commit) {
  var on = !!val;
  var el = h('div', { class: 'ed-toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on) }, [
    h('i', {})
  ]);
  activate(el, function () {
    on = !on;
    el.classList.toggle('on', on);
    el.setAttribute('aria-checked', String(on));
    commit(on, { key: 'tg' });
  });
  return el;
}

function wNum(sc, val, commit, ctx) {
  var isInt = sc.t === 'int';
  var step = ctx && ctx.step ? ctx.step : isInt ? 1 : 0.1;
  var input = h('input', {
    class: 'k-input ed-in ed-numin',
    type: 'text',
    value:
      val === undefined || val === null
        ? ''
        : isFinite(nbtNumberValue(val))
          ? String(nbtNumberValue(val))
          : numLabel(val),
    placeholder: ctx && ctx.placeholder ? ctx.placeholder : I18n.t('cadeditor.ui.common.unset')
  });
  var wrap = kStepper(input, {
      cls: 'ed-num',
      onStep: function (dir, e) {
        nudge(dir, e.shiftKey);
      }
    }),
    editing = false,
    pendingDefault = null;
  function clampv(v) {
    if (sc.min !== undefined && v < sc.min) v = sc.min;
    if (sc.max !== undefined && v > sc.max) v = sc.max;
    return v;
  }
  function allowed(v) {
    return (
      isFinite(v) ||
      (!isInt &&
        sc.live &&
        ((isNaN(v) && sc.allowNaN) ||
          (v === Infinity && sc.allowPositiveInfinity) ||
          (v === -Infinity && sc.allowNegativeInfinity)))
    );
  }
  function packed(v) {
    return isFinite(v) ? v : nbtSpecialScalar(v, sc.nbtType);
  }
  function parse() {
    var t = input.value.trim().replace(/[dfl]$/i, '');
    if (t === '' || t === '-') return undefined;
    if (/^[+\-−]?∞$/.test(t)) return t.charAt(0) === '-' || t.charAt(0) === '−' ? -Infinity : Infinity;
    if (/^NaN$/i.test(t)) return NaN;
    if (/^\+?Infinity$/i.test(t)) return Infinity;
    if (/^-Infinity$/i.test(t)) return -Infinity;
    var n = Number(t);
    return isNaN(n) ? null : n;
  }
  function mark(n) {
    var waiting =
      n !== null &&
      n !== undefined &&
      !isFinite(n) &&
      !isInt &&
      !sc.live &&
      typeof Reg !== 'undefined' &&
      !Reg.preview();
    var bad =
      waiting || n === undefined
        ? false
        : n === null ||
          !allowed(n) ||
          (isInt && !Number.isInteger(n)) ||
          (isFinite(n) &&
            ((sc.min !== undefined && n < sc.min) ||
              (sc.minEx && sc.min !== undefined && n <= sc.min) ||
              (sc.max !== undefined && n > sc.max)));
    wrap.classList.toggle('bad', bad);
  }
  function nudge(dir, big) {
    var n = parse();
    if (n === undefined && (val === undefined || val === null)) {
      toast(I18n.t('cadeditor.ui.forms.enter_value_first'), 'info');
      return;
    }
    if (n === undefined || n === null || !isFinite(n)) n = val === undefined ? 0 : nbtNumberValue(val);
    if (!isFinite(n)) n = 0;
    var d = step * (big ? 10 : 1) * dir;
    n = clampv(isInt ? Math.round(n + d) : n + d);
    input.value = String(n);
    centerInput(input);
    mark(n);
    val = n;
    commit(n, { key: ctx && ctx.key ? ctx.key : 'num' });
  }
  input.addEventListener('input', function () {
    editing = true;
    pendingDefault = null;
    centerInput(input);
    var n = parse();
    mark(n);
    if (n !== undefined && n !== null && allowed(n)) {
      val = n;
      commit(packed(n), { key: ctx && ctx.key ? ctx.key : 'num' });
    }
  });
  input.addEventListener('change', function () {
    var n = parse();
    if (n === undefined) {
      if (ctx && ctx.onEmpty) ctx.onEmpty();
    } else if (n !== null && allowed(n)) {
      var c = isFinite(n) ? clampv(isInt ? Math.round(n) : n) : n;
      if (c !== n) {
        input.value = fmtNum(c);
        mark(c);
        val = c;
        commit(packed(c), { key: 'num' });
      }
    }
  });
  onKey(input, {
    ArrowUp: function (e) {
      nudge(1, e.shiftKey);
    },
    ArrowDown: function (e) {
      nudge(-1, e.shiftKey);
    }
  });
  wrap.refreshDefault = function (v, placeholder) {
    input.setAttribute('placeholder', placeholder || I18n.t('cadeditor.ui.common.unset'));
    if (editing) return;
    if (document.activeElement === input) {
      pendingDefault = { value: v, placeholder: placeholder };
      return;
    }
    pendingDefault = null;
    val = v;
    input.value =
      v === undefined || v === null ? '' : isFinite(nbtNumberValue(v)) ? String(nbtNumberValue(v)) : numLabel(v);
    centerInput(input);
    mark(parse());
  };
  input.addEventListener('blur', function () {
    if (pendingDefault && !editing) wrap.refreshDefault(pendingDefault.value, pendingDefault.placeholder);
  });
  setTimeout(function () {
    centerInput(input);
  }, 0);
  mark(parse());
  return wrap;
}

function wSeg(options, cur, onPick, cls) {
  var seg = h('div', { class: 'o-seg ed-seg' + (cls ? ' ' + cls : '') });
  options.forEach(function (o) {
    var b = h('div', { class: o.v === cur ? 'on' : '', title: o.title || '' }, [o.icon ? icon(o.icon) : null, o.label]);
    activate(b, function () {
      var ch = seg.children;
      for (var i = 0; i < ch.length; i++) ch[i].classList.remove('on');
      b.classList.add('on');
      onPick(o.v);
    });
    seg.appendChild(b);
  });
  return seg;
}

/* 结构里没标注册表、但实际是注册表 ID 的字段：按「组件 + 路径」补上，走统一的选择控件（仍可手动输入） */
var STR_REG = {
  item_model: 'item_model',
  'equippable.asset_id': 'equipment_asset',
  'equippable.camera_overlay': 'camera_overlay'
};
function wStr(sc, val, commit, ctx) {
  if (!sc.reg && !sc.en && !sc.tag) {
    var rg0 = STR_REG[(CURCID || '') + (ctx && ctx.path ? ctx.path : '')];
    if (rg0) {
      var sc2 = {};
      for (var kk0 in sc) sc2[kk0] = sc[kk0];
      sc2.reg = rg0;
      sc = sc2;
    }
  }
  if (
    (sc.en && sc.en.indexOf('light_blue') >= 0 && sc.en.indexOf('magenta') >= 0 && sc.en.indexOf('white') >= 0) ||
    (typeof dyeFieldFor === 'function' && dyeFieldFor(CURCID, ctx && ctx.path))
  )
    return wDye(val, commit);
  if (sc.en) {
    /* 候选以游戏里的枚举为准（liveEnumOptions），没到 / 离线才用内置；多于 4 个的可以直接输入（不在列表里的会在问题列表里提示） */
    var opts = liveEnumOptions(CURCID, ctx && ctx.path) || Reg.schemaEnumOptions(sc);
    if (opts.length > 0 && opts.length <= 4)
      return wSeg(opts, val, function (v) {
        commit(v, {});
      });
    return combo({
      value: val === undefined ? '' : val,
      options: opts,
      free: true,
      placeholder: I18n.t('cadeditor.ui.forms.select_enter_manually'),
      onPick: function (v) {
        if (v !== '') commit(v, {});
      }
    });
  }
  if (typeof dyeFieldFor === 'function' && dyeFieldFor(CURCID, ctx && ctx.path)) return wDye(val, commit);
  var ropts = sc.reg ? registryOptions(sc.reg) : null;
  var ph = sc.tag
    ? I18n.t('cadeditor.ui.forms.label_like_minecraft_logs')
    : (sc.reg && REG_HINT[sc.reg]) || (sc.reg ? sc.reg + ' ID' : '');
  if (sc.reg && !Reg.preview()) {
    /* 注册表字段：统一的“名称 · ID  [选择…]”，音效字段用带试听的音效选择窗；手输 ID 在选择窗的搜索框里 */
    if (sc.reg === 'sound_event')
      return kSoundField(val === undefined ? '' : val, function (x) {
        commit(x, {});
      }).el;
    return kRegSelect({
      reg: sc.reg,
      tag: !!sc.tag,
      value: val === undefined ? '' : String(val),
      empty: I18n.t('cadeditor.ui.banner.selected'),
      onChange: function (x) {
        commit(x, {});
      }
    }).el;
  }
  if (ropts)
    return combo({
      value: val === undefined ? '' : val,
      options: ropts,
      free: true,
      placeholder: ph,
      onPick: function (v) {
        commit(v, {});
      }
    });
  var input = h('input', {
    class: 'ore-field ed-in',
    type: 'text',
    value: val === undefined ? '' : val,
    placeholder: ph || (ctx && ctx.placeholder) || '',
    spellcheck: 'false'
  });
  input.addEventListener('input', function () {
    commit(input.value, { key: 'str' });
  });
  return input;
}

/* ---------- 文本组件 ---------- */
var MC_COLORS = [
  ['black', '000000', I18n.t('cadeditor.ui.forms.black')],
  ['dark_blue', '0000AA', I18n.t('cadeditor.ui.forms.dark_blue')],
  ['dark_green', '00AA00', I18n.t('cadeditor.ui.forms.dark_green')],
  ['dark_aqua', '00AAAA', I18n.t('cadeditor.ui.forms.dark_aqua')],
  ['dark_red', 'AA0000', I18n.t('cadeditor.ui.forms.dark_red')],
  ['dark_purple', 'AA00AA', I18n.t('cadeditor.ui.forms.dark_purple')],
  ['gold', 'FFAA00', I18n.t('cadeditor.ui.forms.gold')],
  ['gray', 'AAAAAA', I18n.t('cadeditor.ui.forms.gray')],
  ['dark_gray', '555555', I18n.t('cadeditor.ui.forms.dark_gray')],
  ['blue', '5555FF', I18n.t('cadeditor.ui.forms.blue')],
  ['green', '55FF55', I18n.t('cadeditor.ui.forms.green')],
  ['aqua', '55FFFF', I18n.t('cadeditor.ui.forms.aqua')],
  ['red', 'FF5555', I18n.t('cadeditor.ui.forms.red')],
  ['light_purple', 'FF55FF', I18n.t('cadeditor.ui.forms.light_purple')],
  ['yellow', 'FFFF55', I18n.t('cadeditor.ui.forms.yellow')],
  ['white', 'FFFFFF', I18n.t('cadeditor.ui.forms.white')]
];
var MC_HEX = {};
MC_COLORS.forEach(function (c) {
  MC_HEX[c[0]] = '#' + c[1];
});
/* 文本颜色：以游戏里的 enum:text_color（ChatFormatting 的颜色）为准，带 rgb；仅浏览器样例预览使用上面内置的 16 色。
   中文名沿用内置表（按 id 对），游戏里多出来的颜色用它自己的名字 */
function mcColors() {
  var l = typeof Reg !== 'undefined' ? Reg.options('enum:text_color') : null;
  if (!l || !l.length) return typeof Reg !== 'undefined' && !Reg.preview() ? [] : MC_COLORS;
  var zh = {};
  MC_COLORS.forEach(function (c) {
    zh[c[0]] = c[2];
  });
  var out = [];
  l.forEach(function (e) {
    if (typeof e.rgb !== 'number') return;
    var hex = ('000000' + e.rgb.toString(16)).slice(-6).toUpperCase();
    MC_HEX[e.v] = '#' + hex;
    out.push([e.v, hex, zh[e.v] || e.label || e.v]);
  });
  return out.length ? out : Reg.preview() ? MC_COLORS : [];
}
/* First-open palettes wait for real enum data; update only swatches, never the RGB input. */
function watchColorOptions(get, paint) {
  if (get().length || typeof Reg === 'undefined' || Reg.preview()) return function () {};
  var off = Reg.on(function () {
    if (get().length) {
      off();
      paint();
    }
  });
  return off;
}
var TC_KEYS = { text: 1, color: 1, bold: 1, italic: 1, underlined: 1, strikethrough: 1, obfuscated: 1 };
function tcSimple(v) {
  if (typeof v === 'string') return { text: v };
  if (isObj(v) && typeof v.text === 'string') {
    for (var k in v) if (!TC_KEYS[k]) return null;
    return clone(v);
  }
  return null;
}
function tcPack(o) {
  var keys = Object.keys(o).filter(function (k) {
    return k !== 'text' && o[k] !== undefined && o[k] !== '';
  });
  if (!keys.length) return o.text || '';
  var out = { text: o.text || '' };
  ['color', 'bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'].forEach(function (k) {
    if (o[k] !== undefined && o[k] !== '') out[k] = o[k];
  });
  return out;
}
function tcHex(c) {
  if (!c) return null;
  if (!MC_HEX[c] && /^[a-z_]+$/.test(c)) mcColors();
  if (MC_HEX[c]) return MC_HEX[c];
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : null;
}
function tcPreview(el, v, fallbackColor) {
  clear(el);
  var o = tcSimple(v);
  if (!o) {
    el.appendChild(h('span', { class: 'tcp', text: I18n.t('cadeditor.ui.forms.complex_text') }));
    return;
  }
  var s = h('span', {
    class:
      'tcp' +
      (o.bold ? ' b' : '') +
      (o.italic ? ' i' : '') +
      (o.underlined ? ' u' : '') +
      (o.strikethrough ? ' s' : ''),
    text: o.obfuscated ? o.text.replace(/./g, '▒') : o.text || ' '
  });
  var hex = tcHex(o.color) || fallbackColor;
  if (hex) s.setAttribute('style', 'color:' + hex);
  el.appendChild(s);
}
function wText(sc, val, commit, ctx) {
  var wrap = h('div', { class: 'ed-tc' });
  var simple = tcSimple(val);
  /* 带阴影、字体、事件、翻译键、精灵 / 头像、extra 的文字：用富文本编辑器（kit2.js），它也认不出的结构才退回 SNBT */
  if (!simple && typeof kRichDoc === 'function' && tcRuns(val === undefined || val === null ? '' : val)) {
    var rd = kRichDoc(val, {
      compact: !!(ctx && ctx.compact),
      openKey: ctx && ctx.openKey,
      placeholder: (ctx && ctx.placeholder) || I18n.t('cadeditor.ui.forms.enter_text'),
      def: ctx && ctx.baseColor ? { color: ctx.baseColor } : undefined,
      onChange: function (v) {
        commit(v, { key: 'tc-rich' });
      }
    });
    wrap.appendChild(rd.el);
    return wrap;
  }
  if (!simple) {
    var ta = h('textarea', { class: 'ore-field ed-raw', rows: '3', spellcheck: 'false' });
    ta.value = toSnbt(val, null, true);
    var err = h('div', { class: 'ed-err' });
    ta.addEventListener('change', function () {
      try {
        var p = parseSnbtUser(ta.value);
        err.textContent = '';
        commit(p, {});
      } catch (e) {
        err.textContent = I18n.t('cadeditor.ui.forms.parsing_failed', e.message);
      }
    });
    wrap.appendChild(kHint(I18n.t('cadeditor.ui.textevent.text_raw'), 'hint'));
    wrap.appendChild(ta);
    wrap.appendChild(err);
    return wrap;
  }
  var cur = simple;
  var input = h('input', {
    class: 'ore-field ed-in',
    type: 'text',
    value: cur.text,
    placeholder: (ctx && ctx.placeholder) || I18n.t('cadeditor.ui.forms.enter_text'),
    spellcheck: 'false'
  });
  var prev = h('div', { class: 'ed-tcprev' });
  var rowC = h('div', { class: 'ed-sw' });
  var colorSwatches = h('div', { class: 'ed-sw' });
  var hex = h('input', {
    class: 'ore-field ed-in ed-hex',
    type: 'text',
    value: cur.color && cur.color.charAt(0) === '#' ? cur.color : '',
    placeholder: '#RRGGBB',
    maxlength: '7'
  });
  hex.addEventListener('change', function () {
    var t = hex.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(t)) {
      cur.color = t;
      paintSw();
      emit('tc-color');
    } else if (t === '') {
      delete cur.color;
      paintSw();
      emit('tc-color');
    }
  });
  rowC.appendChild(colorSwatches);
  rowC.appendChild(hex);
  /* 取色器（HSV / 预设）：只改文字颜色，结果写回同一个 color 字段 */
  if (typeof kColorPickerPop === 'function') {
    var pickC = h('div', { class: 'ed-mini cp-more', title: I18n.t('cadeditor.ui.colorpicker.more_colors') }, [
      icon('pipette')
    ]);
    activate(pickC, function () {
      kColorPickerPop(pickC, {
        layers: ['text'],
        gradient: false,
        value: { text: cur.color ? rdLayerOf([{ color: cur.color }], 'color') : null },
        sample: cur.text,
        onApply: function (r) {
          if (r.text === undefined) return;
          if (!r.text) delete cur.color;
          else cur.color = r.text.n || CP.hex6(r.text.rgb);
          paintSw();
          emit('tc-color');
        }
      });
    });
    rowC.appendChild(pickC);
  }
  var rowS = h('div', { class: 'ed-tcstyle' });
  function emit(k) {
    tcPreview(prev, tcPack(cur), ctx && ctx.baseColor);
    commit(tcPack(cur), { key: k || 'tc' });
  }
  input.addEventListener('input', function () {
    cur.text = input.value;
    emit('tc-text');
  });
  function paintSw(keepInput) {
    clear(colorSwatches);
    var none = h(
      'div',
      { class: 'swatch none' + (!cur.color ? ' on' : ''), title: I18n.t('cadeditor.ui.forms.default_color') },
      [h('i', { text: '⁄' })]
    );
    activate(none, function () {
      delete cur.color;
      paintSw();
      emit('tc-color');
    });
    colorSwatches.appendChild(none);
    mcColors().forEach(function (c) {
      var s = h('div', {
        class: 'swatch' + (cur.color === c[0] ? ' on' : ''),
        title: c[2],
        style: 'background:#' + c[1]
      });
      activate(s, function () {
        cur.color = c[0];
        paintSw();
        emit('tc-color');
      });
      colorSwatches.appendChild(s);
    });
    if (!keepInput) hex.value = cur.color && cur.color.charAt(0) === '#' ? cur.color : '';
  }
  function paintStyle() {
    clear(rowS);
    [
      ['bold', 'B', I18n.t('cadeditor.ui.forms.bold'), 'b'],
      ['underlined', 'U', I18n.t('cadeditor.ui.forms.underlined'), 'u'],
      ['strikethrough', 'S', I18n.t('cadeditor.ui.forms.strikethrough'), 's'],
      ['obfuscated', '?', I18n.t('cadeditor.ui.forms.obfuscated'), 'k']
    ].forEach(function (d) {
      var b = h('div', { class: 'ed-sty ' + d[3] + (cur[d[0]] ? ' on' : ''), title: d[2], text: d[1] });
      activate(b, function () {
        if (cur[d[0]]) delete cur[d[0]];
        else cur[d[0]] = true;
        paintStyle();
        emit('tc-style');
      });
      rowS.appendChild(b);
    });
    var it =
      cur.italic === undefined
        ? I18n.t('cadeditor.ui.common.default')
        : cur.italic
          ? I18n.t('cadeditor.ui.forms.italic')
          : I18n.t('cadeditor.ui.forms.italic_2');
    var ib = h('div', {
      class: 'ed-sty i' + (cur.italic !== undefined ? ' on' : ''),
      title: I18n.t('cadeditor.ui.forms.italic_default_definitioned_name_default'),
      text: 'I ' + it
    });
    activate(ib, function () {
      if (cur.italic === undefined) cur.italic = true;
      else if (cur.italic === true) cur.italic = false;
      else delete cur.italic;
      paintStyle();
      emit('tc-style');
    });
    rowS.appendChild(ib);
  }
  paintSw();
  paintStyle();
  tcPreview(prev, tcPack(cur), ctx && ctx.baseColor);
  watchColorOptions(mcColors, function () {
    paintSw(true);
  });
  if (ctx && ctx.compact) {
    var key = ctx.openKey || 'tc',
      panel = h('div', { class: 'ed-tcpanel' }, [rowC, rowS]);
    var tg = h('div', {
      class: 'ed-mini wide',
      text: I18n.t('cadeditor.ui.forms.style'),
      title: I18n.t('cadeditor.ui.forms.color_bold_italic_more')
    });
    function sync() {
      panel.style.display = UIOpen[key] ? 'flex' : 'none';
      tg.classList.toggle('act', !!UIOpen[key]);
    }
    activate(tg, function () {
      UIOpen[key] = !UIOpen[key];
      sync();
    });
    sync();
    wrap.appendChild(h('div', { class: 'ed-row' }, [input, tg]));
    wrap.appendChild(panel);
    return wrap;
  }
  wrap.appendChild(input);
  wrap.appendChild(rowC);
  wrap.appendChild(rowS);
  wrap.appendChild(prev);
  return wrap;
}

/* ---------- 颜色（RGB 整数） ---------- */
function wColor(sc, val, commit) {
  var wrap = h('div', { class: 'ed-color' });
  var n = typeof val === 'number' ? val & 0xffffff : 0xffffff;
  function hex() {
    var s = n.toString(16).toUpperCase();
    while (s.length < 6) s = '0' + s;
    return '#' + s;
  }
  var chip = h('div', { class: 'ed-chipcolor', style: 'background:' + hex() });
  var input = h('input', { class: 'ore-field ed-in ed-hex', type: 'text', value: hex(), maxlength: '7' });
  function set(v) {
    n = v;
    chip.setAttribute('style', 'background:' + hex());
    input.value = hex();
    if (hsvEd) hsvEd.refresh();
    commit(n, { key: 'color' });
  }
  input.addEventListener('change', function () {
    var t = input.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(t)) set(parseInt(t.replace('#', ''), 16));
    else input.value = hex();
  });
  var pal = h('div', { class: 'ed-sw' });
  function paintPalette() {
    clear(pal);
    mcColors().forEach(function (c) {
      var s = h('div', { class: 'swatch', title: c[2], style: 'background:#' + c[1] });
      activate(s, function () {
        set(parseInt(c[1], 16));
      });
      pal.appendChild(s);
    });
  }
  paintPalette();
  watchColorOptions(mcColors, paintPalette);
  /* HSV 色板（colorpicker.js）：拖动只更新显示，松手才提交 */
  var panel = h('div', { class: 'cp-inline', style: 'display:none' }),
    hsvEd = null;
  var more = h('div', { class: 'ed-mini cp-more', title: I18n.t('cadeditor.ui.colorpicker.more_colors') }, [
    icon('pipette')
  ]);
  activate(more, function () {
    var open = panel.style.display === 'none';
    panel.style.display = open ? 'flex' : 'none';
    more.classList.toggle('on', open);
    if (open && !hsvEd && typeof cpHsvEditor === 'function') {
      hsvEd = cpHsvEditor({
        get: function () {
          return { a: 255, rgb: n };
        },
        set: function (c, final) {
          n = c.rgb;
          chip.setAttribute('style', 'background:' + hex());
          input.value = hex();
          if (final) set(n);
        }
      });
      panel.appendChild(hsvEd.el);
    }
  });
  wrap.appendChild(h('div', { class: 'ed-row' }, [chip, input, more]));
  wrap.appendChild(pal);
  wrap.appendChild(panel);
  return wrap;
}

/* ---------- 通用结构控件 ---------- */
function wRaw(sc, val, commit) {
  var ta = h('textarea', { class: 'ore-field ed-raw', rows: '4', spellcheck: 'false' });
  ta.value = val === undefined ? '{}' : toSnbt(val, null, true);
  var err = h('div', { class: 'ed-err' });
  ta.addEventListener('change', function () {
    try {
      var p = parseSnbtUser(ta.value);
      err.textContent = '';
      ta.classList.remove('bad');
      commit(p, {});
    } catch (e) {
      err.textContent = I18n.t('cadeditor.ui.forms.parsing_failed', e.message);
      ta.classList.add('bad');
    }
  });
  var box = h('div', { class: 'ed-rawbox' }, [ta, err]);
  if (sc.hint)
    box.insertBefore(kHint(I18n.t('cadeditor.ui.forms.structure_more_complex_currently_edited', sc.hint), 'hint'), ta);
  return box;
}

function wUnit(sc) {
  return h('div', { class: 'ed-unit' }, [
    icon('check'),
    h('span', { text: sc.d || I18n.t('cadeditor.ui.forms.existence_take_effect_without_setting') })
  ]);
}

function wUnion(sc, val, commit, ctx) {
  if (sc.a.length === 2 && sc.a[0].t === 'int' && sc.a[1].t === 'arr' && sc.a[1].min === 3)
    return wColor(sc, val, commit);
  if (sc.a.length === 2 && sc.a[0].t === 'str' && sc.a[0].reg === 'sound_event' && sc.a[1].t === 'obj')
    return wSoundEvent(val, commit);
  if (isHolderSet(sc)) return wHolderSet(sc.a[0].reg, val, commit);
  var alt = pickAlt(sc, val),
    idx = sc.a.indexOf(alt);
  var box = h('div', { class: 'ed-union' }),
    body = h('div', { class: 'ed-unionbody' });
  function draw() {
    clear(body);
    body.appendChild(
      renderNode(
        sc.a[idx],
        val,
        function (v, o) {
          val = v;
          commit(v, o);
        },
        ctx
      )
    );
  }
  if (sc.a.length > 1) {
    var seg = wSeg(
      sc.a.map(function (a, i) {
        return { v: i, label: altLabel(a) };
      }),
      idx,
      function (i) {
        idx = i;
        val = defaultFor(sc.a[i]);
        commit(val, {});
        draw();
      }
    );
    box.appendChild(seg);
  }
  box.appendChild(body);
  draw();
  return box;
}

function wDunion(sc, val, commit, ctx) {
  val = isObj(val) ? val : defaultFor(sc);
  var box = h('div', { class: 'ed-union' }),
    body = h('div', { class: 'ed-unionbody' });
  function draw() {
    clear(body);
    if (!val[sc.disc]) {
      body.appendChild(kHint(I18n.t('cadeditor.ui.forms.select_type_current_game_manual')));
      return;
    }
    body.appendChild(
      renderNode(
        sc.br[val[sc.disc]] || { t: 'raw' },
        val,
        function (v, o) {
          if (isObj(v)) v[sc.disc] = val[sc.disc];
          val = v;
          commit(val, o);
        },
        ctx
      )
    );
  }
  var seg = combo({
    options: function () {
      return Reg.variantOptions(sc);
    },
    value: val[sc.disc] || '',
    free: true,
    placeholder: I18n.t('cadeditor.ui.forms.select_manual_fill_type_id'),
    onPick: function (n) {
      var d = sc.br[n] ? defaultFor(sc.br[n]) : {};
      if (!isObj(d)) d = {};
      d[sc.disc] = n;
      val = d;
      commit(val, {});
      draw();
    }
  });
  box.appendChild(seg);
  box.appendChild(body);
  draw();
  return box;
}

/* 字段名一行放下；内部名和说明放进悬停提示，不占版面 */
function fieldLabel(f, ov, quiet) {
  ov = ov || {};
  var full = f.d || f.k,
    short = ov.label || (f.d ? f.d.split(/[，；;：:（(]/)[0] : f.k) || full,
    name = short,
    tip =
      (ov.hint ? ov.hint + String.fromCharCode(10) : '') +
      f.k +
      (f.d && f.d !== f.k && !ov.hint ? String.fromCharCode(10) + f.d : '');
  return h('div', { class: 'fl', title: tip }, [
    h('div', { class: 'fk' }, [
      name,
      f.r && !quiet ? h('b', { class: 'req', text: ' *', title: I18n.t('cadeditor.ui.forms.required') }) : null
    ])
  ]);
}
/* 组件专用表单的“排版说明书”：字段顺序、分段标题、中文名、提示、单位、步进。没有说明书的字段照通用方式显示 */
var SPEC_FORMS = {};
/* 紧凑规格表单：默认值可直接编辑；恢复默认是操作，不伪装成开关。 */
function compactField(f, ov, sc, cur, commit, ctx) {
  var has = cur[f.k] !== undefined,
    value = has ? cur[f.k] : formDefault(f) !== undefined ? clone(formDefault(f)) : undefined;
  var path = ((ctx && ctx.path) || '') + '.' + f.k;
  function save(v, op) {
    cur[f.k] = v;
    commit(cur, op && op.key ? { key: path } : {});
  }
  var box = h('div', { class: 'compact-field' });
  function redraw() {
    if (box.parentNode != null) box.parentNode.replaceChild(compactField(f, ov, sc, cur, commit, ctx), box);
  }
  function reset() {
    delete cur[f.k];
    commit(cur, {});
    redraw();
  }
  function resetBtn() {
    return f.r
      ? h('div', { class: 'compact-reset-space' })
      : kBtn('', reset, {
          icon: 'refresh',
          cls: 'compact-reset' + (has ? '' : ' dim'),
          title: I18n.t('cadeditor.ui.forms.reset_default')
        });
  }
  if (sc.t === 'num' || sc.t === 'int') {
    var row = h('div', { class: 'compact-row' }, [fieldLabel(f, ov, true)]);
    var controls = h('div', { class: 'compact-controls' });
    var special =
      sc.allowNaN ||
      sc.allowPositiveInfinity ||
      sc.allowNegativeInfinity ||
      (nbtMeta(value) && nbtMeta(value).scalar && nbtSpecialNode(nbtMeta(value).scalar));
    var numberChanged = function (v) {
      save(v, { key: path });
      has = true;
      rst.classList.remove('dim');
    };
    var fieldCid = CURCID;
    function placeholder() {
      if (Reg.fieldDefaultReady(f)) return I18n.t('cadeditor.ui.common.unset');
      var status = Reg.formStatus(fieldCid);
      return status.error
        ? I18n.t('cadeditor.ui.forms.load_failed')
        : status.pending
          ? I18n.t('cadeditor.ui.common.loading')
          : I18n.t('cadeditor.ui.common.unset');
    }
    var number = special
      ? {
          el: wNum(sc, value, numberChanged, {
            step: ov.step || (sc.t === 'int' ? 1 : 0.1),
            key: path,
            placeholder: placeholder()
          })
        }
      : codecNumber(value, {
          min: sc.min,
          max: sc.max,
          step: ov.step || (sc.t === 'int' ? 1 : 0.1),
          preservePrecision: sc.t === 'num',
          noSlider: true,
          onChange: numberChanged,
          placeholder: placeholder
        });
    controls.appendChild(number.el);
    if (ctx && ctx.refreshDefaults)
      ctx.refreshDefaults.push(function () {
        if (cur[f.k] !== undefined) return;
        var v = formDefault(f);
        if (number.el.refreshDefault) number.el.refreshDefault(v === undefined ? undefined : clone(v), placeholder());
        else number.set(v === undefined ? undefined : clone(v));
      });
    controls.appendChild(h('span', { class: 'compact-unit', text: ov.unit || '' }));
    var rst = resetBtn();
    controls.appendChild(rst);
    row.appendChild(controls);
    box.appendChild(row);
    return box;
  }
  if (sc.t === 'obj' && ov.flatten) {
    box.setAttribute('data-tip', '');
    box.appendChild(renderNode(sc, value, save, { path: path, spec: ov.spec }));
    return box;
  }
  if (sc.t === 'arr' && ov.flatList) {
    box.appendChild(
      wArr(sc, value, save, {
        path: path,
        compId: ctx && ctx.compId,
        itemSpec: ov.itemSpec,
        itemSummary: ov.itemSummary,
        flatList: true,
        listLabel: ov.label || f.k
      })
    );
    return box;
  }
  if (isHolderSet(sc)) {
    var reg = sc.a[0].reg,
      selected = has ? cur[f.k] : undefined;
    var label =
      selected === undefined
        ? ov.dtxt || I18n.t('cadeditor.ui.common.unset')
        : Array.isArray(selected)
          ? I18n.t('cadeditor.ui.forms.type_damage', selected.length)
          : String(selected);
    var ctl = h('div', { class: 'compact-set-controls' });
    var chosen = h('span', { class: 'compact-set-value', text: label, 'data-tip': label });
    ctl.appendChild(chosen);
    ctl.appendChild(
      kBtn(I18n.t('cadeditor.ui.forms.select'), function () {
        openTagPicker({
          title: I18n.t('cadeditor.ui.forms.choose_damage_type_tag'),
          tagsReg: reg,
          entryReg: reg,
          multi: true,
          selected: selected === undefined ? [] : (Array.isArray(selected) ? selected : [selected]).map(pickerId),
          onConfirm: function (ids) {
            var tags = ids.filter(function (id) {
              return id.charAt(0) === '#';
            });
            if (tags.length && ids.length > 1) {
              toast(I18n.t('cadeditor.ui.forms.mix_tab_multiple_damage_types'), 'warn');
              return;
            }
            save(tags.length ? tags[0] : ids);
            redraw();
          }
        });
      })
    );
    if (has) ctl.appendChild(resetBtn());
    box.appendChild(h('div', { class: 'compact-row' }, [fieldLabel(f, ov, true), ctl]));
    return box;
  }
  return null;
}
function wObj(sc, val, commit, ctx) {
  var cur = isObj(val) ? val : defaultFor(sc);
  var box = h('div', { class: 'ed-obj' }),
    spec = ctx && ctx.spec;
  function entries() {
    if (!spec || !spec.order)
      return sc.f.map(function (x) {
        return { f: x };
      });
    var out = [],
      used = {};
    spec.order.forEach(function (e) {
      if (typeof e === 'string') {
        for (var n = 0; n < sc.f.length; n++)
          if (sc.f[n].k === e) {
            out.push({ f: sc.f[n] });
            used[e] = 1;
          }
      } else out.push({ sec: e.sec });
    });
    var rest = sc.f.filter(function (x) {
      return !used[x.k];
    });
    if (rest.length && !spec.only) {
      out.push({ sec: I18n.t('cadeditor.ui.detail.other') });
      rest.forEach(function (x) {
        out.push({ f: x });
      });
    }
    return out;
  }
  function draw() {
    clear(box);
    entries().forEach(function (en) {
      if (en.sec) {
        box.appendChild(h('div', { class: 'k-sech', text: en.sec }));
        return;
      }
      var f = en.f,
        ov = (spec && spec.over && spec.over[f.k]) || {},
        fs2 = f.s;
      if (fs2 && (ov.min !== undefined || ov.max !== undefined)) {
        fs2 = {};
        for (var kk in f.s) fs2[kk] = f.s[kk];
        if (ov.min !== undefined) fs2.min = ov.min;
        if (ov.max !== undefined) fs2.max = ov.max;
      }
      if (spec && spec.compact) {
        var compact = compactField(f, ov, fs2, cur, commit, ctx);
        if (compact != null) {
          box.appendChild(compact);
          return;
        }
      }
      if (isSoundUnion(fs2)) {
        var lbl0 = ov.label || (f.d ? f.d.split(/[，；;：:（(]/)[0] : f.k);
        box.appendChild(
          soundUnionRow(lbl0, ov.hint, cur[f.k], function (v) {
            if (v === undefined) delete cur[f.k];
            else cur[f.k] = v;
            commit(cur, {});
          })
        );
        return;
      }
      var isSub = !!(
          fs2 &&
          ((fs2.t === 'obj' && fs2.f && fs2.f.length) ||
            (fs2.t === 'union' && fs2.a && fs2.a[0] && fs2.a[0].reg === 'sound_event') ||
            (fs2.t === 'arr' && fs2.i && fs2.i.t === 'obj') ||
            isHolderSet(fs2))
        ),
        subNode = null;
      var row = h('div', { class: 'fld' + (isSub ? ' sub' : '') }),
        has = cur[f.k] !== undefined;
      var lab0 = fieldLabel(f, ov);
      row.appendChild(lab0);
      if (isSub && fs2.t === 'obj' && ov.hint) lab0.appendChild(h('div', { class: 'fh', text: ov.hint }));
      var ctl = h('div', { class: 'fc' });
      var unitEl = ov.unit
        ? h('span', { class: 'fu', text: ov.unit })
        : spec && fs2 && fs2.t === 'num'
          ? h('span', { class: 'fu', text: ' ' })
          : null;
      /* 每行同一个版式：左边字段名，右边取值（+单位），最右一列是“启用”开关（必填字段没有开关，留空位）。没启用时取值处只显示默认值 */
      if (fs2 && fs2.t === 'bool') {
        var bon = has ? !!cur[f.k] : !!formDefault(f);
        var btg = kToggle(
          bon,
          function (v) {
            cur[f.k] = v;
            commit(cur, {});
            draw();
          },
          ''
        );
        ctl.appendChild(
          h(
            'div',
            { class: 'ed-unset' },
            has
              ? []
              : [
                  h('span', {
                    class: 'dv',
                    text:
                      formDefault(f) === undefined
                        ? I18n.t('cadeditor.ui.forms.set_default_value_read')
                        : I18n.t(
                            'cadeditor.ui.eschema.default',
                            formDefault(f) ? I18n.t('cadeditor.ui.forms.on') : I18n.t('cadeditor.ui.forms.off')
                          )
                  })
                ]
          )
        );
        ctl.appendChild(h('div', { class: 'ed-sw' }, [btg.el]));
        row.appendChild(ctl);
        box.appendChild(row);
        return;
      }
      var sw = null;
      if (!f.r) {
        sw = kToggle(
          has,
          function (on) {
            if (on) {
              if (!Reg.fieldDefaultReady(f)) {
                toast(I18n.t('cadeditor.ui.forms.reading_codec_default_value_field'), 'warn');
                draw();
                return;
              }
              cur[f.k] = formDefault(f) !== undefined ? clone(formDefault(f)) : defaultFor(f.s);
            } else delete cur[f.k];
            commit(cur, {});
            draw();
          },
          ''
        );
        row.classList.add('opt');
      }
      if (!has && !f.r) {
        var dtxt =
          ov.dtxt ||
          (formDefault(f) !== undefined
            ? I18n.t(
                'cadeditor.ui.eschema.default',
                Array.isArray(formDefault(f))
                  ? I18n.t('cadeditor.ui.cards2.entries', formDefault(f).length)
                  : isObj(formDefault(f))
                    ? I18n.t('cadeditor.ui.forms.preset')
                    : String(formDefault(f)) + (ov.unit ? ' ' + ov.unit : '')
              )
            : I18n.t('cadeditor.ui.common.unset'));
        ctl.appendChild(
          h(
            'div',
            {
              class: 'ed-unset',
              title:
                formDefault(f) !== undefined && (isObj(formDefault(f)) || Array.isArray(formDefault(f)))
                  ? toSnbt(formDefault(f), null, false)
                  : ''
            },
            [h('span', { class: 'dv', text: dtxt })]
          )
        );
      } else {
        if (!has) cur[f.k] = formDefault(f) !== undefined ? clone(formDefault(f)) : defaultFor(f.s);
        var sub = {
          path: ((ctx && ctx.path) || '') + '.' + f.k,
          step: ov.step,
          spec: ov.spec,
          itemSpec: ov.itemSpec,
          itemSummary: ov.itemSummary
        };
        var node = renderNode(
          fs2,
          cur[f.k],
          function (v, o) {
            cur[f.k] = v;
            commit(cur, o && o.key ? { key: ((ctx && ctx.path) || '') + '.' + f.k } : o);
          },
          sub
        );
        if (isSub) subNode = node;
        else {
          ctl.appendChild(node);
          if (unitEl) ctl.appendChild(unitEl);
        }
      }
      ctl.appendChild(sw ? h('div', { class: 'ed-sw' }, [sw.el]) : h('div', { class: 'ed-sw' }));
      row.appendChild(ctl);
      if (isSub && fs2.t === 'obj') {
        var blk = h('div', { class: 'sub-block' + (subNode ? ' on' : '') }, [row]);
        if (subNode) blk.appendChild(h('div', { class: 'sb-b' }, [subNode]));
        box.appendChild(blk);
        return;
      }
      box.appendChild(row);
      /* 嵌套的对象：字段名自成一行（标题 + 开关），子字段整行展开在下面，缩进 + 引导线 */
      if (subNode) box.appendChild(h('div', { class: 'ed-subbody' }, [subNode]));
    });
  }
  draw();
  return box;
}

/* 列表项是对象，且里面有一个必填的“注册表 ID”字段（效果 ID、旗帜图案……）：添加时用多选窗一次选多个 */
function keyRegField(it) {
  if (it && it.t === 'str' && it.reg && !it.tag && !it.en && it.reg !== 'sound_event') return { k: null, reg: it.reg };
  if (!it || it.t !== 'obj' || !it.f) return null;
  for (var i = 0; i < it.f.length; i++) {
    var x = it.f[i];
    if (x.r && x.s && x.s.t === 'str' && x.s.reg && !x.s.tag && !x.s.en && x.s.reg !== 'sound_event')
      return { k: x.k, reg: x.s.reg };
  }
  return null;
}
function wArr(sc, val, commit, ctx) {
  var cur = Array.isArray(val) ? val : [];
  var flat = !!(ctx && ctx.flatList);
  var box = h('div', { class: 'ed-arr' + (flat ? ' flat-rules' : '') }),
    list = h('div', { class: 'ed-list' });
  var page = { page: 0 },
    pager = h('div', { class: 'k-row wrap' });
  var path = ((ctx && ctx.path) || '') + '[]';
  var complex =
    sc.i.t === 'obj' ||
    sc.i.t === 'map' ||
    sc.i.t === 'dunion' ||
    sc.i.t === 'union' ||
    sc.i.t === 'raw' ||
    sc.i.t === 'nbt' ||
    sc.i.t === 'stack';
  function draw() {
    clear(list);
    if (flat) count.textContent = ctx.listLabel + ' · ' + cur.length;
    var range = kListPage(cur.length, page, pager, draw);
    cur.slice(range.start, range.end).forEach(function (item, index) {
      var i = range.start + index;
      var okey = path + i;
      function makeNode() {
        return renderNode(
          sc.i,
          item,
          function (v, o) {
            cur[i] = v;
            commit(cur, o && o.key ? { key: path + i } : o);
          },
          { path: path + i, spec: ctx && ctx.itemSpec }
        );
      }
      var tools = h('div', { class: 'ed-it-tools' });
      if (i > 0) {
        var up = h('div', { class: 'ed-mini', text: '↑', title: I18n.t('cadeditor.ui.cards1.move_up') });
        activate(up, function () {
          var t = cur[i - 1];
          cur[i - 1] = cur[i];
          cur[i] = t;
          commit(cur, {});
          draw();
        });
        tools.appendChild(up);
      }
      if (i < cur.length - 1) {
        var dn = h('div', { class: 'ed-mini', text: '↓', title: I18n.t('cadeditor.ui.cards1.move_down') });
        activate(dn, function () {
          var t = cur[i + 1];
          cur[i + 1] = cur[i];
          cur[i] = t;
          commit(cur, {});
          draw();
        });
        tools.appendChild(dn);
      }
      var rm = h('div', { class: 'ed-mini del', text: '×', title: I18n.t('cadeditor.ui.forms.delete_entry') });
      activate(rm, function () {
        cur.splice(i, 1);
        commit(cur, {});
        draw();
      });
      tools.appendChild(rm);
      var row;
      if (complex) {
        var openKey = ((ctx && ctx.compId) || '') + path + i;
        var isOpen = UIOpen[openKey] === true || (UIOpen[openKey] !== false && cur.length <= 24);
        row = h('div', { class: 'ed-card' + (isOpen ? ' open' : '') });
        var summary = ctx && ctx.itemSummary ? ctx.itemSummary(item, i) : summarize(sc.i, item);
        var head = h('div', { class: 'ed-card-h', 'data-tip': summary }, [
          h('span', { class: 'ix', text: (flat ? I18n.t('cadeditor.ui.forms.rule') : '#') + (i + 1) }),
          h('span', { class: 'sm', text: flat ? '' : summary }),
          tools
        ]);
        var child = h('div', { class: 'ed-card-b' }),
          mounted = false;
        function mount() {
          if (!mounted) {
            child.appendChild(makeNode());
            mounted = true;
          }
        }
        if (isOpen) mount();
        head.addEventListener('click', function (e) {
          if (e.target.closest && e.target.closest('.ed-it-tools') != null) return;
          isOpen = !isOpen;
          UIOpen[openKey] = isOpen;
          if (isOpen) mount();
          row.classList.toggle('open', isOpen);
        });
        row.appendChild(head);
        row.appendChild(child);
      } else {
        row = h('div', { class: 'ed-itrow' }, [
          h('span', { class: 'ix', text: String(i + 1) }),
          h('div', { class: 'grow' }, [makeNode()]),
          tools
        ]);
      }
      list.appendChild(row);
    });
    if (!cur.length) list.appendChild(h('div', { class: 'ed-empty', text: I18n.t('cadeditor.ui.forms.empty_list') }));
  }
  var keyF = keyRegField(sc.i);
  var add = h('div', { class: 'ed-addbtn' }, [
    icon('plus'),
    keyF ? I18n.t('cadeditor.ui.forms.add_multiple_selection') : I18n.t('cadeditor.ui.cards3.add')
  ]);
  var atMax = function () {
    return sc.max !== undefined && cur.length >= sc.max;
  };
  function pushMany(ids, vals, edit) {
    var next = pickerSyncList(
      cur,
      ids,
      function (x) {
        return keyF.k ? x[keyF.k] : x;
      },
      function (id) {
        if (!keyF.k) return id;
        var it = defaultFor(sc.i);
        it[keyF.k] = id;
        var hasAmp = sc.i.f.some(function (x) {
            return x.k === 'amplifier';
          }),
          hasDur = sc.i.f.some(function (x) {
            return x.k === 'duration';
          }),
          v = (vals && vals[id]) || {};
        if (hasAmp && v.level) it.amplifier = Math.max(0, v.level - 1);
        if (hasDur && v.seconds) it.duration = effectTicksFromSeconds(v.seconds);
        return it;
      },
      function (it, id) {
        if (!keyF.k) return;
        var dirty = (edit && edit.changes[id]) || {},
          v = (vals && vals[id]) || {};
        if (dirty.level) it.amplifier = v.level - 1;
        if (dirty.seconds) it.duration = effectTicksFromSeconds(v.seconds);
      }
    );
    if (sc.max !== undefined && next.length > sc.max) {
      toast(I18n.t('cadeditor.ui.forms.select_maximum_item_original_list', sc.max), 'warn');
      return;
    }
    cur = next;
    commit(cur, {});
    draw();
  }
  activate(add, function () {
    if (atMax() && !keyF) return;
    if (!keyF) {
      cur.push(defaultFor(sc.i));
      page.page = Math.floor((cur.length - 1) / 24);
      commit(cur, {});
      draw();
      return;
    }
    var present = {},
      values = {};
    cur.forEach(function (x) {
      var xv = keyF.k ? x && x[keyF.k] : x;
      if (xv) {
        var id = Reg.full(String(xv));
        present[id] = 1;
        if (keyF.k)
          values[id] = {
            level: (x.amplifier || 0) + 1,
            seconds: x.duration === undefined ? undefined : effectSecondsFromTicks(x.duration)
          };
      }
    });
    if (keyF.reg === 'mob_effect') {
      var hasAmp2 =
          !!keyF.k &&
          sc.i.f.some(function (x) {
            return x.k === 'amplifier';
          }),
        hasDur2 =
          !!keyF.k &&
          sc.i.f.some(function (x) {
            return x.k === 'duration';
          });
      openEffectPicker({
        present: present,
        values: values,
        full: hasAmp2,
        noParams: !hasDur2 && !hasAmp2,
        onConfirm: pushMany
      });
    } else
      openRegPick({
        reg: keyF.reg,
        multi: true,
        selected: present,
        title: I18n.t('cadeditor.ui.forms.choose_entry'),
        onPickMany: function (ids) {
          pushMany(ids);
        }
      });
  });
  var count;
  if (flat) {
    count = h('span', { class: 'flat-rules-title' });
    box.appendChild(h('div', { class: 'flat-rules-head' }, [count, add]));
  }
  box.appendChild(list);
  box.appendChild(pager);
  if (!flat) box.appendChild(add);
  draw();
  return box;
}

function wMap(sc, val, commit, ctx) {
  var cur = isObj(val) ? val : {};
  var box = h('div', { class: 'ed-map' }),
    list = h('div', { class: 'ed-list' });
  var page = { page: 0 },
    pager = h('div', { class: 'k-row wrap' });
  var ropts = sc.k && sc.k.reg ? registryOptions(sc.k.reg) : null;
  function draw() {
    clear(list);
    var keys = Object.keys(cur),
      range = kListPage(keys.length, page, pager, draw);
    keys.slice(range.start, range.end).forEach(function (k) {
      var kin = h('input', { class: 'ore-field ed-in ed-key', type: 'text', value: k, spellcheck: 'false' });
      kin.addEventListener('change', function () {
        var nk = kin.value.trim();
        if (!nk || nk === k) {
          kin.value = k;
          return;
        }
        var nv = {};
        Object.keys(cur).forEach(function (x) {
          nbtPut(nv, x === k ? nk : x, nbtTake(cur, x));
        });
        cur = nv;
        commit(cur, {});
        draw();
      });
      var node = renderNode(
        sc.v,
        cur[k],
        function (v, o) {
          cur[k] = v;
          commit(cur, o && o.key ? { key: ((ctx && ctx.path) || '') + '{' + k + '}' } : o);
        },
        { path: ((ctx && ctx.path) || '') + '{' + k + '}' }
      );
      var rm = h('div', { class: 'ed-mini del', text: '×', title: I18n.t('cadeditor.ui.common.delete') });
      activate(rm, function () {
        delete cur[k];
        commit(cur, {});
        draw();
      });
      list.appendChild(h('div', { class: 'ed-itrow' }, [kin, h('div', { class: 'grow' }, [node]), rm]));
    });
    if (!Object.keys(cur).length)
      list.appendChild(h('div', { class: 'ed-empty', text: I18n.t('cadeditor.ui.cards4.empty') }));
  }
  var addIn = ropts
    ? combo({
        value: '',
        options: ropts,
        free: true,
        reset: true,
        placeholder: I18n.t('cadeditor.ui.forms.add_key'),
        onPick: function (v) {
          if (v && cur[v] === undefined) {
            cur[v] = defaultFor(sc.v);
            commit(cur, {});
            draw();
          }
        }
      })
    : (function () {
        var i = h('input', {
          class: 'ore-field ed-in',
          type: 'text',
          placeholder: I18n.t('cadeditor.ui.forms.new_key_name_enter_add')
        });
        onKey(i, {
          Enter: function () {
            var v = i.value.trim();
            if (v && cur[v] === undefined) {
              cur[v] = defaultFor(sc.v);
              i.value = '';
              commit(cur, {});
              draw();
            }
          }
        });
        return i;
      })();
  box.appendChild(list);
  box.appendChild(pager);
  box.appendChild(h('div', { class: 'ed-addrow' }, [icon('plus'), addIn]));
  draw();
  return box;
}

function renderNode(sc, val, commit, ctx) {
  if (!sc) return wRaw({ t: 'raw' }, val, commit);
  switch (sc.t) {
    case 'bool':
      return wBool(sc, val, commit);
    case 'int':
    case 'num':
      return wNum(sc, val, commit, ctx);
    case 'str':
      return wStr(sc, val, commit, ctx);
    case 'text':
      return wText(sc, val, commit, ctx);
    case 'obj':
      return wObj(sc, val, commit, ctx);
    case 'arr':
      return wArr(sc, val, commit, ctx);
    case 'map':
      return wMap(sc, val, commit, ctx);
    case 'union':
      return wUnion(sc, val, commit, ctx);
    case 'dunion':
      return wDunion(sc, val, commit, ctx);
    case 'unit':
      return wUnit(sc);
    default:
      return wRaw(sc, val, commit);
  }
}

/* ---------- 专用控件 ---------- */
function wEnchants(c, val, commit, ctx) {
  var cur = isObj(val) ? val : {};
  var d = ctx.doc;
  var box = h('div', { class: 'ed-ench' }),
    list = h('div', { class: 'ed-list' });
  function conflicts(id) {
    var out = [];
    Object.keys(cur).forEach(function (k) {
      if (Reg.full(k) !== Reg.full(id) && Reg.enchantConflict(id, k) === true)
        out.push(Reg.nameOf('enchantments', k) || k);
    });
    return out;
  }
  function draw() {
    clear(list);
    Object.keys(cur).forEach(function (k) {
      var id = shortId(k),
        e = Reg.enchant(k),
        lv = cur[k];
      var warn = [];
      if (!e) warn.push(I18n.t('cadeditor.ui.forms.real_time_information_available_keep'));
      else {
        if (e.max !== null && lv > e.max) warn.push(I18n.t('cadeditor.ui.cards1.over_natural_maximum', e.max));
        var cf = conflicts(id);
        if (cf.length) warn.push(I18n.t('cadeditor.ui.forms.retard', cf.join('、')));
      }
      var num = wNum(
        { t: 'int', min: 1, max: 255 },
        lv,
        function (v) {
          cur[k] = v;
          commit(cur, { key: 'ench-' + id });
          rom.textContent = roman(v);
        },
        { key: 'ench-' + id }
      );
      var rom = h('span', { class: 'rom', text: roman(lv) });
      var rm = h('div', { class: 'ed-mini del', text: '×', title: I18n.t('cadeditor.ui.forms.remove_enchantment') });
      activate(rm, function () {
        delete cur[k];
        commit(cur, {});
        draw();
      });
      var row = h('div', { class: 'ed-enrow' + (warn.length ? ' warn' : '') }, [
        icon('enchant'),
        h('div', { class: 'nm' }, [
          h('div', { class: 'z', text: e ? e.name : id }),
          h('div', {
            class: 'id',
            text: Reg.full(k) + (e && e.max !== null ? I18n.t('cadeditor.ui.forms.natural_maximum', e.max) : '')
          })
        ]),
        num,
        rom,
        rm
      ]);
      if (warn.length) row.appendChild(h('div', { class: 'ed-warnline', text: '⚠ ' + warn.join('；') }));
      list.appendChild(row);
    });
    if (!Object.keys(cur).length)
      list.appendChild(h('div', { class: 'ed-empty', text: I18n.t('cadeditor.ui.forms.enchantments') }));
  }
  var opts = function () {
    return Reg.enchants().map(function (e) {
      return {
        v: e.full,
        label: e.name,
        sub:
          e.full +
          (e.max !== null
            ? I18n.t('cadeditor.ui.forms.supreme', e.max)
            : I18n.t('cadeditor.ui.forms.maximum_level_yet_read')) +
          (Reg.enchantFits(e, d.id) === true ? I18n.t('cadeditor.ui.forms.applicable') : '')
      };
    });
  };
  var addIn = combo({
    value: '',
    options: opts,
    free: true,
    reset: true,
    placeholder: I18n.t('cadeditor.ui.forms.search_enter_enchantment_id'),
    onPick: function (id) {
      var key = Reg.full(id);
      if (id && cur[key] === undefined) {
        cur[key] = 1;
        commit(cur, {});
        draw();
      }
    }
  });
  var tools = h('div', { class: 'ed-row wrap' });
  var maxb = h('div', { class: 'ed-mini wide', text: I18n.t('cadeditor.ui.forms.set_all_natural_maximum') });
  activate(maxb, function () {
    var changed = false;
    Object.keys(cur).forEach(function (k) {
      var e = Reg.enchant(k);
      if (e && e.max !== null && cur[k] !== e.max) {
        cur[k] = e.max;
        changed = true;
      }
    });
    if (!changed) return;
    commit(cur, {});
    draw();
  });
  var clr = h('div', { class: 'ed-mini wide del', text: I18n.t('cadeditor.ui.common.clear') });
  activate(clr, function () {
    cur = {};
    commit(cur, {});
    draw();
  });
  var apl = h('div', { class: 'ed-mini wide', text: I18n.t('cadeditor.ui.forms.add_all_applicable_enchantments') });
  activate(apl, function () {
    var changed = false;
    Reg.enchants().forEach(function (e) {
      if (
        e.max !== null &&
        e.exclusiveKnown &&
        Reg.enchantFits(e, d.id) === true &&
        cur[e.full] === undefined &&
        Object.keys(cur).every(function (k) {
          return Reg.enchantConflict(e, k) === false;
        })
      ) {
        cur[e.full] = e.max;
        changed = true;
      }
    });
    if (!changed) return;
    commit(cur, {});
    draw();
  });
  tools.appendChild(maxb);
  tools.appendChild(apl);
  tools.appendChild(clr);
  box.appendChild(list);
  box.appendChild(h('div', { class: 'ed-addrow' }, [icon('plus'), addIn]));
  box.appendChild(tools);
  if (!Reg.preview() && !Reg.list('enchantments'))
    box.appendChild(
      h('div', { class: 'ed-hint', text: I18n.t('cadeditor.ui.forms.reading_enchantment_real_time_manual') })
    );
  draw();
  return box;
}

var OPS = Labels.opShort;
var SLOTS = ['any', 'mainhand', 'offhand', 'hand', 'head', 'chest', 'legs', 'feet', 'armor', 'body', 'saddle'];
var SLOT_ZH = Labels.slot;
function attributeSlotOptions() {
  return Reg.enumOptions(
    'equipment_slot_group',
    SLOTS.map(function (s) {
      return { v: s, label: SLOT_ZH[s] || s };
    })
  );
}
/* 修饰器生效部位的显示名：跟随界面语言，读不到时用 SLOT_ZH，再不行显示原值 */
function attributeSlotLabel(slot) {
  slot = slot || 'any';
  var entry = attributeSlotOptions().filter(function (e) {
    return e.v === slot;
  })[0];
  return entry ? entry.label : SLOT_ZH[slot] || slot;
}
function wAttrMods(c, val, commit, ctx) {
  var cur = Array.isArray(val) ? val : [];
  var box = h('div', { class: 'ed-attrs' }),
    list = h('div', { class: 'ed-list' });
  function draw() {
    clear(list);
    cur.forEach(function (m, i) {
      var id = shortId(m.type || ''),
        a =
          (Reg.list('attributes') || []).filter(function (a) {
            return a.id === Reg.full(m.type);
          })[0] || (Reg.preview() ? ATIDX[id] : null);
      var openKey = 'attr' + i,
        isOpen = UIOpen[openKey] !== false;
      var rm = h('div', { class: 'ed-mini del', text: '×', title: I18n.t('cadeditor.ui.forms.delete_modifier') });
      activate(rm, function () {
        cur.splice(i, 1);
        commit(cur, {});
        draw();
      });
      var amt = typeof m.amount === 'number' ? m.amount : 0;
      var sumTxt =
        (m.operation === 'add_value'
          ? (amt >= 0 ? '+' : '') + fmtNum(amt)
          : (amt >= 0 ? '+' : '') + fmtNum(amt * 100) + '%') +
        ' · ' +
        attributeSlotLabel(m.slot);
      var card = h('div', { class: 'ed-card' + (isOpen ? ' open' : '') });
      var head = h('div', { class: 'ed-card-h' }, [
        icon('sliders'),
        h('span', { class: 'ttl', text: a ? a.name : id || I18n.t('cadeditor.ui.forms.attribute_selected') }),
        h('span', { class: 'sm', text: sumTxt }),
        h('div', { class: 'ed-it-tools' }, [rm])
      ]);
      head.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.ed-it-tools')) return;
        UIOpen[openKey] = !(UIOpen[openKey] !== false);
        card.classList.toggle('open');
      });
      var body = h('div', { class: 'ed-card-b' });
      function fld(label, note, ctl) {
        return h('div', { class: 'fld' }, [
          h('div', { class: 'fl' }, [
            h('div', { class: 'fk', text: label }),
            note ? h('div', { class: 'fn', text: note }) : null
          ]),
          h('div', { class: 'fc' }, [ctl])
        ]);
      }
      body.appendChild(
        fld(
          I18n.t('cadeditor.ui.eschema.attributes'),
          'type',
          combo({
            value: m.type || '',
            options: registryOptions('attribute'),
            free: true,
            placeholder: I18n.t('cadeditor.ui.forms.choose_attribute'),
            onPick: function (v) {
              m.type = v;
              commit(cur, {});
              draw();
            }
          })
        )
      );
      var rangeNote = a
        ? typeof a.min === 'number' && typeof a.max === 'number'
          ? I18n.t('cadeditor.ui.forms.range', a.min, a.max)
          : I18n.t('cadeditor.ui.forms.fixed_range_provided')
        : I18n.t('cadeditor.ui.forms.attribute_information_read_real_time');
      var attributeDefault = a && (typeof a.default === 'number' ? a.default : Reg.preview() ? a.def : undefined);
      if (attributeDefault !== undefined) rangeNote += I18n.t('cadeditor.ui.forms.attribute_default', attributeDefault);
      body.appendChild(
        fld(
          I18n.t('cadeditor.ui.forms.value'),
          rangeNote,
          wNum(
            { t: 'num' },
            m.amount,
            function (v) {
              m.amount = v;
              commit(cur, { key: 'attr-amt-' + i });
            },
            { key: 'attr-amt-' + i, step: m.operation === 'add_value' ? 0.5 : 0.05 }
          )
        )
      );
      body.appendChild(
        fld(
          I18n.t('cadeditor.ui.forms.operation'),
          'operation',
          combo({
            options: function () {
              return Reg.enumOptions('attribute_operation', OPS);
            },
            value: m.operation || '',
            free: true,
            onPick: function (v) {
              m.operation = v;
              commit(cur, {});
              draw();
            }
          })
        )
      );
      body.appendChild(
        fld(
          I18n.t('cadeditor.ui.forms.active_slots'),
          'slot',
          combo({
            value: m.slot || 'any',
            options: attributeSlotOptions,
            free: true,
            placeholder: I18n.t('cadeditor.ui.cards2.read_slot_manual_input'),
            onPick: function (v) {
              m.slot = v;
              commit(cur, {});
              draw();
            }
          })
        )
      );
      body.appendChild(
        fld(
          I18n.t('cadeditor.ui.forms.modifier_id'),
          I18n.t('cadeditor.ui.forms.id_same_id'),
          wStr({ t: 'str' }, m.id || '', function (v) {
            m.id = v;
            commit(cur, { key: 'attr-id-' + i });
          })
        )
      );
      card.appendChild(head);
      card.appendChild(body);
      list.appendChild(card);
    });
    if (!cur.length)
      list.appendChild(
        h('div', { class: 'ed-empty', text: I18n.t('cadeditor.ui.forms.attribute_modifier_empty_list_clear') })
      );
  }
  var addIn = combo({
    value: '',
    options: registryOptions('attribute'),
    free: true,
    reset: true,
    placeholder: I18n.t('cadeditor.ui.forms.search_add_attribute'),
    onPick: function (v) {
      cur.push({
        type: v,
        id: 'cadeditor:' + shortId(v).replace(/[^a-z0-9_./-]/g, '_') + '_' + (cur.length + 1),
        amount: 1,
        operation: 'add_value',
        slot: 'mainhand'
      });
      commit(cur, {});
      draw();
    }
  });
  box.appendChild(list);
  box.appendChild(h('div', { class: 'ed-addrow' }, [icon('plus'), addIn]));
  draw();
  return box;
}

var RARITY = Labels.rarity;
function wRarity(c, val, commit) {
  return combo({
    options: function () {
      return Reg.enumOptions('rarity', RARITY);
    },
    value: val || '',
    free: true,
    onPick: function (v) {
      commit(v, {});
    }
  });
}

function wDamage(c, val, commit, ctx) {
  var eff = effectiveView(ctx.doc),
    maxd = eff.max_damage;
  var box = h('div', { class: 'ed-dmg' });
  var bar = h('div', { class: 'o-meter' }, [h('i', {})]),
    txt = h('div', { class: 'ed-hint' });
  function paint(v) {
    var ratio = typeof maxd === 'number' && maxd > 0 ? Math.max(0, Math.min(1, 1 - v / maxd)) : 1;
    bar.setAttribute('style', '--value:' + ratio);
    txt.textContent =
      typeof maxd === 'number'
        ? I18n.t('cadeditor.ui.forms.durability', Math.max(0, maxd - v), maxd)
        : I18n.t('cadeditor.ui.forms.item_produce_take_effect_fruit');
  }
  box.appendChild(
    wNum(
      { t: 'int', min: 0, max: 2147483647 },
      val,
      function (v) {
        paint(v);
        commit(v, { key: 'damage' });
      },
      { key: 'damage', step: 1 }
    )
  );
  box.appendChild(bar);
  box.appendChild(txt);
  paint(val || 0);
  return box;
}

function wLore(c, val, commit) {
  var cur = Array.isArray(val) ? val : [];
  var box = h('div', { class: 'ed-lore' }),
    list = h('div', { class: 'ed-list' });
  function draw() {
    clear(list);
    cur.forEach(function (line, i) {
      var node = wText(
        { t: 'text' },
        line,
        function (v, o) {
          cur[i] = v;
          commit(cur, { key: 'lore' + i });
        },
        { placeholder: I18n.t('cadeditor.ui.forms.line_description', i + 1), compact: true, openKey: 'lore-style-' + i }
      );
      var tools = h('div', { class: 'ed-it-tools' });
      if (i > 0) {
        var up = h('div', { class: 'ed-mini', text: '↑' });
        activate(up, function () {
          var t = cur[i - 1];
          cur[i - 1] = cur[i];
          cur[i] = t;
          commit(cur, {});
          draw();
        });
        tools.appendChild(up);
      }
      if (i < cur.length - 1) {
        var dn = h('div', { class: 'ed-mini', text: '↓' });
        activate(dn, function () {
          var t = cur[i + 1];
          cur[i + 1] = cur[i];
          cur[i] = t;
          commit(cur, {});
          draw();
        });
        tools.appendChild(dn);
      }
      var rm = h('div', { class: 'ed-mini del', text: '×' });
      activate(rm, function () {
        cur.splice(i, 1);
        commit(cur, {});
        draw();
      });
      tools.appendChild(rm);
      list.appendChild(
        h('div', { class: 'ed-itrow top' }, [
          h('span', { class: 'ix', text: String(i + 1) }),
          h('div', { class: 'grow' }, [node]),
          tools
        ])
      );
    });
    if (!cur.length) list.appendChild(h('div', { class: 'ed-empty', text: I18n.t('cadeditor.ui.forms.lore_lines') }));
  }
  var add = h('div', { class: 'ed-addbtn' }, [icon('plus'), I18n.t('cadeditor.ui.forms.add_row_up_256')]);
  activate(add, function () {
    if (cur.length >= 256) return;
    cur.push({ text: '', color: 'dark_purple', italic: false });
    commit(cur, {});
    draw();
  });
  box.appendChild(list);
  box.appendChild(add);
  draw();
  return box;
}

var COMP_WIDGETS = {
  enchantments: wEnchants,
  stored_enchantments: wEnchants,
  attribute_modifiers: wAttrMods,
  rarity: wRarity,
  damage: wDamage,
  lore: wLore,
  custom_name: function (c, v, cm) {
    return wText({ t: 'text' }, v, cm, { placeholder: I18n.t('cadeditor.ui.forms.custom_name') });
  },
  item_name: function (c, v, cm) {
    return wText({ t: 'text' }, v, cm, { placeholder: I18n.t('cadeditor.ui.forms.base_name') });
  }
};

/* 一个组件的完整表单 */
var CURCID = null;
function renderComponentForm(cid, val, commit, doc) {
  val = clone(val); // Form initialization must not mutate a cached document snapshot.
  CURCID = cid;
  var c = CIDX[cid];
  if (!c) return wRaw({ t: 'raw' }, val, commit);
  var sw = COMP_WIDGETS[cid];
  if (sw) return sw(c, val, commit, { doc: doc, compId: cid });
  return renderNode(c.schema, val, commit, { compId: cid, path: '', spec: SPEC_FORMS[cid] });
}

/* 染料颜色：16 个色块直接点（颜色值来自游戏的 dye_color 枚举，离线时用内置色值） */
var DYE_COMPS = {
  base_color: 1,
  dye: 1,
  'shulker/color': 1,
  'sheep/color': 1,
  'wolf/collar': 1,
  'cat/collar': 1,
  'tropical_fish/base_color': 1,
  'tropical_fish/pattern_color': 1
};
function dyeFieldFor(cid, path) {
  if (cid && DYE_COMPS[cid] && !path) return true;
  if (cid === 'banner_patterns' && path && /[.]color$/.test(path)) return true;
  return false;
}
function dyeList() {
  var live = Reg.options('enum:dye_color');
  if (live)
    return live.map(function (e) {
      return { v: shortId(e.v), label: optLabel(e), rgb: typeof e.rgb === 'number' ? e.rgb : DYE_RGB[shortId(e.v)] };
    });
  return Reg.preview()
    ? Object.keys(DYE_RGB).map(function (k) {
        return { v: k, label: k, rgb: DYE_RGB[k] };
      })
    : [];
}
/* 染料颜色按钮：色块 + 颜色名，点开才出 16 个色块。
   onHover(颜色 | null)：鼠标停在色块上就报这个颜色，离开色块区或没选就关掉时报 null，调用方用它做即时预览 */
function dyeButton(val, onPick, onHover) {
  var cur = shortId(String(val === undefined ? '' : val)),
    info = dyeList().filter(function (d) {
      return d.v === cur;
    })[0] || { v: cur, label: cur, rgb: 0 };
  var chip = h('i', { class: 'dye-chip', style: 'background:#' + ('000000' + (info.rgb || 0).toString(16)).slice(-6) });
  var btn = kBtn(
    (typeof EDATA !== 'undefined' && EDATA.L && EDATA.L.color && EDATA.L.color[cur]) || info.label,
    function () {
      var picked = false;
      kPopover(
        btn,
        h('div', { class: 'world-color-pop' }, [
          wDye(
            cur,
            function (x) {
              /* 选定后由真正的改动去刷新预览；先画回旧值再刷成新值会闪一下 */
              picked = true;
              kPopClose();
              onPick(x);
            },
            onHover
          )
        ]),
        {
          width: 250,
          maxHeight: 120,
          onClose: onHover
            ? function () {
                if (!picked) onHover(null);
              }
            : null
        }
      );
    }
  );
  btn.insertBefore(chip, btn.firstChild);
  return btn;
}
function wDye(val, commit, onHover) {
  var cur = shortId(String(val === undefined ? '' : val)),
    box = h('div', { class: 'ed-dyes' });
  var palette = h('div', { class: 'ed-dyes' });
  if (onHover)
    palette.addEventListener('mouseleave', function () {
      onHover(null);
    });
  function paintPalette() {
    clear(palette);
    dyeList().forEach(function (d) {
      var sw = h('div', {
        class: 'ed-dye' + (d.v === cur ? ' on' : ''),
        title: d.label + ' (' + d.v + ')',
        style: 'background:#' + ('000000' + (d.rgb || 0).toString(16)).slice(-6)
      });
      activate(sw, function () {
        cur = d.v;
        Array.prototype.forEach.call(palette.children, function (x) {
          x.classList.remove('on');
        });
        sw.classList.add('on');
        commit(d.v, {});
      });
      if (onHover)
        sw.addEventListener('mouseenter', function () {
          onHover(d.v);
        });
      palette.appendChild(sw);
    });
  }
  paintPalette();
  watchColorOptions(dyeList, paintPalette);
  box.appendChild(palette);
  box.appendChild(
    combo({
      options: dyeList,
      value: cur,
      free: true,
      placeholder: I18n.t('cadeditor.ui.forms.select_manual_fill_color_id'),
      onPick: function (v) {
        commit(v, {});
      }
    })
  );
  return box;
}

/* 音效：简单写法是一个声音 ID；带“固定传播范围”时是 {sound_id, range} 对象。统一成：声音选择（带试听）+ 可选的范围 */
function wSoundEvent(val, commit) {
  return soundUnionRow(I18n.t('cadeditor.ui.cards3.sound'), '', val, function (v) {
    commit(v === undefined ? '' : v, {});
  });
}

/* “单个条目 / #标签 / 条目列表” 三合一（游戏里叫 HolderSet）：用一个标签芯片区代替 ID | 标签# | 列表 的切换。
   规则（游戏数据格式决定）：要么一个 #标签，要么若干条目，不能混用 —— 选了标签就清掉条目，反过来也一样 */
function isHolderSet(sc) {
  return !!(
    sc &&
    sc.t === 'union' &&
    sc.a &&
    sc.a.length === 3 &&
    sc.a[0].t === 'str' &&
    sc.a[0].reg &&
    sc.a[1].tag &&
    sc.a[2].t === 'arr'
  );
}
function wHolderSet(reg, val, commit) {
  var list = typeof val === 'string' ? [val] : Array.isArray(val) ? val.slice() : [];
  var box = h('div', { class: 'ed-hs' }),
    chips = h('div', { class: 'k-chips' });
  function save() {
    var v = list.length === 1 ? list[0] : list.slice();
    val = v;
    commit(v, {});
  }
  function draw() {
    clear(chips);
    list.forEach(function (id, i) {
      var isTag = id.charAt(0) === '#',
        e = isTag ? null : { v: id };
      var label = isTag
        ? id
        : refName(reg, {
            v: Reg.full(id),
            label: (Reg.options(reg) || [])
              .filter(function (x) {
                return x.v === Reg.full(id);
              })
              .map(function (x) {
                return x.label;
              })[0]
          });
      var c = h('div', { class: 'k-chip on', title: id }, [isTag ? uiIcon('tag', 12) : refIcon(reg, id), label]);
      var x = h('span', { class: 'x', text: ' ×' });
      x.addEventListener('click', function (ev) {
        ev.stopPropagation();
        list.splice(i, 1);
        save();
        draw();
      });
      c.appendChild(x);
      chips.appendChild(c);
    });
    var add = h('div', { class: 'k-chip' }, [
      uiIcon('plus', 12),
      list.length ? I18n.t('cadeditor.ui.forms.plus') : I18n.t('cadeditor.ui.cards3.add')
    ]);
    activate(add, function () {
      openTagPicker({
        title: I18n.t('cadeditor.ui.forms.choose_entry_tag'),
        tagsReg: reg,
        entryReg: reg,
        multi: true,
        selected: list.map(pickerId),
        entryIcon: function (e) {
          return refIcon(reg, e.v);
        },
        onConfirm: function (ids) {
          var tags = ids.filter(function (x) {
              return x.charAt(0) === '#';
            }),
            ents = ids.filter(function (x) {
              return x.charAt(0) !== '#';
            });
          if (tags.length && (ents.length || tags.length > 1)) {
            toast(I18n.t('cadeditor.ui.forms.only_one_tab_more_entries'), 'warn');
            return;
          }
          list = tags.length ? [tags[0]] : ents;
          save();
          draw();
        }
      });
    });
    chips.appendChild(add);
    if (!list.length)
      chips.insertBefore(h('span', { class: 'k-sub', text: I18n.t('cadeditor.ui.forms.empty') }), chips.firstChild);
  }
  draw();
  box.appendChild(chips);
  return box;
}

/* 声音（单个声音 ID，或 {sound_id, range}）：范围入口与声音同排，展开后用紧凑行编辑。 */
function isSoundUnion(s) {
  return !!(s && s.t === 'union' && s.a && s.a[0] && s.a[0].reg === 'sound_event');
}
function soundUnionRow(label, hint, val, set) {
  var box = h('div', { class: 'snd-u' }),
    id = '',
    range,
    extra = {},
    rangeOpen = false;
  if (isObj(val)) {
    id = val.sound_id || '';
    range = typeof val.range === 'number' ? val.range : undefined;
    Object.keys(val).forEach(function (k) {
      if (k !== 'sound_id' && k !== 'range') nbtPut(extra, k, nbtTake(val, k));
    });
  } else if (typeof val === 'string') id = val;
  function out() {
    if (!id) return undefined;
    var hasX = Object.keys(extra).length > 0;
    if (range === undefined && !hasX) return id;
    var o = { sound_id: id };
    if (range !== undefined) o.range = range;
    Object.keys(extra).forEach(function (k) {
      nbtPut(o, k, nbtTake(extra, k));
    });
    return o;
  }
  function put() {
    set(out());
  }
  function draw() {
    clear(box);
    var snd = kSoundField(id, function (x) {
      id = x;
      put();
      draw();
    });
    var row = fieldRow(label, snd.el, hint);
    var rangeBtn;
    function rangeCaption() {
      return range === undefined
        ? I18n.t('cadeditor.ui.forms.range_2')
        : I18n.t('cadeditor.ui.forms.grid', fmtNum(range));
    }
    if (id) {
      var pr = row.querySelector('.pr-r');
      var choose = pr != null ? pr.querySelector('.k-btn') : null;
      if (choose != null) setTip(choose, I18n.t('cadeditor.ui.forms.choose_sound'));
      rangeBtn = kBtn(rangeCaption(), function () {
        rangeOpen = !rangeOpen;
        draw();
      });
      rangeBtn.classList.add('snd-range-btn');
      rangeBtn.setAttribute(
        'data-tip',
        I18n.t(
          'cadeditor.ui.forms.scope_dissemination',
          range === undefined ? I18n.t('cadeditor.ui.cards1.auto') : I18n.t('cadeditor.ui.forms.grid', fmtNum(range))
        )
      );
      rangeBtn.setAttribute('aria-expanded', String(rangeOpen));
      var clr = h('div', { class: 'k-mini del', text: '×', title: I18n.t('cadeditor.ui.forms.clear_sound') });
      activate(clr, function () {
        id = '';
        range = undefined;
        extra = {};
        rangeOpen = false;
        put();
        draw();
      });
      if (pr != null) {
        pr.appendChild(rangeBtn);
        pr.appendChild(clr);
      }
    }
    box.appendChild(row);
    if (id && rangeOpen) {
      var r = h('div', { class: 'snd-range', title: I18n.t('cadeditor.ui.forms.audible_range') });
      var controls = h('div', { class: 'snd-range-controls' });
      controls.appendChild(
        kSeg(
          [
            { v: 'auto', label: I18n.t('cadeditor.ui.cards1.auto') },
            { v: 'fixed', label: I18n.t('cadeditor.ui.forms.fixed') }
          ],
          range === undefined ? 'auto' : 'fixed',
          function (v) {
            if ((v === 'auto') === (range === undefined)) return;
            range = v === 'auto' ? undefined : 16;
            put();
            draw();
          }
        ).el
      );
      if (range !== undefined)
        controls.appendChild(
          kNumber(range, {
            step: 1,
            dec: 3,
            noSlider: true,
            unit: I18n.t('cadeditor.ui.cards2.blocks'),
            onChange: function (v) {
              range = v;
              rangeBtn.textContent = rangeCaption();
              rangeBtn.setAttribute('data-tip', I18n.t('cadeditor.ui.forms.dissemination_grid', fmtNum(range)));
              put();
            }
          }).el
        );
      r.appendChild(controls);
      box.appendChild(r);
    }
  }
  draw();
  return box;
}
