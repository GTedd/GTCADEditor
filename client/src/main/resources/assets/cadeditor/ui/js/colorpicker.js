/* 取色器：HSV 色板 + 色相条、HEX / ARGB / RGB 输入、16 原版色、最近使用、多停靠点渐变、文字层与阴影层、预设收藏。
   纯计算放在 CP 上（测试直接调用）；界面 cpHsvEditor（单个颜色）和 kColorPicker（文字 / 阴影两层 + 渐变 + 预设）。
   预设和最近使用存进宿主偏好（Prefs 'colorPresets' / 'recentColors'，宿主 EditorPrefs 按同一份格式校验后落盘）。

   颜色层（页面内）：纯色 { rgb, a, n? }（n 是原版颜色名，文字层用），渐变 { stops: [{ p: 0..1, rgb, a }] }（至少 2 个点）。
   保存的格式：纯色 { c: '#AARRGGBB', n? }，渐变 { stops: [{ p: 0..1000 整数, c: '#AARRGGBB' }] }。 */
var CP = {
  MAX_PRESETS: 64,
  MAX_RECENT: 12,
  MAX_STOPS: 16,
  NAME_MAX: 48,
  KINDS: ['color', 'gradient', 'shadow', 'style'],
  FLAGS: ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'],
  byte: function (v) {
    v = Math.round(Number(v));
    return isNaN(v) ? 0 : v < 0 ? 0 : v > 255 ? 255 : v;
  },
  hex2: function (n) {
    var s = CP.byte(n).toString(16).toUpperCase();
    return s.length < 2 ? '0' + s : s;
  },
  hex6: function (rgb) {
    return '#' + CP.hex2((rgb >> 16) & 255) + CP.hex2((rgb >> 8) & 255) + CP.hex2(rgb & 255);
  },
  hex8: function (a, rgb) {
    return '#' + CP.hex2(a) + CP.hex6(rgb).substring(1);
  },
  /* 文字 → { a, rgb }；支持 #RGB、#RRGGBB、#AARRGGBB（可不带 #）和 "r,g,b" / "r,g,b,a"（0–255）。不合法返回 null */
  parse: function (text) {
    var t = String(text === undefined || text === null ? '' : text)
      .trim()
      .replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(t))
      t = t.charAt(0) + t.charAt(0) + t.charAt(1) + t.charAt(1) + t.charAt(2) + t.charAt(2);
    if (/^[0-9a-fA-F]{6}$/.test(t)) return { a: 255, rgb: parseInt(t, 16) };
    if (/^[0-9a-fA-F]{8}$/.test(t)) return { a: parseInt(t.substring(0, 2), 16), rgb: parseInt(t.substring(2), 16) };
    var parts = t.split(/\s*[,\s]\s*/);
    if (
      (parts.length === 3 || parts.length === 4) &&
      parts.every(function (p) {
        return /^\d{1,3}$/.test(p) && +p <= 255;
      })
    )
      return {
        a: parts.length === 4 ? +parts[3] : 255,
        rgb: (+parts[0] << 16) | (+parts[1] << 8) | +parts[2]
      };
    return null;
  },
  /* h 0–360，s / v 0–1 → 0xRRGGBB */
  hsvToRgb: function (h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(1, s));
    v = Math.max(0, Math.min(1, v));
    var c = v * s,
      x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
      m = v - c,
      r = 0,
      g = 0,
      b = 0;
    if (h < 60) {
      r = c;
      g = x;
    } else if (h < 120) {
      r = x;
      g = c;
    } else if (h < 180) {
      g = c;
      b = x;
    } else if (h < 240) {
      g = x;
      b = c;
    } else if (h < 300) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    return (CP.byte((r + m) * 255) << 16) | (CP.byte((g + m) * 255) << 8) | CP.byte((b + m) * 255);
  },
  rgbToHsv: function (rgb) {
    var r = ((rgb >> 16) & 255) / 255,
      g = ((rgb >> 8) & 255) / 255,
      b = (rgb & 255) / 255;
    var max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      d = max - min,
      h = 0;
    if (d) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    return { h: (h + 360) % 360, s: max ? d / max : 0, v: max };
  },
  /* shadow_color 的整数（ARGB，按 NBT int 有符号） */
  toSigned: function (a, rgb) {
    return (CP.byte(a) << 24) | (rgb & 0xffffff) | 0;
  },
  /* shadow_color 的现值 → { a, rgb }：整数（有无符号都行）或 [r, g, b, a] 0–1 浮点列表 */
  fromArgb: function (v) {
    if (typeof v === 'number' && isFinite(v) && Math.floor(v) === v) {
      var u = v < 0 ? v + 4294967296 : v;
      return { a: Math.floor(u / 16777216) & 255, rgb: u % 16777216 };
    }
    if (
      Array.isArray(v) &&
      v.length === 4 &&
      v.every(function (x) {
        return typeof x === 'number' && isFinite(x);
      })
    )
      return {
        a: CP.byte(v[3] * 255),
        rgb: (CP.byte(v[0] * 255) << 16) | (CP.byte(v[1] * 255) << 8) | CP.byte(v[2] * 255)
      };
    return null;
  },
  mix: function (c1, c2, t) {
    function ch(sh) {
      return Math.round(((c1 >> sh) & 255) * (1 - t) + ((c2 >> sh) & 255) * t);
    }
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  },
  /* 停靠点：按位置排序、夹到 0–1，去掉多余字段；少于 2 个点返回 null */
  normStops: function (stops) {
    if (!Array.isArray(stops)) return null;
    var out = stops
      .filter(function (s) {
        return s && typeof s.p === 'number' && isFinite(s.p) && typeof s.rgb === 'number';
      })
      .map(function (s, i) {
        return {
          p: Math.max(0, Math.min(1, s.p)),
          rgb: s.rgb & 0xffffff,
          a: typeof s.a === 'number' ? CP.byte(s.a) : 255,
          i: i
        };
      });
    out.sort(function (x, y) {
      return x.p - y.p || x.i - y.i;
    });
    out.forEach(function (s) {
      delete s.i;
    });
    return out.length >= 2 ? out.slice(0, CP.MAX_STOPS) : null;
  },
  /* 界面用：原地夹紧位置并排序，保留每个点对象本身（选中的点不丢） */
  sortStops: function (stops) {
    stops.forEach(function (x, i) {
      x.p = Math.max(0, Math.min(1, typeof x.p === 'number' && isFinite(x.p) ? x.p : 0));
      x._i = i;
    });
    stops.sort(function (x, y) {
      return x.p - y.p || x._i - y._i;
    });
    stops.forEach(function (x) {
      delete x._i;
    });
    return stops;
  },
  /* 渐变在 t（0–1）处的颜色（含透明度），相邻两点之间线性插值 */
  sample: function (stops, t) {
    var s = CP.normStops(stops);
    if (!s) return null;
    if (t <= s[0].p) return { a: s[0].a, rgb: s[0].rgb };
    for (var i = 1; i < s.length; i++)
      if (t <= s[i].p) {
        var a = s[i - 1],
          b = s[i],
          k = b.p > a.p ? (t - a.p) / (b.p - a.p) : 1;
        return { a: Math.round(a.a + (b.a - a.a) * k), rgb: CP.mix(a.rgb, b.rgb, k) };
      }
    var last = s[s.length - 1];
    return { a: last.a, rgb: last.rgb };
  },
  /* n 个字逐字取色：第一个字在起点，最后一个字在终点 */
  spread: function (stops, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(CP.sample(stops, n > 1 ? i / (n - 1) : 0));
    return out;
  },
  /* 层 → 保存格式 / 保存格式 → 层（不合法返回 null） */
  layerOut: function (layer, alpha) {
    if (!layer) return null;
    if (layer.stops) {
      var s = CP.normStops(layer.stops);
      return s
        ? {
            stops: s.map(function (x) {
              return { p: Math.round(x.p * 1000), c: CP.hex8(alpha ? x.a : 255, x.rgb) };
            })
          }
        : null;
    }
    var o = { c: CP.hex8(alpha ? (typeof layer.a === 'number' ? layer.a : 255) : 255, layer.rgb) };
    if (!alpha && layer.n && /^[a-z_]{1,32}$/.test(layer.n)) o.n = layer.n;
    return o;
  },
  layerIn: function (o) {
    if (!o || typeof o !== 'object') return null;
    function col(c) {
      return typeof c === 'string' && /^#[0-9A-F]{8}$/.test(c) ? CP.parse(c) : null;
    }
    if (Array.isArray(o.stops)) {
      var stops = [];
      for (var i = 0; i < o.stops.length; i++) {
        var x = o.stops[i],
          c = x && col(x.c);
        if (!c || typeof x.p !== 'number') return null;
        stops.push({ p: x.p / 1000, rgb: c.rgb, a: c.a });
      }
      stops = CP.normStops(stops);
      return stops ? { stops: stops } : null;
    }
    var one = col(o.c);
    if (!one) return null;
    var out = { rgb: one.rgb, a: one.a };
    if (typeof o.n === 'string') out.n = o.n;
    return out;
  },
  /* 去重用的键：同样的颜色 / 渐变 / 样式只留一份（名字不算） */
  presetKey: function (kind, entry) {
    var e = {};
    Object.keys(entry || {})
      .sort()
      .forEach(function (k) {
        if (k !== 'id' && k !== 'name') e[k] = entry[k];
      });
    if (e.flags) {
      var f = {};
      Object.keys(e.flags)
        .sort()
        .forEach(function (k) {
          f[k] = e.flags[k];
        });
      e.flags = f;
    }
    return kind + ':' + JSON.stringify(e);
  },
  cleanName: function (name) {
    var s = String(name === undefined || name === null ? '' : name)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim();
    return s.length > CP.NAME_MAX ? s.substring(0, CP.NAME_MAX) : s;
  },
  autoName: function (kind, entry) {
    if (entry.c) return entry.n || entry.c;
    if (entry.stops)
      return entry.stops
        .map(function (s) {
          return s.c;
        })
        .join(' → ');
    return I18n.t('cadeditor.ui.colorpicker.style_preset');
  },
  seq: 0,
  newId: function () {
    return 'p' + Date.now().toString(36) + (CP.seq++).toString(36);
  },
  /* ---- 预设：读写都经 Prefs（宿主落盘），本页内存为准 ---- */
  presets: function () {
    var raw = typeof Prefs !== 'undefined' ? Prefs.get('colorPresets', null) : null,
      out = {};
    CP.KINDS.forEach(function (k) {
      out[k] = raw && Array.isArray(raw[k]) ? raw[k].slice(0, CP.MAX_PRESETS) : [];
    });
    return out;
  },
  storePresets: function (all) {
    var out = {};
    CP.KINDS.forEach(function (k) {
      if (all[k] && all[k].length) out[k] = all[k].slice(0, CP.MAX_PRESETS);
    });
    if (typeof Prefs !== 'undefined') Prefs.set('colorPresets', out);
    return out;
  },
  /* 保存一个预设；同样的值已存在时不重复，返回 { entry, dup }；满了返回 { full: true } */
  addPreset: function (kind, value, name) {
    if (CP.KINDS.indexOf(kind) < 0 || !value) return null;
    var all = CP.presets(),
      list = all[kind],
      entry = { id: CP.newId(), name: '' };
    Object.keys(value).forEach(function (k) {
      entry[k] = value[k];
    });
    var key = CP.presetKey(kind, entry);
    for (var i = 0; i < list.length; i++) if (CP.presetKey(kind, list[i]) === key) return { entry: list[i], dup: true };
    if (list.length >= CP.MAX_PRESETS) return { full: true };
    entry.name = CP.cleanName(name) || CP.cleanName(CP.autoName(kind, entry));
    list.push(entry);
    CP.storePresets(all);
    return { entry: entry, dup: false };
  },
  removePreset: function (kind, id) {
    var all = CP.presets();
    all[kind] = all[kind].filter(function (e) {
      return e.id !== id;
    });
    CP.storePresets(all);
  },
  movePreset: function (kind, from, to) {
    var all = CP.presets(),
      list = all[kind];
    if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return;
    var x = list.splice(from, 1)[0];
    list.splice(to, 0, x);
    CP.storePresets(all);
  },
  renamePreset: function (kind, id, name) {
    var all = CP.presets(),
      n = CP.cleanName(name);
    if (!n) return;
    all[kind].forEach(function (e) {
      if (e.id === id) e.name = n;
    });
    CP.storePresets(all);
  },
  recent: function () {
    var l = typeof Prefs !== 'undefined' ? Prefs.get('recentColors', []) : [];
    return Array.isArray(l)
      ? l.filter(function (c) {
          return typeof c === 'string' && /^#[0-9A-F]{8}$/.test(c);
        })
      : [];
  },
  pushRecent: function (a, rgb) {
    var c = CP.hex8(a, rgb),
      l = CP.recent().filter(function (x) {
        return x !== c;
      });
    l.unshift(c);
    if (typeof Prefs !== 'undefined') Prefs.set('recentColors', l.slice(0, CP.MAX_RECENT));
  },
  /* CSS 渐变（预览条、预设色块） */
  css: function (layer, alpha) {
    if (!layer) return '';
    function c(a, rgb) {
      return alpha
        ? 'rgba(' +
            ((rgb >> 16) & 255) +
            ',' +
            ((rgb >> 8) & 255) +
            ',' +
            (rgb & 255) +
            ',' +
            (a / 255).toFixed(3) +
            ')'
        : CP.hex6(rgb);
    }
    if (layer.stops) {
      var s = CP.normStops(layer.stops);
      return s
        ? 'linear-gradient(to right, ' +
            s
              .map(function (x) {
                return c(x.a, x.rgb) + ' ' + Math.round(x.p * 100) + '%';
              })
              .join(', ') +
            ')'
        : '';
    }
    return c(typeof layer.a === 'number' ? layer.a : 255, layer.rgb);
  }
};

