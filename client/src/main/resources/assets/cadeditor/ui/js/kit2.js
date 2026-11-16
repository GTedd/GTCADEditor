/* 工具包 · 第二部分：大数字、等级、拖拽排序、右键菜单、所见即所得文字编辑器。 */

/* ---------- 大数字 / 等级 ---------- */
function fmtInt(n) {
  var s = String(Math.round(n));
  var neg = s.charAt(0) === '-';
  if (neg) s = s.substring(1);
  s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + s;
}
function bigText(n) {
  var a = Math.abs(n);
  if (a >= 1e8) return I18n.t('cadeditor.ui.kit2.billions', +(n / 1e8).toFixed(2));
  if (a >= 1e4) return I18n.t('cadeditor.ui.kit2.miles', +(n / 1e4).toFixed(2));
  return null;
}
function numBig(n) {
  var b = bigText(n);
  return fmtNum(n) + (b ? '（' + b + '）' : '');
}
function levelText(n) {
  return n >= 1 && n <= 10 ? roman(n) : fmtInt(n);
}

/* ---------- 拖拽排序 ----------
   container 的直接子元素带 .k-srow，行里的 .k-grip 是把手。放手时 o.onMove(from, to)。o.grid=true 用二维就近。 */
/* FLIP：重排前记位置，重排后让每一行从旧位置滑到新位置（180ms，out 曲线） */
function flipMove(container, mutate) {
  var scale = typeof uiScaleFactor === 'function' ? uiScaleFactor() : 1;
  var els = Array.prototype.slice.call(container.children),
    first = els.map(function (e) {
      return e.getBoundingClientRect().top;
    });
  mutate();
  els.forEach(function (e, i) {
    var d = (first[i] - e.getBoundingClientRect().top) / scale;
    if (!d) return;
    e.style.transition = 'none';
    e.style.transform = 'translateY(' + d + 'px)';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        e.style.transition = 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        e.style.transform = '';
      });
    });
  });
}
function kSortable(container, o) {
  o = o || {};
  container.addEventListener('mousedown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    var grip = e.target.closest ? e.target.closest('.k-grip') : null;
    if (!grip) return;
    var row = grip.closest('.k-srow');
    if (!row || row.parentNode !== container) return;
    e.preventDefault();
    var rows = function () {
      return Array.prototype.slice.call(container.children).filter(function (c) {
        return c.classList.contains('k-srow');
      });
    };
    var from = rows().indexOf(row);
    row.classList.add('drag');
    container.classList.add('sorting');
    snd('minecraft:entity.item.pickup', 0.3, 1.5);
    var move = function (ev) {
      var others = rows().filter(function (r) {
        return r !== row;
      });
      if (!others.length) return;
      var best = null,
        bd = 1e12,
        after = false;
      others.forEach(function (r) {
        var b = r.getBoundingClientRect(),
          cx = b.left + b.width / 2,
          cy = b.top + b.height / 2;
        var dx = o.grid ? ev.clientX - cx : 0,
          dy = ev.clientY - cy,
          d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = r;
          after = o.grid
            ? ev.clientY > cy + 2 || (Math.abs(ev.clientY - cy) <= b.height / 2 && ev.clientX > cx)
            : ev.clientY > cy;
        }
      });
      if (best) {
        var ref = after ? best.nextSibling : best;
        if (ref !== row && row.nextSibling !== ref)
          flipMove(container, function () {
            container.insertBefore(row, ref);
          });
      }
    };
    var up = function () {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      row.classList.remove('drag');
      container.classList.remove('sorting');
      var to = rows().indexOf(row);
      snd('minecraft:block.wool.place', 0.4, 1.2);
      if (to !== from && o.onMove) o.onMove(from, to);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}
function kGrip() {
  return h('div', { class: 'k-grip', title: I18n.t('cadeditor.ui.kit2.drag_reorder') }, [uiIcon('drag', 12)]);
}

/* ---------- 右键菜单 ---------- */
function kMenu(x, y, items) {
  kPopClose();
  var box = h('div', { class: 'k-pop k-menu' });
  items.forEach(function (it) {
    if (it.sep) {
      box.appendChild(h('div', { class: 'k-msep' }));
      return;
    }
    var row = h('div', { class: 'k-mi' + (it.danger ? ' dng' : '') + (it.dis ? ' dis' : '') }, [
      it.icon ? uiIcon(it.icon, 12) : h('span', { class: 'k-mi0' }),
      h('span', { class: 'lb', text: it.label }),
      it.kbd ? h('span', { class: 'kb', text: it.kbd }) : null
    ]);
    row.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (it.dis) return;
      kPopClose();
      it.run();
    });
    box.appendChild(row);
  });
  document.getElementById('overlays').appendChild(box);
  var scale = typeof uiScaleFactor === 'function' ? uiScaleFactor() : 1;
  x /= scale;
  y /= scale;
  var vw = window.innerWidth / scale,
    vh = window.innerHeight / scale,
    hh = items.length * 22 + 8;
  /* 宽度跟着内容走：中文约 12 像素、半角约 6 像素，加图标和左右留白 */
  function textPx(t) {
    var n = 0;
    String(t || '')
      .split('')
      .forEach(function (c) {
        n += c.charCodeAt(0) > 255 ? 12 : 6;
      });
    return n;
  }
  var w = 80;
  items.forEach(function (it) {
    if (it.sep) return;
    w = Math.max(w, textPx(it.label) + (it.kbd ? textPx(it.kbd) + 14 : 0) + 44);
  });
  w = Math.min(w, 260);
  box.setAttribute(
    'style',
    'left:' +
      Math.max(4, Math.min(x, vw - w - 6)) +
      'px;top:' +
      Math.max(4, Math.min(y, vh - hh - 6)) +
      'px;width:' +
      w +
      'px'
  );
  KPop.el = box;
  KPop.owner = null;
}
var lastCtx = 0;
function onContext(el, getItems) {
  function show(e) {
    var t = Date.now();
    if (t - lastCtx < 80) return;
    lastCtx = t;
    var items = getItems(e);
    if (items && items.length) kMenu(e.clientX, e.clientY, items);
  }
  el.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    show(e);
  });
  el.addEventListener('mousedown', function (e) {
    if (e.button === 2) {
      e.preventDefault();
      show(e);
    }
  });
}

/* ---------- 文本组件 ⇄ 分段 ----------
   样式键（26.x Style Codec）：颜色、阴影色（ARGB 整数）、五个开关、字体、点击 / 悬停事件、插入文本。事件和阴影原样保存、原样写回。
   内容不是纯文字的节点（图集精灵、玩家头像、翻译键、按键名）整体当作一个对象字：编辑器里占一个字，保存时还是原来的对象。 */
var TC_STYLE_KEYS = [
  'color',
  'shadow_color',
  'bold',
  'italic',
  'underlined',
  'strikethrough',
  'obfuscated',
  'font',
  'click_event',
  'hover_event',
  'insertion'
];
/* 对象字各自的字段（除样式键和 extra 外，只有这些字段时才认得） */
var TC_OBJ_KEYS = {
  atlas: ['type', 'object', 'atlas', 'sprite', 'fallback'],
  player: ['type', 'object', 'player', 'hat', 'fallback'],
  translate: ['type', 'translate', 'fallback', 'with'],
  keybind: ['type', 'keybind']
};
function runStyleOf(o) {
  var s = {};
  TC_STYLE_KEYS.forEach(function (k) {
    if (o[k] !== undefined && (o[k] !== '' || k === 'insertion')) s[k] = o[k];
  });
  return s;
}
function tcObjKind(o) {
  if (!isObj(o) || o.text !== undefined) return null;
  if (typeof o.translate === 'string' && (o.type === undefined || o.type === 'translatable')) return 'translate';
  if (typeof o.keybind === 'string' && (o.type === undefined || o.type === 'keybind')) return 'keybind';
  if (o.type !== undefined && o.type !== 'object') return null;
  if (typeof o.sprite === 'string' && (o.object === undefined || o.object === 'atlas')) return 'atlas';
  if (o.object === 'player' && o.player !== undefined) return 'player';
  return null;
}
function tcSprite(o) {
  return tcObjKind(o) === 'atlas';
}
function tcAllowed(o) {
  var kind = tcObjKind(o);
  for (var k in o) {
    if (k === 'extra' || TC_STYLE_KEYS.indexOf(k) >= 0) continue;
    if (k === 'text' && !kind) continue;
    if (kind && TC_OBJ_KEYS[kind].indexOf(k) >= 0) continue;
    return false;
  }
  return !!kind || typeof o.text === 'string' || o.extra !== undefined;
}
/* Native object text remains an object, never a text placeholder in saved data. */
function tcRuns(v) {
  if (typeof v === 'string') return { base: {}, runs: [{ text: v }] };
  if (Array.isArray(v)) {
    if (!v.length) return { base: {}, runs: [{ text: '' }] };
    var first = v[0],
      rest = v.slice(1);
    if (typeof first === 'string') first = { text: first };
    if (!isObj(first)) return null;
    var c = clone(first);
    c.extra = (c.extra || []).concat(rest);
    return tcRuns(c);
  }
  if (!isObj(v) || !tcAllowed(v)) return null;
  var runs = [],
    ok = true;
  function add(x, inherited, depth) {
    if (depth > 32 || runs.length > 1000) {
      ok = false;
      return;
    }
    if (typeof x === 'string') {
      var plain = clone(inherited);
      plain.text = x;
      runs.push(plain);
      return;
    }
    if (!isObj(x) || !tcAllowed(x) || (x.extra !== undefined && !Array.isArray(x.extra))) {
      ok = false;
      return;
    }
    var st = clone(inherited),
      own = runStyleOf(x);
    Object.keys(own).forEach(function (k) {
      st[k] = own[k];
    });
    var r = clone(st),
      kind = tcObjKind(x);
    if (kind) {
      r.text = '￼';
      r._object = {};
      TC_OBJ_KEYS[kind].forEach(function (k) {
        if (x[k] !== undefined) r._object[k] = clone(x[k]);
      });
      runs.push(r);
    } else if (typeof x.text === 'string' && x.text !== '') {
      r.text = x.text;
      runs.push(r);
    }
    (x.extra || []).forEach(function (child) {
      add(child, st, depth + 1);
    });
  }
  add(v, {}, 0);
  if (!ok) return null;
  if (!runs.length) runs.push({ text: '' });
  return { base: {}, runs: runs };
}
function sameStyle(a, b) {
  return deepEq(runStyleOf(a), runStyleOf(b));
}
function tcBuild(base, runs) {
  var merged = [];
  runs.forEach(function (r) {
    if (!r._object && r.text === '' && runs.length > 1) return;
    var last = merged[merged.length - 1];
    if (last && !last._object && !r._object && sameStyle(last, r)) last.text += r.text;
    else merged.push(clone(r));
  });
  if (!merged.length) merged.push({ text: '' });
  function node(r) {
    var out = r._object ? clone(r._object) : { text: r.text },
      st = runStyleOf(r);
    Object.keys(base).forEach(function (k) {
      if (st[k] === undefined) st[k] = base[k];
    });
    Object.keys(st).forEach(function (k) {
      out[k] = st[k];
    });
    return !r._object && !Object.keys(st).length ? r.text : out;
  }
  return merged.length === 1 ? node(merged[0]) : { text: '', extra: merged.map(node) };
}
function tcFontCss(family) {
  return typeof family === 'string' && /^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(family)
    ? 'font-family:"' + family + '";'
    : '';
}
function tcSpriteFont(o) {
  function hex(id) {
    var s = '';
    for (var i = 0; i < id.length; i++) {
      var c = id.charCodeAt(i).toString(16);
      s += c.length < 2 ? '0' + c : c;
    }
    return s;
  }
  var atlas = o.atlas || 'minecraft:blocks',
    sprite = o.sprite;
  if (
    typeof atlas !== 'string' ||
    typeof sprite !== 'string' ||
    !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(atlas) ||
    !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(sprite)
  )
    return '';
  return 'cadeditor_inline:atlas/' + hex(Reg.full(atlas)) + '/' + hex(Reg.full(sprite));
}
/* 对象字在编辑器里显示的文字：翻译键显示回退文字或键名，按键名显示键名；精灵、头像没有文字（画图标） */
function tcObjLabel(o) {
  var kind = tcObjKind(o);
  if (kind === 'translate') return typeof o.fallback === 'string' && o.fallback ? o.fallback : o.translate;
  if (kind === 'keybind') return o.keybind;
  return '';
}
/* 阴影色 → CSS text-shadow（游戏阴影向右下偏 1 像素；透明度 0 就是没有阴影） */
function tcShadowCss(v) {
  var c = typeof CP !== 'undefined' ? CP.fromArgb(v) : null;
  if (!c) return '';
  if (!c.a) return 'text-shadow:none;';
  return (
    'text-shadow:1px 1px 0 rgba(' +
    ((c.rgb >> 16) & 255) +
    ',' +
    ((c.rgb >> 8) & 255) +
    ',' +
    (c.rgb & 255) +
    ',' +
    (c.a / 255).toFixed(3) +
    ');'
  );
}
/* 渲染：在 el 里画出带颜色的文字（所见即所得）。def 为默认色/斜体（如说明文字的紫色斜体） */
function renderRuns(el, base, runs, def) {
  clear(el);
  def = def || {};
  // Item text uses the game's component font/native shadow, not the UI TTF.
  // Keep bold/italic as real styles, including explicit false overrides.
  el.classList.add('k-mctext');
  var any = false;
  runs.forEach(function (r) {
    if (!r.text) return;
    any = true;
    var st = {},
      k;
    for (k in base) st[k] = base[k];
    var rs = runStyleOf(r);
    for (k in rs) st[k] = rs[k];
    var hex = tcHex(st.color) || def.color || '#FFFFFF';
    var italic = st.italic === undefined ? !!def.italic : st.italic;
    var kind = r._object ? tcObjKind(r._object) : null;
    var css =
      tcFontCss(kind === 'atlas' ? tcSpriteFont(r._object) : st.font) +
      'color:' +
      hex +
      ';font-weight:' +
      (st.bold ? 'bold' : 'normal') +
      ';font-style:' +
      (italic ? 'italic' : 'normal') +
      ';' +
      (st.shadow_color !== undefined ? tcShadowCss(st.shadow_color) : '');
    var deco = [];
    if (st.underlined) deco.push('underline');
    if (st.strikethrough) deco.push('line-through');
    if (deco.length) css += 'text-decoration-line:' + deco.join(' ') + ';';
    var shown = kind && kind !== 'atlas' ? tcObjLabel(r._object) : r.text;
    var s = h('span', {
      class: kind && kind !== 'atlas' ? 'k-rdobj ' + kind : null,
      text: st.obfuscated && !r._object ? r.text.replace(/./g, '▒') : shown
    });
    if (kind === 'player') s.appendChild(uiIcon('user', 12));
    s.setAttribute('style', css);
    el.appendChild(s);
  });
  if (!any) el.appendChild(h('span', { class: 'k-ph', text: def.placeholder || I18n.t('cadeditor.ui.kit2.empty') }));
}
/* § 代码 ⇄ 分段 */
var SECT = String.fromCharCode(167);
var CODE_COLOR = {
  '0': 'black',
  '1': 'dark_blue',
  '2': 'dark_green',
  '3': 'dark_aqua',
  '4': 'dark_red',
  '5': 'dark_purple',
  '6': 'gold',
  '7': 'gray',
  '8': 'dark_gray',
  '9': 'blue',
  a: 'green',
  b: 'aqua',
  c: 'red',
  d: 'light_purple',
  e: 'yellow',
  f: 'white'
};
/* sectOnly：只认游戏本身认的 § 代码（书与笔原文），不把普通的 & 当代码 */
function parseCodes(text, sectOnly) {
  var runs = [],
    cur = {},
    buf = '';
  function flush() {
    if (buf !== '') {
      var r = clone(cur);
      r.text = buf;
      runs.push(r);
      buf = '';
    }
  }
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if ((ch === SECT || (!sectOnly && ch === '&')) && i + 1 < text.length) {
      var c = text.charAt(i + 1).toLowerCase();
      if (!sectOnly && c === '#' && /^[0-9a-fA-F]{6}$/.test(text.substring(i + 2, i + 8))) {
        flush();
        cur = { color: '#' + text.substring(i + 2, i + 8).toUpperCase() };
        i += 7;
        continue;
      }
      if (CODE_COLOR[c]) {
        flush();
        cur = { color: CODE_COLOR[c] };
        i++;
        continue;
      }
      if (c === 'l') {
        flush();
        cur.bold = true;
        i++;
        continue;
      }
      if (c === 'o') {
        flush();
        cur.italic = true;
        i++;
        continue;
      }
      if (c === 'n') {
        flush();
        cur.underlined = true;
        i++;
        continue;
      }
      if (c === 'm') {
        flush();
        cur.strikethrough = true;
        i++;
        continue;
      }
      if (c === 'k') {
        flush();
        cur.obfuscated = true;
        i++;
        continue;
      }
      if (c === 'r') {
        flush();
        cur = {};
        i++;
        continue;
      }
    }
    buf += ch;
  }
  flush();
  return runs.length ? runs : [{ text: '' }];
}
function toCodes(base, runs) {
  var rev = {};
  Object.keys(CODE_COLOR).forEach(function (k) {
    rev[CODE_COLOR[k]] = k;
  });
  return runs
    .map(function (r) {
      var st = {},
        k;
      for (k in base) st[k] = base[k];
      var rs = runStyleOf(r);
      for (k in rs) st[k] = rs[k];
      var p = SECT + 'r';
      if (st.color) p += rev[st.color] ? SECT + rev[st.color] : '&' + st.color;
      if (st.bold) p += SECT + 'l';
      if (st.italic) p += SECT + 'o';
      if (st.underlined) p += SECT + 'n';
      if (st.strikethrough) p += SECT + 'm';
      if (st.obfuscated) p += SECT + 'k';
      return p + r.text;
    })
    .join('');
}
function lerpHex(a, b, t) {
  var pa = parseInt(a.replace('#', ''), 16),
    pb = parseInt(b.replace('#', ''), 16);
  function ch(sh) {
    return Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  }
  return (
    '#' +
    [16, 8, 0]
      .map(function (s) {
        var x = ch(s).toString(16).toUpperCase();
        return x.length < 2 ? '0' + x : x;
      })
      .join('')
  );
}

