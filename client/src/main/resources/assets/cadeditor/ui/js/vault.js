/* 保险库（本机）：把改好的物品栈存起来，之后取出放进槽位 / 物品字段。协议见 docs/vault-contract.md（vault → vault.result）。
   存的是带类型的 SNBT 栈，取出的栈和 apply / 提示框 / 世界编辑收的格式完全一样（含 component_snbt），所以能原样放进任何物品槽。 */
var Vault = {
  seq: 0,
  wait: {},
  st: { entries: null, bytes: 0, persisted: true, warning: '', storageError: '', readOnly: false },
  undo: null,
  /* 发一个 vault 操作；cb(r)：r.ok 为真是成功，否则 r.error / r.reason。超时（游戏没回应）给 TIMEOUT */
  call: function (op, fields, cb, view, timeoutMs) {
    var me = this,
      id = 'va' + ++this.seq + '-' + Date.now(),
      msg = { op: op, requestId: id },
      k;
    for (k in fields) msg[k] = fields[k];
    if (view) msg.view = view;
    function fail(code, why) {
      if (cb) cb({ ok: false, error: code, reason: why });
    }
    if (typeof oriel === 'undefined' || !oriel.send) {
      fail('UNAVAILABLE', I18n.t('cadeditor.ui.vault.connection_game'));
      return;
    }
    var len;
    try {
      len = JSON.stringify(msg).length;
    } catch (e) {
      fail('BAD_REQUEST', I18n.t('cadeditor.ui.vault.data_cannot_sequenced'));
      return;
    }
    if (len > 7900) {
      fail('REQUEST_TOO_LARGE', I18n.t('cadeditor.ui.vault.request_too_large'));
      return;
    }
    var w = (this.wait[id] = {
      cb: cb,
      t: setTimeout(
        function () {
          if (me.wait[id]) {
            delete me.wait[id];
            fail(
              'TIMEOUT',
              op === 'give'
                ? I18n.t('cadeditor.ui.vault.retrieve_results_unknown_vault_retained')
                : I18n.t('cadeditor.ui.vault.game_response_may_world_mod')
            );
          }
        },
        timeoutMs || (op === 'give' ? 12000 : 8000)
      )
    });
    var sent = false;
    try {
      sent = oriel.send('vault', msg);
    } catch (e) {}
    if (sent === false) {
      clearTimeout(w.t);
      delete this.wait[id];
      fail('UNAVAILABLE', I18n.t('cadeditor.ui.vault.host_accept_request'));
    }
  },
  receive: function (r) {
    if (!r || !r.requestId) return;
    var w = this.wait[r.requestId];
    if (!w) return;
    clearTimeout(w.t);
    delete this.wait[r.requestId];
    if (r.ok) {
      if (typeof r.giveCapability === 'string') this.st.giveCapability = r.giveCapability;
      if (r.persisted !== undefined) this.st.persisted = !!r.persisted;
      this.st.readOnly = !!r.readOnly;
      this.st.warning = r.warning || '';
      this.st.storageError = r.storageError || '';
      if (r.op === 'stats') {
        this.st.entries = r.entries;
        this.st.bytes = r.bytes;
        if (r.storage) this.st.storage = r.storage;
        this.st.upgradable = r.upgradable || 0;
        this.st.backupError = r.backupError || '';
      }
    }
    if (w.cb) w.cb(r);
  },
  /* 把一段长文本分段上传（请求 8192 字符上限），回调拿到 token */
  upload: function (text, cb) {
    var me = this,
      pos = 0,
      token = null,
      CH = 2800;
    function next() {
      var piece = text.substring(pos, pos + CH);
      if (piece.length && pos + piece.length < text.length) {
        var c = piece.charCodeAt(piece.length - 1);
        if (c >= 0xd800 && c <= 0xdbff) piece = piece.substring(0, piece.length - 1);
      } // 不切开代理对
      var f = { text: piece };
      if (token) f.token = token;
      me.call('upload', f, function (r) {
        if (!r.ok) {
          cb(r);
          return;
        }
        token = r.token;
        pos += piece.length;
        if (pos >= text.length) cb({ ok: true, token: token });
        else next();
      });
    }
    next();
  },
  /* 存栈；太大自动走分段上传 */
  save: function (stack, meta, cb) {
    var f = { stack: stack },
      k;
    meta = meta || {};
    for (k in meta) if (meta[k] !== undefined && meta[k] !== '') f[k] = meta[k];
    var small;
    try {
      small = JSON.stringify(f).length < 7000;
    } catch (e) {
      small = false;
    }
    if (small) {
      this.call('save', f, cb);
      return;
    }
    var me = this,
      up = JSON.stringify(stack),
      g = {};
    for (k in meta) if (meta[k] !== undefined && meta[k] !== '') g[k] = meta[k];
    this.upload(up, function (r) {
      if (!r.ok) {
        cb(r);
        return;
      }
      g.uploadToken = r.token;
      me.call('save', g, cb);
    });
  },
  /* 存一只生物：snbt 是带类型的实体 SNBT 文本（后端会剔除 UUID / 位置 / 乘客等运行时字段，剔除了什么在回复 stripped 里） */
  saveEntity: function (snbt, meta, cb) {
    var f = { kind: 'entity', snbt: snbt },
      k;
    meta = meta || {};
    for (k in meta) if (meta[k] !== undefined && meta[k] !== '') f[k] = meta[k];
    if (JSON.stringify(f).length < 7000) {
      this.call('save', f, cb);
      return;
    }
    var me = this,
      g = { kind: 'entity' };
    for (k in meta) if (meta[k] !== undefined && meta[k] !== '') g[k] = meta[k];
    this.upload(snbt, function (r) {
      if (!r.ok) {
        cb(r);
        return;
      }
      g.uploadToken = r.token;
      me.call('save', g, cb);
    });
  },
  /* 取出一只生物的 SNBT 文本 */
  takeEntity: function (id, cb) {
    this.call('get', { ids: [id] }, function (r) {
      if (!r.ok) {
        cb(r);
        return;
      }
      var e = r.entries && r.entries[0];
      if (e && typeof e.snbt === 'string') cb({ ok: true, snbt: e.snbt, entry: e });
      else cb({ ok: false, error: 'NOT_FOUND', reason: I18n.t('cadeditor.ui.vault.one_doesn_t_exist_anymore') });
    });
  },
  /* 取出完整的栈（编辑器 wire 格式）；get 超限就按 export 分页拼 */
  take: function (id, cb) {
    var me = this;
    this.call('get', { ids: [id] }, function (r) {
      if (r.ok) {
        var e = r.entries && r.entries[0];
        if (e && e.stack) cb({ ok: true, stack: e.stack, entry: e });
        else cb({ ok: false, error: 'NOT_FOUND', reason: I18n.t('cadeditor.ui.vault.rule_longer_exists') });
        return;
      }
      if (r.error !== 'RESPONSE_LIMIT') {
        cb(r);
        return;
      }
      var text = '',
        off = 0,
        rev = null;
      (function more() {
        me.call('export', { ids: [id], offset: off, limit: 3000 }, function (x) {
          if (!x.ok) {
            cb(x);
            return;
          }
          if (rev !== null && x.revision !== rev) {
            cb({ ok: false, error: 'CHANGED', reason: I18n.t('cadeditor.ui.vault.vault_changed_reading_try_again') });
            return;
          }
          rev = x.revision;
          text += x.text;
          if (!x.done) {
            off = x.nextOffset;
            more();
            return;
          }
          try {
            var e = JSON.parse(text).entries[0];
            cb({ ok: true, stack: e.stack, entry: e });
          } catch (err) {
            cb({ ok: false, error: 'BAD_DATA', reason: I18n.t('cadeditor.ui.vault.data_retrieve_cannot_parsed') });
          }
        });
      })();
    });
  }
};

