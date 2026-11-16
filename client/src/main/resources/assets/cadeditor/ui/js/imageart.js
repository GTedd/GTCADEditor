/* 图片转 Lore。页面不读文件：宿主弹原生文件对话框（只收 PNG / JPG）、读图解码、在后台线程生成，页面只发参数、收结果。
   半块：每个字一列两行方形像素（上半块 / 下半块 / 整块 / 空格）；八分块：每个字两列四行（只亮一侧的图案补亮另一侧最接近的像素，
   保持等宽）。字体都是 minecraft:uniform，见宿主 ImageArt。
   宿主消息 image_art：{ op: 'choose' | 'generate' | 'release', requestId, params }，回包同名 data 键。 */
var IMAGE_ART = {
  MIN_WIDTH: 4,
  MAX_WIDTH: 128,
  MAX_LINES: 256,
  MAX_JSON: 524288,
  LEVELS: [256, 64, 32, 16, 8, 4],
  PREVIEW_RUNS: 4000
};
function imageArtDefaults() {
  return {
    width: 48,
    mode: 'color',
    dither: true,
    background: '#100010',
    tolerance: 8,
    levels: 32,
    threshold: 50,
    invert: false,
    foreground: '#FFFFFF',
    cells: 'half'
  };
}
/* 参数校验，规则和宿主 ImageArt.Params 一致。返回 { ok, params（规范化后）, errors: { 字段: 说明 } } */
function imageArtValidate(p) {
  var out = imageArtDefaults(),
    errors = {};
  p = p || {};
  function int(k, min, max) {
    if (p[k] === undefined) return;
    var v = Number(p[k]);
    if (typeof p[k] === 'boolean' || !isFinite(v) || Math.floor(v) !== v || v < min || v > max)
      errors[k] = I18n.t('cadeditor.ui.imageart.range', min, max);
    else out[k] = v;
  }
  function rgb(k) {
    if (p[k] === undefined) return;
    if (typeof p[k] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(p[k]))
      errors[k] = I18n.t('cadeditor.ui.colorpicker.bad_hex');
    else out[k] = p[k].toUpperCase();
  }
  function bool(k) {
    if (p[k] === undefined) return;
    if (typeof p[k] !== 'boolean') errors[k] = I18n.t('cadeditor.ui.imageart.bad_flag');
    else out[k] = p[k];
  }
  int('width', IMAGE_ART.MIN_WIDTH, IMAGE_ART.MAX_WIDTH);
  int('tolerance', 0, 100);
  int('levels', 2, 256);
  int('threshold', 1, 99);
  rgb('background');
  rgb('foreground');
  bool('dither');
  bool('invert');
  if (p.mode !== undefined) {
    if (p.mode !== 'color' && p.mode !== 'mono') errors.mode = I18n.t('cadeditor.ui.imageart.bad_mode');
    else out.mode = p.mode;
  }
  if (p.cells !== undefined) {
    if (p.cells !== 'half' && p.cells !== 'octant') errors.cells = I18n.t('cadeditor.ui.imageart.bad_cells');
    else out.cells = p.cells;
  }
  Object.keys(p).forEach(function (k) {
    if (!(k in out)) errors[k] = I18n.t('cadeditor.ui.imageart.unknown_param', k);
  });
  return { ok: !Object.keys(errors).length, params: out, errors: errors };
}
/* 生成前估算：像素行数、Lore 行数和 JSON 体积的上限（最坏情况：每个字一段颜色） */
function imageArtEstimate(imgW, imgH, params) {
  var w = params.width,
    octant = params.cells === 'octant',
    rows = Math.max(1, Math.round(((octant ? 2 * w : w) * imgH) / imgW)),
    lines = Math.ceil(rows / (octant ? 4 : 2));
  // Octant glyphs are outside the BMP: two UTF-16 units each.
  var perLine = params.mode === 'mono' ? 80 + w * (octant ? 2 : 1) : 90 + w * (octant ? 34 : 32);
  return { rows: rows, lines: lines, maxChars: 2 + lines * (perLine + 1) };
}
/* 能不能插入：Lore 最多 256 行（追加时算上现有的行），生成的 JSON 不超过 IMAGE_ART.MAX_JSON。
   r = 宿主结果 { lineCount, jsonChars }；返回 { ok, total, reasons: [文字] } */