/* ---------- 所见即所得文字编辑器（公共组件） ----------
   像论坛发帖的编辑器：上面一排工具栏，下面直接写字。选中文字再点颜色、粗体等；没选中时，设置的样式用于接下来输入的字。
   颜色直接画在输入框里（Oriel 原生文本高亮）；粗体、斜体等输入框画不出，在预览里看。
   名称、说明文字、告示牌、书页都用这一个组件。
   value：文本组件（mode 'component'）或带 § 代码的字符串（mode 'codes'，书与笔的原文）；lines=n 时 value 是 n 行文本组件的数组（告示牌）。
   o = { mode, multiline, lines, compact, openKey, placeholder, def:{color,italic,placeholder}, preview（默认显示）, paper（'book'|'sign'）,
         height, max（字符上限：数字或函数，undefined=读取中、null=游戏没给上限）, onChange(v, empty), onRender(api), onKey(e) }
   工具栏：文字颜色 / 阴影（取色器 colorpicker.js，含渐变与预设）、粗斜下删乱、字体、精灵 / 玩家头像 / 翻译键插入、点击与悬停事件、渐变、§ 代码。
   返回 { el, set(v), focus(), runs(), lineRuns() }；内容含编辑器不认识的结构（score、selector、nbt 内容，或未知字段）时
   lines 模式返回 null，其他模式退回原始 SNBT 编辑。 */
var RD_FLAGS = [
  ['bold', 'B', I18n.t('cadeditor.ui.kit2.bold_ctrl_b'), 'l'],
  ['italic', 'I', I18n.t('cadeditor.ui.kit2.italic_ctrl_i'), 'o'],
  ['underlined', 'U', I18n.t('cadeditor.ui.kit2.underline_ctrl_u'), 'n'],
  ['strikethrough', 'S', I18n.t('cadeditor.ui.forms.strikethrough'), 'm'],
  ['obfuscated', '?', I18n.t('cadeditor.ui.kit2.discrepancies'), 'k']
];
var RD_OBJ = '\uFFFC'; /* 分段里精灵图的占位字：渲染时由精灵字体画成图 */
var SPR_DY = 4; /* 平滑字体下输入框里的图标比普通字偏上，整体往下挪几个像素；游戏默认字体下对得齐，不挪 */
var RD_MARK =
  I18n.t(
    'cadeditor.ui.kit2.mouthfuls'
  ); /* 输入框里精灵图的占位字（透明）：用和一个汉字等宽的「口」，这样图标盖上去不会遮住后面的字；原生输入框画不了图，真图标由镜像层盖在上面 */
var RD_CODES_WHY = I18n.t('cadeditor.ui.kit2.books_pens_save_only_pure');
function rdNorm(st) {
  var o = {};
  Object.keys(st || {}).forEach(function (k) {
    if (st[k] !== undefined && (st[k] !== '' || k === 'insertion')) o[k] = st[k];
  });
  return o;
}
function rdStyleOf(r) {
  var s = runStyleOf(r);
  if (r._object) s._object = clone(r._object);
  return s;
}
/* 分段 → 文字 + 每个字符的样式（UTF-16 下标对齐输入框） */
function rdFromRuns(runs, into) {
  runs.forEach(function (r) {
    var s = rdStyleOf(r),
      t = r._object ? RD_MARK : r.text || '';
    into.text += t;
    for (var i = 0; i < t.length; i++) into.sty.push(s);
  });
  return into;
}
function rdLoad(v, codes, n) {
  var out = { text: '', sty: [] };
  if (n) {
    var list = Array.isArray(v) ? v : [];
    for (var i = 0; i < n; i++) {
      var p = tcRuns(list[i] === undefined || list[i] === null ? '' : list[i]);
      if (!p) return null;
      if (i) {
        out.text += '\n';
        out.sty.push({});
      }
      rdFromRuns(p.runs, out);
    }
    return out;
  }
  if (codes) return rdFromRuns(parseCodes(typeof v === 'string' ? v : '', true), out);
  var parsed = tcRuns(v === undefined || v === null ? '' : v);
  return parsed ? rdFromRuns(parsed.runs, out) : null;
}
/* 文字 + 样式 → 分段（相同样式的相邻字合并；精灵图各占一段） */
function rdRuns(text, sty, from, to) {
  var runs = [],
    cur = null;
  from = from || 0;
  to = to === undefined ? text.length : to;
  for (var i = from; i < to; i++) {
    var s = sty[i] || {};
    if (s._object) {
      cur = null;
      var o = runStyleOf(s);
      o.text = RD_OBJ;
      o._object = clone(s._object);
      runs.push(o);
      continue;
    }
    if (cur && sameStyle(cur, s)) cur.text += text.charAt(i);
    else {
      cur = runStyleOf(s);
      cur.text = text.charAt(i);
      runs.push(cur);
    }
  }
  if (!runs.length) runs.push({ text: '' });
  return runs;
}
/* 分段 → 游戏认的 § 代码。颜色代码会清掉粗体等，所以换色或去掉某个格式时先换色 / §r，再补格式 */
function rdCodes(runs) {
  var rev = {};
  Object.keys(CODE_COLOR).forEach(function (k) {
    rev[CODE_COLOR[k]] = k;
  });
  var out = '',
    prev = {};
  runs.forEach(function (r) {
    if (!r.text) return;
    var s = runStyleOf(r),
      reset = (prev.color || '') !== (s.color || '');
    RD_FLAGS.forEach(function (f) {
      if (prev[f[0]] === true && s[f[0]] !== true) reset = true;
    });
    if (reset) {
      out += SECT + (s.color && rev[s.color] ? rev[s.color] : 'r');
      RD_FLAGS.forEach(function (f) {
        if (s[f[0]] === true) out += SECT + f[3];
      });
    } else
      RD_FLAGS.forEach(function (f) {
        if (s[f[0]] === true && prev[f[0]] !== true) out += SECT + f[3];
      });
    prev = s;
    out += r.text;
  });
  return out;
}
function rdArgb(c) {
  var hx = tcHex(c);
  return hx ? 0xff000000 + parseInt(hx.substring(1), 16) : null;
}

/* ---------- 富文本高级字段：颜色层、阴影、事件、对象（纯函数，取色器和事件窗口共用） ---------- */
/* 一组字的某个样式值都相同就返回它，否则 undefined */
function rdUniform(list, key) {
  if (!list.length) return undefined;
  var first = list[0][key];
  for (var i = 1; i < list.length; i++) if (!deepEq(list[i][key], first)) return undefined;
  return first;
}
/* 选中文字的颜色 / 阴影 → 取色器的层；不一致或没有就是 null */
function rdLayerOf(list, key) {
  var v = rdUniform(list, key);
  if (v === undefined || v === null) return null;
  if (key === 'shadow_color') {
    var c = typeof CP !== 'undefined' ? CP.fromArgb(v) : null;
    return c ? { rgb: c.rgb, a: c.a } : null;
  }
  var hx = tcHex(v);
  if (!hx) return null;
  var out = { rgb: parseInt(hx.substring(1), 16), a: 255 };
  if (/^[a-z_]+$/.test(v)) out.n = v;
  return out;
}
/* 把取色器的结果画到一个字的样式上。k = 这个字在渐变里的序号（-1 = 不参与渐变，如对象字或待输入样式），
   g = { tc, sc } 逐字颜色；near(hex) 把颜色换成最接近的原版颜色名（书与笔只认 16 色），def 是默认样式（说明文字默认斜体） */