/* ---------- 编辑器 wire 栈 → 原版嵌套 ItemStack（容器 / 装备 / 束袋里的物品）----------
   wire 栈的组件叫 comps（键不带 minecraft:），嵌套字段叫 components（完整 ID）；removed 写成 !完整ID。
   JSON 值取 comps；带类型的值同时登记成“手输类型”（nbtNote），提交时按类型输出。 */
function vaultNested(stack) {
  var out = { id: stack.id, count: stack.count || 1 },
    comps = {},
    any = false,
    sn = stack.component_snbt || {};
  var values = nbtHydrate(stack.comps || {}, sn);
  Object.keys(values).forEach(function (k) {
    nbtPut(comps, Reg.full(k), nbtTake(values, k));
    any = true;
  });
  Object.keys(stack.removed || {}).forEach(function (k) {
    comps['!' + Reg.full(k)] = {};
    any = true;
  });
  if (any) out.components = comps;
  return out;
}

/* ---------- 窗口 ---------- */
/* 列表行下面一行：标签小标记 + 备注（一行，放不下就截断，完整内容在 tip / 展开里） */
function vaultMeta(e, isEnt) {
  var tags = e.tags || [],
    note = (e.note || '').replace(/s+/g, ' ').trim();
  if (!tags.length && !note && !isEnt) return null;
  var kids = [];
  if (isEnt)
    kids.push(
      h('span', { class: 'k-tag', text: 'SNBT', title: I18n.t('cadeditor.ui.vault.type_entity_data_retrieve_use') })
    );
  tags.forEach(function (t) {
    kids.push(h('span', { class: 'k-tag dim', text: t }));
  });
  if (note) kids.push(h('span', { class: 'vt-note', text: note.length > 40 ? note.slice(0, 40) + '…' : note }));
  return h('div', { class: 'vt-meta' }, kids);
}
/* 生物条目：从保险库取出的 SNBT 文本 → 编辑器里用的 JSON（类型后缀登记成手输类型，提交时整段按 SNBT 输出） */
function vaultEntityObj(snbt) {
  return parseSnbtUser(snbt);
}
/* 乘客需要独立 type，但初始数据仍须逐节点保留 byte/float/long/数组。不能经过普通 JSON 打印。 */
function vaultEntityPayload(snbt) {
  var tree = nbtParse(snbt);
  if (tree.k !== 'obj') throw new Error(I18n.t('cadeditor.ui.vault.mob_data_must_snbt_composite'));
  var id = tree.map.id;
  if (!id || id.k !== 'str' || !id.v) throw new Error(I18n.t('cadeditor.ui.vault.mob_data_missing_type_id'));
  delete tree.map.id;
  tree.keys = tree.keys.filter(function (key) {
    return key !== 'id';
  });
  return { type: id.v, snbt: nbtPrint(tree, false) };
}
function vaultEntInfo(e) {
  var s = e.summary || e.entity || {};
  return { id: e.entityId || s.id || (e.entity && e.entity.id) || '', s: s };
}
function vaultEntitySummary(e) {
  var i = vaultEntInfo(e),
    s = i.s,
    bits = [];
  if (i.id) bits.push(entityName(i.id));
  if (s.baby) bits.push(I18n.t('cadeditor.ui.vault.baby'));
  if (s.hasCustomName) bits.push(I18n.t('cadeditor.ui.vault.named'));
  if (s.equipmentCount) bits.push(I18n.t('cadeditor.ui.vault.equipment', s.equipmentCount));
  if (s.attributeCount) bits.push(I18n.t('cadeditor.ui.vault.item_attribute', s.attributeCount));
  if (s.effectCount) bits.push(I18n.t('cadeditor.ui.vault.effect', s.effectCount));
  return bits.join(' · ');
}
/* 方块 / 玩家预设条目：摘要键见 docs/vault-contract.md（block、blockStateFields、nbtFields；sections、counts） */
function vaultOtherIcon(e) {
  var s = e.summary || {};
  return e.kind === 'block' ? itemIcon(shortId(s.block || 'minecraft:stone'), 16) : uiIcon('user', 16);
}
function vaultOtherSummary(e) {
  var s = e.summary || {},
    bits = [];
  if (e.kind === 'block') {
    if (s.block) bits.push(nameOf('block', shortId(s.block)) || humanId(s.block));
    if (s.blockStateFields) bits.push(I18n.t('cadeditor.ui.vault.status', s.blockStateFields));
    if (s.nbtFields) bits.push(I18n.t('cadeditor.ui.vault.item_data', s.nbtFields));
  } else
    (s.sections || []).forEach(function (k) {
      var n = s.counts && s.counts[k];
      bits.push((Labels.vaultSection[k] || k) + (n ? ' ' + n : ''));
    });
  return bits.join(' · ');
}
function vaultSummary(e) {
  var s = e.summary || {},
    bits = [];
  if (s.enchantCount) bits.push(I18n.t('cadeditor.ui.vault.enchantment', s.enchantCount));
  if (s.hasCustomName) bits.push(I18n.t('cadeditor.ui.vault.custom_name'));
  if (s.containerSize) bits.push(I18n.t('cadeditor.ui.vault.inline', s.containerSize));
  if (e.item && e.item.count > 1) bits.push('× ' + e.item.count);
  if (e.incompatible) bits.push(I18n.t('cadeditor.ui.vault.current_version_cannot_opened'));
  else if (e.upgradable) bits.push(I18n.t('cadeditor.ui.vaultpages.upgradable'));
  return bits.join(' · ');
}
var VaultGivePending = {};
function vInput(value, onCommit, ph) {
  var el = kInput(value, function () {}, { placeholder: ph, onCommit: onCommit });
  el.classList.add('vt-in');
  return el;
}
function vaultErr(r) {
  toast((r && r.reason) || (r && r.error) || I18n.t('cadeditor.ui.vault.vault_operation_failed'), 'error');
}