function cpKindLabel(k) {
  return {
    color: I18n.t('cadeditor.ui.colorpicker.kind_color'),
    gradient: I18n.t('cadeditor.ui.colorpicker.kind_gradient'),
    shadow: I18n.t('cadeditor.ui.colorpicker.kind_shadow'),
    style: I18n.t('cadeditor.ui.colorpicker.kind_style')
  }[k];
}
/* 拖动：按下立即取一次值，之后跟随鼠标，松开时 done()。坐标换成元素内 0–1 */
function cpDrag(el, onMove, onDone) {
  el.addEventListener('mousedown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    function at(ev) {
      var r = el.getBoundingClientRect();
      onMove(
        r.width ? Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) : 0,
        r.height ? Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)) : 0
      );
    }
    function up() {
      document.removeEventListener('mousemove', at);
      document.removeEventListener('mouseup', up);
      if (onDone) onDone();
    }
    at(e);
    document.addEventListener('mousemove', at);
    document.addEventListener('mouseup', up);
  });
}

/* 单个颜色的编辑器：饱和度 / 明度色板、色相条、（可选）透明度条、HEX 与 R G B（A）输入。
   o = { get(): { a, rgb }, set({ a, rgb }, final), alpha: 是否编辑透明度 }。拖动中 final=false，松手 / 输入提交时 final=true。
   返回 { el, refresh() }（外部改了颜色后调用 refresh） */