function rdPaintStyle(s, r, k, g, near, def) {
  g = g || {};
  function col(rgb, name) {
    var hx = CP.hex6(rgb);
    return name ? name : near ? near(hx) || hx : hx;
  }
  if (r.text !== undefined) {
    if (!r.text) delete s.color;
    else if (r.text.stops) {
      if (g.tc && k >= 0) s.color = col(g.tc[k].rgb);
    } else s.color = col(r.text.rgb, r.text.n);
  }
  if (r.shadow !== undefined) {
    if (!r.shadow) delete s.shadow_color;
    else if (r.shadow.stops) {
      if (g.sc && k >= 0) s.shadow_color = CP.toSigned(g.sc[k].a, g.sc[k].rgb);
    } else s.shadow_color = CP.toSigned(r.shadow.a, r.shadow.rgb);
  }
  if (r.flags)
    RD_FLAGS.forEach(function (f) {
      var v = r.flags[f[0]];
      if (v === undefined) return;
      if (v) s[f[0]] = true;
      else if (f[0] === 'italic' && def && def.italic) s.italic = false;
      else delete s[f[0]];
    });
  return s;
}
/* 服务器（握手能力）不允许新增执行命令的点击事件（run_command / custom）？ */
function rdCommandClicksBlocked() {
  var d = typeof oriel !== 'undefined' && oriel ? oriel.data : null;
  return !!(d && d.serverCaps && d.serverCaps['item.command_clicks'] === false);
}
/* 字体候选的离线回退（26.3 原版的 font/*.json）；有游戏数据时用资源管理器的实时目录 */
var RD_FONT_FALLBACK = ['minecraft:default', 'minecraft:uniform', 'minecraft:alt', 'minecraft:illageralt'];
var RD_CLICK_ACTIONS = [
  'open_url',
  'run_command',
  'suggest_command',
  'change_page',
  'copy_to_clipboard',
  'show_dialog',
  'custom'
];
var RD_HOVER_ACTIONS = ['show_text', 'show_item', 'show_entity'];
var RD_ID = /^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/;
/* 点击事件：表单值 → 26.x ClickEvent（action 分派）。prev 是原来同 action 的事件，它的其它字段原样保留。不合法抛 Error */
function rdClickEvent(action, f, prev) {
  var out = prev && prev.action === action ? clone(prev) : { action: action };
  function need(v, msg) {
    if (v === undefined || v === null || String(v) === '') throw new Error(msg);
    return v;
  }
  if (action === 'open_url') {
    var url = String(need(f.url, I18n.t('cadeditor.ui.textevent.need_url'))).trim();
    if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(I18n.t('cadeditor.ui.textevent.bad_url'));
    out.url = url;
  } else if (action === 'run_command' || action === 'suggest_command') {
    var cmd = String(need(f.command, I18n.t('cadeditor.ui.textevent.need_command')));
    if (/[\r\n]/.test(cmd)) throw new Error(I18n.t('cadeditor.ui.textevent.command_one_line'));
    out.command = cmd;
  } else if (action === 'change_page') {
    var page = Number(f.page);
    if (!(page >= 1 && page <= 2147483647 && Math.floor(page) === page))
      throw new Error(I18n.t('cadeditor.ui.textevent.bad_page'));
    out.page = page;
  } else if (action === 'copy_to_clipboard') {
    out.value = String(f.value === undefined || f.value === null ? '' : f.value);
  } else if (action === 'show_dialog') {
    if (f.dialog !== undefined && f.dialog !== null && typeof f.dialog === 'object') out.dialog = clone(f.dialog);
    else {
      var d = String(need(f.dialog, I18n.t('cadeditor.ui.textevent.need_dialog'))).trim();
      if (!RD_ID.test(d)) throw new Error(I18n.t('cadeditor.ui.textevent.bad_id', d));
      out.dialog = Reg.full(d);
    }
  } else if (action === 'custom') {
    var id = String(need(f.id, I18n.t('cadeditor.ui.textevent.need_id'))).trim();
    if (!RD_ID.test(id)) throw new Error(I18n.t('cadeditor.ui.textevent.bad_id', id));
    out.id = Reg.full(id);
    if (f.payload === undefined || f.payload === null || f.payload === '') delete out.payload;
    else out.payload = f.payload;
  } else throw new Error(I18n.t('cadeditor.ui.textevent.bad_action', action));
  return out;
}
/* UUID 文本 ⇄ 游戏的 4 个 int（UUIDUtil.CODEC 的整数数组，高位在前） */
function rdUuidInts(text) {
  var t = String(text || '')
    .trim()
    .replace(/-/g, '')
    .toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(t)) return null;
  var out = [];
  for (var i = 0; i < 4; i++) out.push(parseInt(t.substring(i * 8, i * 8 + 8), 16) | 0);
  return out;
}
function rdUuidText(ints) {
  if (!Array.isArray(ints) || ints.length !== 4) return '';
  var hx = ints
    .map(function (n) {
      var v = Number(n);
      if (v < 0) v += 4294967296;
      var x = v.toString(16);
      while (x.length < 8) x = '0' + x;
      return x;
    })
    .join('');
  return (
    hx.substring(0, 8) +
    '-' +
    hx.substring(8, 12) +
    '-' +
    hx.substring(12, 16) +
    '-' +
    hx.substring(16, 20) +
    '-' +
    hx.substring(20)
  );
}
function rdRandomUuid() {
  var ints = [];
  for (var i = 0; i < 4; i++) ints.push(Math.floor(Math.random() * 4294967296) | 0);
  ints[1] = (ints[1] & ~0xf000) | 0x4000; // version 4
  ints[2] = (ints[2] & 0x3fffffff) | 0x80000000; // IETF variant
  return rdUuidText(ints);
}
/* 悬停事件：show_text 的 value 是文本组件；show_item 是物品模板（id、count，components 原样保留）；show_entity 是 id + uuid + 可选 name */
function rdHoverEvent(action, f, prev) {
  var out = prev && prev.action === action ? clone(prev) : { action: action };
  if (action === 'show_text') {
    out.value = f.value === undefined ? '' : f.value;
  } else if (action === 'show_item') {
    var id = String(f.id || '').trim();
    if (!id || !RD_ID.test(id)) throw new Error(I18n.t('cadeditor.ui.textevent.need_item'));
    out.id = Reg.full(id);
    var n = f.count === undefined || f.count === null || f.count === '' ? 1 : Number(f.count);
    if (!(n >= 1 && n <= 99 && Math.floor(n) === n)) throw new Error(I18n.t('cadeditor.ui.textevent.bad_count'));
    if (n === 1) delete out.count;
    else out.count = n;
  } else if (action === 'show_entity') {
    var et = String(f.id || '').trim();
    if (!et || !RD_ID.test(et)) throw new Error(I18n.t('cadeditor.ui.textevent.need_entity'));
    out.id = Reg.full(et);
    var u = String(f.uuid || '').trim();
    if (!rdUuidInts(u)) throw new Error(I18n.t('cadeditor.ui.textevent.bad_uuid'));
    out.uuid = u.toLowerCase();
    if (f.name === undefined || f.name === null || f.name === '') delete out.name;
    else out.name = f.name;
  } else throw new Error(I18n.t('cadeditor.ui.textevent.bad_action', action));
  return out;
}
/* 玩家头像对象的 player 字段：玩家名（≤16 个可见 ASCII，游戏 isValidPlayerName）、UUID、皮肤材质 value。
   材质也可以填 textures.minecraft.net 的网址或 64 位哈希：在本地拼成材质 JSON 再 Base64，不联网 */
function rdPlayerProfile(mode, input) {
  var t = String(input || '').trim();
  if (mode === 'name') {
    if (!/^[\x21-\x7e]{1,16}$/.test(t)) throw new Error(I18n.t('cadeditor.ui.textobj.bad_name'));
    return t;
  }
  if (mode === 'uuid') {
    var ints = rdUuidInts(t);
    if (!ints) throw new Error(I18n.t('cadeditor.ui.textevent.bad_uuid'));
    return { id: ints };
  }
  if (mode === 'texture') {
    var hash = /^(?:https?:\/\/textures\.minecraft\.net\/texture\/)?([0-9a-fA-F]{32,64})$/.exec(t);
    var value = hash
      ? rdBase64('{"textures":{"SKIN":{"url":"http://textures.minecraft.net/texture/' + hash[1].toLowerCase() + '"}}}')
      : t.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]{16,}={0,2}$/.test(value) || value.length > 32767)
      throw new Error(I18n.t('cadeditor.ui.textobj.bad_texture'));
    return { properties: [{ name: 'textures', value: value }] };
  }
  throw new Error(I18n.t('cadeditor.ui.textevent.bad_action', mode));
}
/* 头像对象的现值 → { mode, input } 供表单回填 */
function rdProfileForm(p) {
  if (typeof p === 'string') return { mode: 'name', input: p };
  if (isObj(p)) {
    if (typeof p.name === 'string' && !p.id && !p.properties) return { mode: 'name', input: p.name };
    if (Array.isArray(p.properties))
      for (var i = 0; i < p.properties.length; i++)
        if (p.properties[i] && p.properties[i].name === 'textures' && typeof p.properties[i].value === 'string')
          return { mode: 'texture', input: p.properties[i].value };
    if (Array.isArray(p.id)) return { mode: 'uuid', input: rdUuidText(p.id) };
    if (typeof p.id === 'string') return { mode: 'uuid', input: p.id };
  }
  return { mode: 'name', input: '' };
}
var RD_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function rdBase64(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
    else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  var out = '';
  for (var j = 0; j < bytes.length; j += 3) {
    var n = (bytes[j] << 16) | ((bytes[j + 1] || 0) << 8) | (bytes[j + 2] || 0);
    out +=
      RD_B64.charAt((n >> 18) & 63) +
      RD_B64.charAt((n >> 12) & 63) +
      (j + 1 < bytes.length ? RD_B64.charAt((n >> 6) & 63) : '=') +
      (j + 2 < bytes.length ? RD_B64.charAt(n & 63) : '=');
  }
  return out;
}
/* 翻译键对象：fallback 留空就不写；参数留空的保留空字符串占位（后面还有参数时），末尾的空参数去掉。原来的非文字参数原样保留 */
function rdTranslateObject(key, fallback, args, prev) {
  var k = String(key || '').trim();
  if (!k || k.length > 32767) throw new Error(I18n.t('cadeditor.ui.textobj.need_key'));
  var out = prev && tcObjKind(prev) === 'translate' ? clone(prev) : {};
  out.translate = k;
  if (fallback === undefined || fallback === null || fallback === '') delete out.fallback;
  else out.fallback = String(fallback);
  if (args) {
    var list = args.slice();
    while (list.length && (list[list.length - 1] === '' || list[list.length - 1] === undefined)) list.pop();
    if (list.length)
      out['with'] = list.map(function (a) {
        return a === undefined || a === null ? '' : a;
      });
    else delete out['with'];
  }
  return out;
}
/* 编辑器输入框里对象字的小图标（精灵用精灵字体画，不走这里） */
function rdObjIcon(o) {
  var kind = tcObjKind(o);
  return uiIcon(kind === 'player' ? 'user' : kind === 'keybind' ? 'keyboard' : 'globe', 12);
}