/* 保险库窗口的会话设置：视图（列表 / 网格）、排序、反向、当前页。关掉再开保持（只在本次运行内） */
var VaultUi = { view: 'list', sort: 'recent', reverse: false, page: '' };

/* opts.pick(stack, entry)：作为选择器打开时，点「使用」把栈交出去；不传就是普通的保险库窗口 */
function openVault(opts) {
  opts = opts || {};
  var V = {
    query: '',
    tags: [],
    tagNames: [],
    sort: VaultUi.sort,
    reverse: VaultUi.reverse,
    page: VaultUi.page,
    view: VaultUi.view,
    pages: [],
    rows: [],
    total: 0,
    next: null,
    token: 0,
    open: -1,
    kind:
      opts.pickEntity || opts.kind === 'entity'
        ? 'entity'
        : opts.kind === 'block' || opts.kind === 'player_preset'
          ? opts.kind
          : 'item'
  };
  var fixedKind = !!(opts.pick || opts.pickEntity || opts.pickEntry); // 作为选择器打开时只看对应的一类
  var q = h('input', {
    class: 'k-input',
    type: 'text',
    placeholder: I18n.t('cadeditor.ui.vault.search_name_label_item_support'),
    spellcheck: 'false'
  });
  var sbox = kSearchBox(q, function (v) {
    V.query = v;
    paintHints();
    refresh();
  });
  /* 搜索语法：正在输入的词给出前缀 / 示例值补全；Tab 采纳第一个 */
  var hintBar = h('div', { class: 'k-chips vt-qhint' });
  hintBar.style.display = 'none';
  function hintsFor() {
    return vaultQueryHints(q.value, { pages: V.pages.map(vaultPageLabel), tags: V.tagNames });
  }
  function paintHints() {
    clear(hintBar);
    var list = hintsFor();
    hintBar.style.display = list.length ? '' : 'none';
    list.forEach(function (x) {
      var c = h('div', { class: 'k-chip', text: x.label });
      activate(c, function () {
        q.value = x.text;
        if (q.focus) q.focus();
        if (x.done) sbox.go();
        paintHints();
      });
      hintBar.appendChild(c);
    });
  }
  q.addEventListener('input', paintHints);
  q.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var list = hintsFor();
    if (!list.length) return;
    e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    q.value = list[0].text;
    paintHints();
  });
  var help = h('div', { class: 'k-btn vt-qhelp' }, [uiIcon('help', 12)]);
  setTip(help, I18n.t('cadeditor.ui.vault.search_syntax_help'));
  var tagBar = h('div', { class: 'k-chips vt-tags' }),
    pageBar = h('div', { class: 'k-chips vt-pages' }),
    list,
    stat = h('span', { class: 'k-sub vt-stat' }),
    warn = h('div', { class: 'vt-warn' });
  var sort = kSelect(
    [
      { v: 'recent', label: I18n.t('cadeditor.ui.vault.sort_recent') },
      { v: 'saved', label: I18n.t('cadeditor.ui.vault.sort_saved') },
      { v: 'name', label: I18n.t('cadeditor.ui.cards1.name') },
      { v: 'item', label: I18n.t('cadeditor.ui.labels.type') },
      { v: 'count', label: I18n.t('cadeditor.ui.vault.sort_count') },
      { v: 'size', label: I18n.t('cadeditor.ui.vault.sort_size') }
    ],
    V.sort,
    function (v) {
      V.sort = VaultUi.sort = v;
      refresh();
    },
    { width: 160 }
  );
  var revBtn = kBtn(
    '',
    function () {
      V.reverse = VaultUi.reverse = !V.reverse;
      revBtn.classList.toggle('on', V.reverse);
      refresh();
    },
    { icon: 'sort', title: I18n.t('cadeditor.ui.vault.reverse_sort') }
  );
  revBtn.classList.toggle('on', V.reverse);
  var viewSeg = kSeg(
    [
      { v: 'list', icon: 'list', label: '', title: I18n.t('cadeditor.ui.vault.view_list') },
      { v: 'grid', icon: 'grid', label: '', title: I18n.t('cadeditor.ui.vault.view_grid') }
    ],
    V.view,
    function (v) {
      V.view = VaultUi.view = v;
      paintView();
      load(false);
    },
    'vt-view'
  );
  var pagesBtn = kBtn(
    I18n.t('cadeditor.ui.vault.pages'),
    function () {
      openVaultPages(refresh);
    },
    { icon: 'folder', title: I18n.t('cadeditor.ui.vault.manage_pages') }
  );
  var persistPoll = 0,
    pickingEntity = false,
    pickMask;
  function pollPersisted() {
    // 后台落盘完成时游戏不会主动通知：还显示“正在保存…”就隔一会儿问一次
    if (Vault.st.persisted || persistPoll >= 12 || !$('modal')) return;
    persistPoll++;
    setTimeout(function () {
      Vault.call('stats', {}, function () {
        paintState();
      });
    }, 600);
  }
  function paintState() {
    stat.textContent =
      (Vault.st.entries === null
        ? ''
        : I18n.t('cadeditor.ui.vault.total', Vault.st.entries) +
          (Vault.st.bytes ? ' · ' + vaultSize(Vault.st.bytes) : '')) +
      (Vault.st.persisted ? '' : I18n.t('cadeditor.ui.vault.saving'));
    setTip(stat, Vault.st.storage ? I18n.t('cadeditor.ui.vault.save_all_saved_data_server', Vault.st.storage) : '');
    clear(warn);
    var w = Vault.st.storageError
      ? I18n.t('cadeditor.ui.vault.failed_save_disk_changes_keep', Vault.st.storageError)
      : Vault.st.readOnly
        ? I18n.t('cadeditor.ui.vault.vault_file_version_better_mod')
        : Vault.st.warning
          ? I18n.t('cadeditor.ui.vault.vault_file_problem_original_file', Vault.st.warning)
          : '';
    if (w) warn.appendChild(h('div', { class: 'vt-msg bad', text: w }));
    if (!fixedKind && V.kind === 'item' && Vault.st.upgradable > 0 && !Vault.st.readOnly)
      warn.appendChild(
        h('div', { class: 'vt-msg' }, [
          h('span', { text: I18n.t('cadeditor.ui.vault.upgradable_count', Vault.st.upgradable) }),
          kBtn(
            I18n.t('cadeditor.ui.vaultpages.upgrade_all'),
            function () {
              vaultUpgradeAll(Vault.st.upgradable, refresh);
            },
            { icon: 'refresh', cls: 'sm' }
          )
        ])
      );
    if (!fixedKind && V.kind === 'item' && Vault.st.giveCapability)
      warn.appendChild(h('div', { class: 'vt-msg', text: Vault.st.giveCapability }));
    pollPersisted();
  }
  var tagsOpen = false,
    tagBtn = kBtn(
      I18n.t('cadeditor.ui.eschema.tags'),
      function () {
        tagsOpen = !tagsOpen;
        tagBar.style.display = tagsOpen ? '' : 'none';
      },
      { icon: 'tag', title: I18n.t('cadeditor.ui.vault.filter_tag') }
    );
  tagBar.style.display = 'none';
  tagBtn.style.display = 'none';
  function paintTagBtn() {
    clear(tagBtn);
    tagBtn.appendChild(uiIcon('tag', 12));
    tagBtn.appendChild(
      h('span', {
        text: V.tags.length ? I18n.t('cadeditor.ui.vault.label', V.tags.length) : I18n.t('cadeditor.ui.eschema.tags')
      })
    );
    tagBtn.classList.toggle('on', V.tags.length > 0);
  }
  function paintTags(tags) {
    clear(tagBar);
    tagBtn.style.display = (tags || []).length ? '' : 'none';
    if (!(tags || []).length) {
      tagsOpen = false;
      tagBar.style.display = 'none';
    }
    paintTagBtn();
    (tags || []).forEach(function (t) {
      var on = V.tags.indexOf(t.name) >= 0,
        c = h('div', { class: 'k-chip' + (on ? ' on' : ''), text: t.name + ' ' + t.count });
      activate(c, function () {
        var i = V.tags.indexOf(t.name);
        if (i >= 0) V.tags.splice(i, 1);
        else V.tags.push(t.name);
        refresh();
      });
      tagBar.appendChild(c);
    });
  }
  /* 页签：只有建了自定义页才出现；数字是当前类别在该页的条数 */
  function paintPages() {
    clear(pageBar);
    pageBar.style.display = V.pages.length > 1 ? '' : 'none';
    function chip(id, label, n) {
      var c = h('div', { class: 'k-chip' + (V.page === id ? ' on' : '') }, [
        h('span', { text: label }),
        n === undefined ? null : h('span', { class: 'vt-pcount', text: ' ' + n })
      ]);
      activate(c, function () {
        V.page = VaultUi.page = id;
        paintPages();
        refresh();
      });
      return c;
    }
    if (V.pages.length <= 1) return;
    pageBar.appendChild(chip('', I18n.t('cadeditor.ui.vault.all_pages')));
    V.pages.forEach(function (p) {
      pageBar.appendChild(chip(p.id, vaultPageLabel(p), vaultPageCount(p, V.kind)));
    });
  }
  pageBar.style.display = 'none';
  function load(append, tries) {
    if (append && V.next === null) return;
    var tok = ++V.token;
    if (!append) {
      clear(errBox);
      errBox.appendChild(kLoadingRow(I18n.t('cadeditor.ui.vault.loading_vault')));
    } // 读完（或失败）时 errBox 会被清掉 / 换成错误提示
    var f = {
      kind: V.kind,
      query: V.query,
      tags: V.tags,
      sort: V.sort,
      offset: append ? V.next : 0,
      limit: V.view === 'grid' ? 100 : 40
    };
    if (V.reverse) f.reverse = true;
    if (V.page) f.page = V.page;
    Vault.call(
      'list',
      f,
      function (r) {
        if (tok !== V.token) return;
        if (!r.ok) {
          if (r.error === 'NOT_READY' && (tries || 0) < 8) {
            setTimeout(function () {
              if (tok === V.token) load(append, (tries || 0) + 1);
            }, r.retryAfterMs || 500);
            return;
          } // 文件还在加载：等一下再要，不把“还没读完”当成“是空的”
          if (r.error === 'PAGE_NOT_FOUND' && V.page) {
            V.page = VaultUi.page = ''; // 这一页刚被删掉：回到全部
            paintPages();
            load(false);
            return;
          }
          if (!append) {
            V.rows = [];
            V.total = 0;
            V.next = null;
          }
          more.style.display = 'none';
          draw();
          vaultErrRow(r);
          return;
        }
        clear(errBox);
        /* 两类条目分开：生物页只留 kind==='entity' 的，物品页不要 entity。旧版本的游戏不认 kind，会把物品原样返回——那时生物页给出说明，不把物品当生物 */
        var got = r.entries || [],
          mine = got.filter(function (x) {
            return V.kind === 'item' ? x.kind === undefined || x.kind === 'item' : x.kind === V.kind;
          });
        if (
          V.kind !== 'item' &&
          got.length &&
          !got.some(function (x) {
            return x.kind !== undefined;
          })
        ) {
          mine = [];
          V.legacy = true;
        } else V.legacy = false;
        r = Object.assign({}, r, { entries: mine, total: V.legacy ? 0 : r.total });
        V.rows = append ? V.rows.concat(r.entries) : r.entries;
        V.total = r.total;
        V.next = r.done ? null : r.nextOffset;
        more.style.display = V.next === null ? 'none' : '';
        paintState();
        draw();
      },
      'vault'
    );
  }
  function refresh() {
    V.open = -1;
    load(false);
    Vault.call('tags', {}, function (r) {
      if (!r.ok) return;
      V.tagNames = (r.tags || []).map(function (t) {
        return t.name;
      });
      paintTags(r.tags);
    });
    Vault.call('stats', {}, function () {
      paintState();
    });
    Vault.call('pages', {}, function (r) {
      if (!r.ok || !r.pages) return;
      V.pages = r.pages;
      paintPages();
    });
    undoBar();
  }
  var errBox = h('div', {});
  function vaultErrRow(r) {
    clear(errBox);
    errBox.appendChild(
      xEmpty(
        (r.reason || r.error || I18n.t('cadeditor.ui.vault.could_load_vault')) +
          (r.error === 'NOT_READY' ? I18n.t('cadeditor.ui.vault.files_still_loaded_we_ll') : '')
      )
    );
  }
  function takeAnd(e, fn) {
    Vault.take(e.id, function (r) {
      if ($('modal') !== pickMask) return;
      if (!r.ok) {
        vaultErr(r);
        return;
      }
      fn(r.stack, r.entry);
    });
  }
  function editAndUse(e, entity) {
    if (pickingEntity) return;
    var valid = nestedDraftGuard();
    pickingEntity = true;
    function received(r) {
      pickingEntity = false;
      if ($('modal') !== pickMask) return;
      if (!r.ok) {
        vaultErr(r);
        return;
      }
      if (!valid()) {
        toast(I18n.t('cadeditor.ui.vault.edit_target_changed_re_select'), 'warn');
        return;
      }
      function use(value) {
        if ($('modal') !== pickMask) return;
        closeModal();
        if (entity) opts.pickEntity(value, r.entry);
        else opts.pick(value, r.entry);
      }
      if (entity)
        openEntityDraft(r.snbt, {
          title: e.name || I18n.t('cadeditor.ui.eschema.edit_entity'),
          valid: valid,
          commit: use
        });
      else
        openNestedItem(r.stack, {
          title: e.name || I18n.t('cadeditor.ui.cards3.edit_item'),
          commitUnchanged: true,
          valid: valid,
          commit: use
        });
    }
    if (entity) Vault.takeEntity(e.id, received);
    else Vault.take(e.id, received);
  }
  function emptyText() {
    return V.legacy
      ? I18n.t('cadeditor.ui.vault.version_game_support_saving_mob')
      : V.query || V.tags.length || V.page
        ? I18n.t('cadeditor.ui.vault.matching_entries')
        : V.kind === 'block'
          ? I18n.t('cadeditor.ui.vault.block_stored_yet_point_block')
          : V.kind === 'player_preset'
            ? I18n.t('cadeditor.ui.vault.player_preset_yet_stored_open')
            : V.kind === 'entity'
              ? I18n.t('cadeditor.ui.vault.mob_yet_stored_mob_editor')
              : I18n.t('cadeditor.ui.vault.vault_still_empty_edit_store');
  }
  /* 一条的主要操作（行右侧 / 网格小窗顶部）：给我、使用、套用…… */
  function rowActions(e) {
    var acts = h('div', { class: 'x-rt' }, []);
    var isEnt = V.kind === 'entity';
    var isOther = V.kind === 'block' || V.kind === 'player_preset';
    if (isOther) {
      if (opts.pickEntry)
        acts.appendChild(
          kBtn(
            I18n.t('cadeditor.ui.vault.apply'),
            function () {
              opts.pickEntry(e);
            },
            { cls: 'pri', icon: 'check' }
          )
        );
      else if (V.kind === 'player_preset')
        acts.appendChild(
          kBtn(
            I18n.t('cadeditor.ui.vault.apply_yourself'),
            function () {
              vwApplyToSelf(e);
            },
            { icon: 'download', title: I18n.t('cadeditor.ui.vault.read_current_data_select_partitions') }
          )
        );
    } else if (isEnt && opts.pickEntity)
      acts.appendChild(
        kBtn(
          I18n.t('cadeditor.ui.vault.use'),
          function () {
            if (pickingEntity) return;
            pickingEntity = true;
            Vault.takeEntity(e.id, function (r) {
              pickingEntity = false;
              if ($('modal') !== pickMask) return; // Cancelled/replaced: discard late reads silently.
              if (!r.ok) {
                vaultErr(r);
                return;
              }
              closeModal();
              opts.pickEntity(r.snbt, r.entry);
            });
          },
          { cls: 'pri', icon: 'check' }
        )
      );
    else if (isEnt) {
      /* 生物条目在窗口里只管理；取出在各处“选择生物”里 */
    } else if (opts.pick)
      acts.appendChild(
        kBtn(
          I18n.t('cadeditor.ui.vault.use'),
          function () {
            takeAnd(e, function (stack, entry) {
              closeModal();
              opts.pick(stack, entry);
            });
          },
          { cls: 'pri', icon: 'check' }
        )
      );
    else {
      var giveBtn = kBtn(
        I18n.t('cadeditor.ui.vault.give_me'),
        function () {
          if (VaultGivePending[e.id]) return; // 回复回来之前不重复发，不然会给出好几份
          VaultGivePending[e.id] = true;
          giveBtn.classList.add('dis');
          Vault.call('give', { id: e.id, slot: 'inventory' }, function (r) {
            delete VaultGivePending[e.id];
            giveBtn.classList.remove('dis');
            if (r.ok) toast(r.reason || I18n.t('cadeditor.ui.vault.added_inventory'), 'ok');
            else vaultErr(r);
          });
        },
        { icon: 'download', title: I18n.t('cadeditor.ui.vault.inventory_empty_slot_non_creative') }
      );
      acts.appendChild(giveBtn);
    }
    if ((isEnt && opts.pickEntity) || (!isEnt && !isOther && opts.pick))
      acts.appendChild(
        kBtn(
          I18n.t('cadeditor.ui.vault.edit_before_using'),
          function () {
            editAndUse(e, isEnt);
          },
          { icon: 'edit' }
        )
      );
    return acts;
  }
  function rowIcon(e) {
    if (V.kind === 'block' || V.kind === 'player_preset') return vaultOtherIcon(e);
    if (V.kind === 'entity') return entityIcon(vaultEntInfo(e).id || 'minecraft:pig', 16);
    return itemIcon((e.item && e.item.id) || 'minecraft:stick', 16);
  }
  function rowSub(e) {
    var sub =
      V.kind === 'block' || V.kind === 'player_preset'
        ? vaultOtherSummary(e)
        : V.kind === 'entity'
          ? vaultEntitySummary(e) || vaultEntInfo(e).id
          : vaultSummary(e) || (e.item && e.item.id) || '';
    return e.bytes ? (sub ? sub + ' · ' : '') + vaultSize(e.bytes) : sub;
  }
  /* 展开区：名称 / 标签 / 备注、所在页、升级、复制、删除。列表展开和网格小窗共用 */
  function entryBody(e) {
    var nm = vInput(
      e.name || '',
      function (v) {
        if (!v.trim()) return;
        Vault.call('update', { id: e.id, name: v }, function (r) {
          if (r.ok) {
            e.name = v;
            paintState();
          } else vaultErr(r);
        });
      },
      I18n.t('cadeditor.ui.cards1.name')
    );
    var tg = vInput(
      (e.tags || []).join('，'),
      function (v) {
        var t = splitTags(v).slice(0, 8);
        Vault.call('update', { id: e.id, tags: t }, function (r) {
          if (r.ok) {
            e.tags = t;
            refresh();
            draw();
          } else vaultErr(r);
        });
      },
      I18n.t('cadeditor.ui.vault.label_separated_comma_up_8')
    );
    var nt = vInput(
      e.note || '',
      function (v) {
        Vault.call('update', { id: e.id, note: v }, function (r) {
          if (r.ok) {
            e.note = v;
            draw();
          } else vaultErr(r);
        });
      },
      I18n.t('cadeditor.ui.vault.remarks_up_200')
    );
    var copyBtn = kBtn(
      I18n.t('cadeditor.ui.vault.duplicate'),
      function () {
        Vault.call('duplicate', { id: e.id }, function (r) {
          if (r.ok) refresh();
          else vaultErr(r);
        });
      },
      { icon: 'copy' }
    );
    var delBtn = kBtn(
      I18n.t('cadeditor.ui.common.delete'),
      function () {
        Vault.call('delete', { ids: [e.id] }, function (r) {
          if (r.ok) {
            Vault.undo = { token: r.token, until: Date.now() + 29000 };
            toast(I18n.t('cadeditor.ui.vault.deleted_30_revoked_bottom_window'), 'info');
            kPopClose();
            refresh();
            undoBar();
          } else vaultErr(r);
        });
      },
      { cls: 'dng', icon: 'trash' }
    );
    function vf(label, el) {
      return h('div', { class: 'vt-f' }, [h('span', { class: 'k-sub', text: label }), el]);
    }
    var acts = [copyBtn, delBtn];
    if ((e.kind === undefined || e.kind === 'item') && (e.upgradable || e.incompatible))
      acts.unshift(
        kBtn(
          I18n.t('cadeditor.ui.vault.upgrade'),
          function () {
            vaultUpgrade([e.id], function () {
              kPopClose();
              refresh();
            });
          },
          { icon: 'refresh', title: I18n.t('cadeditor.ui.vault.upgrade_tip', e.mcDataVersion || 0) }
        )
      );
    if (e.kind === 'player_preset')
      acts.unshift(
        kBtn(
          I18n.t('cadeditor.ui.vault.view_player_data'),
          function () {
            if (typeof oriel !== 'undefined' && oriel.send) {
              oriel.send('open_world', { vault_id: e.id });
              closeModal();
            }
          },
          { cls: 'pri', icon: 'eye', title: I18n.t('cadeditor.ui.vault.open_preset_player_edit_page') }
        )
      );
    var fields = [
      vf(I18n.t('cadeditor.ui.cards1.name'), nm),
      vf(I18n.t('cadeditor.ui.eschema.tags'), tg),
      vf(I18n.t('cadeditor.ui.vault.notes'), nt)
    ];
    if (V.pages.length > 1)
      fields.push(
        vf(
          I18n.t('cadeditor.ui.vault.page'),
          kSelect(
            V.pages.map(function (p) {
              return { v: p.id, label: vaultPageLabel(p) };
            }),
            e.page || 'default',
            function (v) {
              Vault.call('move', { ids: [e.id], page: v }, function (r) {
                if (r.ok) {
                  e.page = v;
                  refresh();
                } else vaultErr(r);
              });
            },
            { width: 200 }
          ).el
        )
      );
    fields.push(h('div', { class: 'vt-act' }, acts));
    return [h('div', { class: 'vt-det' }, fields)];
  }
  var xl = xList({
    items: function () {
      return V.rows;
    },
    /* Evaluated at every paint: the same list shows search results, page filters and kind switches. */
    empty: emptyText,
    row: function (e, i) {
      return {
        chevron: true,
        icon: rowIcon(e),
        title: e.name,
        sub: rowSub(e),
        tip: (e.note || '') + (e.translatedName ? '\n' + e.translatedName : ''),
        right: rowActions(e),
        meta: vaultMeta(e, V.kind === 'entity'),
        body: function () {
          return entryBody(e);
        }
      };
    }
  });
  /* 网格：按格子显示图标和数量，悬停看名称 / 数量 / 大小，点开是同一套操作 */
  var gridBox = h('div', { class: 'vt-grid' });
  function openCellPop(cell, e) {
    kPopover(
      cell,
      h(
        'div',
        { class: 'vt-pop' },
        [
          h('div', { class: 'vt-pop-h' }, [
            rowIcon(e),
            h('b', { text: e.name || '' }),
            h('span', { class: 'k-sub', text: rowSub(e) }),
            h('div', { class: 'grow' }),
            rowActions(e)
          ])
        ].concat(entryBody(e))
      ),
      { width: 560, maxHeight: 360 }
    );
  }
  function drawGrid() {
    clear(gridBox);
    if (!V.rows.length) {
      gridBox.appendChild(xEmpty(emptyText()));
      return;
    }
    V.rows.forEach(function (e) {
      var count = (e.item && e.item.count) || 1;
      var cell = h('div', { class: 'slot s34 vt-cell' + (e.incompatible ? ' bad' : e.upgradable ? ' old' : '') }, [
        rowIcon(e),
        count > 1 ? h('span', { class: 'cnt', text: String(count) }) : null
      ]);
      setTip(cell, vaultCellTip(e));
      activate(cell, function () {
        openCellPop(cell, e);
      });
      gridBox.appendChild(cell);
    });
  }
  function paintView() {
    xl.el.style.display = V.view === 'grid' ? 'none' : '';
    gridBox.style.display = V.view === 'grid' ? '' : 'none';
  }
  function draw() {
    if (V.view === 'grid') drawGrid();
    else xl.draw();
  }
  var undoEl = h('div', {});
  function undoBar() {
    clear(undoEl);
    if (!Vault.undo || Date.now() > Vault.undo.until) return;
    undoEl.appendChild(
      h('div', { class: 'vt-msg' }, [
        h('span', { text: I18n.t('cadeditor.ui.vault.entry_just_deleted') }),
        kBtn(
          I18n.t('cadeditor.ui.vault.undo_delete'),
          function () {
            var t = Vault.undo.token;
            Vault.undo = null;
            Vault.call('restore', { token: t }, function (r) {
              if (r.ok) {
                toast(I18n.t('cadeditor.ui.vault.restored'), 'ok');
                refresh();
                clear(undoEl);
              } else vaultErr(r);
            });
          },
          { icon: 'undo' }
        )
      ])
    );
  }
  list = h('div', { class: 'vt-list' }, [xl.el, gridBox, errBox]);
  paintView();
  var more = kBtn(
    I18n.t('cadeditor.ui.vault.show_more'),
    function () {
      load(true);
    },
    { icon: 'down' }
  );
  more.style.display = 'none';
  var saveBtn = kBtn(
    I18n.t('cadeditor.ui.vault.store_current_item'),
    function () {
      openVaultSave(function () {
        refresh();
      }, V.page);
    },
    { cls: 'pri', icon: 'plus' }
  );
  if (!(Store.docs && Store.docs.length) || V.kind !== 'item' || opts.pickEntity) saveBtn.style.display = 'none';
  var impBtn = kBtn(
    I18n.t('cadeditor.ui.vault.import'),
    function () {
      openVaultImportMenu(refresh);
    },
    { icon: 'upload' }
  );
  var expBtn = kBtn(
    I18n.t('cadeditor.ui.vault.export_all'),
    function () {
      vaultExport();
    },
    { icon: 'download' }
  );
  var backupBtn = kBtn(
    I18n.t('cadeditor.ui.vault.backups'),
    function () {
      openVaultBackups(refresh);
    },
    { icon: 'save', title: I18n.t('cadeditor.ui.vault.backups_tip') }
  );
  /* 服务端的编辑历史（需要在服务器里，且服务器装了本模组或 CADEditor 插件） */
  var histBtn = kBtn(
    I18n.t('cadeditor.ui.history.title'),
    function () {
      openHistory({ stacked: true });
    },
    { icon: 'clock', title: I18n.t('cadeditor.ui.history.sub') }
  );
  var kindSeg = fixedKind
    ? null
    : kSeg(
        [
          { v: 'item', label: I18n.t('cadeditor.ui.pages.item_2'), icon: 'backpack' },
          { v: 'entity', label: I18n.t('cadeditor.ui.screens.entity'), icon: 'paw' },
          { v: 'block', label: I18n.t('cadeditor.ui.picker.block'), icon: 'cube' },
          { v: 'player_preset', label: I18n.t('cadeditor.ui.vault.player_presets'), icon: 'user' }
        ],
        V.kind,
        function (v) {
          V.kind = v;
          V.tags = [];
          saveBtn.style.display = v === 'item' && Store.docs && Store.docs.length ? '' : 'none';
          q.setAttribute(
            'placeholder',
            v === 'entity'
              ? I18n.t('cadeditor.ui.vault.search_name_label_mob_support')
              : v === 'block'
                ? I18n.t('cadeditor.ui.vault.search_name_tag_block')
                : v === 'player_preset'
                  ? I18n.t('cadeditor.ui.vault.search_name_tag')
                  : I18n.t('cadeditor.ui.vault.search_name_label_item_support')
          );
          paintPages();
          refresh();
        }
      ).el;
  var body = [
    h('div', { class: 'vt-bar' }, [kindSeg, sbox.el, help, sort.el, revBtn, viewSeg.el, pagesBtn, tagBtn, stat]),
    hintBar,
    pageBar,
    tagBar,
    warn,
    list,
    more
  ];
  var win = modalShell(
    I18n.t('cadeditor.ui.common.vault'),
    opts.pickEntity
      ? I18n.t('cadeditor.ui.vault.choose_entity')
      : opts.pick
        ? I18n.t('cadeditor.ui.vault.choose_item_store')
        : I18n.t('cadeditor.ui.vault.exists_computer_all_saved_data'),
    body,
    [
      saveBtn,
      // E: new item from any registry item (js/newitem.js); not offered while the vault is picking for a field.
      typeof openNewItem === 'function' && !fixedKind
        ? kBtn(I18n.t('cadeditor.ui.newitem.vault_button'), openNewItem, {
            icon: 'plus',
            title: I18n.t('cadeditor.ui.newitem.sub')
          })
        : null,
      impBtn,
      expBtn,
      backupBtn,
      histBtn,
      undoEl,
      h('div', { class: 'grow' }),
      kBtn(I18n.t('cadeditor.ui.common.done'), closeModal, { cls: 'pri' })
    ],
    'wide vtwin'
  );
  pickMask = openModal(win, !!opts.pick || opts.stacked !== false);
  windowify(win, 'vault'); // 默认保留打开保险库的父窗口；显式 false 才替换。
  refresh();
  paintState();
}

