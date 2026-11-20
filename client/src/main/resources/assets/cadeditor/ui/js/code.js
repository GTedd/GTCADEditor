/* SNBT 代码视图 / 编辑器：原生语法高亮、行号、一键格式化 / 压缩、实时检查并定位到出错的行列。
   默认直接使用 Oriel 原生 textarea：点击定位、跨行拖选、剪贴板、方向键 / Home / End、Shift 选区和撤销栈都由同一个原生文本模型处理。
   高亮由同一原生文本模型绘制，不创建第二块只读代码。
   折叠：原生 textarea 不能隐藏行，所以折叠时把 { … } / [ … ] 的内部换成一个占位符“⋯”显示，真实文本另存一份（text）。
   输入时按“旧显示 → 新显示”的差异换算回真实文本；碰到占位符的编辑一律拒绝并展开该处，复制 / 提交 / 格式化永远用真实文本。
   折叠 / 展开会给 textarea 重新赋值，Oriel 的脚本赋值会清空原生撤销栈（引擎语义），撤销因此不会跨越折叠状态。 */
var KC_NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[bBsSlLfFdD]?$/;
var KC_ID = /^(["'])[a-z0-9_.-]+:[a-z0-9_.\/-]+\1$/;
var KC_CHUNK = 400,
  KC_INDENT_PX = 7;
/* 折叠占位符、折叠 / 括号分析的文本上限、行号栏折叠列宽 */
var KC_FOLD_PH = '⋯',
  KC_IDE_MAX = 262144,
  KC_GUT = 10;
function kcFontSize(v) {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 8 && v <= 20 ? v : 12;
}

/* 词法：不依赖整体能否解析，写到一半的 SNBT 也能上色。token = { t, s }，t：key str sid num bool kw word o0-o2 c0-c2 p ws nl bad */
function kcTokens(text, language) {
  var out = [],
    i = 0,
    n = text.length,
    depth = 0,
    j,
    c;
  function push(t, s) {
    out.push({ t: t, s: s });
  }
  while (i < n) {
    c = text.charAt(i);
    if (c === '\n') {
      push('nl', c);
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      j = i;
      while (j < n && ' \t\r'.indexOf(text.charAt(j)) >= 0) j++;
      push('ws', text.substring(i, j));
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      j = i + 1;
      while (j < n && text.charAt(j) !== c && text.charAt(j) !== '\n') {
        if (text.charAt(j) === '\\') j++;
        j++;
      }
      var closed = text.charAt(j) === c;
      j = Math.min(n, closed ? j + 1 : j);
      push(closed ? 'str' : 'bad', text.substring(i, j));
      i = j;
      continue;
    }
    if (c === '{' || c === '[') {
      push('o' + (depth % 3), c);
      depth++;
      i++;
      continue;
    }
    if (c === '}' || c === ']') {
      depth = Math.max(0, depth - 1);
      push('c' + (depth % 3), c);
      i++;
      continue;
    }
    if (c === ',' || c === ':' || c === ';') {
      push('p', c);
      i++;
      continue;
    }
    j = i;
    while (j < n && ' \t\r\n{}[],:;"\''.indexOf(text.charAt(j)) < 0) j++;
    if (j === i) {
      push('bad', c);
      i++;
      continue;
    }
    push('word', text.substring(i, j));
    i = j;
  }
  for (var k = 0; k < out.length; k++) {
    var tk = out[k],
      nx = k + 1;
    if (tk.t === 'word' || tk.t === 'str') {
      while (nx < out.length && (out[nx].t === 'ws' || out[nx].t === 'nl')) nx++;
      if (out[nx] && out[nx].t === 'p' && out[nx].s === ':') {
        tk.t = 'key';
        continue;
      }
    }
    if (tk.t === 'str' && KC_ID.test(tk.s)) tk.t = 'sid';
    else if (tk.t === 'word') {
      if (tk.s === 'true' || tk.s === 'false') tk.t = 'bool';
      else if (KC_NUM.test(tk.s) || /^[+-]?(?:NaN|Infinity)[fFdD]$/.test(tk.s)) tk.t = 'num';
      else if (
        /^[BIL]$/.test(tk.s) &&
        out[k + 1] &&
        out[k + 1].s === ';' &&
        out[k - 1] &&
        out[k - 1].t.charAt(0) === 'o'
      )
        tk.t = 'kw';
    }
  }
  if (language === 'json')
    out.forEach(function (tk) {
      if (tk.t === 'key' || tk.t === 'str' || tk.t === 'sid') {
        if (tk.s.charAt(0) !== '"') tk.t = 'bad';
      } else if (tk.t === 'num' && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(tk.s)) tk.t = 'bad';
      else if (tk.s === 'null') tk.t = 'kw';
      else if (tk.t === 'kw' || tk.t === 'word' || tk.s === ';') tk.t = 'bad';
    });
  return out;
}
/* 按行拆开，并算出每一行能折叠到哪一行（那一行里最外层、没在同行闭合的括号） */
function kcLines(tokens) {
  var lines = [[]],
    stack = [],
    fold = {};
  tokens.forEach(function (tk) {
    var L = lines.length - 1;
    if (tk.t === 'nl') {
      lines.push([]);
      return;
    }
    lines[L].push(tk);
    if (tk.t.charAt(0) === 'o') stack.push(L);
    else if (tk.t.charAt(0) === 'c' && stack.length) {
      var from = stack.pop();
      if (from < L && (fold[from] === undefined || fold[from] < 0)) fold[from] = L;
    }
  });
  return { lines: lines, fold: fold };
}
/* 括号配对：跳过单 / 双引号字符串（与词法一致：字符串到同一行的同种引号或行尾为止，反斜杠转义下一个字符）。
   返回 { match: {位置: 配对位置}, unmatched: [位置], regions: [{ open, close, line, end, depth }]（跨行的成对括号，depth 从 1 起） } */
function kcBrackets(text) {
  var match = {},
    unmatched = [],
    regions = [],
    stack = [],
    line = 0,
    n = text.length,
    i,
    c;
  for (i = 0; i < n; i++) {
    c = text.charAt(i);
    if (c === '\n') {
      line++;
      continue;
    }
    if (c === '"' || c === "'") {
      var q = c;
      for (i++; i < n; i++) {
        c = text.charAt(i);
        if (c === '\\') {
          if (text.charAt(i + 1) === '\n') line++;
          i++;
          continue;
        }
        if (c === q) break;
        if (c === '\n') {
          line++;
          break;
        }
      }
      continue;
    }
    if (c === '{' || c === '[') stack.push({ p: i, c: c, l: line });
    else if (c === '}' || c === ']') {
      var top = stack[stack.length - 1];
      if (top && top.c === (c === '}' ? '{' : '[')) {
        stack.pop();
        match[top.p] = i;
        match[i] = top.p;
        if (line > top.l) regions.push({ open: top.p, close: i, line: top.l, end: line, depth: stack.length + 1 });
      } else unmatched.push(i);
    }
  }
  stack.forEach(function (o) {
    unmatched.push(o.p);
  });
  unmatched.sort(function (a, b) {
    return a - b;
  });
  regions.sort(function (a, b) {
    return a.open - b.open;
  });
  return { match: match, unmatched: unmatched, regions: regions };
}
function kcPos(text, pos) {
  var b = text.substring(0, pos),
    ln = b.split('\n').length;
  return { line: ln, col: pos - (b.lastIndexOf('\n') + 1) + 1 };
}
/* 每行行首偏移（升序）；kcLineAt 用二分查找某个偏移所在的行（0 起） */
function kcLineStarts(text) {
  var out = [0],
    i = -1;
  while ((i = text.indexOf('\n', i + 1)) >= 0) out.push(i + 1);
  return out;
}
function kcLineAt(starts, offset) {
  var lo = 0,
    hi = starts.length - 1;
  while (lo < hi) {
    var mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
/* 检查：默认用 parseSnbt（不带副作用）；失败时尽量给出位置。返回 null 或 { message, pos, line, col } */
function kcCheck(text, validate) {
  try {
    if (validate) validate(text);
    else parseSnbt(text);
    return null;
  } catch (e) {
    var pos = typeof e.pos === 'number' ? e.pos : null,
      m = /第 (\d+) 个字符/.exec(e.message || '');
    if (pos === null && m) pos = Math.max(0, +m[1] - 1);
    var p = pos === null ? null : kcPos(text, Math.min(pos, text.length));
    return {
      message: String(e.message || e).replace(/^SNBT 第 \d+ 个字符：/, ''),
      pos: pos,
      line: p ? p.line : null,
      col: p ? p.col : null
    };
  }
}
function kcFormat(text, compact) {
  return nbtPrint(nbtParse(text), !compact);
}

/* kCode(o)：o = { value, height, readonly, placeholder, language, validate(text), onInput(text, err), onApply(), assist, stringDepth }
   assist：补全语境提示，{ root: 'stack' | 'component' | 'nbt', component }；省略时按文本开头自动判断物品栈。
   返回 { el, get(), set(text), focus(), check() }。 */
var KC_COLORS = {
  key: 0xff7fc8ff,
  str: 0xffe6b673,
  sid: 0xff5fd3c0,
  num: 0xffb5e07a,
  bool: 0xffd98cff,
  kw: 0xffd98cff,
  bad: 0xffff6b6b,
  o0: 0xffffd866,
  c0: 0xffffd866,
  o1: 0xffc792ea,
  c1: 0xffc792ea,
  o2: 0xff6ec0ff,
  c2: 0xff6ec0ff
};
/* 叠加色：括号配对、查找命中、当前命中、折叠占位符。原生着色只有前景色，没有背景色 */
var KC_MARK = { pair: 0xff7dff5c, hit: 0xffff9a3c, cur: 0xffff4fd8, ph: 0xff9aa0a6 };
/* 后面跟整数时按颜色显示的键（文本颜色、阴影色、药水 / 皮革 / 地图色、烟花颜色列表） */
var KC_COLOR_KEY =
  /^(?:color|colors|fade_colors|shadow_color|custom_color|rgb|(?:minecraft:)?(?:dyed_color|map_color))$/;
/* 太暗的颜色在深色编辑区上看不清：保留色相，向白色提亮到可读 */
function kcReadable(rgb) {
  var r = (rgb >> 16) & 255,
    g = (rgb >> 8) & 255,
    b = rgb & 255;
  if (0.299 * r + 0.587 * g + 0.114 * b < 60) {
    r = Math.round(r + (255 - r) * 0.45);
    g = Math.round(g + (255 - g) * 0.45);
    b = Math.round(b + (255 - b) * 0.45);
  }
  return 0xff000000 + (r << 16) + (g << 8) + b;
}
/* "#RRGGBB" / "#AARRGGBB" → 可读的 ARGB；不是颜色返回 null */
function kcColorOf(s) {
  var m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(s);
  if (!m) return null;
  return kcReadable(parseInt(m[1].slice(-6), 16));
}
function kcRanges(text, language, brackets) {
  var offset = 0,
    ranges = [],
    bad = {},
    stack = [],
    key = null;
  if (language !== 'plain' && text.length <= KC_IDE_MAX)
    (brackets || kcBrackets(text)).unmatched.forEach(function (p) {
      bad[p] = 1;
    });
  function keyName(s) {
    return s.charAt(0) === '"' || s.charAt(0) === "'" ? s.slice(1, -1) : s;
  }
  kcTokens(text, language).forEach(function (tk) {
    var end = offset + tk.s.length,
      color = KC_COLORS[tk.t],
      kind = tk.t.charAt(0);
    if ((kind === 'o' || kind === 'c') && tk.t.length === 2 && bad[offset]) color = KC_COLORS.bad;
    else if (tk.t === 'str' || tk.t === 'sid' || tk.t === 'word') {
      var inner = tk.t === 'word' ? tk.s : tk.s.slice(1, -1),
        lit = kcColorOf(inner);
      if (lit === null && key === 'color' && typeof MC_HEX !== 'undefined' && MC_HEX[inner])
        lit = kcColorOf(MC_HEX[inner]);
      if (lit !== null) color = lit;
    } else if (tk.t === 'num') {
      var top = stack[stack.length - 1],
        owner = key !== null ? key : top && top.list ? top.key : null;
      if (owner !== null && KC_COLOR_KEY.test(owner) && /^[+-]?\d+[bsilBSIL]?$/.test(tk.s))
        color = kcReadable(parseInt(tk.s, 10) & 0xffffff);
    }
    if (color !== undefined) ranges.push({ start: offset, end: end, color: color });
    if (tk.t === 'key') key = keyName(tk.s);
    else if (kind === 'o' && tk.t.length === 2) {
      stack.push({ key: key, list: tk.s === '[' });
      key = null;
    } else if (kind === 'c' && tk.t.length === 2) {
      stack.pop();
      key = null;
    } else if (tk.t === 'p' && tk.s === ',') key = null;
    else if (tk.t !== 'ws' && tk.t !== 'nl' && tk.t !== 'p') key = null;
    offset = end;
  });
  return ranges;
}
/* 两组有序、互不重叠的着色段合并：top 盖住 base 的对应字符 */
function kcOverlay(base, top) {
  if (!top.length) return base;
  var cut = [],
    t = 0,
    i,
    k,
    cur,
    b;
  for (i = 0; i < base.length; i++) {
    b = base[i];
    cur = b.start;
    while (t < top.length && top[t].end <= cur) t++;
    for (k = t; k < top.length && top[k].start < b.end; k++) {
      if (top[k].start > cur) cut.push({ start: cur, end: top[k].start, color: b.color });
      cur = Math.max(cur, top[k].end);
    }
    if (cur < b.end) cut.push({ start: cur, end: b.end, color: b.color });
  }
  var out = [],
    x = 0,
    y = 0;
  while (x < cut.length || y < top.length) {
    if (y >= top.length || (x < cut.length && cut[x].start < top[y].start)) out.push(cut[x++]);
    else out.push(top[y++]);
  }
  return out;
}
/* 折叠视图：folds = [{ open, close }]（真实文本里成对括号的位置，可嵌套）；只有最外层生效，内层在外层展开后恢复。
   返回 { display, segs }，seg = { hs, he, ds, open, close }：真实隐藏区 [hs, he)，占位符在显示文本的 ds 处 */
function kcFoldView(text, folds) {
  if (!folds.length) return { display: text, segs: [] };
  var parts = [],
    segs = [],
    last = 0,
    shift = 0,
    cover = -1;
  folds
    .slice()
    .sort(function (a, b) {
      return a.open - b.open;
    })
    .forEach(function (f) {
      var hs = f.open + 1,
        he = f.close;
      if (f.open < cover || he <= hs || he > text.length) return;
      parts.push(text.substring(last, hs), KC_FOLD_PH);
      segs.push({ hs: hs, he: he, ds: hs - shift, open: f.open, close: f.close });
      shift += he - hs - KC_FOLD_PH.length;
      last = he;
      cover = he;
    });
  parts.push(text.substring(last));
  return { display: parts.join(''), segs: segs };
}
function kcR2D(segs, p) {
  var shift = 0;
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i];
    if (p <= s.hs) break;
    if (p >= s.he) {
      shift += s.he - s.hs - KC_FOLD_PH.length;
      continue;
    }
    return s.ds;
  }
  return p - shift;
}
function kcD2R(segs, d) {
  var shift = 0;
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i];
    if (d <= s.ds) break;
    if (d >= s.ds + KC_FOLD_PH.length) {
      shift += s.he - s.hs - KC_FOLD_PH.length;
      continue;
    }
    return s.hs;
  }
  return d + shift;
}
/* 显示坐标的编辑 [from, to) 是否碰到占位符（含紧邻两侧，即括号内部）；整个 {⋯} 连括号一起被替换不算。返回 seg 下标或 -1 */
function kcTouches(segs, from, to) {
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i],
      pe = s.ds + KC_FOLD_PH.length;
    if (from <= pe && to >= s.ds && !(from <= s.ds - 1 && to >= pe + 1)) return i;
  }
  return -1;
}
/* 旧文本 a → 新文本 b 的单段差异 { from, to, insert }（to 是 a 中的位置）。caret 是编辑后的光标：
   先从光标往后对齐公共后缀，使差异尽量落在光标前（撤销等不在光标处的变化也仍是一段正确差异）。 */