function kRichDoc(value, o) {
  o = o || {};
  var codes = o.mode === 'codes',
    n = o.lines || 0,
    multi = !!o.multiline || n > 1,
    def = o.def || {};
  var loaded = rdLoad(value, codes, n);
  if (!loaded) {
    if (n) return null;
    var raw = wText(
      { t: 'text' },
      value,
      function (v) {
        o.onChange(v, false);
      },
      o
    );
    return {
      el: h('div', { class: 'k-rd raw' }, [raw]),
      set: function () {},
      focus: function () {},
      runs: function () {
        return [];
      },
      lineRuns: function () {
        return [];
      },
      raw: true
    };
  }
  var sprOn = false,
    followAside = null,
    text = loaded.text,
    sty = loaded.sty,
    pending = null,
    sel = { s: text.length, e: text.length },
    version = 0,
    hlError = false,
    api;
  var wrap = h('div', {
    class:
      'k-rd' + (multi ? ' multi' : ' single') + (o.paper ? ' paper-' + o.paper : '') + (o.compact ? ' compact' : '')
  });
  var ta = h('textarea', { class: 'k-input k-rdta', spellcheck: 'false', placeholder: o.placeholder || '' });
  if (!multi) ta.setAttribute('wrap', 'off');
  if (o.height) ta.style.height = o.height + 'px';
  else if (n > 1) ta.style.height = n * 14 + 8 + 'px';
  if (def.color && (!o.paper || o.paper === 'sign')) ta.style.color = tcHex(def.color) || def.color;
  ta.value = text;
  var prev = o.preview === false ? null : h('div', { class: 'k-rprev k-rdprev' });
  var bar = h('div', { class: 'k-rdbar' }),
    count = h('span', { class: 'k-rdcount' });

  function styleAt(p) {
    var s =
      p > 0 && text.charAt(p - 1) !== '\n'
        ? sty[p - 1]
        : p < text.length && text.charAt(p) !== '\n'
          ? sty[p]
          : p > 0
            ? sty[p - 1]
            : null;
    s = clone(s || {});
    delete s._object;
    return s;
  }
  function selStyles() {
    if (sel.s === sel.e) return [pending && pending.at === sel.s ? pending.style : styleAt(sel.s)];
    var out = [];
    for (var i = sel.s; i < sel.e; i++) if (text.charAt(i) !== '\n') out.push(sty[i] || {});
    return out.length ? out : [{}];
  }
  function eff(s, f) {
    return f === 'italic' && s.italic === undefined ? !!def.italic : s[f] === true;
  }
  function readSel() {
    if (typeof ta.selectionStart === 'number' && typeof ta.selectionEnd === 'number') {
      var s = Math.max(0, Math.min(text.length, ta.selectionStart)),
        e = Math.max(s, Math.min(text.length, ta.selectionEnd));
      sel = { s: s, e: e };
    }
    if (pending && (sel.s !== sel.e || sel.s !== pending.at)) pending = null;
    paintBar();
  }
  function refocus(top) {
    if (!document.body.contains || !document.body.contains(wrap)) return;
    var keepTop = top === undefined ? ta.scrollTop : top,
      want = { s: sel.s, e: sel.e };
    /* focus() 会触发 focus 事件，readSel 把引擎自己放的光标（文末）读成 sel；所以先记下想要的选区，聚焦后再放回去 */
    ta.focus();
    sel = want;
    if (typeof ta.setSelectionRange === 'function') ta.setSelectionRange(want.s, want.e);
    if (multi) {
      ta.scrollTop = keepTop;
      if (followAside) followAside();
    }
  }
  function curValue() {
    if (n) {
      var lines = [],
        start = 0;
      for (var i = 0; i <= text.length; i++)
        if (i === text.length || text.charAt(i) === '\n') {
          lines.push(tcBuild({}, rdRuns(text, sty, start, i)));
          start = i + 1;
        }
      while (lines.length < n) lines.push('');
      return lines.slice(0, n);
    }
    var runs = rdRuns(text, sty);
    return codes ? rdCodes(runs) : tcBuild({}, runs);
  }
  function isEmpty(v) {
    return n
      ? v.every(function (x) {
          return x === '';
        })
      : v === '';
  }
  function highlight() {
    if (typeof ta.setTextHighlights !== 'function') return;
    var ranges = [],
      cur = null;
    for (var i = 0; i < text.length; i++) {
      var c = sty[i] && sty[i].color ? rdArgb(sty[i].color) : null;
      if (sprOn && sty[i] && sty[i]._object) c = 0;
      if (c === null || text.charAt(i) === '\n') {
        cur = null;
        continue;
      }
      if (cur && cur.color === c && cur.end === i) cur.end = i + 1;
      else {
        cur = { start: i, end: i + 1, color: c };
        ranges.push(cur);
      }
    }
    try {
      ta.setTextHighlights(text, ranges, false);
      hlError = false;
    } catch (e) {
      if (!hlError && typeof EditorDiag !== 'undefined') EditorDiag.error('richdoc.highlight', e);
      hlError = true;
    }
  }
  function paintCount(v) {
    if (o.max === undefined) return;
    var m = typeof o.max === 'function' ? o.max() : o.max,
      len = typeof v === 'string' ? v.length : text.length;
    count.textContent = len + (typeof m === 'number' ? ' / ' + m : m === undefined ? ' / …' : '');
    count.classList.toggle('bad', typeof m === 'number' && len > m);
    setTip(
      count,
      typeof m === 'number'
        ? codes
          ? I18n.t('cadeditor.ui.kit2.code_also_characterized_according_saved', m)
          : I18n.t('cadeditor.ui.kit2.game_cap', m)
        : m === undefined
          ? I18n.t('cadeditor.ui.kit2.reading_maximum_number_words_game')
          : ''
    );
  }
  function paintPrev() {
    if (prev) renderRuns(prev, {}, rdRuns(text, sty), def);
  }
  function rendered(v) {
    scheduleSprites();
    paintPrev();
    paintCount(v === undefined ? curValue() : v);
    if (o.onRender) o.onRender(api);
    if (followAside) followAside();
  }
  function emit() {
    version++;
    var v = curValue();
    rendered(v);
    o.onChange(v, isEmpty(v));
  }
  /* 原生输入框改了文字：比较前后共同的首尾，中间被替换的部分换成新输入的字，新字沿用光标前一个字（或刚设好的待输入样式） */
  function absorb(nt) {
    var a = text,
      max = Math.min(a.length, nt.length),
      p = 0,
      q = 0;
    while (p < max && a.charCodeAt(p) === nt.charCodeAt(p)) p++;
    while (q < max - p && a.charCodeAt(a.length - 1 - q) === nt.charCodeAt(nt.length - 1 - q)) q++;
    var st = pending && pending.at === p ? pending.style : styleAt(p),
      add = [];
    for (var i = p; i < nt.length - q; i++) add.push(nt.charAt(i) === '\n' ? {} : st);
    Array.prototype.splice.apply(sty, [p, a.length - q - p].concat(add));
    text = nt;
  }
  ta.addEventListener('input', function () {
    var nt = ta.value;
    if (!multi && nt.indexOf('\n') >= 0) {
      nt = nt.replace(/\r?\n/g, '');
      ta.value = nt;
    }
    if (n && nt.split('\n').length > n) {
      /* 末尾还有空行就让出来：在中间按回车，整体下移一行，最后一个空行被挤掉 */
      var ls = nt.split('\n'),
        extra = ls.length - n,
        caret = typeof ta.selectionStart === 'number' ? ta.selectionStart : nt.length;
      while (extra > 0 && ls.length && ls[ls.length - 1] === '') {
        ls.pop();
        extra--;
      }
      if (extra > 0) {
        var back = sel.s;
        ta.value = text;
        if (typeof ta.setSelectionRange === 'function') ta.setSelectionRange(back, back);
        toast(I18n.t('cadeditor.ui.kit2.up_here_line', n), 'info', 'rd-lines');
        return;
      }
      nt = ls.join('\n');
      ta.value = nt;
      if (typeof ta.setSelectionRange === 'function')
        ta.setSelectionRange(Math.min(caret, nt.length), Math.min(caret, nt.length));
      while (nt.split('\n').length < n) nt += '\n';
      ta.value = nt;
      if (typeof ta.setSelectionRange === 'function')
        ta.setSelectionRange(Math.min(caret, nt.length), Math.min(caret, nt.length));
      /* 在中间按回车：新换行插在光标处，末尾那个空行的换行被挤掉；后面各行的样式跟着整体下移，不要被重置 */
      var cut = caret - 1;
      if (
        cut >= 0 &&
        nt.length === text.length &&
        text.charAt(text.length - 1) === '\n' &&
        nt === text.slice(0, cut) + '\n' + text.slice(cut, text.length - 1)
      ) {
        sty.splice(cut, 0, {});
        sty.length = nt.length;
        text = nt;
        pending = null;
        emit();
        highlight();
        readSel();
        return;
      }
    }
    absorb(nt);
    emit();
    highlight();
    readSel();
  });
  ['select', 'mouseup', 'keyup', 'focus'].forEach(function (ev) {
    ta.addEventListener(ev, readSel);
  });
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.ctrlKey && !multi) {
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      var f = { b: 'bold', i: 'italic', u: 'underlined' }[String(e.key).toLowerCase()];
      if (f) {
        e.preventDefault();
        readSel();
        toggleFlag(f);
        return;
      }
    }
    if (o.onKey) o.onKey(e);
  });

  /* 选中范围改样式；没选中就设成接下来输入的样式 */
  function patch(fn) {
    if (sel.s === sel.e) {
      pending = { at: sel.s, style: rdNorm(fn(clone(selStyles()[0]))) };
      paintBar();
      refocus();
      return;
    }
    for (var i = sel.s; i < sel.e; i++) {
      if (text.charAt(i) === '\n') continue;
      var obj = sty[i] && sty[i]._object;
      var s = rdNorm(fn(clone(sty[i] || {})));
      if (obj) s._object = obj;
      sty[i] = s;
    }
    emit();
    highlight();
    paintBar();
    refocus();
  }
  function toggleFlag(f) {
    var on = selStyles().every(function (s) {
      return eff(s, f);
    });
    patch(function (s) {
      if (on) {
        if (f === 'italic' && def.italic) s.italic = false;
        else delete s[f];
      } else {
        if (f === 'italic' && def.italic) delete s.italic;
        else s[f] = true;
      }
      return s;
    });
  }
  function setColor(c) {
    patch(function (s) {
      if (c) s.color = c;
      else delete s.color;
      return s;
    });
  }
  function replaceSel(str, styles) {
    var s = sel.s,
      e = sel.e,
      top = ta.scrollTop;
    text = text.slice(0, s) + str + text.slice(e);
    Array.prototype.splice.apply(sty, [s, e - s].concat(styles));
    ta.value = text;
    sel = { s: s + str.length, e: s + str.length };
    pending = null;
    refocus(top);
    emit();
    highlight();
    paintBar();
  }
  function wholeIfEmpty() {
    if (sel.s === sel.e) sel = { s: 0, e: text.length };
  }

  function tb(cls, label, tip, fn) {
    var b = h('div', { class: 'k-rdb ' + cls, title: tip }, [
      typeof label === 'string' ? h('span', { text: label }) : label
    ]);
    b.addEventListener('mousedown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      readSel();
      e.preventDefault();
    });
    activate(b, function () {
      fn(b);
    });
    return b;
  }
  var chip = h('i', { class: 'k-rdsw' }),
    shChip = h('i', { class: 'k-rdsw k-rdsh' });
  /* 书与笔只认 § 代码：只有 16 色，旧的色板小窗 */
  function legacyColorPop(b) {
    var keep = { s: sel.s, e: sel.e },
      box = h('div', { class: 'k-pickbox' }),
      sw = h('div', { class: 'k-swatches' });
    function pick(c) {
      kPopClose();
      sel = keep;
      setColor(c);
    }
    function paint() {
      clear(sw);
      var none = h('div', { class: 'k-sw nonec', title: I18n.t('cadeditor.ui.forms.default_color') }, [
        h('i', { text: '×' })
      ]);
      none.addEventListener('mousedown', function (e) {
        e.preventDefault();
        pick(null);
      });
      sw.appendChild(none);
      mcColors().forEach(function (c) {
        var s = h('div', { class: 'k-sw', title: c[2], style: 'background:#' + c[1] });
        s.addEventListener('mousedown', function (e) {
          e.preventDefault();
          pick(c[0]);
        });
        sw.appendChild(s);
      });
      if (!mcColors().length)
        sw.appendChild(h('span', { class: 'k-sub', text: I18n.t('cadeditor.ui.kit2.loading_colors') }));
    }
    paint();
    box.appendChild(sw);
    var hex = h('input', {
      class: 'k-input',
      type: 'text',
      placeholder: I18n.t('cadeditor.ui.kit2.books_pens_cannot_use_custom'),
      maxlength: '7'
    });
    hex.setAttribute('disabled', '');
    setTip(hex, RD_CODES_WHY);
    box.appendChild(hex);
    kPopover(b, box, { width: 244, onClose: watchColorOptions(mcColors, paint) });
  }
  /* 取色器的预览文字：选中的字（去掉对象字和换行），最多 40 个 */
  function sampleText(r) {
    var a = r.s === r.e ? 0 : r.s,
      b = r.s === r.e ? text.length : r.e,
      out = '';
    for (var i = a; i < b && out.length < 40; i++)
      if (text.charAt(i) !== '\n' && !(sty[i] && sty[i]._object)) out += text.charAt(i);
    return out;
  }
  /* 文字颜色 / 阴影 / 渐变：同一个取色器，active 决定先编辑哪一层，mode 'gradient' 直接进渐变 */
  function colorPick(anchor, active, mode) {
    if (codes) {
      if (active === 'shadow') {
        toast(RD_CODES_WHY, 'info', 'rd-codes');
        return;
      }
      if (mode === 'gradient') gradientPop(anchor);
      else legacyColorPop(anchor);
      return;
    }
    var keep = { s: sel.s, e: sel.e },
      ver = version,
      list = selStyles(),
      flags = {};
    RD_FLAGS.forEach(function (f) {
      flags[f[0]] = list.every(function (s) {
        return eff(s, f[0]);
      });
    });
    kColorPickerPop(anchor, {
      layers: ['text', 'shadow'],
      active: active,
      mode: mode,
      value: { text: rdLayerOf(list, 'color'), shadow: rdLayerOf(list, 'shadow_color') },
      flags: flags,
      sample: sampleText(keep),
      onApply: function (r) {
        if (ver !== version) {
          toast(I18n.t('cadeditor.ui.kit2.text_changed_re_select_place'), 'info');
          return;
        }
        sel = keep;
        applyLayers(r);
      }
    });
  }
  function applyLayers(r) {
    var grad = !!((r.text && r.text.stops) || (r.shadow && r.shadow.stops)),
      near = codes ? nearestColor : null;
    if (grad) wholeIfEmpty();
    if (sel.s === sel.e) {
      pending = { at: sel.s, style: rdNorm(rdPaintStyle(clone(selStyles()[0]), r, -1, null, near, def)) };
      paintBar();
      refocus();
      return;
    }
    var idx = [],
      pos = {};
    for (var i = sel.s; i < sel.e; i++) if (text.charAt(i) !== '\n' && !(sty[i] && sty[i]._object)) idx.push(i);
    if (grad && idx.length > 256) {
      toast(I18n.t('cadeditor.ui.kit2.gradual_maximum_256_word'), 'error');
      return;
    }
    idx.forEach(function (at, k) {
      pos[at] = k;
    });
    var g = {
      tc: r.text && r.text.stops ? CP.spread(r.text.stops, idx.length) : null,
      sc: r.shadow && r.shadow.stops ? CP.spread(r.shadow.stops, idx.length) : null
    };
    for (var j = sel.s; j < sel.e; j++) {
      if (text.charAt(j) === '\n') continue;
      var obj = sty[j] && sty[j]._object;
      var s2 = rdNorm(rdPaintStyle(clone(sty[j] || {}), r, obj ? -1 : pos[j], g, near, def));
      if (obj) s2._object = obj;
      sty[j] = s2;
    }
    emit();
    highlight();
    paintBar();
    refocus();
  }
  var colorB = tb('color', chip, I18n.t('cadeditor.ui.kit2.text_color'), function (b) {
    colorPick(b, 'text', 'solid');
  });
  bar.appendChild(colorB);
  var shadowB = tb(
    'shadow' + (codes ? ' dis' : ''),
    shChip,
    codes ? RD_CODES_WHY : I18n.t('cadeditor.ui.textstyle.shadow'),
    function (b) {
      colorPick(b, 'shadow', 'solid');
    }
  );
  bar.appendChild(shadowB);
  var flagB = {};
  RD_FLAGS.forEach(function (f) {
    flagB[f[0]] = tb('flag ' + f[0], f[1], f[2], function () {
      toggleFlag(f[0]);
    });
    bar.appendChild(flagB[f[0]]);
  });
  /* 字体：候选来自资源管理器的 font/*.json（资源包和模组的也在内），也可以手输 ID */
  var fontB = tb(
    'font' + (codes ? ' dis' : ''),
    h('span', { text: 'Aa' }),
    codes ? RD_CODES_WHY : I18n.t('cadeditor.ui.textstyle.font'),
    function (b) {
      if (codes) {
        toast(RD_CODES_WHY, 'info', 'rd-codes');
        return;
      }
      var keep = { s: sel.s, e: sel.e },
        ver = version;
      var live = typeof Reg !== 'undefined' ? Reg.options('font') : null,
        ids =
          live && live.length
            ? live.map(function (e) {
                return e.v;
              })
            : RD_FONT_FALLBACK;
      var entries = [{ v: '', label: I18n.t('cadeditor.ui.textstyle.default_font'), sub: 'minecraft:default' }].concat(
        ids
          .filter(function (id) {
            return id !== 'minecraft:default';
          })
          .map(function (id) {
            return { v: id, label: humanId(shortId(id).split('/').pop()), sub: id };
          })
      );
      pickFrom(
        b,
        entries,
        function (e) {
          if (ver !== version) {
            toast(I18n.t('cadeditor.ui.kit2.text_changed_re_select_place'), 'info');
            return;
          }
          sel = keep;
          var id = e.v ? Reg.full(e.v) : '';
          patch(function (s) {
            if (id && id !== 'minecraft:default') s.font = id;
            else delete s.font;
            return s;
          });
        },
        {
          placeholder: I18n.t('cadeditor.ui.textstyle.font_search'),
          manual: {
            label: I18n.t('cadeditor.ui.textstyle.font_manual'),
            parse: function (t) {
              if (!RD_ID.test(t)) throw new Error(I18n.t('cadeditor.ui.textevent.bad_id', t));
              return Reg.full(t);
            }
          }
        }
      );
    }
  );
  bar.appendChild(fontB);
  bar.appendChild(h('i', { class: 'k-rdsep' }));
  function insertObject(object, style) {
    replaceSel(RD_MARK, [Object.assign({}, style || {}, { _object: clone(object) })]);
  }
  /* 选中的正好是一个某类对象字：返回它的位置，编辑时原地替换 */
  function selObject(kind) {
    if (sel.e - sel.s !== 1) return -1;
    var s = sty[sel.s];
    return s && s._object && tcObjKind(s._object) === kind ? sel.s : -1;
  }
  bar.appendChild(
    tb(
      'sprite' + (codes ? ' dis' : ''),
      uiIcon('image', 12),
      codes ? I18n.t('cadeditor.ui.kit2.elves', RD_CODES_WHY) : I18n.t('cadeditor.ui.kit2.insert_sprite_cursor'),
      function (b) {
        if (codes) {
          toast(RD_CODES_WHY, 'info', 'rd-codes');
          return;
        }
        var keep = { s: sel.s, e: sel.e },
          ver = version;
        pickSprite(b, function (object) {
          if (ver !== version) {
            toast(I18n.t('cadeditor.ui.kit2.text_changed_re_select_place'), 'info');
            return;
          }
          sel = keep;
          insertObject(object, { color: 'white' });
        });
      }
    )
  );
  /* 玩家头像（object:"player"）：和精灵并列；按玩家名、UUID 或材质 value 指定，可关掉帽子层 */
  bar.appendChild(
    tb(
      'head' + (codes ? ' dis' : ''),
      uiIcon('user', 12),
      codes ? RD_CODES_WHY : I18n.t('cadeditor.ui.textobj.head'),
      function (b) {
        if (codes) {
          toast(RD_CODES_WHY, 'info', 'rd-codes');
          return;
        }
        var at = selObject('player'),
          keep = { s: sel.s, e: sel.e },
          ver = version,
          prev = at >= 0 ? sty[at]._object : null;
        rdHeadPop(b, prev, function (object) {
          if (ver !== version) {
            toast(I18n.t('cadeditor.ui.kit2.text_changed_re_select_place'), 'info');
            return;
          }
          sel = keep;
          var style = at >= 0 ? runStyleOf(sty[at]) : { color: 'white' };
          insertObject(object, style);
        });
      }
    )
  );
  /* 翻译键（translate + 可选 fallback / 参数）：游戏按玩家的语言显示 */
  bar.appendChild(
    tb(
      'translate' + (codes ? ' dis' : ''),
      uiIcon('globe', 12),
      codes ? RD_CODES_WHY : I18n.t('cadeditor.ui.textobj.translate'),
      function (b) {
        if (codes) {
          toast(RD_CODES_WHY, 'info', 'rd-codes');
          return;
        }
        var at = selObject('translate'),
          keep = { s: sel.s, e: sel.e },
          ver = version,
          prev = at >= 0 ? sty[at]._object : null;
        rdTranslatePop(b, prev, function (object) {
          if (ver !== version) {
            toast(I18n.t('cadeditor.ui.kit2.text_changed_re_select_place'), 'info');
            return;
          }
          sel = keep;
          insertObject(object, at >= 0 ? runStyleOf(sty[at]) : styleAt(sel.s));
        });
      }
    )
  );
  /* 点击 / 悬停事件与插入文本：作用于选中的字（没选中 = 全部） */
  var eventB = tb(
    'event' + (codes ? ' dis' : ''),
    uiIcon('link', 12),
    codes ? RD_CODES_WHY : I18n.t('cadeditor.ui.textevent.title'),
    function () {
      if (codes) {
        toast(RD_CODES_WHY, 'info', 'rd-codes');
        return;
      }
      wholeIfEmpty();
      var keep = { s: sel.s, e: sel.e },
        ver = version,
        list = selStyles();
      var cur = {},
        mixed = false;
      ['click_event', 'hover_event', 'insertion'].forEach(function (k) {
        var v = rdUniform(list, k);
        if (v === undefined)
          mixed =
            mixed ||
            list.some(function (s) {
              return s[k] !== undefined;
            });
        else cur[k] = v;
      });
      kTextEventDialog({
        click: cur.click_event,
        hover: cur.hover_event,
        insertion: cur.insertion,
        mixed: mixed,
        sign: o.paper === 'sign',
        onApply: function (r) {
          if (ver !== version) {
            toast(I18n.t('cadeditor.ui.kit2.text_changed_re_select_place'), 'info');
            return;
          }
          sel = keep;
          patch(function (s) {
            ['click_event', 'hover_event', 'insertion'].forEach(function (k) {
              if (r[k] === undefined) return;
              if (r[k] === null) delete s[k];
              else s[k] = clone(r[k]);
            });
            return s;
          });
        }
      });
    }
  );
  bar.appendChild(eventB);
  function nearestColor(hx) {
    var v = parseInt(hx.replace('#', ''), 16),
      best = null,
      bd = 1e9;
    mcColors().forEach(function (c) {
      var p = parseInt(c[1], 16),
        d = 0;
      [16, 8, 0].forEach(function (sh) {
        var x = ((v >> sh) & 255) - ((p >> sh) & 255);
        d += x * x;
      });
      if (d < bd) {
        bd = d;
        best = c[0];
      }
    });
    return best;
  }
  var gradB = null;
  /* 书与笔的渐变：两点、逐字换成最接近的 16 色 */
  function gradientPop(anchor) {
    wholeIfEmpty();
    var keep = { s: sel.s, e: sel.e },
      c1 = '#FF5555',
      c2 = '#5555FF';
    var box = h('div', { class: 'k-pickbox' });
    box.appendChild(kHint(I18n.t('cadeditor.ui.kit2.only_16_color_closest_word')));
    box.appendChild(kHint(I18n.t('cadeditor.ui.kit2.start')));
    box.appendChild(
      kColor(0xff5555, function (v) {
        c1 = hex6(v);
      }).el
    );
    box.appendChild(kHint(I18n.t('cadeditor.ui.kit2.end')));
    box.appendChild(
      kColor(0x5555ff, function (v) {
        c2 = hex6(v);
      }).el
    );
    box.appendChild(
      kBtn(
        I18n.t(
          'cadeditor.ui.kit2.apply',
          keep.s === 0 && keep.e === text.length
            ? I18n.t('cadeditor.ui.kit2.all_text')
            : I18n.t('cadeditor.ui.kit2.selected_text')
        ),
        function () {
          var idx = [];
          for (var i = keep.s; i < keep.e; i++) if (text.charAt(i) !== '\n' && !(sty[i] && sty[i]._object)) idx.push(i);
          if (idx.length > 256) {
            toast(I18n.t('cadeditor.ui.kit2.gradual_maximum_256_word'), 'error');
            return;
          }
          idx.forEach(function (i, k) {
            var s = clone(sty[i] || {});
            var hx = lerpHex(c1, c2, idx.length > 1 ? k / (idx.length - 1) : 0);
            s.color = nearestColor(hx) || hx;
            sty[i] = s;
          });
          kPopClose();
          sel = keep;
          emit();
          highlight();
          paintBar();
          refocus();
        },
        { cls: 'pri' }
      )
    );
    kPopover(anchor, box, { width: 280, maxHeight: 360 });
  }
  function codePop(anchor) {
    var src = h('textarea', {
      class: 'k-input ed-code-in',
      spellcheck: 'false',
      placeholder: codes ? I18n.t('cadeditor.ui.kit2.gold_bold') : I18n.t('cadeditor.ui.kit2.n6gold_lbold')
    });
    src.value = rdCodes(rdRuns(text, sty));
    src.setAttribute('style', 'height:140px');
    var grip = h('div', { class: 'k-pop-grip', title: I18n.t('cadeditor.ui.kit2.drag_resize') });
    var apply = kBtn(
      codes ? I18n.t('cadeditor.ui.kit2.use_raw_text') : I18n.t('cadeditor.ui.kit2.import'),
      function () {
        var nt = { text: '', sty: [] };
        rdFromRuns(parseCodes(src.value, codes), nt);
        if (!multi) {
          nt.text = nt.text.replace(/\n/g, '');
          nt.sty = nt.sty.slice(0, nt.text.length);
        }
        kPopClose();
        sel = { s: 0, e: text.length };
        replaceSel(nt.text, nt.sty);
      },
      { cls: 'pri' }
    );
    var pop = kPopover(
      anchor,
      h('div', { class: 'k-pickbox' }, [
        codes ? kHint(I18n.t('cadeditor.ui.kit2.original_text_saved_page_code')) : null,
        src,
        h('div', { class: 'k-pop-foot' }, [apply, grip])
      ]),
      { width: 400, maxHeight: 520 }
    );
    grip.addEventListener('mousedown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var scale = uiScaleFactor(),
        vp = uiViewport(),
        pr = pop.getBoundingClientRect(),
        sx = e.clientX,
        sy = e.clientY;
      var w0 = pr.width / scale,
        h0 = src.getBoundingClientRect().height / scale,
        left = pr.left / scale;
      var st = String(pop.getAttribute('style') || '').replace(/(^|;)\s*(width|max-height)\s*:[^;]*/g, '');
      dragTrack(e, function (ev) {
        var w = clampN(w0 + (ev.clientX - sx) / scale, 220, Math.max(220, vp.width - left - 8));
        var hh = clampN(h0 + (ev.clientY - sy) / scale, 60, Math.max(60, vp.height - 120));
        src.setAttribute('style', 'height:' + Math.round(hh) + 'px');
        pop.setAttribute(
          'style',
          st + ';width:' + Math.round(w) + 'px;max-height:' + Math.round(vp.height - 16) + 'px'
        );
      });
    });
  }
  gradB = tb(
    'grad',
    uiIcon('palette', 12),
    I18n.t('cadeditor.ui.kit2.gradient_color_text_selected_page'),
    function (b) {
      colorPick(b, 'text', 'gradient');
    }
  );
  bar.appendChild(gradB);
  var more = tb('more', uiIcon('menu', 12), I18n.t('cadeditor.ui.kit2.codes_clear_formatting'), function (b) {
    var r = b.getBoundingClientRect();
    kMenu(
      r.left,
      r.bottom + 2,
      [
        {
          label: codes
            ? I18n.t('cadeditor.ui.kit2.view_edit_raw_text')
            : I18n.t('cadeditor.ui.kit2.code_import_export'),
          icon: 'code',
          run: function () {
            codePop(more);
          }
        },
        { sep: 1 },
        {
          label: I18n.t('cadeditor.ui.kit2.clear_formatting'),
          icon: 'restore',
          run: function () {
            wholeIfEmpty();
            patch(function (s) {
              return s._object ? { _object: s._object } : {};
            });
          }
        }
      ].filter(Boolean)
    );
  });
  bar.appendChild(more);
  bar.appendChild(count);
  function paintBar() {
    var list = selStyles();
    RD_FLAGS.forEach(function (f) {
      flagB[f[0]].classList.toggle(
        'on',
        list.every(function (s) {
          return eff(s, f[0]);
        })
      );
    });
    var colors = list.map(function (s) {
        return s.color || '';
      }),
      same = colors.every(function (c) {
        return c === colors[0];
      });
    var hx = same ? tcHex(colors[0]) || tcHex(def.color) || '' : '';
    chip.className = 'k-rdsw' + (same ? '' : ' mixed') + (same && !colors[0] ? ' def' : '');
    chip.setAttribute('style', hx ? 'background:' + hx : '');
    setTip(
      colorB,
      I18n.t(
        'cadeditor.ui.kit2.text_colour',
        !same
          ? I18n.t('cadeditor.ui.kit2.mixed')
          : colors[0]
            ? mcColors()
                .filter(function (c) {
                  return c[0] === colors[0];
                })
                .map(function (c) {
                  return c[2];
                })[0] || colors[0]
            : I18n.t('cadeditor.ui.common.default')
      )
    );
    if (codes) return;
    /* 阴影色块：一致就画出来（含透明度），不一致画混合，没有阴影色画默认 */
    var shadow = rdUniform(list, 'shadow_color'),
      shc = shadow === undefined || shadow === null ? null : CP.fromArgb(shadow);
    shChip.className =
      'k-rdsw k-rdsh' +
      (shadow === undefined &&
      list.some(function (s) {
        return s.shadow_color !== undefined;
      })
        ? ' mixed'
        : shc
          ? ''
          : ' def');
    shChip.setAttribute(
      'style',
      shc
        ? 'background:rgba(' +
            ((shc.rgb >> 16) & 255) +
            ',' +
            ((shc.rgb >> 8) & 255) +
            ',' +
            (shc.rgb & 255) +
            ',' +
            (shc.a / 255).toFixed(3) +
            ')'
        : ''
    );
    setTip(
      shadowB,
      I18n.t(
        'cadeditor.ui.textstyle.shadow_is',
        shc
          ? CP.hex8(shc.a, shc.rgb)
          : shadow === undefined && shChip.classList.contains('mixed')
            ? I18n.t('cadeditor.ui.kit2.mixed')
            : I18n.t('cadeditor.ui.common.default')
      )
    );
    var fonts = list.map(function (s) {
      return s.font || '';
    });
    fontB.classList.toggle(
      'on',
      fonts.some(function (f) {
        return f !== '';
      })
    );
    setTip(
      fontB,
      I18n.t(
        'cadeditor.ui.textstyle.font_is',
        fonts.every(function (f) {
          return f === fonts[0];
        })
          ? fonts[0] || 'minecraft:default'
          : I18n.t('cadeditor.ui.kit2.mixed')
      )
    );
    eventB.classList.toggle(
      'on',
      list.some(function (s) {
        return s.click_event !== undefined || s.hover_event !== undefined || s.insertion !== undefined;
      })
    );
  }

  /* aside：放在输入框右边、和它等高的预览（书页）；两边按滚动比例同步 */
  /* 原生输入框画不了图：精灵图在输入框里占一个（透明的）◆，真图标盖在它上面。
     位置由一个看不见的镜像量出来：同样的宽度、字体、折行，◆ 落在哪就把图标放在哪 */
  var sprLayer = h('div', { class: 'k-rdspr' }),
    sprIn = h('div', { class: 'k-rdsprin' }),
    mirror = h('div', { class: 'k-rdmirror' });
  sprIn.appendChild(mirror);
  sprLayer.appendChild(sprIn);
  var tawrap = h('div', { class: 'k-rdtaw' }, [ta, sprLayer]);
  var sprKey = '',
    sprTimer = null,
    sprWaited = 0;
  function hasObjects() {
    for (var i = 0; i < sty.length; i++) if (sty[i] && sty[i]._object) return true;
    return false;
  }
  var shownTop = -1,
    shownLeft = -1;
  function sprShift() {
    shownTop = ta.scrollTop || 0;
    shownLeft = ta.scrollLeft || 0;
    sprIn.setAttribute('style', 'left:' + -shownLeft + 'px;top:' + -shownTop + 'px');
  }
  function placeSprites() {
    if (codes) return;
    if (!hasObjects()) {
      if (sprOn) {
        sprOn = false;
        highlight();
      }
      clear(sprIn);
      clear(mirror);
      sprKey = '';
      return;
    }
    if (!document.body.contains || !document.body.contains(wrap)) return;
    var cw = ta.clientWidth,
      scale = typeof uiScaleFactor === 'function' ? uiScaleFactor() : 1;
    if (!cw) return;
    /* 镜像：和输入框同宽、同字体、同折行，文字透明，只有图标可见。
       图标和普通字排在同一行（基线、行高和右边预览一模一样），外面套一个和占位符 ◆ 一样宽的盒子，这样折行和位置不会错 */
    clear(mirror);
    mirror.setAttribute('style', 'width:' + cw + 'px');
    var probe = h('span', { text: RD_MARK });
    mirror.appendChild(probe);
    var mw = Math.round((probe.getBoundingClientRect().width / scale) * 100) / 100;
    clear(mirror);
    if (!(mw > 0)) return;
    var from = 0;
    for (var i = 0; i < text.length; i++)
      if (sty[i] && sty[i]._object) {
        if (i > from) mirror.appendChild(h('span', { text: text.slice(from, i) }));
        var box = h('span');
        if (tcObjKind(sty[i]._object) === 'atlas') {
          var run = runStyleOf(sty[i]);
          run.text = RD_OBJ;
          run._object = clone(sty[i]._object);
          renderRuns(box, {}, [run], def);
        } else box.appendChild(rdObjIcon(sty[i]._object));
        box.setAttribute(
          'style',
          'display:inline-block;width:' +
            mw +
            'px;white-space:pre;position:relative;top:' +
            (typeof UI !== 'undefined' && UI.font === 'smooth' ? SPR_DY : 0) +
            'px'
        );
        mirror.appendChild(box);
        from = i + 1;
      }
    if (from < text.length) mirror.appendChild(h('span', { text: text.slice(from) }));
    sprShift();
    sprKey = cw + ',' + ta.clientHeight + ',' + version;
    if (!sprOn) {
      sprOn = true;
      highlight();
    }
  }
  function scheduleSprites() {
    if (codes) return;
    [0, 120, 500].forEach(function (ms) {
      setTimeout(placeSprites, ms);
    });
    if (sprTimer) return;
    sprTimer = setInterval(function () {
      var attached = document.body.contains && document.body.contains(wrap);
      if (!attached) {
        if (++sprWaited > 200) {
          clearInterval(sprTimer);
          sprTimer = null;
        }
        return;
      }
      sprWaited = 0;
      if (!hasObjects()) return;
      if (sprKey !== ta.clientWidth + ',' + ta.clientHeight + ',' + version) placeSprites();
      else if ((ta.scrollTop || 0) !== shownTop || (ta.scrollLeft || 0) !== shownLeft) sprShift();
    }, 80);
  }
  ta.addEventListener('scroll', sprShift);
  var edit = h('div', { class: 'k-rdedit' }, [
    bar,
    o.aside ? h('div', { class: 'k-rdbody' }, [tawrap, o.aside]) : tawrap
  ]);
  if (o.aside) {
    var syncing = false,
      scroller = o.asideScroll || o.aside;
    var follow = function (from, to) {
      if (syncing) return;
      var span = from.scrollHeight - from.clientHeight,
        r = span > 0 ? from.scrollTop / span : 0;
      syncing = true;
      to.scrollTop = Math.round(r * Math.max(0, to.scrollHeight - to.clientHeight));
      syncing = false;
    };
    ta.addEventListener('scroll', function () {
      follow(ta, scroller);
    });
    scroller.addEventListener('scroll', function () {
      follow(scroller, ta);
    });
    followAside = function () {
      follow(ta, scroller);
    };
  }
  if (prev) wrap.appendChild(prev);
  wrap.appendChild(edit);
  var openKey = o.openKey || 'rich',
    open = !o.compact || !!UIOpen[openKey];
  function sync() {
    edit.style.display = open ? 'flex' : 'none';
    wrap.classList.toggle('open', open);
  }
  if (o.compact && prev) {
    prev.classList.add('click');
    setTip(prev, I18n.t('cadeditor.ui.kit2.click_expand_editor'));
    prev.addEventListener('click', function () {
      open = !open;
      UIOpen[openKey] = open;
      sync();
      if (open) refocus();
    });
  }
  sync();
  api = {
    el: wrap,
    textarea: ta,
    recount: function () {
      paintCount(curValue());
    },
    runs: function () {
      return rdRuns(text, sty);
    },
    lineRuns: function () {
      var out = [],
        start = 0;
      for (var i = 0; i <= text.length; i++)
        if (i === text.length || text.charAt(i) === '\n') {
          out.push(rdRuns(text, sty, start, i));
          start = i + 1;
        }
      return out;
    },
    focus: function () {
      open = true;
      sync();
      sel = { s: text.length, e: text.length };
      refocus();
    },
    length: function () {
      return text.length;
    },
    caretPos: function () {
      readSel();
      return sel.e;
    },
    setCaret: function (p) {
      p = Math.max(0, Math.min(text.length, p));
      sel = { s: p, e: p };
      refocus(0);
    },
    slice: function (a, b) {
      return { text: text.slice(a, b), sty: sty.slice(a, b) };
    },
    set: function (v) {
      var l = rdLoad(v, codes, n);
      if (!l) return;
      version++;
      text = l.text;
      sty = l.sty;
      pending = null;
      sel = { s: Math.min(sel.s, text.length), e: Math.min(sel.e, text.length) };
      if (ta.value !== text) ta.value = text;
      highlight();
      paintBar();
      rendered();
    }
  };
  highlight();
  paintBar();
  rendered();
  return api;
}
/* 旧接口：名称、说明文字等单行文字 */
function kRich(value, o) {
  o = o || {};
  return kRichDoc(value, {
    compact: o.compact,
    openKey: o.openKey,
    placeholder: o.placeholder,
    def: o.def,
    onChange: o.onChange
  });
}