/* 存入一只生物：snbt 是带类型的实体数据文本；名称默认用生物名 */
function openVaultSaveEntity(snbt, defName, done) {
  if (!snbt || snbt === '{}') {
    toast(I18n.t('cadeditor.ui.vault.entity_data_yet'), 'warn');
    return;
  }
  var nm = kInput(defName || '', function () {}, { placeholder: I18n.t('cadeditor.ui.cards1.name') }),
    tg = kInput('', function () {}, { placeholder: I18n.t('cadeditor.ui.vault.label_separated_comma_cannot_filled') }),
    nt = kInput('', function () {}, { placeholder: I18n.t('cadeditor.ui.vault.notes_optional') });
  var go = kBtn(
    I18n.t('cadeditor.ui.vault.store'),
    function () {
      var tags = splitTags(tg.value).slice(0, 8);
      Vault.saveEntity(snbt, { name: (nm.value || '').trim(), tags: tags, note: nt.value || '' }, function (r) {
        if (!r.ok) {
          vaultErr(r);
          return;
        }
        closeModal();
        toast(
          (r.duplicate
            ? I18n.t('cadeditor.ui.vault.vault_already_same_image')
            : I18n.t('cadeditor.ui.vault.stored_vault')) +
            (r.entry ? r.entry.name : '') +
            (r.stripped && r.stripped.length ? I18n.t('cadeditor.ui.vault.location_uuid_etc_running_data') : ''),
          'ok'
        );
        if (done) done();
      });
    },
    { cls: 'pri', icon: 'check' }
  );
  openModal(
    modalShell(
      I18n.t('cadeditor.ui.eschema.store_vault'),
      I18n.t('cadeditor.ui.screens.entity'),
      [
        fieldRow(I18n.t('cadeditor.ui.cards1.name'), nm),
        fieldRow(I18n.t('cadeditor.ui.eschema.tags'), tg),
        fieldRow(I18n.t('cadeditor.ui.vault.notes'), nt)
      ],
      [h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal), go]
    ),
    true
  );
}

