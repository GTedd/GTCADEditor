/* 编辑历史（服务端）：查看、搜索服务端记下的编辑器操作，给记录写备注和标签，删除或按条件清除。
   协议：页面 oriel.send('history', {requestId, action, …}) → 宿主 HistoryClient 转给服务端（op:"history"）→ 回复 history_result。
   能做什么只由服务端决定：capabilities 只用来藏掉用不了的按钮，每个请求服务端都会按权限节点重新检查。 */
var EditHistory = {
  seq: 0,
  wait: {},
  call: function (action, fields, cb) {
    var me = this,
      id = 'hs' + ++this.seq + '-' + Date.now(),
      msg = { action: action, requestId: id },
      k;
    for (k in fields) msg[k] = fields[k];
    function fail(code, why) {
      if (cb) cb({ ok: false, code: code, reason: why });
    }
    if (typeof oriel === 'undefined' || !oriel.send) {
      fail('UNAVAILABLE', I18n.t('cadeditor.ui.history.unavailable'));
      return;
    }
    var w = (this.wait[id] = {
      cb: cb,
      t: setTimeout(function () {
        if (me.wait[id]) {
          delete me.wait[id];
          fail('TIMEOUT', I18n.t('cadeditor.ui.history.timeout'));
        }
      }, 12000)
    });
    var sent = false;
    try {
      sent = oriel.send('history', msg);
    } catch (e) {}
    if (sent === false) {
      clearTimeout(w.t);
      delete this.wait[id];
      fail('UNAVAILABLE', I18n.t('cadeditor.ui.history.unavailable'));
    }
  },
  receive: function (r) {
    if (!r || !r.requestId) return;
    var w = this.wait[r.requestId];
    if (!w) return;
    clearTimeout(w.t);
    delete this.wait[r.requestId];
    r.ok = r.status === 'history';
    if (w.cb) w.cb(r);
  }
};

function historyReason(r) {
  var known = {
    permission_denied: I18n.t('cadeditor.ui.history.err.denied'),
    history_unavailable: I18n.t('cadeditor.ui.history.err.off'),
    rate_limited: I18n.t('cadeditor.ui.history.err.rate'),
    not_found: I18n.t('cadeditor.ui.history.err.missing'),
    UNAVAILABLE: I18n.t('cadeditor.ui.history.unavailable'),
    TIMEOUT: I18n.t('cadeditor.ui.history.timeout')
  };
  var head = known[r.code] || I18n.t('cadeditor.ui.history.err.generic');
  return r.reason && r.reason !== head ? head + ' — ' + r.reason : head;
}
function historyTime(ms, short) {
  var d = new Date(ms);
  function p(n) {
    return (n < 10 ? '0' : '') + n;
  }
  return (
    (short ? '' : d.getFullYear() + '-') +
    p(d.getMonth() + 1) +
    '-' +
    p(d.getDate()) +
    ' ' +
    p(d.getHours()) +
    ':' +
    p(d.getMinutes()) +
    ':' +
    p(d.getSeconds())
  );
}
function historyOutcome(o) {
  var label =
    {
      ok: I18n.t('cadeditor.ui.history.outcome.ok'),
      pending: I18n.t('cadeditor.ui.history.outcome.pending'),
      rejected: I18n.t('cadeditor.ui.history.outcome.rejected'),
      denied: I18n.t('cadeditor.ui.history.outcome.denied'),
      note: I18n.t('cadeditor.ui.history.outcome.note')
    }[o] || o;
  return h('span', { class: 'hs-badge hs-o-' + o, text: label });
}
function historyTags(text) {
  return String(text || '')
    .split(/[,，\s]+/)
    .map(function (t) {
      return t.trim().toLowerCase();
    })
    .filter(function (t) {
      return t;
    });
}