/* ---------- 插入玩家头像 / 翻译键、点击与悬停事件窗口 ---------- */
/* 玩家头像：prev 是正在编辑的头像对象（没有就是插入新的）。onPick(对象) */
function rdHeadPop(anchor, prev, onPick) {
  var form = rdProfileForm(prev ? prev.player : null),
    mode = form.mode,
    hat = !(prev && prev.hat === false);
  var input = h('input', { class: 'k-input', type: 'text', spellcheck: 'false' });
  input.value = form.input;
  var err = h('div', { class: 'k-numerr' });
  function placeholder() {
    input.setAttribute(
      'placeholder',
      mode === 'name'
        ? I18n.t('cadeditor.ui.textobj.head_name_ph')
        : mode === 'uuid'
          ? '00000000-0000-0000-0000-000000000000'
          : I18n.t('cadeditor.ui.textobj.head_texture_ph')
    );
  }
  var seg = kSeg(
    [
      { v: 'name', label: I18n.t('cadeditor.ui.textobj.head_by_name') },
      { v: 'uuid', label: 'UUID' },
      { v: 'texture', label: I18n.t('cadeditor.ui.textobj.head_by_texture') }
    ],
    mode,
    function (m) {
      mode = m;
      err.textContent = '';
      placeholder();
    }
  );
  var hatT = kToggle(
    hat,
    function (v) {
      hat = v;
    },
    I18n.t('cadeditor.ui.textobj.head_hat')
  );
  var ok = kBtn(
    prev ? I18n.t('cadeditor.ui.textobj.update') : I18n.t('cadeditor.ui.textobj.insert'),
    function () {
      var player;
      try {
        player = rdPlayerProfile(mode, input.value);
      } catch (e) {
        err.textContent = e.message;
        return;
      }
      var obj = prev ? clone(prev) : {};
      obj.object = 'player';
      obj.player = player;
      if (hat) delete obj.hat;
      else obj.hat = false;
      kPopClose();
      onPick(obj);
    },
    { cls: 'pri' }
  );
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      ok.click();
    }
  });
  placeholder();
  kPopover(
    anchor,
    h('div', { class: 'k-pickbox rd-objpop' }, [
      seg.el,
      input,
      err,
      hatT.el,
      kHint(I18n.t('cadeditor.ui.textobj.head_note')),
      h('div', { class: 'k-pop-foot' }, [h('div', { class: 'grow' }), ok])
    ]),
    { width: 380 }
  );
  setTimeout(function () {
    if (input.focus) input.focus();
  }, 0);
}
/* 翻译键：键名必填；回退文字和参数可留空。原来带的非文字参数（文本组件、数字）原样保留，不在这里改 */
function rdTranslatePop(anchor, prev, onPick) {
  var key = h('input', {
      class: 'k-input',
      type: 'text',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.textobj.key_ph')
    }),
    fb = h('input', {
      class: 'k-input',
      type: 'text',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.textobj.fallback_ph')
    });
  key.value = prev ? prev.translate : '';
  fb.value = prev && typeof prev.fallback === 'string' ? prev.fallback : '';
  var args = prev && Array.isArray(prev['with']) ? prev['with'].slice() : [],
    complex = args.some(function (a) {
      return typeof a !== 'string';
    });
  var argBox = h('div', { class: 'rd-args' }),
    err = h('div', { class: 'k-numerr' });
  function paintArgs() {
    clear(argBox);
    if (complex) {
      argBox.appendChild(kHint(I18n.t('cadeditor.ui.textobj.args_kept', args.length)));
      return;
    }
    args.forEach(function (a, i) {
      var inp = h('input', {
        class: 'k-input',
        type: 'text',
        spellcheck: 'false',
        placeholder: I18n.t('cadeditor.ui.textobj.arg_ph')
      });
      inp.value = a;
      inp.addEventListener('input', function () {
        args[i] = inp.value;
      });
      var rm = h('div', { class: 'k-mini del', text: '×', title: I18n.t('cadeditor.ui.common.delete') });
      activate(rm, function () {
        args.splice(i, 1);
        paintArgs();
      });
      argBox.appendChild(
        h('div', { class: 'k-row rd-arg' }, [h('span', { class: 'k-sub', text: '%' + (i + 1) + '$s' }), inp, rm])
      );
    });
    argBox.appendChild(
      kBtn(
        I18n.t('cadeditor.ui.textobj.add_arg'),
        function () {
          args.push('');
          paintArgs();
        },
        { icon: 'plus' }
      )
    );
  }
  paintArgs();
  var ok = kBtn(
    prev ? I18n.t('cadeditor.ui.textobj.update') : I18n.t('cadeditor.ui.textobj.insert'),
    function () {
      var obj;
      try {
        obj = rdTranslateObject(key.value, fb.value, complex ? null : args, prev);
      } catch (e) {
        err.textContent = e.message;
        return;
      }
      kPopClose();
      onPick(obj);
    },
    { cls: 'pri' }
  );
  kPopover(
    anchor,
    h('div', { class: 'k-pickbox rd-objpop' }, [
      key,
      fb,
      argBox,
      err,
      h('div', { class: 'k-pop-foot' }, [h('div', { class: 'grow' }), ok])
    ]),
    { width: 380, maxHeight: 420 }
  );
  setTimeout(function () {
    if (key.focus) key.focus();
  }, 0);
}
function rdClickLabel(a) {
  return {
    open_url: I18n.t('cadeditor.ui.textevent.click_open_url'),
    run_command: I18n.t('cadeditor.ui.textevent.click_run_command'),
    suggest_command: I18n.t('cadeditor.ui.textevent.click_suggest_command'),
    change_page: I18n.t('cadeditor.ui.textevent.click_change_page'),
    copy_to_clipboard: I18n.t('cadeditor.ui.textevent.click_copy_to_clipboard'),
    show_dialog: I18n.t('cadeditor.ui.textevent.click_show_dialog'),
    custom: I18n.t('cadeditor.ui.textevent.click_custom')
  }[a];
}
function rdHoverLabel(a) {
  return {
    show_text: I18n.t('cadeditor.ui.textevent.hover_show_text'),
    show_item: I18n.t('cadeditor.ui.textevent.hover_show_item'),
    show_entity: I18n.t('cadeditor.ui.textevent.hover_show_entity')
  }[a];
}
/* 点击事件、悬停事件、插入文本的编辑窗口（叠在当前窗口上）。
   o = { click, hover, insertion（现值，可缺）, mixed（所选文字的事件不一致）, sign（告示牌）, onApply(r) }
   r 的每个键：undefined = 没动，null = 去掉，其他 = 新值 */