/* 存入当前物品：名称 / 标签 / 备注可以填，不填就用默认；page = 保险库当前所在的自定义页（可省） */
function openVaultSave(done, page) {
  var d = Store.doc();
  if (!d) {
    toast(I18n.t('cadeditor.ui.vault.item_being_edited'), 'warn');
    return;
  }
  var nm = kInput(displayName(d), function () {}, { placeholder: I18n.t('cadeditor.ui.cards1.name') }),
    tg = kInput('', function () {}, { placeholder: I18n.t('cadeditor.ui.vault.label_separated_comma_cannot_filled') }),
    nt = kInput('', function () {}, { placeholder: I18n.t('cadeditor.ui.vault.notes_optional') });
  function val(c) {
    return c.value || '';
  }
  var go = kBtn(
    I18n.t('cadeditor.ui.vault.store'),
    function () {
      var tags = splitTags(val(tg)).slice(0, 8);
      Vault.save(hostTipStack(d), { name: val(nm).trim(), tags: tags, note: val(nt), page: page || '' }, function (r) {
        if (!r.ok) {
          vaultErr(r);
          return;
        }
        closeModal();
        toast(
          r.duplicate
            ? I18n.t('cadeditor.ui.vault.vault_already_looks_same', r.entry.name)
            : I18n.t('cadeditor.ui.vault.store_vault', r.entry.name),
          'ok'
        );
        if (done) done();
      });
    },
    { cls: 'pri', icon: 'check' }
  );
  openModal(
    modalShell(
      I18n.t('cadeditor.ui.eschema.store_vault'),
      itemNameOf(d),
      [
        fieldRow(I18n.t('cadeditor.ui.cards1.name'), nm),
        fieldRow(I18n.t('cadeditor.ui.eschema.tags'), tg),
        fieldRow(I18n.t('cadeditor.ui.vault.notes'), nt)
      ],
      [h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal), go]
    ),
    true
  );
}
function itemNameOf(d) {
  return nameOfItem(d.id);
}

