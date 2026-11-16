/* 代码编辑器的 IDE 能力（挂在 code.js 的 kCode 上，所有用 kCode 的 SNBT / JSON 编辑入口都有）：
   查找 / 替换 / 跳转（Ctrl+F / Ctrl+H / Ctrl+G）、自动补全（Ctrl+Space、输入 : { , " 或前缀时自动弹出）、
   嵌入字符串编辑（Ctrl+O，可递归）。补全的候选由宿主算（code_assist 通道，CodeAssistChannel.java）：
   页面只算光标语境（从文本开头到光标的键路径、前缀、键位 / 值位、顶层物品 id），不把整份文本发给宿主。 */

/* ---------- 查找 ---------- */
var KC_FIND_MAX = 5000,
  KC_REGEX_MAX = 500,
  KC_FIND_MS = 250;
/* 嵌套重复（(a+)+、(a|aa)*、(.*x){3,} 这类）会让回溯指数爆炸：Rhino 里没法中断单次匹配，所以直接拒绝 */
function kcRegexRisk(src) {
  var stack = [{ q: false, alt: false }],
    i,
    c,
    n = src.length;
  function quantAt(j) {
    var ch = src.charAt(j);
    if (ch === '*' || ch === '+') return true;
    if (ch === '{') {
      var m = /^\{(\d+)(,(\d*))?\}/.exec(src.substring(j));
      return !!m && (m[2] !== undefined ? m[3] === '' || +m[3] > 1 : +m[1] > 1);
    }
    return false;
  }
  for (i = 0; i < n; i++) {
    c = src.charAt(i);
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') {
      for (i++; i < n && src.charAt(i) !== ']'; i++) if (src.charAt(i) === '\\') i++;
      continue;
    }
    if (c === '(') stack.push({ q: false, alt: false, at: i });
    else if (c === ')' && stack.length > 1) {
      var g = stack.pop();
      if (quantAt(i + 1) && (g.q || (g.alt && kcOverlapAlternatives(src.substring(g.at + 1, i))))) return true;
      if (g.q || quantAt(i + 1)) stack[stack.length - 1].q = true;
    } else if (c === '|') stack[stack.length - 1].alt = true;
    else if (quantAt(i)) stack[stack.length - 1].q = true;
  }
  return false;
}
/* 重复的分组里有多个分支：分支都是互不为前缀的普通字面量（true|false）才安全；(a|aa)、(.|x) 这类会指数回溯 */
function kcOverlapAlternatives(body) {
  var alts = body.replace(/^\?(?::|<?[=!]|<[A-Za-z_]\w*>)/, '').split('|');
  for (var i = 0; i < alts.length; i++) {
    if (!alts[i] || /[\\.[\]()*+?{}^$|]/.test(alts[i])) return true;
    for (var j = 0; j < alts.length; j++) if (i !== j && alts[j].indexOf(alts[i]) === 0) return true;
  }
  return false;
}
function kcWordChar(c) {
  return /[A-Za-z0-9_]/.test(c) || (c > '¿' && /\S/.test(c));
}
/* 查找：o = { case, word, regex, scope: [a, b] }。返回 { matches: [{ s, e, m, g }], error, detail, truncated, timeout } */
function kcFind(text, query, o) {
  o = o || {};
  var out = { matches: [], error: null, truncated: false, timeout: false };
  if (!query) return out;
  var from = o.scope ? Math.max(0, o.scope[0]) : 0,
    to = o.scope ? Math.min(text.length, o.scope[1]) : text.length,
    re;
  if (o.regex) {
    if (query.length > KC_REGEX_MAX) {
      out.error = 'long';
      return out;
    }
    if (kcRegexRisk(query)) {
      out.error = 'risky';
      return out;
    }
    try {
      re = new RegExp(query, 'gm' + (o.case ? '' : 'i'));
    } catch (e) {
      out.error = 'invalid';
      out.detail = String(e.message || e);
      return out;
    }
  } else re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g' + (o.case ? '' : 'i'));
  var started = Date.now(),
    steps = 0,
    m;
  re.lastIndex = from;
  while ((m = re.exec(text)) !== null) {
    var s = m.index,
      e = s + m[0].length;
    if (s >= to || e > to) break;
    if (++steps % 64 === 0 && Date.now() - started > KC_FIND_MS) {
      out.timeout = true;
      break;
    }
    if (!m[0].length) {
      re.lastIndex = s + 1;
      continue;
    }
    if (o.word && ((s > 0 && kcWordChar(text.charAt(s - 1))) || (e < text.length && kcWordChar(text.charAt(e)))))
      continue;
    out.matches.push({ s: s, e: e, m: o.regex ? Array.prototype.slice.call(m) : null, g: o.regex ? m.groups : null });
    if (out.matches.length >= KC_FIND_MAX) {
      out.truncated = true;
      break;
    }
  }
  return out;
}
/* 正则替换文本：$$、$&、$1…$99、$<名字> */
function kcExpand(repl, m, groups) {
  if (!m) return repl;
  return repl.replace(/\$(\$|&|\d{1,2}|<([^>]*)>)/g, function (all, t, name) {
    if (t === '$') return '$';
    if (t === '&') return m[0];
    if (name !== undefined) return groups && groups[name] !== undefined ? groups[name] : '';
    if (+t < m.length && +t > 0) return m[+t] === undefined ? '' : m[+t];
    if (t.length === 2 && +t.charAt(0) > 0 && +t.charAt(0) < m.length) return (m[+t.charAt(0)] || '') + t.charAt(1);
    return all;
  });
}
/* 全部替换算成一段编辑 { from, to, insert, count }：只替换首个到末个命中之间，整体一步写入（一步撤销） */
function kcReplaceAll(text, query, o, repl) {
  var res = kcFind(text, query, o);
  if (res.error || res.truncated || res.timeout || !res.matches.length)
    return { count: 0, error: res.error, truncated: res.truncated, timeout: res.timeout, detail: res.detail };
  var parts = [],
    list = res.matches,
    pos = list[0].s;
  list.forEach(function (m) {
    parts.push(text.substring(pos, m.s), o && o.regex ? kcExpand(repl, m.m, m.g) : repl);
    pos = m.e;
  });
  return { from: list[0].s, to: list[list.length - 1].e, insert: parts.join(''), count: list.length };
}