function kTextEventDialog(o) {
  var click = o.click ? clone(o.click) : null,
    hover = o.hover ? clone(o.hover) : null;
  var clickAction = click ? (RD_CLICK_ACTIONS.indexOf(click.action) >= 0 ? click.action : 'raw') : '',
    hoverAction = hover ? (RD_HOVER_ACTIONS.indexOf(hover.action) >= 0 ? hover.action : 'raw') : '';
  var touched = { click: false, hover: false, insertion: false };
  var cf = {
    url: click && click.url,
    command: click && click.command,
    page: click && click.page,
    value: click && click.value,
    dialog: click && click.dialog,
    id: click && click.id,
    payload: click && click.payload
  };
  var hf = {
    value: hover && hover.action === 'show_text' ? hover.value : '',
    id: hover && hover.id,
    count: hover && hover.count,
    uuid: hover ? (Array.isArray(hover.uuid) ? rdUuidText(hover.uuid) : hover.uuid) : '',
    name: hover && hover.name
  };
  var detach = [],
    err = h('div', { class: 'ed-err' });
  function field(label, control, extra) {
    return h(
      'div',
      { class: 'k-row rd-evf' },
      [h('span', { class: 'k-sub rd-evl', text: label }), control].concat(extra || [])
    );
  }
  function textIn(value, onInput, ph) {
    var inp = h('input', { class: 'k-input', type: 'text', spellcheck: 'false', placeholder: ph || '' });
    inp.value = value === undefined || value === null ? '' : String(value);
    inp.addEventListener('input', function () {
      onInput(inp.value);
    });
    return inp;
  }
  /* ---- 点击 ---- */
  var clickBody = h('div', { class: 'rd-evb' }),
    dialogSnbt = null,
    payloadSnbt = null;
  function paintClick() {
    detach.forEach(function (fn) {
      fn();
    });
    detach = [];
    clear(clickBody);
    dialogSnbt = payloadSnbt = null;
    var a = clickAction;
    if (!a) return;
    if (a === 'raw') {
      clickBody.appendChild(kHint(I18n.t('cadeditor.ui.textevent.unknown_kept', String(click.action))));
      clickBody.appendChild(h('div', { class: 'k-sub rd-raw', text: toSnbt(click, null, true) }));
      return;
    }
    if ((a === 'run_command' || a === 'custom') && rdCommandClicksBlocked())
      clickBody.appendChild(kHint(I18n.t('cadeditor.ui.textevent.server_blocks_commands'), 'err'));
    function upd(k) {
      return function (v) {
        cf[k] = v;
        touched.click = true;
      };
    }
    if (a === 'open_url')
      clickBody.appendChild(field(I18n.t('cadeditor.ui.textevent.url'), textIn(cf.url, upd('url'), 'https://')));
    else if (a === 'run_command' || a === 'suggest_command') {
      var ta = h('textarea', {
        class: 'k-input rd-cmd',
        spellcheck: 'false',
        rows: '2',
        placeholder: I18n.t('cadeditor.ui.textevent.command_ph')
      });
      ta.value = cf.command === undefined || cf.command === null ? '' : String(cf.command);
      ta.addEventListener('input', function () {
        cf.command = ta.value;
        touched.click = true;
      });
      var host = h('div', { class: 'rd-cmdassist' });
      clickBody.appendChild(field(I18n.t('cadeditor.ui.textevent.command'), ta));
      clickBody.appendChild(host);
      if (typeof CommandAssist !== 'undefined' && CommandAssist.attach) {
        var off = CommandAssist.attach(ta, {
          host: host,
          onApply: function (t) {
            cf.command = t;
            touched.click = true;
          }
        });
        if (typeof off === 'function') detach.push(off);
      }
    } else if (a === 'change_page')
      clickBody.appendChild(field(I18n.t('cadeditor.ui.textevent.page'), textIn(cf.page, upd('page'), '1')));
    else if (a === 'copy_to_clipboard')
      clickBody.appendChild(field(I18n.t('cadeditor.ui.textevent.copy_value'), textIn(cf.value, upd('value'))));
    else if (a === 'show_dialog') {
      if (cf.dialog !== undefined && cf.dialog !== null && typeof cf.dialog === 'object') {
        dialogSnbt = h('textarea', { class: 'k-input rd-snbt', spellcheck: 'false', rows: '4' });
        dialogSnbt.value = toSnbt(cf.dialog, null, true);
        dialogSnbt.addEventListener('input', function () {
          touched.click = true;
        });
        clickBody.appendChild(kHint(I18n.t('cadeditor.ui.textevent.inline_dialog')));
        clickBody.appendChild(dialogSnbt);
      } else {
        var did = textIn(cf.dialog, upd('dialog'), 'minecraft:…');
        var pick = kBtn(
          I18n.t('cadeditor.ui.forms.select'),
          function () {
            openRegPick({
              reg: 'dialog',
              current: cf.dialog || '',
              title: I18n.t('cadeditor.ui.textevent.click_show_dialog'),
              onPick: function (id) {
                cf.dialog = id;
                did.value = id;
                touched.click = true;
              }
            });
          },
          { icon: 'grid' }
        );
        clickBody.appendChild(field(I18n.t('cadeditor.ui.textevent.dialog'), did, [pick]));
      }
    } else if (a === 'custom') {
      clickBody.appendChild(field('ID', textIn(cf.id, upd('id'), 'namespace:path')));
      payloadSnbt = h('textarea', {
        class: 'k-input rd-snbt',
        spellcheck: 'false',
        rows: '3',
        placeholder: I18n.t('cadeditor.ui.textevent.payload_ph')
      });
      payloadSnbt.value = cf.payload === undefined || cf.payload === null ? '' : toSnbt(cf.payload, null, true);
      payloadSnbt.addEventListener('input', function () {
        touched.click = true;
      });
      clickBody.appendChild(field(I18n.t('cadeditor.ui.textevent.payload'), payloadSnbt));
    }
  }
  var clickTiles = kTiles(
    [{ v: '', label: I18n.t('cadeditor.ui.common.none') }]
      .concat(
        RD_CLICK_ACTIONS.map(function (a) {
          return { v: a, label: rdClickLabel(a) };
        })
      )
      .concat(clickAction === 'raw' ? [{ v: 'raw', label: String(click.action) }] : []),
    clickAction,
    function (v) {
      clickAction = v;
      touched.click = v !== 'raw';
      paintClick();
    }
  );
  /* ---- 悬停 ---- */
  var hoverBody = h('div', { class: 'rd-evb' });
  function paintHover() {
    clear(hoverBody);
    var a = hoverAction;
    if (!a) return;
    if (o.sign) hoverBody.appendChild(kHint(I18n.t('cadeditor.ui.textevent.sign_no_hover')));
    if (a === 'raw') {
      hoverBody.appendChild(kHint(I18n.t('cadeditor.ui.textevent.unknown_kept', String(hover.action))));
      hoverBody.appendChild(h('div', { class: 'k-sub rd-raw', text: toSnbt(hover, null, true) }));
      return;
    }
    if (a === 'show_text') {
      var ed = kRichDoc(hf.value === undefined ? '' : hf.value, {
        multiline: true,
        placeholder: I18n.t('cadeditor.ui.textevent.hover_text_ph'),
        height: 60,
        onChange: function (v) {
          hf.value = v;
          touched.hover = true;
        }
      });
      if (ed) hoverBody.appendChild(ed.el);
    } else if (a === 'show_item') {
      var item = kRegSelect({
        reg: 'item',
        value: hf.id || '',
        title: I18n.t('cadeditor.ui.textevent.hover_show_item'),
        onChange: function (v) {
          hf.id = v;
          touched.hover = true;
        }
      });
      hoverBody.appendChild(field(I18n.t('cadeditor.ui.textevent.item'), item.el));
      hoverBody.appendChild(
        field(
          I18n.t('cadeditor.ui.textevent.count'),
          textIn(
            hf.count,
            function (v) {
              hf.count = v;
              touched.hover = true;
            },
            '1'
          )
        )
      );
      if (hover && hover.action === 'show_item' && isObj(hover.components) && Object.keys(hover.components).length)
        hoverBody.appendChild(
          kHint(I18n.t('cadeditor.ui.textevent.components_kept', Object.keys(hover.components).length))
        );
    } else if (a === 'show_entity') {
      var ent = kRegSelect({
        reg: 'entity_type',
        value: hf.id || '',
        title: I18n.t('cadeditor.ui.textevent.hover_show_entity'),
        onChange: function (v) {
          hf.id = v;
          touched.hover = true;
        }
      });
      var uuid = textIn(
        hf.uuid,
        function (v) {
          hf.uuid = v;
          touched.hover = true;
        },
        '00000000-0000-0000-0000-000000000000'
      );
      var rnd = kBtn(
        '',
        function () {
          hf.uuid = rdRandomUuid();
          uuid.value = hf.uuid;
          touched.hover = true;
        },
        { icon: 'shuffle', title: I18n.t('cadeditor.ui.textevent.random_uuid') }
      );
      var name = kRich(hf.name === undefined ? '' : hf.name, {
        placeholder: I18n.t('cadeditor.ui.textevent.entity_name_ph'),
        onChange: function (v, empty) {
          hf.name = empty ? undefined : v;
          touched.hover = true;
        }
      });
      hoverBody.appendChild(field(I18n.t('cadeditor.ui.textevent.entity'), ent.el));
      hoverBody.appendChild(field('UUID', uuid, [rnd]));
      hoverBody.appendChild(field(I18n.t('cadeditor.ui.textevent.entity_name'), name.el));
    }
  }
  var hoverTiles = kTiles(
    [{ v: '', label: I18n.t('cadeditor.ui.common.none') }]
      .concat(
        RD_HOVER_ACTIONS.map(function (a) {
          return { v: a, label: rdHoverLabel(a) };
        })
      )
      .concat(hoverAction === 'raw' ? [{ v: 'raw', label: String(hover.action) }] : []),
    hoverAction,
    function (v) {
      hoverAction = v;
      touched.hover = v !== 'raw';
      paintHover();
    }
  );
  var ins = h('input', {
    class: 'k-input',
    type: 'text',
    spellcheck: 'false',
    placeholder: I18n.t('cadeditor.ui.textevent.insertion_ph')
  });
  ins.value = typeof o.insertion === 'string' ? o.insertion : '';
  ins.addEventListener('input', function () {
    touched.insertion = true;
  });
  function finish(r) {
    detach.forEach(function (fn) {
      fn();
    });
    detach = [];
    closeModal();
    o.onApply(r);
  }
  function apply() {
    var r = {};
    err.textContent = '';
    try {
      if (touched.click) {
        if (!clickAction) r.click_event = null;
        else if (clickAction !== 'raw') {
          if (dialogSnbt) cf.dialog = parseSnbtUser(dialogSnbt.value);
          if (payloadSnbt) cf.payload = payloadSnbt.value.trim() ? parseSnbtUser(payloadSnbt.value) : '';
          r.click_event = rdClickEvent(clickAction, cf, click);
        }
      }
      if (touched.hover) {
        if (!hoverAction) r.hover_event = null;
        else if (hoverAction !== 'raw') r.hover_event = rdHoverEvent(hoverAction, hf, hover);
      }
      if (touched.insertion) r.insertion = ins.value === '' ? null : ins.value;
    } catch (e) {
      err.textContent = e.message || String(e);
      return;
    }
    finish(r);
  }
  var body = h('div', { class: 'k-mb rd-ev' }, [
    o.mixed ? kHint(I18n.t('cadeditor.ui.textevent.mixed'), 'hint') : null,
    h('div', { class: 'rd-evh' }, [uiIcon('mouse', 12), h('b', { text: I18n.t('cadeditor.ui.textevent.click') })]),
    clickTiles.el,
    clickBody,
    h('div', { class: 'rd-evh' }, [uiIcon('eye', 12), h('b', { text: I18n.t('cadeditor.ui.textevent.hover') })]),
    hoverTiles.el,
    hoverBody,
    h('div', { class: 'rd-evh' }, [uiIcon('chat', 12), h('b', { text: I18n.t('cadeditor.ui.textevent.insertion') })]),
    field(I18n.t('cadeditor.ui.textevent.insertion_text'), ins),
    err
  ]);
  var foot = h('div', { class: 'k-mf' }, [
    kBtn(
      I18n.t('cadeditor.ui.textevent.remove_all'),
      function () {
        finish({ click_event: null, hover_event: null, insertion: null });
      },
      { icon: 'trash', cls: 'dng' }
    ),
    h('div', { class: 'grow' }),
    kBtn(I18n.t('cadeditor.ui.common.cancel'), function () {
      detach.forEach(function (fn) {
        fn();
      });
      detach = [];
      closeModal();
    }),
    kBtn(I18n.t('cadeditor.ui.colorpicker.apply'), apply, { cls: 'pri' })
  ]);
  var win = modalShell({
    icon: 'link',
    title: I18n.t('cadeditor.ui.textevent.title'),
    sub: '',
    cls: 'rd-evwin',
    body: body,
    foot: foot
  });
  paintClick();
  paintHover();
  var mask = openModal(win, true);
  if (mask)
    mask.onEditorClose = function () {
      detach.forEach(function (fn) {
        fn();
      });
      detach = [];
    };
  return win;
}

