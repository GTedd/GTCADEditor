/* 保险库 · 整理与导入：自定义分页、搜索语法提示、NBT 大小、跨版本升级、轮转备份、从文件 / 其它模组导入。
   协议见 docs/editor/vault-contract.md 的「分页、搜索语法、升级、备份与导入」节。页面不碰路径：选文件走宿主的原生对话框，
   备份只按文件名指定；读文件、数据修复、注册表校验都在宿主做，这里只收结果窗口。 */

/* 字节数 → 简短大小（与配额同口径：条目在保险库文件里的 UTF-8 字节） */
function vaultSize(n) {
  n = +n || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KiB';
  return (n / 1048576).toFixed(1) + ' MiB';
}
function vaultTime(ms) {
  var d = new Date(+ms || 0);
  function two(x) {
    return (x < 10 ? '0' : '') + x;
  }
  return (
    d.getFullYear() +
    '-' +
    two(d.getMonth() + 1) +
    '-' +
    two(d.getDate()) +
    ' ' +
    two(d.getHours()) +
    ':' +
    two(d.getMinutes())
  );
}
function vaultPageLabel(p) {
  return (p && p.name) || I18n.t('cadeditor.ui.vaultpages.default_page');
}
/* 该页里当前类别有几条 */
function vaultPageCount(p, kind) {
  return (p && p.kinds && p.kinds[kind]) || 0;
}
/* 网格格子的悬停文字：名称、数量 · 大小、打不开的原因 */
function vaultCellTip(e) {
  var lines = [e.name || ''],
    count = (e.item && e.item.count) || 1;
  if (e.translatedName && e.translatedName !== e.name) lines.push(e.translatedName);
  lines.push('× ' + count + (e.bytes ? ' · ' + vaultSize(e.bytes) : ''));
  if (e.incompatible)
    lines.push(I18n.t('cadeditor.ui.vault.current_version_cannot_opened') + (e.reason ? ': ' + e.reason : ''));
  else if (e.upgradable) lines.push(I18n.t('cadeditor.ui.vaultpages.upgradable'));
  return lines.join('\n');
}

/* ---------- 搜索语法提示 ----------
   前缀与示例值只用于补全；真正的匹配在宿主（VaultQuery）。 */
var VAULT_QUERY_FIELDS = ['item', 'name', 'lore', 'tag', 'note', 'count', 'size', 'saved', 'updated', 'page', 'kind'];
var VAULT_QUERY_VALUES = {
  item: ['minecraft:', '*_sword', 'diamond*'],
  count: ['>=16', '1', '2-32'],
  size: ['>1k', '<512', '10k-2m'],
  saved: ['<7d', '<24h', '>30d'],
  updated: ['<1h', '<7d', '>30d'],
  kind: ['item', 'entity', 'block', 'player_preset']
};
function vaultQuote(v) {
  return /\s/.test(v) ? '"' + v + '"' : v;
}
/* text 末尾正在输入的词的补全。extra = { pages:[页名], tags:[标签] }。返回 [{ text: 采纳后的整段文字, label, done }]，最多 8 个；
   done 为真表示值已完整，可以直接搜索 */