function imageArtVerdict(r, existing, mode) {
  var reasons = [],
    total = mode === 'append' ? existing + r.lineCount : r.lineCount;
  if (total > IMAGE_ART.MAX_LINES)
    reasons.push(
      mode === 'append'
        ? I18n.t('cadeditor.ui.imageart.too_many_lines_append', existing, r.lineCount, total, IMAGE_ART.MAX_LINES)
        : I18n.t('cadeditor.ui.imageart.too_many_lines', r.lineCount, IMAGE_ART.MAX_LINES)
    );
  if (r.jsonChars > IMAGE_ART.MAX_JSON)
    reasons.push(I18n.t('cadeditor.ui.imageart.too_large', fmtInt(r.jsonChars), fmtInt(IMAGE_ART.MAX_JSON)));
  return { ok: !reasons.length, total: total, reasons: reasons };
}
var ImageArtHost = {
  seq: 0,
  listener: null,
  available: function () {
    return (
      typeof oriel !== 'undefined' &&
      !!oriel &&
      typeof oriel.send === 'function' &&
      !!(oriel.data && oriel.data.hostPrefs)
    );
  },
  send: function (op, extra) {
    var id = 'image-art-' + ++this.seq,
      msg = { op: op, requestId: id };
    Object.keys(extra || {}).forEach(function (k) {
      msg[k] = extra[k];
    });
    if (!this.available() || oriel.send('image_art', msg) === false) return null;
    return id;
  },
  receive: function (r) {
    if (r && typeof r === 'object' && this.listener) this.listener(r);
  }
};
if (typeof oriel !== 'undefined' && oriel && oriel.on)
  oriel.on('data', function (data, key) {
    if (key === 'image_art') ImageArtHost.receive((data && data.image_art) || data);
  });