/* ---------- 书本编辑器（成书 / 书与笔共用） ----------
   一次编辑一页：工具栏在上；左边写字，右边是同高的书页预览，两边滚动同步。
   页脚一行：左边是本页操作（插入、复制、删除），中间是居中的页码（页多时折叠成 1 … 5 6 [7] 8 9 … 100，点 … 跳页），右边是页数。
   右键页码可移动、复制、插入或删除那一页；PageUp / PageDown 翻页。
   o = { kind: 'written'|'writable', get(): 页数组, save(pages, label), maxPages(), maxChars()（undefined=读取中、null=没有上限）, key }
   页可以是 {raw, filtered}（游戏的过滤文本）：只改 raw，filtered 原样保留。 */
function bookFiltered(p) {
  return (
    isObj(p) &&
    p.raw !== undefined &&
    Object.keys(p).every(function (k) {
      return k === 'raw' || k === 'filtered';
    })
  );
}
/* 页码窗口：总数 ≤ 9 全部列出；否则首页、末页、当前页前后各 2 页，中间用 … 代替。返回 [0, '…', 4, 5, 6, …] */
function bookPagerItems(total, at) {
  if (total <= 9) {
    var all = [];
    for (var i = 0; i < total; i++) all.push(i);
    return all;
  }
  var lo = Math.max(1, Math.min(at - 2, total - 6)),
    hi = Math.min(total - 2, Math.max(at + 2, 5)),
    out = [0];
  if (lo > 1) out.push('…');
  for (var j = lo; j <= hi; j++) out.push(j);
  if (hi < total - 2) out.push('…');
  out.push(total - 1);
  return out;
}
function kBookEditor(o) {
  var codes = o.kind === 'writable',
    key = o.key || 'book:' + o.kind;
  var root = h('div', { class: 'k-book' }),
    at = UIOpen[key] || 0,
    seen = '',
    ed = null;
  function pages() {
    var l = o.get();
    return Array.isArray(l) ? clone(l) : [];
  }
  function raw(p) {
    return bookFiltered(p) ? p.raw : p;
  }
  function put(list, label) {
    seen = JSON.stringify(list);
    o.save(list, label);
  }
  function maxPages() {
    return o.maxPages ? o.maxPages() : null;
  }
  function setAt(i, n) {
    at = Math.max(0, Math.min(i, n - 1));
    UIOpen[key] = at;
  }

  var edHost = h('div', { class: 'k-book-ed' });
  var pgBody = h('div', { class: 'k-bookpg-b' }),
    paper = h('div', { class: 'k-bookpg' }, [pgBody]);
  var note = h('div', { class: 'k-book-note' });
  var acts = h('div', { class: 'k-book-acts' }),
    pager = h('div', { class: 'k-book-pager' }),
    info = h('div', { class: 'k-book-info' });
  var foot = h('div', { class: 'k-book-foot' }, [acts, pager, info]);
  root.appendChild(edHost);
  root.appendChild(note);
  root.appendChild(foot);
  root.addEventListener('keydown', function (e) {
    if (e.key === 'PageUp') {
      e.preventDefault();
      go(at - 1);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      go(at + 1);
    }
  });

  function go(i) {
    var l = pages();
    if (!l.length) return;
    i = Math.max(0, Math.min(l.length - 1, i));
    if (i === at) return;
    setAt(i, l.length);
    drawAll(true);
  }
  function insert(i, page) {
    var l = pages(),
      m = maxPages();
    if (typeof m === 'number' && l.length >= m) {
      toast(I18n.t('cadeditor.ui.kit2.book_maximum_page', m), 'error', 'book-max');
      return;
    }
    i = Math.max(0, Math.min(i, l.length));
    l.splice(i, 0, page);
    put(l, I18n.t('cadeditor.ui.kit2.insert_page', i + 1));
    setAt(i, l.length);
    drawAll(true);
  }
  function remove(i) {
    var l = pages();
    if (i < 0 || i >= l.length) return;
    l.splice(i, 1);
    put(l, I18n.t('cadeditor.ui.kit2.delete_page', i + 1));
    setAt(Math.min(at, l.length - 1), l.length);
    drawAll();
  }
  function move(from, to) {
    var l = pages();
    if (to < 0 || to >= l.length || from === to) return;
    var x = l.splice(from, 1)[0];
    l.splice(to, 0, x);
    put(l, I18n.t('cadeditor.ui.kit2.move_page', from + 1));
    setAt(to, l.length);
    drawAll();
  }
  function setPage(v) {
    var l = pages();
    if (at >= l.length) return;
    var p = l[at];
    if (bookFiltered(p)) {
      p = clone(p);
      p.raw = v;
      l[at] = p;
    } else l[at] = v;
    put(l, I18n.t('cadeditor.ui.kit2.modify_page', at + 1));
  }
  function pageMenu(i) {
    var n = pages().length;
    return [
      {
        label: I18n.t('cadeditor.ui.kit2.insert_blank_page_before'),
        icon: 'plus',
        run: function () {
          insert(i, '');
        }
      },
      {
        label: I18n.t('cadeditor.ui.kit2.insert_blank_page_after'),
        icon: 'plus',
        run: function () {
          insert(i + 1, '');
        }
      },
      {
        label: I18n.t('cadeditor.ui.kit2.duplicate_page'),
        icon: 'copy',
        run: function () {
          insert(i + 1, clone(pages()[i]));
        }
      },
      { sep: 1 },
      {
        label: I18n.t('cadeditor.ui.kit2.move_page_back'),
        icon: 'back',
        dis: i === 0,
        run: function () {
          move(i, i - 1);
        }
      },
      {
        label: I18n.t('cadeditor.ui.kit2.move_page_forward'),
        icon: 'forward',
        dis: i >= n - 1,
        run: function () {
          move(i, i + 1);
        }
      },
      {
        label: I18n.t('cadeditor.ui.kit2.move_first_page'),
        icon: 'up',
        dis: i === 0,
        run: function () {
          move(i, 0);
        }
      },
      {
        label: I18n.t('cadeditor.ui.kit2.move_last_page'),
        icon: 'down',
        dis: i >= n - 1,
        run: function () {
          move(i, n - 1);
        }
      },
      { sep: 1 },
      {
        label: I18n.t('cadeditor.ui.kit2.delete_page_2'),
        icon: 'trash',
        danger: 1,
        run: function () {
          remove(i);
        }
      }
    ];
  }
  function iconBtn(icon, tip, fn, cls) {
    return kBtn('', fn, { icon: icon, title: tip, cls: 'k-book-ib' + (cls ? ' ' + cls : '') });
  }
  function jumpPop(anchor, n) {
    var inp = h('input', { class: 'k-input', type: 'text', placeholder: '1 – ' + n });
    function ok() {
      var v = parseInt(inp.value, 10);
      if (!isNaN(v)) {
        kPopClose();
        go(v - 1);
      }
    }
    inp.addEventListener('change', ok);
    kPopover(
      anchor,
      h('div', { class: 'k-pickbox' }, [
        kHint(I18n.t('cadeditor.ui.kit2.go_page')),
        inp,
        kBtn(I18n.t('cadeditor.ui.kit2.go'), ok, { cls: 'pri' })
      ]),
      { width: 150 }
    );
    setTimeout(function () {
      if (inp.focus) inp.focus();
    }, 0);
  }
  function paintFoot() {
    var l = pages(),
      n = l.length,
      m = maxPages();
    clear(acts);
    clear(pager);
    clear(info);
    acts.appendChild(
      iconBtn(
        'plus',
        I18n.t('cadeditor.ui.kit2.insert_blank_pages_after_page'),
        function () {
          insert(n ? at + 1 : 0, '');
        },
        typeof m === 'number' && n >= m ? 'dis' : ''
      )
    );
    acts.appendChild(
      iconBtn(
        'copy',
        I18n.t('cadeditor.ui.kit2.duplicate_page'),
        function () {
          if (n) insert(at + 1, clone(pages()[at]));
        },
        n ? '' : 'dis'
      )
    );
    acts.appendChild(
      iconBtn(
        'trash',
        I18n.t('cadeditor.ui.kit2.delete_page_2'),
        function () {
          remove(at);
        },
        'dng' + (n ? '' : ' dis')
      )
    );
    var prev = iconBtn(
      'back',
      I18n.t('cadeditor.ui.kit2.previous_page_pageup'),
      function () {
        go(at - 1);
      },
      at <= 0 ? 'dis' : ''
    );
    var next = iconBtn(
      'forward',
      I18n.t('cadeditor.ui.kit2.next_page_pagedown'),
      function () {
        go(at + 1);
      },
      at >= n - 1 ? 'dis' : ''
    );
    pager.appendChild(prev);
    bookPagerItems(n, at).forEach(function (i) {
      if (i === '…') {
        var gap = h('div', { class: 'k-book-pn gap', text: '…', title: I18n.t('cadeditor.ui.kit2.go_page_2') });
        activate(gap, function () {
          jumpPop(gap, n);
        });
        pager.appendChild(gap);
        return;
      }
      var b = h('div', {
        class: 'k-book-pn' + (i === at ? ' on' : ''),
        text: String(i + 1),
        title: I18n.t('cadeditor.ui.kit2.page_right_key_move_copy', i + 1)
      });
      activate(b, function () {
        go(i);
      });
      onContext(b, function () {
        return pageMenu(i);
      });
      pager.appendChild(b);
    });
    pager.appendChild(next);
    info.textContent = I18n.t('cadeditor.ui.kit2.total_page', n, typeof m === 'number' ? ' / ' + m : '');
    setTip(
      info,
      typeof m === 'number'
        ? I18n.t('cadeditor.ui.kit2.game_cap_page', m)
        : m === undefined
          ? I18n.t('cadeditor.ui.kit2.loading_page_limit')
          : ''
    );
  }
  /* 游戏里的书页：宽 114、最多 14 行、每行 9（游戏像素）。界面字号固定 12px，游戏字体里 6 像素宽的数字在这里宽 9.0508，所以放大倍数是固定的 */
  var BOOK_W = 114,
    BOOK_N = 14,
    BOOK_LH = 9,
    bookS = 1.5085;
  function pageStyle(el, extra) {
    bookS =
      typeof UI !== 'undefined' && UI.font === 'smooth'
        ? 1.5085
        : 1.5; /* 游戏字体 12px 下正好 1.5 倍；平滑字体的数字略宽 */
    el.setAttribute(
      'style',
      'width:' +
        Math.round(BOOK_W * bookS) +
        'px;line-height:' +
        (BOOK_LH * bookS).toFixed(2) +
        'px;overflow-wrap:anywhere;' +
        (extra || '')
    );
  }
  /* 放得下返回 -1；放不下返回该在哪个下标切开（尽量在空白处，切口后面的内容挪到下一页）。
     先把每个段落放进各自的块里，一次排版就知道累计行数；再把溢出的那一段逐字拆开，一次排版找到第一个落到第 15 行的字 */
  function fitIndex(text, sty) {
    pageStyle(pgBody);
    clear(pgBody);
    var lh = BOOK_LH * bookS,
      def = { color: '#000000' };
    var paras = [],
      start = 0;
    for (var i = 0; i <= text.length; i++)
      if (i === text.length || text.charAt(i) === '\n') {
        var d = h('div');
        renderRuns(d, {}, i > start ? rdRuns(text, sty, start, i) : [{ text: '\u00A0' }], def);
        pgBody.appendChild(d);
        paras.push({ el: d, s: start, e: i });
        start = i + 1;
      }
    var cum = 0,
      hit = -1,
      rem = 0;
    for (var p = 0; p < paras.length; p++) {
      var n = Math.max(1, Math.round(paras[p].el.clientHeight / lh));
      if (cum + n > BOOK_N) {
        hit = p;
        rem = BOOK_N - cum;
        break;
      }
      cum += n;
    }
    if (hit < 0) return -1;
    var P = paras[hit];
    if (rem <= 0) return Math.max(1, P.s);
    clear(pgBody);
    var runs = [];
    for (var c = P.s; c < P.e; c++) runs = runs.concat(rdRuns(text, sty, c, c + 1));
    var host = h('div');
    renderRuns(host, {}, runs, def);
    pgBody.appendChild(host);
    var hr = host.getBoundingClientRect(),
      sc = host.clientHeight ? hr.height / host.clientHeight : 1,
      kids = host.children,
      at2 = P.e;
    for (var j = 0; j < kids.length; j++) {
      var line = Math.floor((kids[j].getBoundingClientRect().top - hr.top) / sc / lh + 0.2);
      if (line >= rem) {
        at2 = P.s + j;
        break;
      }
    }
    for (var q = at2; q > Math.max(P.s + 1, at2 - 60); q--) if (/\s/.test(text.charAt(q - 1))) return q;
    return Math.max(1, at2);
  }
  function rdVal(t) {
    var runs = rdRuns(t.text, t.sty);
    return codes ? rdCodes(runs) : tcBuild({}, runs);
  }
  function withRaw(p, v) {
    if (bookFiltered(p)) {
      p = clone(p);
      p.raw = v;
      return p;
    }
    return v;
  }
  /* 当前页写满了：多出来的挪到下一页开头（下一页再满就继续往后），最后一页满了就加新页 */
  function flow() {
    if (!ed || ed.raw || !document.body.contains || !document.body.contains(pgBody)) return;
    try {
      flowRun();
    } finally {
      paintPaper();
    }
  }
  function flowRun() {
    var l = pages(),
      j = at,
      carry = null,
      caretPage = null,
      caret = ed.caretPos(),
      changed = false,
      guard = 0;
    var maxP = maxPages();
    while (j < l.length && guard++ < 200) {
      var ld = j === at ? ed.slice(0, ed.length()) : rdLoad(raw(l[j]), codes, 0);
      if (!ld) break;
      if (carry) {
        ld = { text: carry.text + ld.text, sty: carry.sty.concat(ld.sty) };
      }
      var k = fitIndex(ld.text, ld.sty);
      if (k < 0) {
        if (carry) {
          l[j] = withRaw(l[j], rdVal(ld));
          changed = true;
        }
        break;
      }
      var head = { text: ld.text.slice(0, k), sty: ld.sty.slice(0, k) },
        tail = { text: ld.text.slice(k), sty: ld.sty.slice(k) };
      if (j === at && caret >= k) caretPage = { page: at + 1, pos: caret - k };
      if (j + 1 >= l.length) {
        if (typeof maxP === 'number' && l.length >= maxP) {
          toast(I18n.t('cadeditor.ui.kit2.book_already_most_page_cut', maxP), 'error', 'book-flow');
          return;
        }
        l.push('');
      }
      l[j] = withRaw(l[j], rdVal(head));
      changed = true;
      carry = tail;
      j++;
    }
    if (!changed) return;
    put(l, I18n.t('cadeditor.ui.kit2.write_one_page_change_next'));
    if (caretPage) {
      setAt(caretPage.page, l.length);
      drawAll(true);
      if (ed && ed.setCaret) ed.setCaret(caretPage.pos);
    } else {
      drawAll(true);
      if (ed && ed.setCaret) ed.setCaret(Math.min(caret, ed.length()));
    }
    toast(I18n.t('cadeditor.ui.kit2.page_full_up_rows_per', BOOK_N), 'info', 'book-flow');
  }
  function paintPaper() {
    pageStyle(pgBody, 'min-height:' + Math.round(BOOK_N * BOOK_LH * bookS) + 'px;border-bottom:1px dashed #b0a07a;');
    if (ed && !ed.raw)
      renderRuns(pgBody, {}, ed.runs(), { color: '#000000', placeholder: I18n.t('cadeditor.ui.kit2.blank_page') });
    else clear(pgBody);
  }
  function drawEditor(focus) {
    clear(edHost);
    clear(note);
    ed = null;
    var l = pages();
    if (!l.length) {
      edHost.appendChild(
        h('div', { class: 'k-book-empty' }, [
          h('span', { class: 'k-sub', text: I18n.t('cadeditor.ui.kit2.book_pages_yet') }),
          kBtn(
            I18n.t('cadeditor.ui.kit2.add_first_page'),
            function () {
              insert(0, '');
            },
            { icon: 'plus', cls: 'pri' }
          )
        ])
      );
      return;
    }
    var p = l[at];
    ed = kRichDoc(raw(p), {
      mode: codes ? 'codes' : 'component',
      multiline: true,
      preview: false,
      paper: 'book',
      aside: paper,
      placeholder: I18n.t('cadeditor.ui.kit2.write_contents_page', at + 1),
      def: { color: '#000000', placeholder: I18n.t('cadeditor.ui.kit2.blank_page') },
      max: codes ? o.maxChars : undefined,
      onChange: function (v) {
        setPage(v);
        flow();
      },
      onRender: paintPaper
    });
    edHost.appendChild(ed.el);
    if (ed.raw) note.appendChild(kHint(I18n.t('cadeditor.ui.textevent.page_raw'), 'hint'));
    if (bookFiltered(p) && p.filtered !== undefined)
      note.appendChild(kHint(I18n.t('cadeditor.ui.kit2.page_also_filter_text_version')));
    if (focus && ed.focus) ed.focus();
  }
  function drawAll(focus) {
    var l = pages();
    seen = JSON.stringify(l);
    setAt(at, l.length);
    drawEditor(focus);
    paintPaper();
    paintFoot();
  }
  /* 撤销 / 重做 / 外部修改：内容不是这里刚写的，就重新载入 */
  function refresh() {
    if (JSON.stringify(pages()) !== seen) drawAll();
    else {
      paintFoot();
      if (ed && ed.recount) ed.recount();
    }
  }
  drawAll();
  return { el: root, refresh: refresh };
}