function kcDiff(a, b, caret) {
  var la = a.length,
    lb = b.length,
    p = 0,
    s = 0,
    sMax = Math.min(la, lb);
  if (typeof caret === 'number' && caret >= 0 && caret <= lb) sMax = Math.min(sMax, lb - caret);
  while (s < sMax && a.charCodeAt(la - 1 - s) === b.charCodeAt(lb - 1 - s)) s++;
  var pMax = Math.min(la - s, lb - s);
  while (p < pMax && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  return { from: p, to: la - s, insert: b.substring(p, lb - s) };
}
// Only pending editors are retained. Lifecycle callers flush before replacing their owner.
var PendingCode = {
  entries: [],
  flushing: false,
  flush: function () {
    if (this.flushing) return;
    this.flushing = true;
    try {
      this.entries.slice().forEach(function (entry) {
        entry();
      });
    } finally {
      this.flushing = false;
    }
  }
};
function flushPendingCode() {
  PendingCode.flush();
}
document.addEventListener('mousedown', flushPendingCode, true);
function kcNum(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}
function kCode(o) {
  o = o || {};
  var text = o.value === undefined || o.value === null ? '' : String(o.value),
    err = null,
    timer = null,
    nativeError = null,
    checkedText = null,
    parsed,
    pending = false;
  var ownerDoc = typeof Store !== 'undefined' ? Store.doc() : null,
    ownerWorld = typeof WE !== 'undefined' ? WE.w : null;
  function currentOwner() {
    return (
      (typeof Store === 'undefined' || Store.doc() === ownerDoc) && (typeof WE === 'undefined' || WE.w === ownerWorld)
    );
  }
  function cancelPending() {
    clearTimeout(timer);
    pending = false;
    var i = PendingCode.entries.indexOf(flush);
    if (i >= 0) PendingCode.entries.splice(i, 1);
  }
  function flush() {
    if (!pending) return;
    cancelPending();
    if (!currentOwner()) return;
    runCheck();
    if (o.onInput) o.onInput(text, err, parsed);
    highlight();
    if (assist && assist.flushed) assist.flushed();
  }
  var root = h('div', { class: 'kc' }),
    ta = h('textarea', { class: 'ed-snbt kc-ta', spellcheck: 'false', wrap: 'off', placeholder: o.placeholder || '' });
  var status = h('div', { class: 'kc-st k-sub' });
  var height = o.height || 320;
  ta.style.height = height + 'px';
  ta.style.minHeight = '80px';
  var fontSize = kcFontSize(Prefs.get('codeFontSize', 12)),
    fontLabel = h('span', { class: 'kc-font-label' });
  function applyFont() {
    root.style.fontSize = fontSize + 'px';
    root.style.lineHeight = fontSize + 2 + 'px';
    // No textarea value assignment, reconstruction, selection or undo reset.
    ta.style.fontSize = fontSize + 'px';
    ta.style.lineHeight = fontSize + 2 + 'px';
    fontLabel.textContent = String(fontSize);
    measured = {};
    renderGutter(true);
  }
  function changeFont(delta) {
    var next = Math.max(8, Math.min(20, fontSize + delta));
    if (next === fontSize) return;
    fontSize = next;
    applyFont();
    Prefs.set('codeFontSize', fontSize);
  }
  /* Ctrl / Cmd + 滚轮：和常见编辑器一样调字号（上滚放大）；这时不滚动内容，也不让外层页面滚走 */
  root.addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.deltaY) return;
    e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    changeFont(e.deltaY < 0 ? 1 : -1);
  });
  if (o.readonly) ta.setAttribute('readonly', 'true');
  ta.value = text;

  var language = o.language || 'snbt',
    validator =
      o.validate ||
      (language === 'json'
        ? function (v) {
            JSON.parse(v);
          }
        : language === 'plain'
          ? function () {}
          : null);

  /* ---- 折叠模型与显示坐标 ---- */
  var ideOn = language !== 'plain',
    folds = [],
    view = { display: text, segs: [] },
    pendingEdit = null,
    before = null,
    realCache = { text: null, info: null },
    dispCache = { text: null, info: null, starts: null },
    baseCache = { src: null, ranges: null },
    findMarks = [],
    findCur = -1,
    pairSpans = [],
    assist = null,
    measured = {};
  /* ---- 撤销 / 重做：由页面自己记录（真实文本 + 折叠 + 选区）。
     折叠、展开和整体替换都要给 value 赋值，那会清空原生撤销栈；所以 Ctrl+Z / Ctrl+Y 不交给原生控件。 ---- */
  var KC_UNDO_STEPS = 200,
    KC_UNDO_CHARS = 4000000,
    KC_UNDO_MERGE_MS = 1000;
  var hist = { undo: [], redo: [], chars: 0, kind: null, time: 0, applying: false, last: null };
  function histSnap() {
    var s = selD();
    // Folds are view state and are not part of a step: undo keeps the current folds (see histApply).
    return { text: text, a: d2r(s[0]), b: d2r(s[1]) };
  }
  function histReset() {
    hist.undo = [];
    hist.redo = [];
    hist.chars = 0;
    hist.kind = null;
    hist.last = null;
  }
  function histPush(stack, s) {
    stack.push(s);
    hist.chars += s.text.length;
    while (hist.undo.length + hist.redo.length > KC_UNDO_STEPS || hist.chars > KC_UNDO_CHARS) {
      var from = hist.undo.length ? hist.undo : hist.redo;
      if (!from.length) break;
      hist.chars -= from.shift().text.length;
    }
  }
  function histPop(stack) {
    var s = stack.pop();
    if (s) hist.chars -= s.text.length;
    return s;
  }
  /* 文本刚变：把变化前的状态记一步。连续打字 / 连续删除在短时间内合并成一步 */
  function histRecord(inputType) {
    var prev = hist.last;
    if (hist.applying || !prev) {
      hist.last = histSnap();
      return;
    }
    if (prev.text === text) {
      hist.last = histSnap();
      return;
    }
    var now = Date.now(),
      kind = /^insertText$|^insertCompositionText$/.test(inputType || '')
        ? 'type'
        : /^delete(ContentBackward|ContentForward|WordBackward|WordForward)$/.test(inputType || '')
          ? 'delete'
          : null;
    var merge = kind && kind === hist.kind && now - hist.time < KC_UNDO_MERGE_MS && hist.undo.length;
    if (!merge) histPush(hist.undo, prev);
    while (hist.redo.length) histPop(hist.redo);
    hist.kind = kind;
    hist.time = now;
    hist.last = histSnap();
  }
  /* 撤销到 s：保留当前的折叠——改动段之前的原样、之后的按长度差平移、跨在改动段上的展开 */
  function histApply(s) {
    var d = kcDiff(text, s.text),
      delta = d.insert.length - (d.to - d.from),
      kept = [];
    folds.forEach(function (f) {
      if (f.close < d.from) kept.push({ open: f.open, close: f.close });
      else if (f.open >= d.to) kept.push({ open: f.open + delta, close: f.close + delta });
    });
    hist.applying = true;
    try {
      text = s.text;
      setFolds(validFolds(kept), false);
      if (ta.value !== view.display) ta.value = view.display;
      selectReal(s.a, s.b);
    } finally {
      hist.applying = false;
    }
    hist.kind = null;
    hist.last = histSnap();
    changed({ inputType: 'historyUndo' });
  }
  function histStep(fromUndo) {
    if (o.readonly) return false;
    var from = fromUndo ? hist.undo : hist.redo,
      to = fromUndo ? hist.redo : hist.undo;
    if (!from.length) return false;
    flushSelection();
    var target = histPop(from);
    histPush(to, hist.last || histSnap());
    histApply(target);
    return true;
  }
  /* 选区只在输入前才会被下一步记住；撤销前先把当前光标记进“当前状态” */
  function flushSelection() {
    if (hist.last && hist.last.text === text) {
      var s = selD();
      hist.last.a = d2r(s[0]);
      hist.last.b = d2r(s[1]);
    }
  }
  function realInfo() {
    if (realCache.text !== text) {
      realCache.text = text;
      realCache.info = text.length <= KC_IDE_MAX ? kcBrackets(text) : { match: {}, unmatched: [], regions: [] };
      realCache.starts = null;
    }
    return realCache.info;
  }
  function realStarts() {
    realInfo();
    if (!realCache.starts) realCache.starts = kcLineStarts(text);
    return realCache.starts;
  }
  function dispInfo(src) {
    if (!folds.length) return src === text ? realInfo() : kcBrackets(src);
    if (dispCache.text !== src) {
      dispCache.text = src;
      dispCache.info = src.length <= KC_IDE_MAX ? kcBrackets(src) : { match: {}, unmatched: [], regions: [] };
      dispCache.starts = null;
    }
    return dispCache.info;
  }
  function dispStarts(src) {
    if (!folds.length) return src === text ? realStarts() : kcLineStarts(src);
    dispInfo(src);
    if (!dispCache.starts) dispCache.starts = kcLineStarts(src);
    return dispCache.starts;
  }
  function r2d(p) {
    return folds.length ? kcR2D(view.segs, p) : p;
  }
  function d2r(d) {
    return folds.length ? kcD2R(view.segs, d) : d;
  }
  function selD() {
    var a = kcNum(ta.selectionStart, 0),
      b = kcNum(ta.selectionEnd, a);
    return [Math.min(a, b), Math.max(a, b)];
  }
  function setSelD(a, b) {
    if (typeof ta.setSelectionRange === 'function') ta.setSelectionRange(a, b);
    else
      try {
        ta.selectionStart = a;
        ta.selectionEnd = b;
      } catch (e) {}
  }
  function hides(f, a, b) {
    return a === b ? a > f.open + 1 && a < f.close : a < f.close && b > f.open + 1;
  }
  /* 让真实区间 [a, b] 可见：展开所有把它藏起来的折叠 */
  function reveal(a, b) {
    var keep = folds.filter(function (f) {
      return !hides(f, a, b === undefined ? a : b);
    });
    if (keep.length !== folds.length) setFolds(keep, true);
  }
  function selectReal(a, b) {
    reveal(Math.min(a, b), Math.max(a, b));
    setSelD(r2d(a), r2d(b === undefined ? a : b));
  }
  /* 换一组折叠：重新生成显示文本（给 value 赋值会清空原生撤销栈），保持真实选区 */
  function setFolds(next, keepSelection) {
    var sel = keepSelection ? [d2r(selD()[0]), d2r(selD()[1])] : null;
    folds = next.slice().sort(function (a, b) {
      return a.open - b.open;
    });
    view = kcFoldView(text, folds);
    if (ta.value !== view.display) ta.value = view.display;
    ta.style.paddingLeft = ideOn ? gutterWidth() + 3 + 'px' : '';
    pairSpans = [];
    if (sel) {
      var a = sel[0],
        b = sel[1];
      // A caret that would sit inside newly hidden text moves before the fold.
      folds.forEach(function (f) {
        if (hides(f, a, a)) a = f.open;
        if (hides(f, b, b)) b = f.close + 1;
      });
      setSelD(r2d(a), r2d(Math.max(a, b)));
    }
    highlight();
  }
  function validFolds(list) {
    var info = realInfo();
    return list.filter(function (f) {
      return info.match[f.open] === f.close && f.close > f.open && text.substring(f.open, f.close).indexOf('\n') >= 0;
    });
  }
  function regionAt(open) {
    var r = realInfo().regions;
    for (var i = 0; i < r.length; i++) if (r[i].open === open) return r[i];
    return null;
  }
  function toggleFold(open) {
    if (!ideOn) return;
    var has = folds.some(function (f) {
      return f.open === open;
    });
    if (has)
      setFolds(
        folds.filter(function (f) {
          return f.open !== open;
        }),
        true
      );
    else {
      var r = regionAt(open);
      if (r) setFolds(folds.concat([{ open: r.open, close: r.close }]), true);
    }
  }
  function foldWhere(test) {
    flush();
    if (!ideOn) return;
    if (text.length > KC_IDE_MAX) {
      toast(I18n.t('cadeditor.ui.code.fold_too_large'), 'warn', 'kc-fold');
      return;
    }
    setFolds(
      realInfo()
        .regions.filter(test)
        .map(function (r) {
          return { open: r.open, close: r.close };
        }),
      true
    );
  }

  /* ---- 着色：词法颜色（按显示文本）+ 叠加（占位符、查找命中、括号配对） ---- */
  function topMarks(src) {
    var phs = [],
      hits = [],
      i,
      m;
    view.segs.forEach(function (s) {
      phs.push({ start: s.ds, end: s.ds + KC_FOLD_PH.length, color: KC_MARK.ph });
    });
    for (i = 0; i < findMarks.length && hits.length < 4000; i++) {
      m = findMarks[i];
      var hidden = view.segs.some(function (s) {
        return m.s < s.he && m.e > s.hs;
      });
      if (hidden) continue;
      var a = r2d(m.s),
        b = r2d(m.e);
      // Never cut a surrogate pair: the native API rejects such ranges.
      if (a > 0 && /[\udc00-\udfff]/.test(src.charAt(a)) && /[\ud800-\udbff]/.test(src.charAt(a - 1))) a--;
      if (b < src.length && /[\udc00-\udfff]/.test(src.charAt(b)) && /[\ud800-\udbff]/.test(src.charAt(b - 1))) b++;
      if (b > a && (!hits.length || a >= hits[hits.length - 1].end))
        hits.push({ start: a, end: b, color: i === findCur ? KC_MARK.cur : KC_MARK.hit });
    }
    var over = phs.concat(pairSpans).sort(function (x, y) {
      return x.start - y.start;
    });
    return kcOverlay(hits, over);
  }
  function highlight() {
    var src = ta.value;
    try {
      if (typeof ta.setTextHighlights !== 'function')
        throw new Error(I18n.t('cadeditor.ui.code.requires_oriel_text_highlights'));
      var big = src.length > 32768;
      if (baseCache.src !== src) {
        baseCache.src = src;
        baseCache.ranges = language === 'plain' || big ? [] : kcRanges(src, language, ideOn ? dispInfo(src) : null);
      }
      var ranges = big ? baseCache.ranges : kcOverlay(baseCache.ranges, topMarks(src));
      if (ta.setTextHighlights(src, ranges, folds.length === 0) !== true)
        throw new Error(I18n.t('cadeditor.ui.code.original_model_rejects_expired_text'));
      nativeError = null;
      root.setAttribute('data-highlight', 'native');
    } catch (e) {
      root.setAttribute('data-highlight', 'failed');
      if (!nativeError) {
        nativeError = I18n.t('cadeditor.ui.code.original_editor_highlighting_failed', e.message || e);
        if (typeof EditorDiag !== 'undefined') EditorDiag.error('code.highlight.api', new Error(nativeError));
      }
    }
    renderGutter(true);
  }
  /* 光标紧邻括号时高亮它和配对括号（不配对的括号在词法颜色里已是错误色） */
  function updatePair() {
    if (!ideOn || pending) return;
    var src = ta.value,
      sel = selD(),
      spans = [];
    if (sel[0] === sel[1] && src.length <= KC_IDE_MAX) {
      var c = sel[0],
        p = -1,
        info = dispInfo(src);
      if (c > 0 && '{}[]'.indexOf(src.charAt(c - 1)) >= 0 && info.match[c - 1] !== undefined) p = c - 1;
      else if ('{}[]'.indexOf(src.charAt(c)) >= 0 && info.match[c] !== undefined) p = c;
      if (p >= 0) {
        var q = info.match[p];
        spans = [
          { start: Math.min(p, q), end: Math.min(p, q) + 1, color: KC_MARK.pair },
          { start: Math.max(p, q), end: Math.max(p, q) + 1, color: KC_MARK.pair }
        ];
      }
    }
    if (spans.length === pairSpans.length && (!spans.length || spans[0].start === pairSpans[0].start)) return;
    pairSpans = spans;
    highlight();
  }

  /* ---- 行号栏：折叠标记；折叠时原生行号会按显示行编号，改由这里显示真实行号 ---- */
  var gut = null,
    gutIn = null,
    gutWin = null,
    measure = null,
    foldVersion = 0;
  if (ideOn) {
    gutIn = h('div', { class: 'kc-gut-in' });
    gut = h('div', { class: 'kc-gut', 'aria-hidden': 'true' }, [gutIn]);
    ta.style.paddingLeft = KC_GUT + 3 + 'px';
  }
  function cssPx(name, fallback) {
    try {
      if (typeof getComputedStyle === 'function') {
        var v = parseFloat(getComputedStyle(ta).getPropertyValue(name));
        if (isFinite(v)) return v;
      }
    } catch (e) {}
    return fallback;
  }
  function textWidth(s) {
    if (!measure) {
      measure = h('span', { class: 'kc-measure', 'aria-hidden': 'true' });
      surface.appendChild(measure);
    }
    if (measured[s] !== undefined) return measured[s];
    measure.textContent = s;
    var w = 0;
    try {
      w = measure.getBoundingClientRect().width / (typeof uiScaleFactor === 'function' ? uiScaleFactor() || 1 : 1);
    } catch (e) {}
    if (!isFinite(w) || w < 0) w = 0;
    if (s.length < 24) measured[s] = w;
    return w;
  }
  function digitWidth() {
    return Math.max(3, Math.min(16, textWidth('0000000000') / 10 || fontSize * 0.5));
  }
  function gutterWidth() {
    if (!folds.length) return KC_GUT;
    return KC_GUT + Math.ceil(String(realStarts().length).length * digitWidth()) + 4;
  }
  function renderGutter(force) {
    if (!gut) return;
    var lh = fontSize + 2,
      st = kcNum(ta.scrollTop, 0),
      ch = kcNum(ta.clientHeight, 0) || height,
      src = ta.value,
      top = cssPx('padding-top', 4) - st;
    gut.style.height = ch + 'px';
    gut.style.width = gutterWidth() + 'px';
    gutIn.style.top = top + 'px';
    var lines = dispStarts(src),
      first = Math.max(0, Math.floor(st / lh) - 4),
      last = Math.min(lines.length, Math.ceil((st + ch) / lh) + 4);
    if (
      !force &&
      gutWin &&
      gutWin.src === src &&
      gutWin.version === foldVersion &&
      first >= gutWin.first &&
      last <= gutWin.last
    )
      return;
    var from = Math.max(0, first - 40),
      to = Math.min(lines.length, last + 40),
      marks = {},
      kids = [];
    gutWin = { src: src, version: foldVersion, first: from, last: to };
    if (src.length <= KC_IDE_MAX)
      realInfo().regions.forEach(function (r) {
        var folded = folds.some(function (f) {
          return f.open === r.open;
        });
        // Regions whose opening bracket is hidden have no visible line.
        if (
          view.segs.some(function (s) {
            return r.open >= s.hs && r.open < s.he;
          })
        )
          return;
        var line = kcLineAt(lines, r2d(r.open));
        if (line < from || line >= to) return;
        if (!marks[line] || (folded && !marks[line].folded)) marks[line] = { open: r.open, folded: folded };
      });
    Object.keys(marks).forEach(function (line) {
      var m = marks[line],
        el = h('div', { class: 'kc-fm' + (m.folded ? ' on' : ''), text: m.folded ? '+' : '−' });
      el.style.top = line * lh + 'px';
      el.style.height = lh + 'px';
      el.style.lineHeight = lh + 'px';
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        toggleFold(m.open);
      });
      kids.push(el);
    });
    if (folds.length) {
      var starts = realStarts();
      for (var i = from; i < to; i++) {
        var n = h('div', { class: 'kc-gln', text: String(kcLineAt(starts, d2r(lines[i])) + 1) });
        n.style.top = i * lh + 'px';
        n.style.height = lh + 'px';
        n.style.lineHeight = lh + 'px';
        kids.push(n);
      }
    }
    clear(gutIn);
    kids.forEach(function (k) {
      gutIn.appendChild(k);
    });
  }
  /* 光标在编辑区（surface）里的位置，供补全弹窗贴近光标：行号由文本算出，列宽用同字体的隐藏测量元素量 */
  function caretBox() {
    var src = ta.value,
      d = selD()[1],
      lh = fontSize + 2,
      lines = dispStarts(src),
      line = kcLineAt(lines, d),
      col = src.substring(Math.max(lines[line], d - 400), d),
      left = 2 + cssPx('padding-left', ideOn ? KC_GUT + 3 : 5);
    // Native line numbers (shown while nothing is folded) are as wide as their digits plus two.
    if (!folds.length) left += textWidth(new Array(String(lines.length).length + 3).join('0'));
    var y = 2 + cssPx('padding-top', 4) + line * lh - kcNum(ta.scrollTop, 0);
    return {
      x: left + textWidth(col) - kcNum(ta.scrollLeft, 0),
      top: y,
      bottom: y + lh,
      height: kcNum(ta.clientHeight, 0) || height,
      width: kcNum(ta.clientWidth, 0) || 0
    };
  }

  /* ---- 编辑：用户输入换算回真实文本；脚本编辑尽量走原生文本模型（一步撤销） ---- */
  function rejectEdit(old, segIndex) {
    var seg = view.segs[segIndex];
    ta.value = old;
    setFolds(
      folds.filter(function (f) {
        return !(f.open === seg.open || hides(f, seg.hs, seg.he));
      }),
      false
    );
    setSelD(r2d(seg.hs), r2d(seg.hs));
    toast(I18n.t('cadeditor.ui.code.fold_edit_unfolded'), 'info', 'kc-fold');
  }
  /* 折叠时的一次输入：返回 false 表示这次输入被拒绝（已恢复显示） */
  function syncFolded() {
    var nd = ta.value,
      od = view.display,
      oldText = text,
      oldSel = selD();
    if (nd === od) return true;
    var edit = pendingEdit && pendingEdit.result === nd ? pendingEdit : null;
    if (!edit && before && before.value === od && before.sel[0] !== before.sel[1]) {
      // A replaced selection is exactly [selStart, selEnd): diffing alone could not tell "[⋯]" from "⋯]".
      var a = before.sel[0],
        tail = od.length - before.sel[1];
      if (
        nd.length >= a + tail &&
        nd.substring(0, a) === od.substring(0, a) &&
        nd.substring(nd.length - tail) === od.substring(before.sel[1])
      )
        edit = { from: a, to: before.sel[1], insert: nd.substring(a, nd.length - tail) };
    }
    if (!edit) edit = kcDiff(od, nd, kcNum(ta.selectionEnd, undefined));
    before = null;
    var hit = kcTouches(view.segs, edit.from, edit.to);
    if (hit >= 0) {
      rejectEdit(od, hit);
      return false;
    }
    var rf = kcD2R(view.segs, edit.from),
      rt = kcD2R(view.segs, edit.to),
      delta = edit.insert.length - (rt - rf),
      kept = [];
    text = oldText.substring(0, rf) + edit.insert + oldText.substring(rt);
    folds.forEach(function (f) {
      if (f.close < rf) kept.push(f);
      else if (f.open >= rt) kept.push({ open: f.open + delta, close: f.close + delta });
    });
    var check = kcFoldView(text, kept);
    if (check.display !== nd) {
      // Never guess: restore the last consistent state.
      text = oldText;
      ta.value = od;
      setSelD(oldSel[0], oldSel[1]);
      toast(I18n.t('cadeditor.ui.code.fold_sync_failed'), 'warn', 'kc-fold');
      return false;
    }
    var valid = validFolds(kept);
    folds = kept;
    view = check;
    if (valid.length !== kept.length) {
      var caret = kcD2R(check.segs, kcNum(ta.selectionEnd, 0));
      setFolds(valid, false);
      setSelD(r2d(caret), r2d(caret));
    }
    return true;
  }
  function onInput(e) {
    if (hist.applying) return;
    if (folds.length) {
      if (!syncFolded()) return;
    } else {
      text = ta.value;
      view = { display: text, segs: [] };
    }
    pendingEdit = null;
    histRecord(e && e.inputType);
    changed(e);
  }
  /* 文本已变（输入、替换、撤销）：通知调用方并在停顿后检查 */
  function changed(e) {
    if (o.onText) o.onText(text); // Preserve exact text now; parse only after the input pause.
    if (!pending) PendingCode.entries.push(flush);
    pending = true;
    pairSpans = [];
    paintStatus();
    clearTimeout(timer);
    timer = setTimeout(flush, 300);
    if (assist && assist.input) assist.input(e || {});
  }
  function editDisplay(df, dt, insert) {
    var before = ta.value,
      after = before.substring(0, df) + insert + before.substring(dt);
    if (after === before) return;
    pendingEdit = { from: df, to: dt, insert: insert, result: after };
    var native =
      document.documentElement &&
      document.documentElement.getAttribute('data-editor-code-edit') === 'ready' &&
      typeof ta.dispatchEvent === 'function';
    if (native) {
      ta.setAttribute('data-code-edit', JSON.stringify({ from: df, to: dt, text: insert, length: before.length }));
      try {
        ta.dispatchEvent(new CustomEvent('ed:code-edit', { bubbles: true }));
      } catch (e) {}
      ta.removeAttribute('data-code-edit');
    }
    if (ta.value === before) {
      // No native route (preview / tests): plain assignment, the history restarts here.
      ta.value = after;
      onInput({ inputType: 'insertReplacementText' });
    }
    pendingEdit = null;
  }
  /* 真实坐标的替换（补全、替换、写回字符串都走这里）；会先展开被波及的折叠 */
  function replaceReal(from, to, insert, selA, selB) {
    if (o.readonly) return false;
    var touched = folds.filter(function (f) {
      return from <= f.close && to >= f.open + 1 && !(from <= f.open && to >= f.close + 1);
    });
    if (touched.length)
      setFolds(
        folds.filter(function (f) {
          return touched.indexOf(f) < 0;
        }),
        false
      );
    editDisplay(r2d(from), r2d(to), insert);
    var a = selA === undefined ? from + insert.length : selA;
    selectReal(a, selB === undefined ? a : selB);
    return true;
  }
  function copyReal(cut) {
    var sel = selD(),
      a = d2r(sel[0]),
      b = d2r(sel[1]),
      piece = text.substring(a, b);
    if (Prefs.hostClip && typeof oriel !== 'undefined' && oriel.send) oriel.send('clipboard', { text: piece });
    else copyText(piece, I18n.t('cadeditor.ui.code.characters', piece.length));
    if (cut && !o.readonly) replaceReal(a, b, '');
  }

  var diagnostic = h('div', { class: 'kc-diagnostic' });
  diagnostic.style.display = 'none';
  activate(status, function () {
    if (!err && !nativeError) return;
    diagnostic.style.display = diagnostic.style.display === 'none' ? '' : 'none';
    if (err && err.pos !== null) {
      ta.focus();
      var p = Math.min(text.length, err.pos);
      reveal(p, Math.min(text.length, p + 1));
      if (typeof ta.setSelectionRange === 'function') ta.setSelectionRange(r2d(p), r2d(Math.min(text.length, p + 1)));
    }
  });
  function paintStatus() {
    status.classList.toggle('bad', (!pending && !!err) || !!nativeError);
    diagnostic.textContent =
      nativeError ||
      (err
        ? (err.line
            ? I18n.t('cadeditor.ui.code.article_line_columns', err.line, err.col)
            : I18n.t('cadeditor.ui.code.cannot_determine_error_location')) + err.message
        : '');
    if (nativeError) {
      status.textContent = I18n.t('cadeditor.ui.code.highlight_available_view_reasons');
      return;
    }
    if (pending) {
      status.textContent = I18n.t('cadeditor.ui.code.pending');
      return;
    }
    if (!text.trim()) {
      status.textContent = '';
      return;
    }
    status.textContent = err
      ? '✗ ' + (err.line ? I18n.t('cadeditor.ui.code.article_line_columns', err.line, err.col) : '') + err.message
      : I18n.t(
          'cadeditor.ui.code.effective_line',
          language === 'json' ? 'JSON' : language === 'plain' ? I18n.t('cadeditor.ui.code.text') : 'SNBT',
          text.split('\n').length
        );
  }
  function runCheck() {
    if (checkedText !== text) {
      parsed = undefined;
      err = text.trim()
        ? kcCheck(text, function (v) {
            parsed = validator ? validator(v) : parseSnbt(v);
          })
        : null;
      checkedText = text;
    }
    paintStatus();
    if (err && !nativeError)
      status.textContent = I18n.t('cadeditor.ui.code.view_error', err.line ? err.line + ':' + err.col + ' · ' : '');
    return err;
  }
  function set(v, silent) {
    cancelPending();
    text = v === undefined || v === null ? '' : String(v);
    folds = [];
    foldVersion++;
    view = { display: text, segs: [] };
    if (ta.value !== text) ta.value = text;
    if (ideOn) ta.style.paddingLeft = KC_GUT + 3 + 'px';
    pairSpans = [];
    histReset(); // a new value from outside starts a new history
    hist.last = histSnap();
    highlight();
    runCheck();
    if (assist && assist.flushed) assist.flushed();
    if (!silent && o.onText) o.onText(text);
    if (!silent && o.onInput) o.onInput(text, err, parsed);
  }
  function act(fn) {
    return function () {
      try {
        fn();
      } catch (e) {
        toast(I18n.t('cadeditor.ui.code.unable_handle', e.message || e), 'warn', 'kc-bad');
      }
    };
  }
  function tool(action, label, icon, fn, detail) {
    var button = kBtn('', fn, { icon: icon, cls: 'kc-tool', title: label + (detail ? '：' + detail : '') });
    button.setAttribute('aria-label', label);
    button.setAttribute('data-code-action', action);
    return button;
  }
  var bFmt = tool(
    'format',
    I18n.t('cadeditor.ui.code.format'),
    'list',
    act(function () {
      set(language === 'json' ? JSON.stringify(JSON.parse(text), null, 2) : kcFormat(text, false));
    }),
    I18n.t('cadeditor.ui.code.hierarchy_indentation_retention_type')
  );
  var bCmp = tool(
    'compact',
    I18n.t('cadeditor.ui.code.minify'),
    'layers',
    act(function () {
      set(language === 'json' ? JSON.stringify(JSON.parse(text)) : kcFormat(text, true));
    }),
    I18n.t('cadeditor.ui.code.minify_one_line')
  );
  var bCopy = tool('copy', I18n.t('cadeditor.ui.common.copy'), 'copy', function () {
    copyText(text, I18n.t('cadeditor.ui.code.characters', text.length));
  });
  var bFold = ideOn
    ? tool('fold', I18n.t('cadeditor.ui.code.fold_menu'), 'layers_cards', function () {
        var menu = h('div', { class: 'kc-menu', role: 'menu' });
        function item(label, fn) {
          var row = h('div', { class: 'kc-menu-i', role: 'menuitem', text: label });
          activate(row, function () {
            kPopClose();
            fn();
            ta.focus();
          });
          menu.appendChild(row);
        }
        item(I18n.t('cadeditor.ui.code.fold_all'), function () {
          foldWhere(function () {
            return true;
          });
        });
        item(I18n.t('cadeditor.ui.code.unfold_all'), function () {
          setFolds([], true);
        });
        [1, 2, 3, 4, 5].forEach(function (n) {
          item(I18n.t('cadeditor.ui.code.fold_level', n), function () {
            foldWhere(function (r) {
              return r.depth === n;
            });
          });
        });
        kPopover(bFold, menu, { width: 160, cls: 'kc-menu-pop' });
      })
    : null;
  var actions = h('div', { class: 'kc-actions' }, o.readonly ? [bCopy, bFold] : [bFmt, bCmp, bCopy, bFold]);
  var bar = h('div', { class: 'kc-bar' }, [actions]);
  bar.appendChild(
    h('div', { class: 'kc-fonts', title: I18n.t('cadeditor.ui.code.adjust_snbt_only_without_changing') }, [
      kBtn(
        'A−',
        function () {
          changeFont(-1);
        },
        { cls: 'sm', title: I18n.t('cadeditor.ui.code.zoom_out_snbt') }
      ),
      fontLabel,
      kBtn(
        'A+',
        function () {
          changeFont(1);
        },
        { cls: 'sm', title: I18n.t('cadeditor.ui.code.zoom_snbt') }
      )
    ])
  );
  ta.addEventListener('input', onInput);
  // The selection an edit replaces, recorded before the native model applies it.
  ta.addEventListener('beforeinput', function () {
    before = folds.length ? { value: ta.value, sel: selD() } : null;
    flushSelection(); // the next undo step restores the caret from before this edit
  });
  ta.addEventListener('blur', function () {
    flush();
    if (assist && assist.blur) assist.blur();
  });
  ta.addEventListener('scroll', function () {
    renderGutter(false);
    if (assist && assist.scroll) assist.scroll();
  });
  ['keyup', 'mouseup', 'focus'].forEach(function (type) {
    ta.addEventListener(type, function (e) {
      updatePair();
      renderGutter(false);
      if (assist && assist.caret) assist.caret(e);
    });
  });
  ta.addEventListener('mousedown', function () {
    if (assist && assist.pointer) assist.pointer();
  });
  ta.addEventListener('keydown', function (e) {
    if (assist && assist.keydown && assist.keydown(e)) return;
    var ctrl = e.ctrlKey || e.metaKey,
      k = (e.key || '').toLowerCase();
    if (ctrl && !e.altKey && (k === 'z' || k === 'y')) {
      // Page-owned history: the native stack does not survive folding, so it never handles these keys.
      e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      histStep(k === 'z' && !e.shiftKey);
      return;
    }
    if (ctrl && e.key === 'Enter' && o.onApply) {
      e.preventDefault();
      flush();
      o.onApply();
      return;
    }
    if (folds.length && ctrl && !e.altKey && (k === 'c' || k === 'x')) {
      // The display holds placeholders: copy the real text instead.
      var sel = selD();
      if (sel[0] !== sel[1] && ta.value.substring(sel[0], sel[1]).indexOf(KC_FOLD_PH) >= 0) {
        e.preventDefault();
        copyReal(k === 'x');
        return;
      }
    }
    if (
      !o.readonly &&
      e.key === 'Tab' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      document.documentElement.getAttribute('data-editor-code-indent') === 'ready'
    ) {
      e.preventDefault();
      if (folds.length) {
        // Indenting rewrites whole lines; open folds on them first.
        var s = selD(),
          src = ta.value,
          ls = src.lastIndexOf('\n', s[0] - 1) + 1,
          le = src.indexOf('\n', s[1]);
        if (le < 0) le = src.length;
        if (kcTouches(view.segs, ls, le) >= 0) reveal(d2r(ls), d2r(le));
      }
      ta.setAttribute('data-code-indent', e.shiftKey ? 'out' : 'in');
      ta.dispatchEvent(new CustomEvent('ed:code-indent', { bubbles: true }));
    }
  });
  root.appendChild(bar);
  var surface = h('div', { class: 'kc-surface' }, [ta, status]);
  if (gut) surface.insertBefore(gut, ta);
  root.appendChild(surface);
  root.appendChild(diagnostic);
  applyFont();
  var ed = {
    ta: ta,
    root: root,
    surface: surface,
    bar: bar,
    language: language,
    readonly: !!o.readonly,
    depth: o.stringDepth || 0,
    assist: o.assist,
    text: function () {
      return text;
    },
    caret: function () {
      return d2r(selD()[1]);
    },
    selection: function () {
      var s = selD();
      return [d2r(s[0]), d2r(s[1])];
    },
    select: selectReal,
    reveal: reveal,
    replace: replaceReal,
    marks: function (spans, cur) {
      findMarks = spans || [];
      findCur = cur === undefined ? -1 : cur;
      highlight();
    },
    focus: function () {
      ta.focus();
    },
    flush: flush,
    caretBox: caretBox,
    lineHeight: function () {
      return fontSize + 2;
    },
    addTool: function (button) {
      actions.appendChild(button);
    },
    folded: function () {
      return folds.length > 0;
    },
    onApply: o.onApply
  };
  if (typeof kcAssist === 'function' && o.assist !== false) assist = kcAssist(ed);
  highlight();
  runCheck();
  hist.last = histSnap();
  return {
    el: root,
    surface: surface,
    toolbar: bar,
    get: function () {
      flush();
      return text;
    },
    set: set,
    focus: function () {
      ta.focus();
    },
    flush: flush,
    check: function () {
      flush();
      return runCheck();
    },
    editor: ed,
    fold: function (open) {
      toggleFold(open);
    },
    foldAll: function () {
      foldWhere(function () {
        return true;
      });
    },
    foldLevel: function (n) {
      foldWhere(function (r) {
        return r.depth === n;
      });
    },
    unfoldAll: function () {
      setFolds([], true);
    },
    display: function () {
      return ta.value;
    }
  };
}