function vaultQueryHints(text, extra) {
  text = String(text || '');
  extra = extra || {};
  var m = /(^|\s)(-?)(\S*)$/.exec(text),
    neg = m ? m[2] : '',
    word = m ? m[3] : '',
    head = text.substring(0, text.length - neg.length - word.length),
    out = [];
  if (!word) return out;
  function add(insert, label, done) {
    if (out.length < 8) out.push({ text: head + neg + insert, label: label, done: !!done });
  }
  var colon = word.indexOf(':');
  if (colon < 0) {
    var low = word.toLowerCase();
    VAULT_QUERY_FIELDS.forEach(function (f) {
      if (f.indexOf(low) === 0 && f !== low) add(f + ':', f + ':');
    });
    return out;
  }
  var field = word.substring(0, colon).toLowerCase(),
    val = word.substring(colon + 1).replace(/^["']/, ''),
    lowVal = val.toLowerCase();
  if (field === 'amount') field = 'count';
  if (field === 'bytes') field = 'size';
  if (VAULT_QUERY_FIELDS.indexOf(field) < 0) return out;
  var values =
    field === 'page' ? extra.pages || [] : field === 'tag' ? extra.tags || [] : VAULT_QUERY_VALUES[field] || [];
  values.forEach(function (v) {
    if (String(v).toLowerCase().indexOf(lowVal) === 0 && v !== val)
      add(word.substring(0, colon + 1) + vaultQuote(String(v)) + ' ', word.substring(0, colon + 1) + v, true);
  });
  return out;
}

/* ---------- 分页管理 ---------- */
function openVaultPages(onChanged) {
  var listBox = h('div', { class: 'vt-plist' }),
    pages = [];
  function changed() {
    load();
    if (onChanged) onChanged();
  }
  function load() {
    Vault.call('pages', {}, function (r) {
      if (!r.ok) {
        vaultErr(r);
        return;
      }
      pages = r.pages || [];
      draw();
    });
  }
  function move(p, to) {
    if (to < 0 || to >= pages.length) return;
    Vault.call('page_move', { page: p.id, to: to }, function (r) {
      if (r.ok) changed();
      else vaultErr(r);
    });
  }
  function draw() {
    clear(listBox);
    pages.forEach(function (p, i) {
      var nm = kInput(p.name || '', function () {}, {
        placeholder: p['default']
          ? I18n.t('cadeditor.ui.vaultpages.default_page')
          : I18n.t('cadeditor.ui.vaultpages.page_name'),
        onCommit: function (v) {
          v = String(v || '').trim();
          if (v === (p.name || '') || (!v && !p['default'])) return;
          Vault.call('page_rename', { page: p.id, name: v }, function (r) {
            if (r.ok) changed();
            else vaultErr(r);
          });
        }
      });
      nm.classList.add('vt-in');
      var up = kBtn(
          '',
          function () {
            move(p, i - 1);
          },
          { icon: 'up', title: I18n.t('cadeditor.ui.vaultpages.move_up') }
        ),
        down = kBtn(
          '',
          function () {
            move(p, i + 1);
          },
          { icon: 'down', title: I18n.t('cadeditor.ui.vaultpages.move_down') }
        );
      if (i === 0) up.classList.add('dis');
      if (i === pages.length - 1) down.classList.add('dis');
      var del = p['default']
        ? null
        : kBtn(
            '',
            function () {
              vaultDeletePage(p, changed);
            },
            { icon: 'trash', cls: 'dng', title: I18n.t('cadeditor.ui.vaultpages.delete_page') }
          );
      listBox.appendChild(
        h('div', { class: 'vt-prow' }, [
          uiIcon(p['default'] ? 'home' : 'folder', 12),
          nm,
          h('span', {
            class: 'k-sub vt-pstat',
            text: I18n.t('cadeditor.ui.vaultpages.page_stat', p.count || 0, vaultSize(p.bytes))
          }),
          up,
          down,
          del
        ])
      );
    });
  }
  var newName = kInput('', function () {}, { placeholder: I18n.t('cadeditor.ui.vaultpages.new_page_name') });
  newName.classList.add('vt-in');
  var add = kBtn(
    I18n.t('cadeditor.ui.vaultpages.new_page'),
    function () {
      var v = String(newName.value || '').trim();
      if (!v) return;
      Vault.call('page_create', { name: v }, function (r) {
        if (!r.ok) {
          vaultErr(r);
          return;
        }
        newName.value = '';
        changed();
      });
    },
    { icon: 'plus', cls: 'pri' }
  );
  openModal(
    modalShell(
      I18n.t('cadeditor.ui.vaultpages.pages'),
      I18n.t('cadeditor.ui.vaultpages.pages_sub'),
      [listBox, h('div', { class: 'vt-pnew' }, [newName, add])],
      [h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.done'), closeModal, { cls: 'pri' })]
    ),
    true
  );
  load();
}
/* 删页：空页直接删；非空页先说明条目去向（移到默认页 / 一起删除，30 秒内可撤销） */
function vaultDeletePage(p, done) {
  function go(mode) {
    var f = { page: p.id };
    if (mode) f.entries = mode;
    Vault.call('page_delete', f, function (r) {
      if (!r.ok) {
        vaultErr(r);
        return;
      }
      if (mode) closeModal();
      if (r.token) {
        Vault.undo = { token: r.token, until: Date.now() + 29000 };
        toast(I18n.t('cadeditor.ui.vaultpages.page_deleted_undo', r.deleted), 'info');
      } else toast(I18n.t('cadeditor.ui.vaultpages.page_deleted'), 'ok');
      if (VaultUi.page === p.id) VaultUi.page = '';
      if (done) done(r);
    });
  }
  if (!p.count) {
    go('');
    return;
  }
  openModal(
    modalShell(
      I18n.t('cadeditor.ui.vaultpages.delete_page_title', vaultPageLabel(p)),
      '',
      [h('div', { class: 'k-sub', text: I18n.t('cadeditor.ui.vaultpages.delete_page_body', p.count) })],
      [
        h('div', { class: 'grow' }),
        kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal),
        kBtn(
          I18n.t('cadeditor.ui.vaultpages.move_to_default'),
          function () {
            go('move');
          },
          { icon: 'move' }
        ),
        kBtn(
          I18n.t('cadeditor.ui.vaultpages.delete_with_entries'),
          function () {
            go('delete');
          },
          { icon: 'trash', cls: 'dng' }
        )
      ]
    ),
    true
  );
}

/* ---------- 跨版本升级（数据修复器） ---------- */
function vaultUpgrade(ids, done) {
  Vault.call(
    'upgrade',
    { ids: ids },
    function (r) {
      if (!r.ok) {
        vaultErr(r);
        return;
      }
      var bad = (r.results || []).filter(function (x) {
        return !x.ok;
      });
      if (bad.length)
        toast(I18n.t('cadeditor.ui.vaultpages.upgrade_failed_kept', bad[0].reason || bad[0].error), 'warn');
      else toast(I18n.t('cadeditor.ui.vaultpages.upgraded', r.upgraded || 0), 'ok');
      if (done) done(r);
    },
    null,
    30000
  );
}
/* 全部升级：按游标分批（每批 8 条），失败的保持原样并汇报第一条原因 */
function vaultUpgradeAll(count, done) {
  function run() {
    var ok = 0,
      failed = 0,
      first = '',
      after = '';
    toast(I18n.t('cadeditor.ui.vaultpages.upgrading'), 'info', 'vault-upgrade');
    (function next() {
      Vault.call(
        'upgrade',
        { all: true, after: after, limit: 8 },
        function (r) {
          if (!r.ok) {
            toastDismiss('vault-upgrade');
            vaultErr(r);
            if (done) done();
            return;
          }
          ok += r.upgraded || 0;
          failed += r.failed || 0;
          (r.results || []).forEach(function (x) {
            if (!x.ok && !first)
              first = I18n.t('cadeditor.ui.vaultpages.named_reason', x.name || x.id, x.reason || x.error);
          });
          after = r.nextAfter || after;
          if (!r.done) {
            next();
            return;
          }
          toastDismiss('vault-upgrade');
          toast(
            failed
              ? I18n.t('cadeditor.ui.vaultpages.upgrade_all_partial', ok, failed, first)
              : I18n.t('cadeditor.ui.vaultpages.upgrade_all_done', ok),
            failed ? 'warn' : 'ok'
          );
          if (done) done();
        },
        null,
        30000
      );
    })();
  }
  openModal(
    modalShell(
      I18n.t('cadeditor.ui.vaultpages.upgrade_all_title'),
      '',
      [h('div', { class: 'k-sub', text: I18n.t('cadeditor.ui.vaultpages.upgrade_all_body', count) })],
      [
        h('div', { class: 'grow' }),
        kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal),
        kBtn(
          I18n.t('cadeditor.ui.vaultpages.upgrade_all'),
          function () {
            closeModal();
            run();
          },
          { icon: 'refresh', cls: 'pri' }
        )
      ]
    ),
    true
  );
}

/* ---------- 轮转备份 ---------- */
function vaultBackupReason(r) {
  var key = {
    startup: 'cadeditor.ui.vaultpages.reason_startup',
    daily: 'cadeditor.ui.vaultpages.reason_daily',
    manual: 'cadeditor.ui.vaultpages.reason_manual',
    upgrade: 'cadeditor.ui.vaultpages.reason_upgrade',
    restore: 'cadeditor.ui.vaultpages.reason_restore'
  }[r];
  return key ? I18n.t(key) : r;
}
function openVaultBackups(onChanged) {
  var box = h('div', { class: 'vt-plist' }),
    msg = h('div', { class: 'k-sub' });
  function confirmRestore(b) {
    openModal(
      modalShell(
        I18n.t('cadeditor.ui.vaultpages.restore_title'),
        vaultTime(b.time),
        [h('div', { class: 'k-sub', text: I18n.t('cadeditor.ui.vaultpages.restore_body') })],
        [
          h('div', { class: 'grow' }),
          kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal),
          kBtn(
            I18n.t('cadeditor.ui.vaultpages.restore_confirm'),
            function () {
              Vault.call(
                'backup_restore',
                { name: b.name, confirm: true },
                function (r) {
                  if (!r.ok) {
                    vaultErr(r);
                    return;
                  }
                  closeModal();
                  toast(I18n.t('cadeditor.ui.vaultpages.restored', r.restored), 'ok');
                  load();
                  if (onChanged) onChanged();
                },
                null,
                30000
              );
            },
            { icon: 'restore', cls: 'dng' }
          )
        ]
      ),
      true
    );
  }
  function load() {
    clear(box);
    box.appendChild(kLoadingRow(I18n.t('cadeditor.ui.vaultpages.loading_backups')));
    Vault.call(
      'backups',
      {},
      function (r) {
        clear(box);
        if (!r.ok) {
          box.appendChild(xEmpty(r.reason || r.error));
          return;
        }
        msg.textContent = I18n.t('cadeditor.ui.vaultpages.backup_rotation', r.maxBackups || 0);
        if (!(r.backups || []).length) {
          box.appendChild(xEmpty(I18n.t('cadeditor.ui.vaultpages.no_backups')));
          return;
        }
        r.backups.forEach(function (b) {
          box.appendChild(
            h('div', { class: 'vt-prow' }, [
              uiIcon('save', 12),
              h('span', { class: 'vt-bname', text: vaultTime(b.time) }),
              h('span', { class: 'k-tag dim', text: vaultBackupReason(b.reason) }),
              h('span', { class: 'k-sub', text: vaultSize(b.bytes) }),
              h('div', { class: 'grow' }),
              kBtn(
                I18n.t('cadeditor.ui.vaultpages.restore'),
                function () {
                  confirmRestore(b);
                },
                { icon: 'restore' }
              )
            ])
          );
        });
      },
      null,
      20000
    );
  }
  var now = kBtn(
    I18n.t('cadeditor.ui.vaultpages.backup_now'),
    function () {
      Vault.call(
        'backup_now',
        {},
        function (r) {
          if (!r.ok) {
            vaultErr(r);
            return;
          }
          toast(I18n.t('cadeditor.ui.vaultpages.backup_done'), 'ok');
          load();
        },
        null,
        20000
      );
    },
    { icon: 'save', cls: 'pri' }
  );
  openModal(
    modalShell(
      I18n.t('cadeditor.ui.vaultpages.backups'),
      I18n.t('cadeditor.ui.vaultpages.backups_sub'),
      [box, msg],
      [now, h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.done'), closeModal)]
    ),
    true
  );
  load();
}

/* ---------- 导入渠道 ---------- */
var VaultImportBusy = false;
function openVaultImportMenu(done) {
  var counts = {},
    box = h('div', { class: 'vt-imenu' }),
    world = false,
    scanned = false,
    menu;
  function opt(icon, title, sub, fn, off) {
    var row = h('div', { class: 'vt-iopt' + (off ? ' dis' : '') }, [
      uiIcon(icon, 16),
      h('div', { class: 'vt-iopt-t' }, [h('b', { text: title }), h('span', { class: 'k-sub', text: sub })])
    ]);
    activate(row, function () {
      if (!off) fn();
    });
    return row;
  }
  function found(source, key) {
    if (!scanned) return I18n.t('cadeditor.ui.vaultpages.scanning');
    if (!world) return I18n.t('cadeditor.ui.vaultpages.needs_world');
    return counts[source] ? I18n.t(key, counts[source]) : I18n.t('cadeditor.ui.vaultpages.not_found');
  }
  function draw() {
    clear(box);
    box.appendChild(
      opt(
        'clipboard',
        I18n.t('cadeditor.ui.vaultpages.from_paste'),
        I18n.t('cadeditor.ui.vaultpages.from_paste_sub'),
        function () {
          closeModal();
          openVaultImport(done);
        }
      )
    );
    box.appendChild(
      opt(
        'file',
        I18n.t('cadeditor.ui.vaultpages.from_file'),
        scanned && !world
          ? I18n.t('cadeditor.ui.vaultpages.needs_world')
          : I18n.t('cadeditor.ui.vaultpages.from_file_sub'),
        function () {
          vaultImportOpen('file', done, menu);
        },
        !world
      )
    );
    box.appendChild(
      opt(
        'chest',
        I18n.t('cadeditor.ui.vaultpages.from_nbteditor'),
        found('nbteditor', 'cadeditor.ui.vaultpages.pages_found'),
        function () {
          vaultImportOpen('nbteditor', done, menu);
        },
        !world || !counts.nbteditor
      )
    );
    box.appendChild(
      opt(
        'layers',
        I18n.t('cadeditor.ui.vaultpages.from_librarian'),
        found('librarian', 'cadeditor.ui.vaultpages.files_found'),
        function () {
          vaultImportOpen('librarian', done, menu);
        },
        !world || !counts.librarian
      )
    );
    box.appendChild(
      opt(
        'backpack',
        I18n.t('cadeditor.ui.vaultpages.from_hotbar'),
        found('hotbar', 'cadeditor.ui.vaultpages.hotbar_found'),
        function () {
          vaultImportOpen('hotbar', done, menu);
        },
        !world || !counts.hotbar
      )
    );
  }
  draw();
  menu = openModal(
    modalShell(
      I18n.t('cadeditor.ui.kit2.import'),
      I18n.t('cadeditor.ui.vaultpages.import_sub'),
      [box],
      [h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal)]
    ),
    true
  );
  Vault.call(
    'import_scan',
    {},
    function (r) {
      scanned = true;
      if (r.ok) {
        world = !!r.world;
        (r.sources || []).forEach(function (s) {
          counts[s.source] = s.files;
        });
      }
      draw();
    },
    null,
    15000
  );
}
/* 打开一个来源：选文件时等用户在原生窗口里选完（最长 10 分钟）；读取、升级、校验都在宿主 */
function vaultImportOpen(source, done, menu) {
  if (VaultImportBusy) return;
  VaultImportBusy = true;
  toast(
    source === 'file' ? I18n.t('cadeditor.ui.vaultpages.choose_file') : I18n.t('cadeditor.ui.vaultpages.reading'),
    'info',
    'vault-import'
  );
  Vault.call(
    'import_open',
    { source: source },
    function (r) {
      VaultImportBusy = false;
      toastDismiss('vault-import');
      if (!r.ok) {
        if (r.error !== 'CANCELLED') vaultErr(r);
        return;
      }
      if (menu && $('modal') === menu) closeModal();
      openVaultImportPreview(r, done);
    },
    null,
    source === 'file' ? 600000 : 120000
  );
}
/* 预览：逐条可勾选排除；无法导入的行灰掉并给原因；当前版本打不开的行默认导入并保留原始数据 */
function openVaultImportPreview(info, done) {
  var rows = [],
    sel = [],
    loaded = false,
    committed = false,
    dedupe = 'skip',
    state = { page: 0 },
    groups = {},
    mask;
  (info.groups || []).forEach(function (g) {
    groups[g.index] = g;
  });
  var listBox = h('div', { class: 'vt-ilist' }),
    pager = h('div', { class: 'k-row wrap' }),
    count = h('span', { class: 'k-sub' }),
    warnBox = h('div', {});
  (info.warnings || []).forEach(function (w) {
    warnBox.appendChild(h('div', { class: 'vt-msg bad', text: w }));
  });
  function importable(x) {
    return x.ok || x.kept;
  }
  function paintCount() {
    var n = 0;
    rows.forEach(function (x) {
      if (sel[x.i]) n++;
    });
    count.textContent = loaded
      ? I18n.t('cadeditor.ui.vaultpages.selected', n, info.total)
      : I18n.t('cadeditor.ui.vaultpages.loading_rows', rows.length, info.total);
    go.classList.toggle('dis', !loaded || !n);
  }
  function rowEl(x) {
    var tg = kToggle(!!sel[x.i], function (on) {
      sel[x.i] = on;
      paintCount();
    });
    if (!importable(x)) tg.el.classList.add('dis');
    var bits = [x.id + (x.count > 1 ? ' × ' + x.count : ''), vaultSize(x.bytes)];
    var badges = [];
    if (x.duplicate) badges.push(h('span', { class: 'k-tag dim', text: I18n.t('cadeditor.ui.vaultpages.duplicate') }));
    if (x.kept) badges.push(h('span', { class: 'k-tag dim', text: I18n.t('cadeditor.ui.vaultpages.kept_raw') }));
    var el = h('div', { class: 'vt-irow' + (importable(x) ? '' : ' off') }, [
      tg.el,
      x.kind === 'entity'
        ? entityIcon(x.id || 'minecraft:pig', 16)
        : x.kind === 'player_preset'
          ? uiIcon('user', 16)
          : itemIcon(x.id || 'minecraft:stone', 16),
      h('div', { class: 'vt-irow-t' }, [
        h('span', { class: 'vt-iname', text: x.name || x.id }),
        h('span', { class: 'k-sub', text: bits.join(' · ') })
      ]),
      h('div', { class: 'vt-irow-b' }, badges)
    ]);
    if (x.reason) setTip(el, x.reason);
    return el;
  }
  function draw() {
    clear(listBox);
    var range = kListPage(rows.length, state, pager, draw),
      lastGroup = null;
    rows.slice(range.start, range.end).forEach(function (x) {
      if (x.g !== lastGroup) {
        lastGroup = x.g;
        var g = groups[x.g] || { label: '', count: 0 };
        var all = kBtn(
          I18n.t('cadeditor.ui.vaultpages.toggle_group'),
          function () {
            var on = rows.some(function (y) {
              return y.g === x.g && importable(y) && !sel[y.i];
            });
            rows.forEach(function (y) {
              if (y.g === x.g && importable(y)) sel[y.i] = on;
            });
            draw();
          },
          { cls: 'sm' }
        );
        listBox.appendChild(
          h('div', { class: 'vt-igroup' }, [
            uiIcon('folder', 12),
            h('b', { text: g.label }),
            h('span', { class: 'k-sub', text: String(g.count) }),
            h('div', { class: 'grow' }),
            all
          ])
        );
      }
      listBox.appendChild(rowEl(x));
    });
    paintCount();
  }
  function more(offset) {
    Vault.call('import_preview', { token: info.token, offset: offset, limit: 100 }, function (r) {
      if ($('modal') !== mask) return;
      if (!r.ok) {
        vaultErr(r);
        return;
      }
      (r.rows || []).forEach(function (x) {
        rows.push(x);
        sel[x.i] = importable(x);
      });
      if (!r.done && r.nextOffset > offset) {
        paintCount();
        more(r.nextOffset);
        return;
      }
      loaded = true;
      draw();
    });
  }
  var dedupeSeg = kSeg(
    [
      { v: 'skip', label: I18n.t('cadeditor.ui.vaultpages.skip_duplicates') },
      { v: 'keep', label: I18n.t('cadeditor.ui.vaultpages.keep_duplicates') }
    ],
    dedupe,
    function (v) {
      dedupe = v;
    }
  );
  if (!info.duplicates) dedupeSeg.el.style.display = 'none';
  var go = kBtn(
    I18n.t('cadeditor.ui.vaultpages.import_as_pages'),
    function () {
      if (!loaded || committed) return;
      var bitsel = '';
      for (var i = 0; i < info.total; i++) bitsel += sel[i] ? '1' : '0';
      committed = true;
      Vault.call(
        'import_commit',
        { token: info.token, selected: bitsel, dedupe: dedupe },
        function (r) {
          if (!r.ok) {
            committed = false;
            vaultErr(r);
            return;
          }
          closeModal();
          var first = (r.errors || [])[0];
          toast(
            I18n.t('cadeditor.ui.vaultpages.imported', r.imported || 0, (r.pages || []).length) +
              (r.skipped ? I18n.t('cadeditor.ui.vaultpages.imported_skipped', r.skipped) : '') +
              (r.failed
                ? I18n.t('cadeditor.ui.vaultpages.imported_failed', r.failed, first ? first.reason || first.error : '')
                : ''),
            r.failed ? 'warn' : 'ok'
          );
          if ((r.pages || []).length === 1) VaultUi.page = r.pages[0].id;
          if (done) done(r);
        },
        null,
        30000
      );
    },
    { icon: 'upload', cls: 'pri' }
  );
  var summary = I18n.t(
    'cadeditor.ui.vaultpages.preview_summary',
    info.total,
    info.valid || 0,
    info.kept || 0,
    info.invalid || 0,
    info.duplicates || 0
  );
  mask = openModal(
    modalShell(
      I18n.t('cadeditor.ui.vaultpages.preview_title'),
      summary,
      [warnBox, listBox, pager],
      [dedupeSeg.el, count, h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal), go],
      'wide vtwin'
    ),
    true
  );
  mask.onEditorClose = function () {
    if (!committed) Vault.call('import_cancel', { token: info.token }, null);
  };
  paintCount();
  more(0);
}