/* ---------- 嵌入字符串 ---------- */
var KC_STRING_DEPTH = 16,
  KC_STRING_MAX = 2000000;
/* 光标所在的带引号字符串：{ start, end（含收尾引号之后）, quote, raw, key（是不是键） }；不在字符串里返回 null */
function kcStringAt(text, pos) {
  var ls = text.lastIndexOf('\n', pos - 1) + 1,
    le = text.indexOf('\n', pos);
  if (le < 0) le = text.length;
  for (var i = ls; i < le; i++) {
    var c = text.charAt(i);
    if (c !== '"' && c !== "'") continue;
    var j = i + 1;
    while (j < le && text.charAt(j) !== c) j += text.charAt(j) === '\\' ? 2 : 1;
    if (j >= le) return null;
    if (pos > i && pos <= j) {
      var after = text.substring(j + 1).replace(/^[ \t\r\n]+/, '');
      return { start: i, end: j + 1, quote: c, raw: text.substring(i, j + 1), key: after.charAt(0) === ':' };
    }
    i = j;
  }
  return null;
}
function kcHex(s, n) {
  if (!new RegExp('^[0-9a-fA-F]{' + n + '}$').test(s))
    throw new Error(I18n.t('cadeditor.ui.codeassist.unsupported_escape', s));
  return parseInt(s, 16);
}
/* SNBT 字符串字面量（带引号）→ 值。支持 \\ \" \' \n \t \r \b \f \s \xHH \uHHHH \UHHHHHHHH；其它转义拒绝（不猜） */
function kcDecodeString(raw) {
  var body = raw.slice(1, -1),
    out = [],
    i = 0;
  while (i < body.length) {
    var c = body.charAt(i);
    if (c !== '\\') {
      out.push(c);
      i++;
      continue;
    }
    var e = body.charAt(i + 1),
      simple = { '\\': '\\', '"': '"', "'": "'", n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', s: ' ' };
    if (simple[e] !== undefined) {
      out.push(simple[e]);
      i += 2;
      continue;
    }
    var len = e === 'x' ? 2 : e === 'u' ? 4 : e === 'U' ? 8 : 0;
    if (!len) throw new Error(I18n.t('cadeditor.ui.codeassist.unsupported_escape', '\\' + e));
    var cp = kcHex(body.substr(i + 2, len), len);
    if (cp > 0x10ffff) throw new Error(I18n.t('cadeditor.ui.codeassist.unsupported_escape', body.substr(i, len + 2)));
    if (cp > 0xffff) {
      cp -= 0x10000;
      out.push(String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)));
    } else out.push(String.fromCharCode(cp));
    i += 2 + len;
  }
  return out.join('');
}
/* 值 → SNBT 字符串字面量，沿用原来的引号 */
function kcEncodeString(value, quote) {
  var q = quote === "'" ? "'" : '"';
  return (
    q +
    value
      .replace(/\\/g, '\\\\')
      .replace(q === '"' ? /"/g : /'/g, '\\' + q)
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t') +
    q
  );
}
/* 字符串内容像什么：'json' | 'snbt' | 'plain' */
function kcEmbeddedLanguage(value) {
  var t = value.trim();
  if (!/^[{[]/.test(t)) return 'plain';
  try {
    JSON.parse(t);
    return 'json';
  } catch (e) {}
  return 'snbt';
}
function kcSignificant(text, language) {
  var toks = kcTokens(text, language);
  if (
    toks.some(function (t) {
      return t.t === 'bad';
    })
  )
    return null;
  return toks.filter(function (t) {
    return t.t !== 'ws' && t.t !== 'nl';
  });
}
function kcValueToken(t) {
  var k = t.t.charAt(0);
  return !(t.t === 'p' || ((k === 'o' || k === 'c') && t.t.length === 2));
}
/* 只按 token 加换行缩进：不重排数字、不改引号，记号原样保留（压缩回去逐字一致） */
function kcPrettyTokens(text, language) {
  var sig = kcSignificant(text, language);
  if (!sig) return null;
  var out = [],
    depth = 0;
  function nl() {
    return '\n' + new Array(depth + 1).join('  ');
  }
  for (var i = 0; i < sig.length; i++) {
    var t = sig[i],
      k = t.t.charAt(0),
      nx = sig[i + 1];
    if (k === 'o' && t.t.length === 2) {
      out.push(t.s);
      if (nx && nx.t === 'kw') {
        out.push(nx.s);
        i++;
        if (sig[i + 1] && sig[i + 1].s === ';') {
          out.push(';');
          i++;
        }
        nx = sig[i + 1];
      }
      if (nx && nx.t.charAt(0) === 'c' && nx.t.length === 2) {
        out.push(nx.s);
        i++;
        continue;
      }
      depth++;
      out.push(nl());
    } else if (k === 'c' && t.t.length === 2) {
      depth = Math.max(0, depth - 1);
      out.push(nl(), t.s);
    } else if (t.t === 'p' && t.s === ',') out.push(',', nl());
    else if (t.t === 'p' && t.s === ':') out.push(': ');
    else {
      if (i > 0 && kcValueToken(sig[i - 1]) && kcValueToken(t)) out.push(' ');
      out.push(t.s);
    }
  }
  return out.join('');
}
function kcCompactTokens(text, language) {
  var sig = kcSignificant(text, language);
  if (!sig) return null;
  var out = [];
  sig.forEach(function (t, i) {
    if (i > 0 && kcValueToken(sig[i - 1]) && kcValueToken(t)) out.push(' ');
    out.push(t.s);
  });
  return out.join('');
}

/* ---------- 补全语境 ---------- */
var KC_CTX_MAX = 400000;
function kcWordAt(c, value) {
  return /[A-Za-z0-9_.+\-#!\/]/.test(c) || (value && c === ':');
}
/* 光标语境：{ mode: 'key' | 'value' | 'none', path, prefix, quote, start, end, siblings, values, item, root, component }
   path：键位时是所在复合的路径，值位时再加上当前键（列表元素记作 "[]"）；start / end 是要被候选替换的范围 */
function kcContext(text, pos, o) {
  o = o || {};
  var none = { mode: 'none' };
  if (pos > KC_CTX_MAX) return none;
  var stack = [],
    item = null,
    i = 0,
    n = pos,
    c;
  function top() {
    return stack[stack.length - 1];
  }
  function scalar(v) {
    var f = top();
    if (!f) return;
    if (f.t === 'o') {
      if (f.state === 'key') {
        f.key = v;
        f.keys.push(v);
        f.state = 'colon';
      } else if (f.state === 'value') {
        if (f.count < 16 && v.length <= 256) {
          f.vals[f.key] = v;
          f.count++;
        }
        if (stack.length === 1 && f.key === 'id') item = v;
        f.state = 'after';
      }
    } else if (f.state === 'value') f.state = 'after';
  }
  function readString(at) {
    var q = text.charAt(at),
      j = at + 1,
      buf = [];
    while (j < text.length) {
      var d = text.charAt(j);
      if (d === '\\') {
        buf.push(text.charAt(j + 1));
        j += 2;
        continue;
      }
      if (d === q || d === '\n') break;
      buf.push(d);
      j++;
    }
    return { end: j, closed: text.charAt(j) === q, value: buf.join('') };
  }
  function forward(f, from) {
    if (f.t !== 'o') return;
    var d = 0,
      j = from,
      limit = Math.min(text.length, from + 20000),
      pendingTok = null,
      lastKey = null;
    function token(v) {
      if (lastKey !== null) {
        if (f.count < 16 && v.length <= 256 && f.vals[lastKey] === undefined) {
          f.vals[lastKey] = v;
          f.count++;
        }
        lastKey = null;
      } else pendingTok = v;
    }
    while (j < limit) {
      var ch = text.charAt(j);
      if (ch === '"' || ch === "'") {
        var s = readString(j);
        if (d === 0) token(s.value);
        j = s.closed ? s.end + 1 : s.end;
        continue;
      }
      if (ch === '{' || ch === '[') {
        d++;
        lastKey = null;
        pendingTok = null;
      } else if (ch === '}' || ch === ']') {
        if (d === 0) break;
        d--;
      } else if (d === 0) {
        if (ch === ':') {
          if (pendingTok !== null && f.keys.length < 64) f.keys.push(pendingTok);
          lastKey = pendingTok;
          pendingTok = null;
        } else if (ch === ',') {
          lastKey = null;
          pendingTok = null;
        } else if (kcWordAt(ch, lastKey !== null)) {
          var k = j;
          while (k < limit && kcWordAt(text.charAt(k), lastKey !== null)) k++;
          token(text.substring(j, k));
          j = k;
          continue;
        }
      }
      j++;
    }
  }
  function result(f, prefix, quote, start, end) {
    if (!f || stack.length > 24) return none;
    var mode = f.state === 'key' && f.t === 'o' ? 'key' : f.state === 'value' ? 'value' : 'none';
    if (mode === 'none' || (mode === 'value' && f.t === 'o' && f.key === null)) return none;
    var path = [];
    for (var x = 1; x < stack.length; x++) path.push(stack[x].pk);
    if (mode === 'value') path.push(f.t === 'o' ? f.key : '[]');
    if (mode === 'value' && f.t === 'o') delete f.vals[f.key];
    forward(f, end);
    var root =
      o.root ||
      (o.component ? 'component' : /^\s*\{\s*(["']?)(?:id|count|components)\1\s*:/.test(text) ? 'stack' : 'nbt');
    return {
      mode: mode,
      path: path,
      prefix: prefix,
      quote: quote,
      start: start,
      end: end,
      siblings:
        f.t === 'o'
          ? f.keys
              .filter(function (k) {
                return k !== prefix;
              })
              .slice(0, 64)
          : [],
      values: f.vals,
      item: item,
      root: root,
      component: o.component || null
    };
  }
  while (i < n) {
    c = text.charAt(i);
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      var s = readString(i);
      if (n <= s.end) {
        var f0 = top(),
          raw = text.substring(i + 1, n);
        // An unterminated string ends at the cursor: never swallow the text after it.
        return result(f0, raw.replace(/\\(.)/g, '$1'), c, i, s.closed ? s.end + 1 : n);
      }
      scalar(s.value);
      i = s.closed ? s.end + 1 : s.end;
      continue;
    }
    if (c === '{' || c === '[') {
      var p = top();
      stack.push({
        t: c === '{' ? 'o' : 'l',
        state: c === '{' ? 'key' : 'value',
        key: null,
        keys: [],
        vals: {},
        count: 0,
        pk: p ? (p.t === 'o' ? p.key : '[]') : null
      });
      i++;
      continue;
    }
    if (c === '}' || c === ']') {
      stack.pop();
      if (top()) top().state = 'after';
      i++;
      continue;
    }
    if (c === ',') {
      var fc = top();
      if (fc) {
        fc.state = fc.t === 'o' ? 'key' : 'value';
        if (fc.t === 'o') fc.key = null;
      }
      i++;
      continue;
    }
    if (c === ':') {
      var fk = top();
      if (fk && fk.t === 'o' && fk.state === 'colon') fk.state = 'value';
      i++;
      continue;
    }
    var fr = top(),
      valueState = !!fr && fr.state === 'value',
      k = i;
    while (k < text.length && kcWordAt(text.charAt(k), valueState)) k++;
    if (k === i) {
      i++;
      continue;
    }
    if (k >= n) return result(fr, text.substring(i, n), '', i, k);
    scalar(text.substring(i, k));
    i = k;
  }
  return result(top(), '', '', pos, pos);
}
function kcEscapeIn(v, q) {
  return v.replace(/\\/g, '\\\\').replace(q === "'" ? /'/g : /"/g, '\\' + q);
}
/* 采纳候选：{ from, to, insert, caret }。键补 ": " 和值的外形（{} / [] / ""，光标落在里面）；值补引号；
   后面还有别的键 / 值时补逗号 */
function kcCompletionEdit(text, ctx, item) {
  var v = String(item.v),
    from = ctx.start,
    to = ctx.end,
    rest = text.substring(to),
    sp = /^[ \t]*/.exec(rest)[0],
    next = rest.charAt(sp.length),
    nlAt = rest.indexOf('\n'),
    lineRest = (nlAt < 0 ? rest : rest.substring(0, nlAt)).trim(),
    after = rest.replace(/^\s+/, '').charAt(0),
    insert,
    caret;
  function comma() {
    if (lineRest) return ',}]:'.indexOf(lineRest.charAt(0)) < 0 ? ', ' : '';
    return after && ',}]'.indexOf(after) < 0 ? ',' : '';
  }
  if (ctx.mode === 'key') {
    insert = ctx.quote
      ? ctx.quote + kcEscapeIn(v, ctx.quote) + ctx.quote
      : /^[A-Za-z0-9_\-.+]+$/.test(v)
        ? v
        : '"' + kcEscapeIn(v, '"') + '"';
    if (next === ':') {
      caret = from + insert.length + sp.length + 1;
      if (rest.charAt(sp.length + 1) === ' ') caret++;
      return { from: from, to: to, insert: insert, caret: caret };
    }
    var tmpl = item.t || '';
    insert += ': ' + tmpl;
    caret = from + insert.length - (tmpl && item.k !== 'removal' ? tmpl.length - 1 : 0);
    insert += comma();
    return { from: from, to: to, insert: insert, caret: caret };
  }
  insert = item.k === 'bool' ? v : (ctx.quote || '"') + kcEscapeIn(v, ctx.quote || '"') + (ctx.quote || '"');
  var tail = comma();
  return { from: from, to: to, insert: insert + tail, caret: from + insert.length + tail.length };
}
/* 宿主不可用时也知道的候选：物品栈顶层键、布尔值 */
function kcLocalCandidates(ctx) {
  if (ctx.mode === 'key' && ctx.root === 'stack' && !ctx.path.length)
    return [
      { v: 'id', k: 'key', t: '""' },
      { v: 'count', k: 'key' },
      { v: 'components', k: 'key', t: '{}', o: true }
    ].filter(function (x) {
      return ctx.siblings.indexOf(x.v) < 0;
    });
  if (ctx.mode === 'value' && ctx.root === 'nbt')
    return [
      { v: 'true', k: 'bool' },
      { v: 'false', k: 'bool' }
    ];
  return [];
}
function kcFilterItems(items, prefix, limit) {
  var needle = String(prefix || '')
      .toLowerCase()
      .replace(/^[!#]+/, ''),
    ranked = [];
  items.forEach(function (it, i) {
    var v = String(it.v)
        .toLowerCase()
        .replace(/^[!#]+/, ''),
      colon = v.indexOf(':'),
      r = !needle
        ? 0
        : v.indexOf(needle) === 0 ||
            (colon >= 0 && needle.indexOf(':') < 0 && v.indexOf(needle, colon + 1) === colon + 1)
          ? 0
          : v.indexOf(needle) >= 0
            ? 1
            : -1;
    if (r >= 0) ranked.push({ r: r, i: i, it: it });
  });
  ranked.sort(function (a, b) {
    return a.r - b.r || a.i - b.i;
  });
  return ranked.slice(0, limit || 60).map(function (x) {
    return x.it;
  });
}

/* ---------- 宿主通道：每个 view 只有一个有效请求，新请求取代旧的；没回应 / 老宿主时调用方用本地候选 ---------- */
var CodeAssistHost = {
  seq: 0,
  views: {},
  supported: null,
  listening: false,
  listen: function () {
    if (this.listening || typeof oriel === 'undefined' || !oriel.on) return;
    this.listening = true;
    var me = this;
    oriel.on('patch', function (p) {
      if (p && p.key === 'code_assist.result') me.receive(p.value);
    });
  },
  request: function (view, msg, cb) {
    if (
      this.supported === false ||
      typeof oriel === 'undefined' ||
      !oriel.send ||
      (typeof Reg !== 'undefined' && Reg.live && !Reg.live())
    )
      return false;
    this.listen();
    var me = this,
      id = 'ca' + ++this.seq,
      old = this.views[view];
    if (old) clearTimeout(old.timer);
    msg.requestId = id;
    msg.view = view;
    var len;
    try {
      len = JSON.stringify(msg).length;
    } catch (e) {
      return false;
    }
    if (len > 7600) return false;
    var v = (this.views[view] = { id: id, cb: cb, view: view, timer: null });
    v.timer = setTimeout(
      function () {
        if (me.views[view] !== v) return;
        delete me.views[view];
        if (me.supported !== true) me.supported = false;
        cb({ fallback: true });
      },
      this.supported === true ? 4000 : 3000
    );
    var sent = false;
    try {
      sent = oriel.send('code_assist', msg);
    } catch (e) {}
    if (sent === false) {
      clearTimeout(v.timer);
      delete this.views[view];
      return false;
    }
    return true;
  },
  cancel: function (view) {
    var v = this.views[view];
    if (!v) return;
    clearTimeout(v.timer);
    delete this.views[view];
  },
  receive: function (r) {
    if (!r || typeof r !== 'object') return;
    var v = null,
      k;
    for (k in this.views) if (this.views[k].id === r.requestId) v = this.views[k];
    if (!v) return;
    this.supported = true;
    clearTimeout(v.timer);
    delete this.views[v.view];
    if (r.cancelled) return;
    v.cb(r.ok ? r : { fallback: true, error: r.error || 'ERROR', reason: r.reason });
  }
};

/* ---------- 补全弹窗 ---------- */
var KcAssistSeq = 0;
function kcCompleter(ed) {
  var box = null,
    items = [],
    shown = [],
    index = 0,
    ctx = null,
    timer = null,
    view = 'kc' + ++KcAssistSeq,
    message = '';
  function enabled() {
    return ed.language === 'snbt' && !ed.readonly;
  }
  function hint() {
    var a = ed.assist || {};
    return { root: a.root, component: a.component };
  }
  function context() {
    return kcContext(ed.text(), ed.caret(), hint());
  }
  /* 浮层关闭也走统一的退出动画；退出中的旧弹窗是 inert，不再接收输入 */
  function dropBox() {
    if (box) {
      if (typeof uiDismiss === 'function') uiDismiss(box);
      else box.remove();
    }
    box = null;
  }
  function close() {
    clearTimeout(timer);
    dropBox();
    shown = [];
    ctx = null;
    message = '';
    CodeAssistHost.cancel(view);
  }
  function same(a, b) {
    return a && b && a.mode === b.mode && a.start === b.start && a.path.join('\u0000') === b.path.join('\u0000');
  }
  function label(it) {
    if (it.d) return it.d;
    if (it.k === 'removal') return I18n.t('cadeditor.ui.codeassist.remove_component');
    if (it.df) return I18n.t('cadeditor.ui.codeassist.default_component');
    if (it.k === 'tag') return I18n.t('cadeditor.ui.codeassist.tag');
    return '';
  }
  function render() {
    if (!shown.length && !message) {
      dropBox();
      return;
    }
    if (!box) {
      box = h('div', { class: 'kc-ac', role: 'listbox' });
      ed.surface.appendChild(box);
    }
    clear(box);
    if (!shown.length) box.appendChild(h('div', { class: 'kc-ac-empty', text: message }));
    shown.forEach(function (it, i) {
      var d = label(it),
        row = h('div', { class: 'kc-ac-i' + (i === index ? ' on' : ''), role: 'option' }, [
          h('span', { class: 'kc-ac-v', text: String(it.v) }),
          d ? h('span', { class: 'kc-ac-d', text: d }) : null
        ]);
      row.addEventListener('mousedown', function (e) {
        e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        accept(it);
      });
      box.appendChild(row);
    });
    var cb = ed.caretBox(),
      rows = Math.max(1, Math.min(8, shown.length)),
      bh = rows * 15 + 6,
      top = cb.bottom + bh > cb.height && cb.top - bh > 0 ? cb.top - bh : cb.bottom;
    box.style.left = Math.max(2, Math.min(cb.x, (cb.width || 400) - 222)) + 'px';
    box.style.top = Math.max(0, top) + 'px';
    var on = box.querySelector('.kc-ac-i.on');
    if (on && on.scrollIntoView)
      try {
        on.scrollIntoView({ block: 'nearest' });
      } catch (e) {}
  }
  function filter() {
    shown = kcFilterItems(items, ctx ? ctx.prefix : '', 60);
    index = Math.max(0, Math.min(index, shown.length - 1));
  }
  function request(force) {
    if (!enabled()) return;
    var c = context();
    if (c.mode === 'none') {
      if (force) {
        items = [];
        shown = [];
        ctx = c;
        message = I18n.t('cadeditor.ui.codeassist.no_candidates');
        render();
      } else close();
      return;
    }
    var keep = same(c, ctx);
    ctx = c;
    if (!keep) index = 0;
    var local = kcLocalCandidates(c),
      msg = {
        root: c.root,
        component: c.component || undefined,
        item: c.item || undefined,
        path: c.path,
        mode: c.mode,
        prefix: c.prefix.slice(0, 256),
        siblings: c.siblings,
        values: c.values,
        limit: 120
      };
    var sent = CodeAssistHost.request(view, msg, function (r) {
      if (ctx !== c) return;
      if (r.fallback) {
        items = local;
        message = force && !local.length ? r.reason || I18n.t('cadeditor.ui.codeassist.completion_offline') : '';
      } else {
        items = r.items || [];
        message = force ? I18n.t('cadeditor.ui.codeassist.no_candidates') : '';
      }
      filter();
      render();
    });
    if (!sent) {
      items = local;
      message = force && !local.length ? I18n.t('cadeditor.ui.codeassist.completion_offline') : '';
      filter();
      render();
    } else if (local.length && !keep) {
      items = local;
      filter();
      render();
    }
  }
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      request(false);
    }, ms);
  }
  function accept(it) {
    var c = context();
    close();
    if (c.mode === 'none') return;
    var edit = kcCompletionEdit(ed.text(), c, it);
    ed.replace(edit.from, edit.to, edit.insert, edit.caret, edit.caret);
    ed.focus();
    // After a key the cursor is at its value: offer values right away.
    if (c.mode === 'key' && it.k !== 'removal') schedule(60);
  }
  return {
    trigger: function (force) {
      request(!!force);
    },
    close: close,
    isOpen: function () {
      return !!box;
    },
    input: function (e) {
      if (!enabled()) return;
      var type = e && e.inputType,
        data = e && typeof e.data === 'string' ? e.data : '';
      if (box && ctx) {
        var c = context();
        if (c.mode === 'none' || !same(c, ctx)) {
          close();
          if (c.mode !== 'none') schedule(150);
          return;
        }
        ctx = c;
        filter();
        render();
        schedule(150);
        return;
      }
      // On by default, no shortcut needed (as in Item-Editor): typing anywhere a key or value can be completed opens
      // the list after a short pause. request(false) shows nothing where the context has no candidates.
      if ((type === 'insertText' || type === 'insertCompositionText') && data) {
        var last = data.charAt(data.length - 1);
        if (':{[,"\''.indexOf(last) >= 0) schedule(80);
        else if (/[A-Za-z0-9_!#.\-\/]/.test(last)) schedule(120);
        return;
      }
      // Deleting back into a word reopens the list for what is left of it.
      if (/^delete(Content|Word)Backward$/.test(type || '')) {
        var caret = ed.caret(),
          text = ed.text();
        if (caret > 0 && /[A-Za-z0-9_!#.\-\/:]/.test(text.charAt(caret - 1))) schedule(150);
      }
    },
    keydown: function (e) {
      if (!box) return false;
      var k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'PageDown' || k === 'PageUp') {
        if (!shown.length) return false;
        e.preventDefault();
        var step = k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : k === 'PageDown' ? 7 : -7;
        index = (index + step + shown.length) % shown.length;
        if (Math.abs(step) > 1) index = Math.max(0, Math.min(shown.length - 1, index));
        render();
        return true;
      }
      if ((k === 'Enter' || k === 'Tab') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!shown.length) {
          close();
          return false;
        }
        e.preventDefault();
        accept(shown[index]);
        return true;
      }
      if (k === 'Escape') {
        e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        close();
        return true;
      }
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') close();
      return false;
    },
    destroy: close
  };
}

/* ---------- 查找 / 替换 / 跳转面板（放在编辑区上方） ---------- */
function kcFindPanel(ed, memo) {
  memo = memo || {};
  var saved = Prefs.get('codeFind', {}) || {},
    st = {
      open: false,
      mode: 'find',
      opts: { case: !!saved.case, word: !!saved.word, regex: !!saved.regex },
      scope: memo.scope || null,
      res: null,
      text: null,
      cur: -1,
      timer: null
    };
  var q = h('input', {
      class: 'k-input kc-fq',
      type: 'text',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.codeassist.find_placeholder')
    }),
    rq = h('input', {
      class: 'k-input kc-fr',
      type: 'text',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.codeassist.replace_placeholder')
    }),
    gq = h('input', {
      class: 'k-input kc-fg',
      type: 'text',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.codeassist.goto_placeholder')
    }),
    count = h('span', { class: 'kc-find-count', role: 'status' }),
    msg = h('div', { class: 'kc-find-msg', role: 'alert' });
  q.value = memo.q || '';
  rq.value = memo.r || '';
  q.setAttribute('aria-label', I18n.t('cadeditor.ui.codeassist.find_placeholder'));
  rq.setAttribute('aria-label', I18n.t('cadeditor.ui.codeassist.replace_placeholder'));
  gq.setAttribute('aria-label', I18n.t('cadeditor.ui.codeassist.goto_placeholder'));
  function opt(key, text, title) {
    var b = h('div', {
      class: 'kc-opt' + (key !== 'sel' && st.opts[key] ? ' on' : ''),
      role: 'checkbox',
      text: text,
      title: title
    });
    b.setAttribute('aria-label', title);
    b.setAttribute('aria-checked', key !== 'sel' && st.opts[key] ? 'true' : 'false');
    activate(b, function () {
      if (key === 'sel') {
        if (st.scope) st.scope = null;
        else {
          var s = ed.selection();
          if (s[0] === s[1]) {
            msg.textContent = I18n.t('cadeditor.ui.codeassist.selection_needed');
            return;
          }
          st.scope = s;
        }
      } else {
        st.opts[key] = !st.opts[key];
        Prefs.set('codeFind', { case: st.opts.case, word: st.opts.word, regex: st.opts.regex });
      }
      var on = key === 'sel' ? !!st.scope : st.opts[key];
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      search(false);
      q.focus();
    });
    return b;
  }
  function btn(icon, title, fn, label) {
    var b = kBtn(label || '', fn, { icon: icon || undefined, cls: 'sm', title: title });
    b.setAttribute('aria-label', title);
    return b;
  }
  var bPrev = btn('up', I18n.t('cadeditor.ui.codeassist.previous'), function () {
      next(-1);
    }),
    bNext = btn('down', I18n.t('cadeditor.ui.codeassist.next'), function () {
      next(1);
    }),
    bClose = btn('close', I18n.t('cadeditor.ui.codeassist.close'), function () {
      close();
    }),
    bRep = btn(null, I18n.t('cadeditor.ui.codeassist.replace'), replaceOne, I18n.t('cadeditor.ui.codeassist.replace')),
    bAll = btn(
      null,
      I18n.t('cadeditor.ui.codeassist.replace_all'),
      replaceAll,
      I18n.t('cadeditor.ui.codeassist.replace_all')
    ),
    bGo = btn(null, I18n.t('cadeditor.ui.codeassist.go'), go, I18n.t('cadeditor.ui.codeassist.go'));
  var rowFind = h('div', { class: 'kc-find-row' }, [
      q,
      opt('case', 'Aa', I18n.t('cadeditor.ui.codeassist.match_case')),
      opt('word', 'W', I18n.t('cadeditor.ui.codeassist.whole_word')),
      opt('regex', '.*', I18n.t('cadeditor.ui.codeassist.regex')),
      opt('sel', I18n.t('cadeditor.ui.codeassist.selection_short'), I18n.t('cadeditor.ui.codeassist.in_selection')),
      count,
      bPrev,
      bNext,
      bClose
    ]),
    rowRep = h('div', { class: 'kc-find-row' }, [rq, bRep, bAll]),
    rowGo = h('div', { class: 'kc-find-row' }, [gq, bGo]);
  var el = h('div', { class: 'kc-find' }, [rowFind, rowRep, rowGo, msg]);
  function stale() {
    return !st.res || st.text !== ed.text();
  }
  function search(move) {
    var text = ed.text();
    msg.textContent = '';
    st.text = text;
    st.res = kcFind(text, q.value, { case: st.opts.case, word: st.opts.word, regex: st.opts.regex, scope: st.scope });
    var r = st.res,
      m = r.matches;
    if (r.error === 'invalid') msg.textContent = I18n.t('cadeditor.ui.codeassist.regex_invalid', r.detail || '');
    else if (r.error === 'risky') msg.textContent = I18n.t('cadeditor.ui.codeassist.regex_risky');
    else if (r.error === 'long') msg.textContent = I18n.t('cadeditor.ui.codeassist.regex_too_long', KC_REGEX_MAX);
    else if (r.truncated) msg.textContent = I18n.t('cadeditor.ui.codeassist.too_many', KC_FIND_MAX);
    else if (r.timeout) msg.textContent = I18n.t('cadeditor.ui.codeassist.timeout');
    var sel = ed.selection();
    st.cur = -1;
    for (var i = 0; i < m.length; i++)
      if (m[i].s === sel[0] && m[i].e === sel[1]) {
        st.cur = i;
        break;
      }
    if (move && st.cur < 0 && m.length) {
      st.cur = 0;
      for (var j = 0; j < m.length; j++)
        if (m[j].s >= sel[0]) {
          st.cur = j;
          break;
        }
      ed.select(m[st.cur].s, m[st.cur].e);
    }
    paint();
  }
  function paint() {
    var m = st.res ? st.res.matches : [];
    count.textContent = !q.value
      ? ''
      : m.length
        ? I18n.t('cadeditor.ui.codeassist.count', st.cur >= 0 ? st.cur + 1 : '?', m.length)
        : I18n.t('cadeditor.ui.codeassist.no_results');
    count.classList.toggle('bad', !!q.value && !m.length);
    ed.marks(st.open ? m : [], st.cur);
  }
  function next(dir) {
    if (!q.value) return;
    if (stale()) search(false);
    var m = st.res.matches;
    if (!m.length) return;
    var sel = ed.selection(),
      i;
    if (dir > 0) {
      for (i = 0; i < m.length && m[i].s < sel[1]; i++);
      if (i >= m.length) i = 0;
    } else {
      for (i = m.length - 1; i >= 0 && m[i].e > sel[0]; i--);
      if (i < 0) i = m.length - 1;
    }
    st.cur = i;
    ed.select(m[i].s, m[i].e);
    paint();
  }
  function replaceOne() {
    if (ed.readonly || !q.value) return;
    if (stale()) search(false);
    var m = st.res.matches,
      sel = ed.selection(),
      k = -1;
    for (var i = 0; i < m.length; i++)
      if (m[i].s === sel[0] && m[i].e === sel[1]) {
        k = i;
        break;
      }
    if (k < 0) {
      next(1);
      return;
    }
    var rep = st.opts.regex ? kcExpand(rq.value, m[k].m, m[k].g) : rq.value;
    if (st.scope) st.scope = [st.scope[0], st.scope[1] + rep.length - (m[k].e - m[k].s)];
    ed.replace(m[k].s, m[k].e, rep);
    search(false);
    next(1);
  }
  function replaceAll() {
    if (ed.readonly || !q.value) return;
    var r = kcReplaceAll(
      ed.text(),
      q.value,
      { case: st.opts.case, word: st.opts.word, regex: st.opts.regex, scope: st.scope },
      rq.value
    );
    if (!r.count) {
      search(false);
      if (r.truncated) msg.textContent = I18n.t('cadeditor.ui.codeassist.too_many', KC_FIND_MAX);
      else if (r.timeout) msg.textContent = I18n.t('cadeditor.ui.codeassist.timeout');
      return;
    }
    if (st.scope) st.scope = [st.scope[0], st.scope[1] + r.insert.length - (r.to - r.from)];
    ed.replace(r.from, r.to, r.insert, r.from, r.from + r.insert.length);
    toast(I18n.t('cadeditor.ui.codeassist.replaced', r.count), 'ok', 'kc-replace');
    search(false);
  }
  function go() {
    var m = /^\s*(\d+)\s*(?:[:,\s]\s*(\d+))?\s*$/.exec(gq.value),
      text = ed.text();
    if (!m) {
      msg.textContent = I18n.t('cadeditor.ui.codeassist.goto_invalid');
      return;
    }
    var starts = kcLineStarts(text),
      line = +m[1],
      col = m[2] ? +m[2] : 1;
    if (line < 1 || line > starts.length) {
      msg.textContent = I18n.t('cadeditor.ui.codeassist.goto_out_of_range', starts.length);
      return;
    }
    var ls = starts[line - 1],
      le = line < starts.length ? starts[line] - 1 : text.length,
      at = Math.min(le, ls + Math.max(0, col - 1));
    close();
    ed.select(at, at);
    ed.focus();
  }
  function keys(e, field) {
    var k = (e.key || '').toLowerCase(),
      ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'F3') {
      e.preventDefault();
      next(e.shiftKey ? -1 : 1);
      return;
    }
    if (ctrl && !e.altKey && (k === 'f' || k === 'h' || k === 'g')) {
      e.preventDefault();
      open(k === 'f' ? 'find' : k === 'h' ? 'replace' : 'goto');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (field === q) next(e.shiftKey ? -1 : 1);
      else if (field === rq) replaceOne();
      else go();
    }
  }
  [q, rq, gq].forEach(function (field) {
    field.addEventListener('keydown', function (e) {
      keys(e, field);
    });
  });
  q.addEventListener('input', function () {
    clearTimeout(st.timer);
    st.timer = setTimeout(function () {
      search(true);
    }, 120);
  });
  function selectAll(field) {
    if (typeof field.setSelectionRange === 'function') field.setSelectionRange(0, field.value.length);
  }
  function open(mode) {
    if (mode === 'replace' && ed.readonly) mode = 'find';
    st.mode = mode;
    if (!st.open) {
      st.open = true;
      ed.root.insertBefore(el, ed.surface);
      var s = ed.selection(),
        piece = ed.text().substring(s[0], s[1]);
      if (mode !== 'goto' && piece && piece.length <= 200 && piece.indexOf('\n') < 0) q.value = piece;
    }
    rowFind.style.display = mode === 'goto' ? 'none' : '';
    rowRep.style.display = mode === 'replace' ? '' : 'none';
    rowGo.style.display = mode === 'goto' ? '' : 'none';
    msg.textContent = '';
    var field = mode === 'goto' ? gq : q;
    field.focus();
    selectAll(field);
    if (mode !== 'goto') search(false);
  }
  /* 关闭后这块面板不再复用（退出动画结束才移除）；查询词和选区范围留在 memo 里给下一块面板 */
  function close() {
    if (!st.open) return;
    st.open = false;
    clearTimeout(st.timer);
    memo.q = q.value;
    memo.r = rq.value;
    memo.scope = st.scope;
    ed.marks([], -1);
    if (typeof uiDismiss === 'function') uiDismiss(el);
    else el.remove();
    ed.focus();
  }
  return {
    el: el,
    open: open,
    close: close,
    next: function (dir) {
      if (!st.open && !q.value) open('find');
      else next(dir);
    },
    isOpen: function () {
      return st.open;
    },
    refresh: function () {
      if (st.open && q.value && stale()) search(false);
    },
    edited: function () {
      // A scope set by "in selection" follows edits made inside it; any other change drops it.
      if (!st.scope || st.text === null) return;
      var d = kcDiff(st.text, ed.text());
      if (d.to <= st.scope[0])
        st.scope = [st.scope[0] + d.insert.length - (d.to - d.from), st.scope[1] + d.insert.length - (d.to - d.from)];
      else if (d.from >= st.scope[1]) return;
      else if (d.from >= st.scope[0] && d.to <= st.scope[1])
        st.scope = [st.scope[0], st.scope[1] + d.insert.length - (d.to - d.from)];
      else st.scope = null;
      st.text = ed.text();
    }
  };
}

/* ---------- 嵌入字符串（Open String） ---------- */
function kcOpenString(ed) {
  ed.flush();
  var text = ed.text(),
    s = kcStringAt(text, ed.caret());
  if (!s || s.key) {
    toast(I18n.t('cadeditor.ui.codeassist.string_not_at_cursor'), 'warn', 'kc-string');
    return false;
  }
  var depth = (ed.depth || 0) + 1;
  if (depth > KC_STRING_DEPTH) {
    toast(I18n.t('cadeditor.ui.codeassist.string_depth_limit', KC_STRING_DEPTH), 'warn', 'kc-string');
    return false;
  }
  var value;
  try {
    value = ed.language === 'json' ? JSON.parse(s.raw) : kcDecodeString(s.raw);
  } catch (e) {
    toast(I18n.t('cadeditor.ui.codeassist.string_escape', e.message || e), 'warn', 'kc-string');
    return false;
  }
  if (value.length > KC_STRING_MAX) {
    toast(I18n.t('cadeditor.ui.codeassist.string_too_long', KC_STRING_MAX), 'warn', 'kc-string');
    return false;
  }
  var kind = kcEmbeddedLanguage(value),
    formatted = null,
    inner = kCode({
      value: value,
      language: kind,
      height: 200,
      stringDepth: depth,
      readonly: ed.readonly,
      onApply: apply
    });
  function current() {
    var now = inner.get();
    if (!formatted) return now;
    if (now === formatted.pretty) return formatted.raw;
    var compact = kcCompactTokens(now, kind);
    return compact === null ? now : compact;
  }
  var view = null;
  if (kind !== 'plain')
    view = kBtn(
      I18n.t('cadeditor.ui.codeassist.formatted_view'),
      function () {
        if (formatted) {
          var raw = current();
          formatted = null;
          inner.set(raw, true);
          view.querySelector('span').textContent = I18n.t('cadeditor.ui.codeassist.formatted_view');
          return;
        }
        var raw2 = inner.get(),
          pretty = kcPrettyTokens(raw2, kind);
        if (pretty === null) {
          toast(I18n.t('cadeditor.ui.codeassist.format_unavailable'), 'warn', 'kc-string');
          return;
        }
        formatted = { raw: raw2, pretty: pretty };
        inner.set(pretty, true);
        view.querySelector('span').textContent = I18n.t('cadeditor.ui.codeassist.raw_view');
      },
      { cls: 'sm' }
    );
  function apply() {
    if (ed.readonly) return;
    var next = current();
    if (ed.text() !== text) {
      toast(I18n.t('cadeditor.ui.codeassist.parent_changed'), 'warn', 'kc-string');
      return;
    }
    closeModal();
    if (next !== value) {
      var lit = ed.language === 'json' ? JSON.stringify(next) : kcEncodeString(next, s.quote);
      ed.replace(s.start, s.end, lit, s.start + 1, s.start + 1);
    }
    ed.focus();
  }
  var kindLabel =
    kind === 'json'
      ? I18n.t('cadeditor.ui.codeassist.string_kind_json')
      : kind === 'snbt'
        ? I18n.t('cadeditor.ui.codeassist.string_kind_snbt')
        : I18n.t('cadeditor.ui.codeassist.string_kind_plain');
  var body = [h('div', { class: 'kc-str-bar' }, [h('span', { class: 'k-sub grow', text: kindLabel }), view]), inner.el];
  var foot = [
    h('div', { class: 'grow' }),
    kBtn(I18n.t('cadeditor.ui.common.cancel'), function () {
      closeModal();
      ed.focus();
    }),
    ed.readonly ? null : kBtn(I18n.t('cadeditor.ui.codeassist.write_back'), apply, { cls: 'pri' })
  ];
  openModal(modalShell(I18n.t('cadeditor.ui.codeassist.string_title', depth), '', body, foot, 'kc-str-modal'), true);
  setTimeout(function () {
    inner.focus();
  }, 0);
  return true;
}

/* ---------- 接到 kCode 上 ---------- */
function kcAssist(ed) {
  var find = null,
    memo = {},
    comp = kcCompleter(ed);
  function panel() {
    if (!find || !find.isOpen()) find = kcFindPanel(ed, memo);
    return find;
  }
  function tool(action, label, icon, fn) {
    var b = kBtn('', fn, { icon: icon, cls: 'kc-tool', title: label });
    b.setAttribute('aria-label', label);
    b.setAttribute('data-code-action', action);
    ed.addTool(b);
  }
  tool('find', I18n.t('cadeditor.ui.codeassist.find'), 'search', function () {
    panel().open(ed.readonly ? 'find' : 'replace');
  });
  if (ed.language === 'snbt' && !ed.readonly)
    tool('complete', I18n.t('cadeditor.ui.codeassist.complete'), 'sparkle', function () {
      ed.focus();
      comp.trigger(true);
    });
  tool('open-string', I18n.t('cadeditor.ui.codeassist.open_string'), 'external', function () {
    kcOpenString(ed);
  });
  return {
    keydown: function (e) {
      var k = (e.key || '').toLowerCase(),
        ctrl = e.ctrlKey || e.metaKey;
      if (comp.keydown(e)) return true;
      if (ctrl && !e.altKey && !e.shiftKey && (k === 'f' || k === 'h' || k === 'g')) {
        e.preventDefault();
        panel().open(k === 'f' ? 'find' : k === 'h' ? 'replace' : 'goto');
        return true;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        panel().next(e.shiftKey ? -1 : 1);
        return true;
      }
      if (ctrl && !e.altKey && (e.key === ' ' || e.key === 'Space' || e.code === 'Space')) {
        e.preventDefault();
        comp.trigger(true);
        return true;
      }
      if (ctrl && !e.altKey && !e.shiftKey && k === 'o') {
        e.preventDefault();
        kcOpenString(ed);
        return true;
      }
      if (e.key === 'Escape' && find && find.isOpen()) {
        e.preventDefault();
        find.close();
        return true;
      }
      return false;
    },
    input: function (e) {
      comp.input(e);
      if (find) find.edited();
    },
    flushed: function () {
      if (find) find.refresh();
    },
    scroll: function () {
      comp.close();
    },
    pointer: function () {
      comp.close();
    },
    blur: function () {
      setTimeout(function () {
        if (document.activeElement !== ed.ta) comp.close();
      }, 0);
    },
    completer: comp,
    finder: panel
  };
}