function cpHsvEditor(o) {
  var hsv = CP.rgbToHsv(o.get().rgb),
    alpha = !!o.alpha;
  var sv = h('div', { class: 'cp-sv' }),
    svk = h('i', { class: 'cp-svk' }),
    hue = h('div', { class: 'cp-hue' }),
    huek = h('i', { class: 'cp-barK' }),
    al = h('div', { class: 'cp-alpha' }),
    alFill = h('div', { class: 'cp-alphaFill' }),
    alk = h('i', { class: 'cp-barK' });
  sv.appendChild(svk);
  hue.appendChild(huek);
  al.appendChild(alFill);
  al.appendChild(alk);
  var hex = h('input', { class: 'k-input cp-hex', type: 'text', spellcheck: 'false', maxlength: alpha ? '9' : '7' });
  setTip(hex, alpha ? I18n.t('cadeditor.ui.colorpicker.hex_argb_tip') : I18n.t('cadeditor.ui.colorpicker.hex_tip'));
  var nums = (alpha ? ['R', 'G', 'B', 'A'] : ['R', 'G', 'B']).map(function (label) {
    var inp = h('input', { class: 'k-input cp-num', type: 'text', spellcheck: 'false', maxlength: '3' });
    return { label: label, input: inp, el: h('label', { class: 'cp-numw' }, [h('span', { text: label }), inp]) };
  });
  var err = h('div', { class: 'k-numerr' });
  function cur() {
    var c = o.get();
    return { a: typeof c.a === 'number' ? c.a : 255, rgb: c.rgb & 0xffffff };
  }
  function put(c, final) {
    o.set({ a: alpha ? c.a : 255, rgb: c.rgb & 0xffffff }, final);
    paint();
  }
  function paint(keepInputs) {
    var c = cur();
    sv.setAttribute(
      'style',
      'background:linear-gradient(to top, #000000, rgba(0,0,0,0)), linear-gradient(to right, #FFFFFF, ' +
        CP.hex6(CP.hsvToRgb(hsv.h, 1, 1)) +
        ')'
    );
    svk.setAttribute('style', 'left:' + (hsv.s * 100).toFixed(2) + '%;top:' + ((1 - hsv.v) * 100).toFixed(2) + '%');
    huek.setAttribute('style', 'left:' + ((hsv.h / 360) * 100).toFixed(2) + '%');
    alFill.setAttribute('style', 'background:linear-gradient(to right, rgba(0,0,0,0), ' + CP.hex6(c.rgb) + ')');
    alk.setAttribute('style', 'left:' + ((c.a / 255) * 100).toFixed(2) + '%');
    if (keepInputs) return;
    hex.value = alpha ? CP.hex8(c.a, c.rgb) : CP.hex6(c.rgb);
    var vals = [(c.rgb >> 16) & 255, (c.rgb >> 8) & 255, c.rgb & 255, c.a];
    nums.forEach(function (n, i) {
      n.input.value = String(vals[i]);
    });
    err.textContent = '';
  }
  cpDrag(
    sv,
    function (x, y) {
      hsv.s = x;
      hsv.v = 1 - y;
      put({ a: cur().a, rgb: CP.hsvToRgb(hsv.h, hsv.s, hsv.v) }, false);
    },
    function () {
      put(cur(), true);
    }
  );
  cpDrag(
    hue,
    function (x) {
      hsv.h = Math.min(359.99, x * 360);
      put({ a: cur().a, rgb: CP.hsvToRgb(hsv.h, hsv.s, hsv.v) }, false);
    },
    function () {
      put(cur(), true);
    }
  );
  cpDrag(
    al,
    function (x) {
      put({ a: Math.round(x * 255), rgb: cur().rgb }, false);
    },
    function () {
      put(cur(), true);
    }
  );
  hex.addEventListener('change', function () {
    var p = CP.parse(hex.value);
    if (!p || (!alpha && hex.value.replace(/^#/, '').trim().length === 8)) {
      err.textContent = alpha
        ? I18n.t('cadeditor.ui.colorpicker.bad_argb')
        : I18n.t('cadeditor.ui.colorpicker.bad_hex');
      return;
    }
    hsv = CP.rgbToHsv(p.rgb);
    put({ a: alpha ? p.a : 255, rgb: p.rgb }, true);
  });
  nums.forEach(function (n, i) {
    n.input.addEventListener('change', function () {
      var t = n.input.value.trim();
      if (!/^\d{1,3}$/.test(t) || +t > 255) {
        err.textContent = I18n.t('cadeditor.ui.colorpicker.bad_channel', n.label);
        return;
      }
      var c = cur(),
        v = [(c.rgb >> 16) & 255, (c.rgb >> 8) & 255, c.rgb & 255, c.a];
      v[i] = +t;
      hsv = CP.rgbToHsv((v[0] << 16) | (v[1] << 8) | v[2]);
      put({ a: v[3], rgb: (v[0] << 16) | (v[1] << 8) | v[2] }, true);
    });
  });
  var el = h('div', { class: 'cp-hsv' }, [
    sv,
    hue,
    alpha ? al : null,
    h(
      'div',
      { class: 'cp-inputs' },
      [hex].concat(
        nums.map(function (n) {
          return n.el;
        })
      )
    ),
    err
  ]);
  paint();
  return {
    el: el,
    refresh: function () {
      var c = cur(),
        next = CP.rgbToHsv(c.rgb);
      /* 灰色 / 黑色没有色相（饱和度为 0 时色相不变），别把色相条跳回红色 */
      if (next.s > 0 && next.v > 0) hsv.h = next.h;
      if (next.v > 0) hsv.s = next.s;
      hsv.v = next.v;
      paint();
    }
  };
}

/* 文字颜色 / 阴影 / 渐变 / 预设的完整取色器。
   o = { layers: ['text','shadow']（可只给一层）, active: 'text'|'shadow', value: { text: 层|null, shadow: 层|null },
         gradient: 允许渐变（默认 true）, mode: 'solid'|'gradient'（打开时的模式）, flags: 当前开关（保存样式预设用）,
         sample: 预览文字, preview(el, value)（可选，自己画预览）, onApply(result) }
   result = { text?: 层|null, shadow?: 层|null, flags?: {...} }：只带用户动过的层；null = 去掉（默认文字色 / 无阴影） */
function kColorPicker(o) {
  o = o || {};
  var layers = o.layers && o.layers.length ? o.layers.slice() : ['text'],
    allowGrad = o.gradient !== false;
  var st = { active: layers.indexOf(o.active) >= 0 ? o.active : layers[0], touched: {}, flags: null, sel: {} };
  var val = {};
  layers.forEach(function (l) {
    var v = o.value ? o.value[l] : null;
    val[l] = v ? clone(v) : null;
    st.sel[l] = 0;
  });
  /* 用户正在编辑的颜色：渐变时是选中的停靠点，纯色时是层本身；层为空时先给一个起始色 */
  function layer() {
    return val[st.active];
  }
  function isGrad() {
    return !!(layer() && layer().stops);
  }
  function ensure() {
    if (!val[st.active])
      val[st.active] = st.active === 'shadow' ? { rgb: 0x3f3f3f, a: 255 } : { rgb: 0xffffff, a: 255 };
    return val[st.active];
  }
  /* create=false 只是读（层为空时给一个不存下来的起始色，免得画界面就把「默认」变成了白色） */
  function editing(create) {
    var l = create
      ? ensure()
      : val[st.active] || (st.active === 'shadow' ? { rgb: 0x3f3f3f, a: 255 } : { rgb: 0xffffff, a: 255 });
    if (l.stops) {
      var i = Math.max(0, Math.min(l.stops.length - 1, st.sel[st.active]));
      return l.stops[i];
    }
    return l;
  }
  function touch() {
    st.touched[st.active] = true;
  }
  var root = h('div', { class: 'cp' });
  var tabs = h('div', { class: 'cp-tabs' }),
    modeRow = h('div', { class: 'cp-row' }),
    gradBox = h('div', { class: 'cp-grad' }),
    hsvHost = h('div'),
    swRow = h('div', { class: 'k-swatches cp-sw' }),
    recentRow = h('div', { class: 'k-swatches cp-sw' }),
    prev = h('div', { class: 'k-rprev cp-prev' }),
    presetBox = h('div', { class: 'cp-presets' });
  var hsvEd = null;
  function paintTabs() {
    clear(tabs);
    if (layers.length < 2) return;
    layers.forEach(function (l) {
      var chip = h('i', { class: 'cp-chip' + (val[l] ? '' : ' none') }),
        b = h('div', { class: 'cp-tab' + (st.active === l ? ' on' : '') }, [
          chip,
          h('span', {
            text:
              l === 'shadow'
                ? I18n.t('cadeditor.ui.colorpicker.layer_shadow')
                : I18n.t('cadeditor.ui.colorpicker.layer_text')
          })
        ]);
      if (val[l]) chip.setAttribute('style', 'background:' + CP.css(val[l], l === 'shadow'));
      activate(b, function () {
        st.active = l;
        paintAll();
      });
      tabs.appendChild(b);
    });
  }
  function paintMode() {
    clear(modeRow);
    var none = kBtn(
      st.active === 'shadow'
        ? I18n.t('cadeditor.ui.colorpicker.default_shadow')
        : I18n.t('cadeditor.ui.colorpicker.default_color'),
      function () {
        val[st.active] = null;
        touch();
        paintAll();
      },
      { cls: 'cp-none' + (val[st.active] ? '' : ' on'), icon: 'close' }
    );
    if (allowGrad) {
      var seg = kSeg(
        [
          { v: 'solid', label: I18n.t('cadeditor.ui.colorpicker.solid') },
          { v: 'gradient', label: I18n.t('cadeditor.ui.colorpicker.gradient') }
        ],
        isGrad() ? 'gradient' : 'solid',
        function (m) {
          var l = ensure();
          if (m === 'gradient' && !l.stops) {
            var from = { rgb: l.rgb, a: l.a };
            val[st.active] = {
              stops: [
                { p: 0, rgb: from.rgb, a: from.a },
                { p: 1, rgb: st.active === 'shadow' ? 0x000000 : 0x5555ff, a: from.a }
              ]
            };
            st.sel[st.active] = 0;
          } else if (m === 'solid' && l.stops) {
            var s = editing();
            val[st.active] = { rgb: s.rgb, a: s.a };
          }
          touch();
          paintAll();
        }
      );
      modeRow.appendChild(seg.el);
    }
    modeRow.appendChild(h('div', { class: 'grow' }));
    modeRow.appendChild(none);
  }
  function paintGrad() {
    clear(gradBox);
    var l = layer();
    gradBox.style.display = l && l.stops ? '' : 'none';
    if (!l || !l.stops) return;
    var shadow = st.active === 'shadow';
    var bar = h('div', { class: 'cp-gbar' }),
      fill = h('div', { class: 'cp-gfill', style: 'background:' + CP.css(l, shadow) });
    bar.appendChild(fill);
    l.stops.forEach(function (s, i) {
      var k = h('i', {
        class: 'cp-stop' + (i === st.sel[st.active] ? ' on' : ''),
        style: 'left:' + (s.p * 100).toFixed(2) + '%;background:' + CP.hex6(s.rgb)
      });
      k.addEventListener('mousedown', function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        st.sel[st.active] = i;
        var moved = false;
        function mv(ev) {
          var r = bar.getBoundingClientRect();
          if (!r.width) return;
          moved = true;
          s.p = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
          k.style.left = (s.p * 100).toFixed(2) + '%';
          fill.setAttribute('style', 'background:' + CP.css(l, shadow));
          posIn.value = String(Math.round(s.p * 100));
          paintPrev();
        }
        function up() {
          document.removeEventListener('mousemove', mv);
          document.removeEventListener('mouseup', up);
          var keep = l.stops[st.sel[st.active]];
          CP.sortStops(l.stops);
          st.sel[st.active] = Math.max(0, l.stops.indexOf(keep));
          if (moved) touch();
          paintAll();
        }
        document.addEventListener('mousemove', mv);
        document.addEventListener('mouseup', up);
        paintStopFields();
        hsvEd.refresh();
      });
      bar.appendChild(k);
    });
    /* 点空白处加一个停靠点（颜色取该处的渐变色） */
    bar.addEventListener('mousedown', function (e) {
      if (e.target !== bar && e.target !== fill) return;
      if (l.stops.length >= CP.MAX_STOPS) {
        toast(I18n.t('cadeditor.ui.colorpicker.max_stops', CP.MAX_STOPS), 'info', 'cp-stops');
        return;
      }
      var r = bar.getBoundingClientRect(),
        p = r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0.5,
        c = CP.sample(l.stops, p);
      var ns = { p: p, rgb: c.rgb, a: c.a };
      l.stops.push(ns);
      CP.sortStops(l.stops);
      st.sel[st.active] = l.stops.indexOf(ns);
      touch();
      paintAll();
    });
    gradBox.appendChild(bar);
    var posIn = h('input', { class: 'k-input cp-num', type: 'text', spellcheck: 'false', maxlength: '3' });
    var fields = h('div', { class: 'cp-row' });
    function paintStopFields() {
      clear(fields);
      var s = editing();
      posIn.value = String(Math.round(s.p * 100));
      fields.appendChild(
        h('label', { class: 'cp-numw' }, [
          h('span', { text: I18n.t('cadeditor.ui.colorpicker.position') }),
          posIn,
          h('span', { text: '%' })
        ])
      );
      fields.appendChild(h('div', { class: 'grow' }));
      fields.appendChild(
        kBtn(
          '',
          function () {
            var keep = editing();
            l.stops.forEach(function (x) {
              x.p = 1 - x.p;
            });
            CP.sortStops(l.stops);
            st.sel[st.active] = Math.max(0, l.stops.indexOf(keep));
            touch();
            paintAll();
          },
          { icon: 'shuffle', title: I18n.t('cadeditor.ui.colorpicker.reverse'), cls: 'cp-ib' }
        )
      );
      fields.appendChild(
        kBtn(
          '',
          function () {
            var n = l.stops.length;
            l.stops.forEach(function (x, i) {
              x.p = n > 1 ? i / (n - 1) : 0;
            });
            touch();
            paintAll();
          },
          { icon: 'sliders', title: I18n.t('cadeditor.ui.colorpicker.distribute'), cls: 'cp-ib' }
        )
      );
      fields.appendChild(
        kBtn(
          '',
          function () {
            if (l.stops.length <= 2) return;
            l.stops.splice(st.sel[st.active], 1);
            st.sel[st.active] = Math.max(0, st.sel[st.active] - 1);
            touch();
            paintAll();
          },
          {
            icon: 'trash',
            title: I18n.t('cadeditor.ui.colorpicker.remove_stop'),
            cls: 'cp-ib' + (l.stops.length <= 2 ? ' dis' : '')
          }
        )
      );
    }
    posIn.addEventListener('change', function () {
      var t = posIn.value.trim();
      if (!/^\d{1,3}$/.test(t) || +t > 100) {
        posIn.value = String(Math.round(editing().p * 100));
        return;
      }
      var keep = editing();
      keep.p = +t / 100;
      CP.sortStops(l.stops);
      st.sel[st.active] = Math.max(0, l.stops.indexOf(keep));
      touch();
      paintAll();
    });
    paintStopFields();
    gradBox.appendChild(fields);
  }
  function paintHsv() {
    clear(hsvHost);
    hsvEd = cpHsvEditor({
      alpha: st.active === 'shadow',
      get: function () {
        var c = editing();
        return { a: c.a, rgb: c.rgb };
      },
      set: function (c, final) {
        var e = editing(true);
        e.rgb = c.rgb;
        e.a = c.a;
        delete e.n;
        touch();
        if (final) {
          CP.pushRecent(c.a, c.rgb);
          paintAll(true);
        } else paintLive();
      }
    });
    hsvHost.appendChild(hsvEd.el);
  }
  function swatch(a, rgb, tip, pick) {
    var s = h('div', { class: 'k-sw', title: tip, style: 'background:' + CP.hex6(rgb) });
    if (a < 255) s.classList.add('cp-semi');
    activate(s, pick);
    return s;
  }
  function paintSwatches() {
    clear(swRow);
    clear(recentRow);
    var shadow = st.active === 'shadow';
    mcColors().forEach(function (c) {
      var rgb = parseInt(c[1], 16);
      swRow.appendChild(
        swatch(255, rgb, c[2], function () {
          var e = editing(true);
          e.rgb = rgb;
          if (!shadow && !isGrad()) e.n = c[0];
          touch();
          hsvEd.refresh();
          paintAll(true);
        })
      );
    });
    var rec = CP.recent();
    if (rec.length) {
      recentRow.appendChild(h('span', { class: 'k-sub cp-lbl', text: I18n.t('cadeditor.ui.colorpicker.recent') }));
      rec.forEach(function (hx) {
        var p = CP.parse(hx);
        recentRow.appendChild(
          swatch(p.a, p.rgb, hx, function () {
            var e = editing(true);
            e.rgb = p.rgb;
            e.a = shadow ? p.a : 255;
            delete e.n;
            touch();
            hsvEd.refresh();
            paintAll(true);
          })
        );
      });
    }
  }
  function paintPrev() {
    if (o.preview) {
      o.preview(prev, val);
      return;
    }
    var text = String(o.sample || I18n.t('cadeditor.ui.colorpicker.sample')),
      chars = text.split(''),
      runs = [];
    var tc = val.text && val.text.stops ? CP.spread(val.text.stops, chars.length) : null,
      sc = val.shadow && val.shadow.stops ? CP.spread(val.shadow.stops, chars.length) : null;
    chars.forEach(function (ch, i) {
      var r = { text: ch };
      if (tc) r.color = CP.hex6(tc[i].rgb);
      else if (val.text) r.color = CP.hex6(val.text.rgb);
      if (sc) r.shadow_color = CP.toSigned(sc[i].a, sc[i].rgb);
      else if (val.shadow) r.shadow_color = CP.toSigned(val.shadow.a, val.shadow.rgb);
      CP.FLAGS.forEach(function (f) {
        if (st.flags ? st.flags[f] : o.flags && o.flags[f]) r[f] = true;
      });
      runs.push(r);
    });
    if (typeof renderRuns === 'function') renderRuns(prev, {}, runs, {});
    else prev.textContent = text;
  }
  /* 拖动中：只更新预览、页签色块和渐变条，不重建控件 */
  function paintLive() {
    paintPrev();
    var l = layer();
    var fill = gradBox.querySelector ? gradBox.querySelector('.cp-gfill') : null;
    if (fill && l && l.stops) {
      fill.setAttribute('style', 'background:' + CP.css(l, st.active === 'shadow'));
      var ks = gradBox.querySelectorAll('.cp-stop');
      for (var i = 0; i < ks.length && i < l.stops.length; i++)
        ks[i].setAttribute(
          'style',
          'left:' + (l.stops[i].p * 100).toFixed(2) + '%;background:' + CP.hex6(l.stops[i].rgb)
        );
    }
  }
  var presetKind = null;
  function presetKindDefault() {
    return st.active === 'shadow' ? 'shadow' : isGrad() ? 'gradient' : 'color';
  }
  function presetValue(kind) {
    if (kind === 'style') {
      var out = {};
      if (val.text) out.text = CP.layerOut(val.text, false);
      if (val.shadow) out.shadow = CP.layerOut(val.shadow, true);
      /* 样式是一整套开关：五个都记下（开 / 关），应用时按这套组合设置 */
      if (st.flags || o.flags) {
        var flags = {};
        CP.FLAGS.forEach(function (f) {
          flags[f] = !!(st.flags ? st.flags[f] : o.flags[f]);
        });
        out.flags = flags;
      }
      return Object.keys(out).length ? out : null;
    }
    var name = kind === 'shadow' ? 'shadow' : layers.indexOf('text') >= 0 ? 'text' : st.active,
      l = val[name];
    if (!l) return null;
    if (kind === 'gradient' && !l.stops) return null;
    if (kind === 'color' && l.stops) return null;
    return CP.layerOut(l, name === 'shadow');
  }
  function applyPreset(kind, e) {
    if (kind === 'style') {
      if (layers.indexOf('text') >= 0 && e.text) {
        val.text = CP.layerIn(e.text);
        st.touched.text = true;
      }
      if (layers.indexOf('shadow') >= 0) {
        val.shadow = e.shadow ? CP.layerIn(e.shadow) : null;
        st.touched.shadow = true;
      }
      st.flags = e.flags ? clone(e.flags) : {};
    } else {
      var l = CP.layerIn(e);
      if (!l) return;
      if (kind === 'shadow' && layers.indexOf('shadow') >= 0) st.active = 'shadow';
      else if (kind !== 'shadow' && layers.indexOf('text') >= 0) st.active = 'text';
      if (st.active !== 'shadow') {
        if (l.stops)
          l.stops.forEach(function (s) {
            s.a = 255;
          });
        else l.a = 255;
      }
      val[st.active] = l;
      st.sel[st.active] = 0;
      touch();
    }
    paintAll();
  }
  function paintPresets() {
    clear(presetBox);
    var all = CP.presets(),
      kind = presetKind || presetKindDefault();
    var kinds = CP.KINDS.filter(function (k) {
      return k === 'style'
        ? layers.length > 1 || layers[0] === 'text'
        : k === 'shadow'
          ? layers.indexOf('shadow') >= 0
          : layers.indexOf('text') >= 0 && (k !== 'gradient' || allowGrad);
    });
    if (kinds.indexOf(kind) < 0) kind = kinds[0];
    var seg = kSeg(
      kinds.map(function (k) {
        return { v: k, label: cpKindLabel(k) + (all[k].length ? ' ' + all[k].length : '') };
      }),
      kind,
      function (k) {
        presetKind = k;
        paintPresets();
      },
      'cp-kinds'
    );
    var save = kBtn(
      I18n.t('cadeditor.ui.colorpicker.save_preset'),
      function () {
        var v = presetValue(kind);
        if (!v) {
          toast(I18n.t('cadeditor.ui.colorpicker.nothing_to_save'), 'info', 'cp-save');
          return;
        }
        var r = CP.addPreset(kind, v, nameIn.value);
        if (r && r.full) toast(I18n.t('cadeditor.ui.colorpicker.presets_full', CP.MAX_PRESETS), 'error', 'cp-save');
        else if (r && r.dup) toast(I18n.t('cadeditor.ui.colorpicker.preset_exists', r.entry.name), 'info', 'cp-save');
        nameIn.value = '';
        paintPresets();
      },
      { icon: 'plus' }
    );
    var nameIn = h('input', {
      class: 'k-input cp-name',
      type: 'text',
      spellcheck: 'false',
      maxlength: String(CP.NAME_MAX),
      placeholder: I18n.t('cadeditor.ui.colorpicker.preset_name')
    });
    presetBox.appendChild(h('div', { class: 'cp-row' }, [seg.el]));
    presetBox.appendChild(h('div', { class: 'cp-row' }, [nameIn, save]));
    var list = h('div', { class: 'cp-plist' });
    all[kind].forEach(function (e, i) {
      var sw = h('i', { class: 'cp-pchip' });
      if (kind === 'style') {
        var tl = CP.layerIn(e.text),
          sl = CP.layerIn(e.shadow);
        sw.setAttribute('style', 'background:' + (tl ? CP.css(tl, false) : sl ? CP.css(sl, true) : 'transparent'));
      } else {
        var pl = CP.layerIn(e);
        if (pl) sw.setAttribute('style', 'background:' + CP.css(pl, kind === 'shadow'));
      }
      var nm = h('span', { class: 'cp-pname', text: e.name, title: e.name });
      var row = h('div', { class: 'cp-prow' }, [sw, nm]);
      activate(nm, function () {
        applyPreset(kind, e);
      });
      activate(sw, function () {
        applyPreset(kind, e);
      });
      function mini(icon, tip, fn, dis) {
        var b = h('div', { class: 'k-mini cp-pbtn' + (dis ? ' dis' : ''), title: tip }, [uiIcon(icon, 8)]);
        activate(b, function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          if (!dis) fn();
        });
        return b;
      }
      row.appendChild(
        mini(
          'up',
          I18n.t('cadeditor.ui.colorpicker.move_up'),
          function () {
            CP.movePreset(kind, i, i - 1);
            paintPresets();
          },
          i === 0
        )
      );
      row.appendChild(
        mini(
          'down',
          I18n.t('cadeditor.ui.colorpicker.move_down'),
          function () {
            CP.movePreset(kind, i, i + 1);
            paintPresets();
          },
          i === all[kind].length - 1
        )
      );
      row.appendChild(
        mini('edit', I18n.t('cadeditor.ui.colorpicker.rename'), function () {
          var t = nameIn.value.trim();
          if (!t) {
            nameIn.value = e.name;
            if (nameIn.focus) nameIn.focus();
            toast(I18n.t('cadeditor.ui.colorpicker.rename_hint'), 'info', 'cp-rename');
            return;
          }
          CP.renamePreset(kind, e.id, t);
          nameIn.value = '';
          paintPresets();
        })
      );
      row.appendChild(
        mini('trash', I18n.t('cadeditor.ui.common.delete'), function () {
          CP.removePreset(kind, e.id);
          paintPresets();
        })
      );
      list.appendChild(row);
    });
    if (!all[kind].length)
      list.appendChild(h('div', { class: 'k-sub', text: I18n.t('cadeditor.ui.colorpicker.no_presets') }));
    presetBox.appendChild(list);
  }
  function paintAll(keepHsv) {
    paintTabs();
    paintMode();
    paintGrad();
    if (!keepHsv || !hsvEd) paintHsv();
    else hsvEd.refresh();
    paintSwatches();
    paintPrev();
    paintPresets();
  }
  var apply = kBtn(
    I18n.t('cadeditor.ui.colorpicker.apply'),
    function () {
      var out = {};
      layers.forEach(function (l) {
        if (st.touched[l]) out[l] = val[l] ? clone(val[l]) : null;
      });
      if (st.flags) out.flags = clone(st.flags);
      if (o.onApply) o.onApply(out);
    },
    { cls: 'pri' }
  );
  root.appendChild(tabs);
  root.appendChild(modeRow);
  root.appendChild(gradBox);
  root.appendChild(hsvHost);
  root.appendChild(swRow);
  root.appendChild(recentRow);
  root.appendChild(prev);
  root.appendChild(h('div', { class: 'cp-foot' }, [o.note ? kHint(o.note) : h('div', { class: 'grow' }), apply]));
  root.appendChild(presetBox);
  if (o.mode === 'gradient' && allowGrad && !(val[st.active] && val[st.active].stops)) {
    var from = val[st.active] || { rgb: st.active === 'shadow' ? 0x3f1515 : 0xff5555, a: 255 };
    val[st.active] = {
      stops: [
        { p: 0, rgb: from.rgb, a: from.a },
        { p: 1, rgb: st.active === 'shadow' ? 0x000000 : 0x5555ff, a: from.a }
      ]
    };
    touch();
  }
  watchColorOptions(mcColors, paintSwatches);
  paintAll();
  return {
    el: root,
    value: function () {
      return clone(val);
    },
    touched: function () {
      return clone(st.touched);
    }
  };
}

/* 在 anchor 旁弹出 kColorPicker；应用后关闭 */
function kColorPickerPop(anchor, o) {
  var onApply = o.onApply;
  var p = kColorPicker(
    Object.assign({}, o, {
      onApply: function (r) {
        kPopClose();
        if (onApply) onApply(r);
      }
    })
  );
  kPopover(anchor, h('div', { class: 'k-pickbox cp-pop' }, [p.el]), { width: 400, maxHeight: 560 });
  return p;
}