/* 导入：粘贴导出的文本 */
function openVaultImport(done) {
  var ta = h('textarea', {
      class: 'ed-snbt',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.vault.paste_text_exported_vault')
    }),
    msg = h('div', { class: 'k-sub' });
  var go = kBtn(
    I18n.t('cadeditor.ui.kit2.import'),
    function () {
      var text = ta.value.trim();
      if (!text) return;
      var okN = 0,
        bad = 0,
        off = 0;
      function page(tokenObj) {
        var f = { offset: off, limit: 32 };
        if (tokenObj) f.uploadToken = tokenObj;
        else f.text = text;
        Vault.call('import', f, function (r) {
          if (!r.ok) {
            msg.textContent = r.reason || r.error;
            return;
          }
          (r.results || []).forEach(function (x) {
            if (x.ok) okN++;
            else bad++;
          });
          if (!r.done) {
            off = r.nextOffset;
            page(tokenObj);
            return;
          }
          closeModal();
          toast(
            I18n.t(
              'cadeditor.ui.vault.organisation_success',
              okN,
              bad ? I18n.t('cadeditor.ui.vault.article_rejected_repeated_formatted', bad) : ''
            ),
            bad ? 'warn' : 'ok'
          );
          if (done) done();
        });
      }
      if (text.length < 6500) page(null);
      else
        Vault.upload(text, function (u) {
          if (!u.ok) {
            msg.textContent = u.reason || u.error;
            return;
          }
          page(u.token);
        });
    },
    { cls: 'pri', icon: 'upload' }
  );
  openModal(
    modalShell(
      I18n.t('cadeditor.ui.kit2.import'),
      '',
      [ta, msg],
      [h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal), go]
    ),
    true
  );
}
function vaultExport() {
  var text = '',
    off = 0,
    rev = null;
  (function more() {
    Vault.call('export', { all: true, offset: off, limit: 6000 }, function (x) {
      if (!x.ok) {
        vaultErr(x);
        return;
      }
      if (rev !== null && x.revision !== rev) {
        toast(I18n.t('cadeditor.ui.vault.vault_changed_during_export_re'), 'warn');
        return;
      }
      rev = x.revision;
      text += x.text;
      if (!x.done) {
        off = x.nextOffset;
        more();
        return;
      }
      if (Prefs.hostClip && typeof oriel !== 'undefined' && oriel.send) {
        oriel.send('clipboard', { text: text });
        toast(I18n.t('cadeditor.ui.vault.copyed_clipboard_character_paste_text', text.length), 'ok');
        return;
      }
      var ta = h('textarea', { class: 'ed-snbt', spellcheck: 'false' });
      ta.value = text;
      openModal(
        modalShell(
          I18n.t('cadeditor.ui.vault.export'),
          I18n.t('cadeditor.ui.vault.copy_all_selected_save_text'),
          [ta],
          [h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.done'), closeModal, { cls: 'pri' })]
        ),
        true
      );
    });
  })();
}