function openHistory(opts) {
  opts = opts || {};
  var S = {
    page: 0,
    size: 20,
    total: 0,
    rows: [],
    scope: '',
    caps: {},
    filter: { text: '', actor: opts.actor || '', outcome: '', action: '' },
    open: -1,
    token: 0
  };
  var q = h('input', {
    class: 'k-input',
    type: 'text',
    placeholder: I18n.t('cadeditor.ui.history.search'),
    spellcheck: 'false'
  });
  var sbox = kSearchBox(q, function (v) {
    S.filter.text = v;
    S.page = 0;
    load();
  });
  var who = h('input', {
    class: 'k-input hs-who',
    type: 'text',
    placeholder: I18n.t('cadeditor.ui.history.player'),
    spellcheck: 'false'
  });
  who.value = S.filter.actor;
  who.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      S.filter.actor = who.value.trim();
      S.page = 0;
      load();
    }
  });
  who.addEventListener('blur', function () {
    if (who.value.trim() !== S.filter.actor) {
      S.filter.actor = who.value.trim();
      S.page = 0;
      load();
    }
  });
  var outcomes = [
    { v: '', label: I18n.t('cadeditor.ui.history.all'), icon: 'filter' },
    { v: 'ok', label: I18n.t('cadeditor.ui.history.outcome.ok'), icon: 'check' },
    { v: 'denied', label: I18n.t('cadeditor.ui.history.outcome.denied'), icon: 'lock' },
    { v: 'rejected', label: I18n.t('cadeditor.ui.history.outcome.rejected'), icon: 'ban' },
    { v: 'pending', label: I18n.t('cadeditor.ui.history.outcome.pending'), icon: 'hourglass' },
    { v: 'note', label: I18n.t('cadeditor.ui.history.outcome.note'), icon: 'edit' }
  ];
  var outcome = kSeg(
    outcomes,
    '',
    function (v) {
      S.filter.outcome = v;
      S.page = 0;
      load();
    },
    'hs-oseg'
  );
  /* 结果的图标沿用列表里结果标签的颜色：成功绿、无权限红、其余黄，一眼对上号 */
  outcomes.forEach(function (o, i) {
    if (o.v) outcome.el.children[i].classList.add('hs-o-' + o.v);
  });
  var action = kSeg(
    [
      { v: '', label: I18n.t('cadeditor.ui.history.all'), icon: 'grid' },
      { v: 'item', label: I18n.t('cadeditor.ui.history.kind.item'), icon: 'pickaxe' },
      { v: 'world', label: I18n.t('cadeditor.ui.history.kind.world'), icon: 'cube_grass' },
      { v: 'player', label: I18n.t('cadeditor.ui.history.kind.player'), icon: 'user' },
      { v: 'vault', label: I18n.t('cadeditor.ui.history.kind.vault'), icon: 'chest' },
      { v: 'history', label: I18n.t('cadeditor.ui.history.kind.history'), icon: 'clock' }
    ],
    '',
    function (v) {
      S.filter.action = v;
      S.page = 0;
      load();
    }
  );
  var list = h('div', { class: 'hs-list' }),
    msg = h('div', { class: 'hs-msg' }),
    stat = h('span', { class: 'k-sub hs-stat' });
  var prev = kBtn(
    I18n.t('cadeditor.ui.history.prev'),
    function () {
      if (S.page > 0) {
        S.page--;
        load();
      }
    },
    { icon: 'prev' }
  );
  var next = kBtn(
    I18n.t('cadeditor.ui.history.next'),
    function () {
      if ((S.page + 1) * S.size < S.total) {
        S.page++;
        load();
      }
    },
    { icon: 'next' }
  );
  var add = kBtn(I18n.t('cadeditor.ui.history.add'), openAdd, {
    icon: 'plus',
    title: I18n.t('cadeditor.ui.history.add.tip')
  });
  var purge = kBtn(I18n.t('cadeditor.ui.history.purge'), confirmPurge, {
    icon: 'trash',
    title: I18n.t('cadeditor.ui.history.purge.tip')
  });
  var refresh = kBtn(
    '',
    function () {
      load();
    },
    { icon: 'refresh', title: I18n.t('cadeditor.ui.history.refresh') }
  );
  add.style.display = 'none';
  purge.style.display = 'none';

  function filter() {
    var f = {},
      k;
    for (k in S.filter) if (S.filter[k]) f[k] = S.filter[k];
    return f;
  }
  function load() {
    var tok = ++S.token;
    S.open = -1;
    clear(msg);
    msg.appendChild(
      typeof kLoadingRow === 'function'
        ? kLoadingRow(I18n.t('cadeditor.ui.history.loading'))
        : h('div', { class: 'k-empty', text: I18n.t('cadeditor.ui.history.loading') })
    );
    EditHistory.call('list', { filter: filter(), page: S.page, size: S.size }, function (r) {
      if (tok !== S.token) return;
      clear(msg);
      if (!r.ok) {
        S.rows = [];
        S.total = 0;
        paint();
        msg.appendChild(h('div', { class: 'vt-msg bad', text: historyReason(r) }));
        return;
      }
      S.rows = r.records || [];
      S.total = r.total || 0;
      S.scope = r.scope || '';
      paint();
    });
  }
  function paint() {
    clear(list);
    if (!S.rows.length) list.appendChild(xEmpty(I18n.t('cadeditor.ui.history.empty')));
    S.rows.forEach(function (r, i) {
      list.appendChild(row(r, i));
      if (S.open === i) list.appendChild(detail(r));
    });
    var pages = Math.max(1, Math.ceil(S.total / S.size));
    stat.textContent =
      I18n.t('cadeditor.ui.history.stat', S.total, S.page + 1, pages) +
      (S.scope === 'own' ? I18n.t('cadeditor.ui.history.own') : '');
    prev.classList.toggle('off', S.page <= 0);
    next.classList.toggle('off', (S.page + 1) * S.size >= S.total);
  }
  function row(r, i) {
    var el = h('div', { class: 'hs-row' + (S.open === i ? ' on' : '') }, [
      h('span', { class: 'hs-id', text: '#' + r.id }),
      h('span', { class: 'hs-time', text: historyTime(r.time, true), title: historyTime(r.time) }),
      h('span', { class: 'hs-actor', text: (r.actor && r.actor.name) || '?' }),
      h('span', { class: 'hs-action', text: r.action }),
      historyOutcome(r.outcome),
      h('span', { class: 'hs-target', text: r.target || '' }),
      (r.tags || []).length ? h('span', { class: 'hs-tags', text: r.tags.join(', ') }) : null,
      r.note ? uiIcon('edit', 12, 'hs-noted') : null
    ]);
    activate(el, function () {
      S.open = S.open === i ? -1 : i;
      paint();
    });
    return el;
  }
  function field(label, value) {
    return value === undefined || value === null || value === ''
      ? null
      : h('div', { class: 'hs-field' }, [h('b', { text: label }), h('span', { text: String(value) })]);
  }
  function detail(r) {
    var kids = [
      field(I18n.t('cadeditor.ui.history.f.time'), historyTime(r.time)),
      field(I18n.t('cadeditor.ui.history.f.actor'), r.actor ? r.actor.name + ' (' + r.actor.id + ')' : ''),
      field(I18n.t('cadeditor.ui.history.f.action'), r.action),
      field(I18n.t('cadeditor.ui.history.f.target'), r.target),
      field(I18n.t('cadeditor.ui.history.f.code'), r.code),
      field(I18n.t('cadeditor.ui.history.f.node'), r.node),
      field(I18n.t('cadeditor.ui.history.f.request'), r.requestId),
      r.detail
        ? field(
            I18n.t('cadeditor.ui.history.f.detail'),
            Object.keys(r.detail)
              .map(function (k) {
                var v = r.detail[k];
                return k + ' = ' + (typeof v === 'object' ? JSON.stringify(v) : v);
              })
              .join('；')
          )
        : null,
      r.edited
        ? field(
            I18n.t('cadeditor.ui.history.f.edited'),
            I18n.t('cadeditor.ui.history.edited', r.edited.by, historyTime(r.edited.at))
          )
        : null
    ];
    var canEdit = !!S.caps['history.edit'],
      canDelete = !!S.caps['history.delete'];
    var note = h('textarea', {
      class: 'ed-snbt hs-note',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.history.note.placeholder')
    });
    note.value = r.note || '';
    if (!canEdit) note.setAttribute('readonly', '');
    var tags = h('input', {
      class: 'k-input hs-taginput',
      type: 'text',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.history.tags.placeholder')
    });
    tags.value = (r.tags || []).join(', ');
    if (!canEdit) tags.setAttribute('readonly', '');
    kids.push(h('div', { class: 'hs-field' }, [h('b', { text: I18n.t('cadeditor.ui.history.f.note') }), note]));
    kids.push(h('div', { class: 'hs-field' }, [h('b', { text: I18n.t('cadeditor.ui.history.f.tags') }), tags]));
    var acts = [h('div', { class: 'grow' })];
    if (canEdit)
      acts.push(
        kBtn(
          I18n.t('cadeditor.ui.history.save'),
          function () {
            EditHistory.call('edit', { id: r.id, note: note.value, tags: historyTags(tags.value) }, function (x) {
              if (!x.ok) {
                toast(historyReason(x), 'error', 'history');
                return;
              }
              toast(I18n.t('cadeditor.ui.history.saved', r.id), 'ok', 'history');
              load();
            });
          },
          { cls: 'pri', icon: 'save' }
        )
      );
    if (canDelete)
      acts.push(
        kBtn(
          I18n.t('cadeditor.ui.history.delete'),
          function () {
            confirmDelete(r);
          },
          { icon: 'trash' }
        )
      );
    kids.push(h('div', { class: 'world-actions' }, acts));
    return h('div', { class: 'hs-detail' }, kids);
  }
  function confirmDelete(r) {
    var go = kBtn(
      I18n.t('cadeditor.ui.history.delete'),
      function () {
        closeModal();
        EditHistory.call('delete', { ids: [r.id] }, function (x) {
          if (!x.ok) {
            toast(historyReason(x), 'error', 'history');
            return;
          }
          toast(I18n.t('cadeditor.ui.history.deleted', r.id), 'ok', 'history');
          load();
        });
      },
      { cls: 'pri', icon: 'trash' }
    );
    openModal(
      modalShell(
        I18n.t('cadeditor.ui.history.delete.title', r.id),
        '',
        [h('div', { class: 'k-sub', text: I18n.t('cadeditor.ui.history.delete.body') })],
        [h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal), go]
      ),
      true
    );
  }
  function confirmPurge() {
    var f = filter();
    if (!Object.keys(f).length) {
      toast(I18n.t('cadeditor.ui.history.purge.nofilter'), 'warn', 'history');
      return;
    }
    var go = kBtn(
      I18n.t('cadeditor.ui.history.purge'),
      function () {
        closeModal();
        EditHistory.call('purge', { filter: f }, function (x) {
          if (!x.ok) {
            toast(historyReason(x), 'error', 'history');
            return;
          }
          toast(I18n.t('cadeditor.ui.history.purged', x.deleted), 'ok', 'history');
          S.page = 0;
          load();
        });
      },
      { cls: 'pri', icon: 'trash' }
    );
    openModal(
      modalShell(
        I18n.t('cadeditor.ui.history.purge.title'),
        '',
        [
          h('div', { class: 'k-sub', text: I18n.t('cadeditor.ui.history.purge.body', S.total) }),
          h('div', { class: 'hs-filter', text: JSON.stringify(f) })
        ],
        [h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal), go]
      ),
      true
    );
  }
  function openAdd() {
    var note = h('textarea', {
      class: 'ed-snbt hs-note',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.history.note.placeholder')
    });
    var target = h('input', {
      class: 'k-input',
      type: 'text',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.history.target.placeholder')
    });
    var tags = h('input', {
      class: 'k-input',
      type: 'text',
      spellcheck: 'false',
      placeholder: I18n.t('cadeditor.ui.history.tags.placeholder')
    });
    var go = kBtn(
      I18n.t('cadeditor.ui.history.add'),
      function () {
        if (!note.value.trim()) {
          toast(I18n.t('cadeditor.ui.history.add.empty'), 'warn', 'history');
          return;
        }
        EditHistory.call(
          'add',
          { note: note.value, target: target.value, tags: historyTags(tags.value) },
          function (x) {
            if (!x.ok) {
              toast(historyReason(x), 'error', 'history');
              return;
            }
            closeModal();
            toast(I18n.t('cadeditor.ui.history.added', x.record.id), 'ok', 'history');
            S.page = 0;
            load();
          }
        );
      },
      { cls: 'pri', icon: 'check' }
    );
    openModal(
      modalShell(
        I18n.t('cadeditor.ui.history.add'),
        I18n.t('cadeditor.ui.history.add.tip'),
        [
          fieldRow(I18n.t('cadeditor.ui.history.f.note'), note),
          fieldRow(I18n.t('cadeditor.ui.history.f.target'), target),
          fieldRow(I18n.t('cadeditor.ui.history.f.tags'), tags)
        ],
        [h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal), go]
      ),
      true
    );
    setTimeout(function () {
      if (note.focus) note.focus();
    }, 0);
  }

  var filters = h('div', { class: 'hs-filters' }, [
    h('div', { class: 'hs-frow' }, [sbox.el, who, refresh]),
    h('div', { class: 'hs-frow' }, [outcome.el]),
    h('div', { class: 'hs-frow' }, [action.el])
  ]);
  var win = modalShell(
    I18n.t('cadeditor.ui.history.title'),
    I18n.t('cadeditor.ui.history.sub'),
    [filters, msg, list],
    [stat, h('div', { class: 'grow' }), add, purge, prev, next, kBtn(I18n.t('cadeditor.ui.common.close'), closeModal)],
    'hs-modal'
  );
  openModal(win, !!opts.stacked);
  if (typeof windowify === 'function') windowify(win, 'history');
  EditHistory.call('capabilities', {}, function (r) {
    if (r.ok) {
      S.caps = r.capabilities || {};
      add.style.display = S.caps['history.edit'] ? '' : 'none';
      purge.style.display = S.caps['history.delete'] ? '' : 'none';
      if (r.enabled === false) {
        clear(msg);
        msg.appendChild(h('div', { class: 'vt-msg bad', text: I18n.t('cadeditor.ui.history.err.off') }));
        return;
      }
    }
    load();
  });
}

/* 单独打开编辑历史（/cade history）：没有物品，关掉窗口就关页面 */
function enterHistoryMode() {
  if (VaultOnly) return;
  VaultOnly = true;
  document.body.classList.add('vault-only');
  try {
    Store.docs.length = 0;
  } catch (e) {}
  openHistory({});
}