/* 图片转 Lore 的窗口。ctx = { get(): 现有 Lore 行, set(新行) } */
function openImageArt(ctx) {
  var params = imageArtDefaults(),
    image = null,
    result = null,
    insertMode = 'replace',
    chooseId = null,
    genId = null,
    timer = null,
    closed = false;
  var pickBtn = kBtn(I18n.t('cadeditor.ui.imageart.choose'), choose, { icon: 'folder_open', cls: 'pri' });
  var fileInfo = h('span', { class: 'k-sub ia-file', text: I18n.t('cadeditor.ui.imageart.no_image') });
  var status = h('div', { class: 'k-sub ia-status' }),
    reasons = h('div', { class: 'ia-reasons' }),
    prev = h('div', { class: 'k-rprev ia-prev' });
  var form = h('div', { class: 'ia-form' });
  function row(label, control, tip) {
    return h('div', { class: 'k-row ia-row', title: tip || '' }, [
      h('span', { class: 'k-sub ia-l', text: label }),
      control
    ]);
  }
  function setParam(k, v) {
    params[k] = v;
    if (k === 'mode') paintForm();
    schedule();
  }
  function paintForm() {
    clear(form);
    form.appendChild(
      row(
        I18n.t('cadeditor.ui.imageart.width'),
        kNumber(params.width, {
          min: IMAGE_ART.MIN_WIDTH,
          max: IMAGE_ART.MAX_WIDTH,
          step: 1,
          dec: 0,
          onChange: function (v) {
            setParam('width', v);
          }
        }).el,
        I18n.t('cadeditor.ui.imageart.width_tip', IMAGE_ART.MIN_WIDTH, IMAGE_ART.MAX_WIDTH)
      )
    );
    form.appendChild(
      row(
        I18n.t('cadeditor.ui.imageart.mode'),
        kSeg(
          [
            { v: 'color', label: I18n.t('cadeditor.ui.imageart.mode_color') },
            { v: 'mono', label: I18n.t('cadeditor.ui.imageart.mode_mono') }
          ],
          params.mode,
          function (v) {
            setParam('mode', v);
          }
        ).el
      )
    );
    form.appendChild(
      row(
        I18n.t('cadeditor.ui.imageart.cells'),
        kSeg(
          [
            { v: 'half', label: I18n.t('cadeditor.ui.imageart.cells_half') },
            { v: 'octant', label: I18n.t('cadeditor.ui.imageart.cells_octant') }
          ],
          params.cells,
          function (v) {
            setParam('cells', v);
          }
        ).el,
        I18n.t('cadeditor.ui.imageart.cells_tip')
      )
    );
    form.appendChild(
      row(
        I18n.t('cadeditor.ui.imageart.dither'),
        kToggle(params.dither, function (v) {
          setParam('dither', v);
        }).el,
        I18n.t('cadeditor.ui.imageart.dither_tip')
      )
    );
    form.appendChild(
      row(
        I18n.t('cadeditor.ui.imageart.background'),
        kColor(parseInt(params.background.substring(1), 16), function (v) {
          setParam('background', hex6(v));
        }).el,
        I18n.t('cadeditor.ui.imageart.background_tip')
      )
    );
    if (params.mode === 'color') {
      form.appendChild(
        row(
          I18n.t('cadeditor.ui.imageart.tolerance'),
          kNumber(params.tolerance, {
            min: 0,
            max: 100,
            step: 1,
            dec: 0,
            unit: '%',
            onChange: function (v) {
              setParam('tolerance', v);
            }
          }).el,
          I18n.t('cadeditor.ui.imageart.tolerance_tip')
        )
      );
      form.appendChild(
        row(
          I18n.t('cadeditor.ui.imageart.levels'),
          kSeg(
            IMAGE_ART.LEVELS.map(function (n) {
              return { v: n, label: n === 256 ? I18n.t('cadeditor.ui.imageart.levels_all') : String(n) };
            }),
            params.levels,
            function (v) {
              setParam('levels', v);
            }
          ).el,
          I18n.t('cadeditor.ui.imageart.levels_tip')
        )
      );
    } else {
      form.appendChild(
        row(
          I18n.t('cadeditor.ui.imageart.threshold'),
          kNumber(params.threshold, {
            min: 1,
            max: 99,
            step: 1,
            dec: 0,
            unit: '%',
            onChange: function (v) {
              setParam('threshold', v);
            }
          }).el,
          I18n.t('cadeditor.ui.imageart.threshold_tip')
        )
      );
      form.appendChild(
        row(
          I18n.t('cadeditor.ui.imageart.invert'),
          kToggle(params.invert, function (v) {
            setParam('invert', v);
          }).el
        )
      );
      form.appendChild(
        row(
          I18n.t('cadeditor.ui.imageart.foreground'),
          kColor(parseInt(params.foreground.substring(1), 16), function (v) {
            setParam('foreground', hex6(v));
          }).el
        )
      );
    }
  }
  var insertSeg = kSeg(
    [
      { v: 'replace', label: I18n.t('cadeditor.ui.imageart.replace') },
      { v: 'append', label: I18n.t('cadeditor.ui.imageart.append') }
    ],
    insertMode,
    function (v) {
      insertMode = v;
      paintVerdict();
    }
  );
  var insertBtn = kBtn(I18n.t('cadeditor.ui.imageart.insert'), insert, { cls: 'pri', icon: 'check' });
  function existing() {
    var l = ctx.get();
    return Array.isArray(l) ? l.length : 0;
  }
  function paintEstimate() {
    if (!image) {
      status.textContent = ImageArtHost.available()
        ? I18n.t('cadeditor.ui.imageart.pick_first')
        : I18n.t('cadeditor.ui.imageart.needs_game');
      return;
    }
    var v = imageArtValidate(params);
    if (!v.ok) {
      status.textContent = Object.keys(v.errors)
        .map(function (k) {
          return v.errors[k];
        })
        .join(' · ');
      return;
    }
    var est = imageArtEstimate(image.width, image.height, v.params);
    status.textContent = I18n.t('cadeditor.ui.imageart.estimate', est.lines, fmtInt(est.maxChars));
  }
  function paintVerdict() {
    clear(reasons);
    var ok = false;
    if (result && result.status === 'result') {
      var v = imageArtVerdict(result, existing(), insertMode);
      ok = v.ok && Array.isArray(result.lines);
      status.textContent = I18n.t(
        'cadeditor.ui.imageart.measured',
        result.lineCount,
        fmtInt(result.jsonChars),
        fmtInt(IMAGE_ART.MAX_JSON)
      );
      v.reasons.forEach(function (t) {
        reasons.appendChild(kHint(t, 'err'));
      });
    }
    insertBtn.classList.toggle('dis', !ok);
    setTip(insertBtn, ok ? '' : reasons.textContent || status.textContent);
  }
  function paintPreview() {
    clear(prev);
    if (!result || !Array.isArray(result.lines)) return;
    var budget = IMAGE_ART.PREVIEW_RUNS,
      shown = 0;
    for (var i = 0; i < result.lines.length && budget > 0; i++) {
      var parsed = tcRuns(result.lines[i]);
      if (!parsed) continue;
      budget -= parsed.runs.length;
      var line = h('div', { class: 'ia-line' });
      renderRuns(line, {}, parsed.runs, { color: '#AA00AA', italic: true, placeholder: ' ' });
      prev.appendChild(line);
      shown++;
    }
    if (shown < result.lines.length)
      prev.appendChild(kHint(I18n.t('cadeditor.ui.imageart.preview_partial', shown, result.lines.length)));
  }
  function schedule() {
    paintEstimate();
    result = null;
    paintVerdict();
    if (!image) return;
    clearTimeout(timer);
    timer = setTimeout(generate, 250);
  }
  function generate() {
    if (closed || !image) return;
    var v = imageArtValidate(params);
    if (!v.ok) return;
    var est = imageArtEstimate(image.width, image.height, v.params);
    if (est.lines > IMAGE_ART.MAX_LINES) {
      result = { status: 'result', lineCount: est.lines, jsonChars: 0 };
      paintVerdict();
      clear(prev);
      return;
    }
    genId = ImageArtHost.send('generate', { params: v.params });
    status.textContent = I18n.t('cadeditor.ui.imageart.generating');
  }
  function choose() {
    if (!ImageArtHost.available()) {
      toast(I18n.t('cadeditor.ui.imageart.needs_game'), 'info', 'image-art');
      return;
    }
    chooseId = ImageArtHost.send('choose');
    status.textContent = I18n.t('cadeditor.ui.imageart.choosing');
  }
  function insert() {
    if (!result || !Array.isArray(result.lines) || !imageArtVerdict(result, existing(), insertMode).ok) {
      toast(reasons.textContent || I18n.t('cadeditor.ui.imageart.pick_first'), 'error', 'image-art');
      return;
    }
    var lines = clone(result.lines),
      cur = ctx.get();
    ctx.set(insertMode === 'append' && Array.isArray(cur) ? cur.concat(lines) : lines);
    toast(I18n.t('cadeditor.ui.imageart.inserted', lines.length), 'ok', 'image-art');
    closeModal();
  }
  ImageArtHost.listener = function (r) {
    if (closed) return;
    if (r.op === 'choose' && r.requestId === chooseId) {
      if (r.status === 'chosen') {
        image = { name: r.name, width: r.width, height: r.height, bytes: r.bytes };
        fileInfo.textContent = I18n.t(
          'cadeditor.ui.imageart.file',
          r.name,
          r.width + '×' + r.height,
          fmtInt(Math.ceil(r.bytes / 1024))
        );
        setTip(fileInfo, fileInfo.textContent);
        schedule();
      } else if (r.status === 'error') {
        status.textContent = r.reason || '';
        toast(r.reason || I18n.t('cadeditor.ui.imageart.failed'), 'error', 'image-art');
      } else paintEstimate();
    } else if (r.op === 'generate' && r.requestId === genId) {
      if (r.status === 'error') {
        status.textContent = r.reason || I18n.t('cadeditor.ui.imageart.failed');
        result = null;
      } else result = r;
      paintVerdict();
      paintPreview();
    }
  };
  paintForm();
  paintEstimate();
  paintVerdict();
  var body = h('div', { class: 'k-mb ia-body' }, [
    h('div', { class: 'k-row ia-pick' }, [pickBtn, fileInfo]),
    form,
    status,
    reasons,
    prev
  ]);
  var foot = h('div', { class: 'k-mf' }, [
    insertSeg.el,
    h('div', { class: 'grow' }),
    kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal),
    insertBtn
  ]);
  var win = modalShell({
    icon: 'image',
    title: I18n.t('cadeditor.ui.imageart.title'),
    sub: I18n.t('cadeditor.ui.imageart.sub'),
    cls: 'ia-win',
    body: body,
    foot: foot
  });
  var mask = openModal(win, true);
  if (mask)
    mask.onEditorClose = function () {
      closed = true;
      clearTimeout(timer);
      ImageArtHost.listener = null;
      ImageArtHost.send('release');
    };
  return win;
}
/* Lore 卡片上的入口按钮（cards1.js 的 Lore 卡片插入一行调用）。c = 卡片的 Ctx */
function imageArtButton(c) {
  var b = kBtn(
    I18n.t('cadeditor.ui.imageart.title'),
    function () {
      openImageArt({
        get: function () {
          return c.get('lore') || [];
        },
        set: function (lines) {
          c.setSmart('lore', lines, { label: I18n.t('cadeditor.ui.imageart.title') });
        }
      });
    },
    { icon: 'image', cls: 'ia-entry', title: I18n.t('cadeditor.ui.imageart.entry_tip') }
  );
  return b;
}
