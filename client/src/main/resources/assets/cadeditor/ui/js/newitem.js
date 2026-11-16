/* 新建任意物品：不用先悬停或手持。选一个物品（实时注册表，含模组物品，支持拼音），以它的默认栈为基线打开一个「新物品」页，
   全部组件和数量都能改。这一页不属于任何槽位（复用嵌套编辑页 openNestedItem，返回时回到原来的页面 / 保险库）。
   「放入背包」复用保险库「给我」的写入引擎（宿主 VaultChannel give，带 stack）：只放进所选区域的空槽，不合并、不覆盖；
   创造模式走原版创造槽位包（服务器不返回结果，只算已提交），装了 CAD Editor 的服务器走它的权限节点与物品规则，
   其他情况走原版命令（服务器没装 CAD Editor 时，非创造模式需要 OP 指令权限）。没有空槽、被拒绝或结果未知时草稿保留。
   另可「存入保险库」。 */
var NewItemRegion = 'inventory',
  NewItemGive = null;
function openNewItem() {
  if ((typeof WE !== 'undefined' && WE.pending) || (typeof EditorBridge !== 'undefined' && EditorBridge.pending)) {
    toast(I18n.t('cadeditor.ui.screens.wait_current_write_response_before'), 'warn');
    return;
  }
  var pick = h('div', { class: 'k-btn pri' }, [
    uiIcon('search', 12),
    h('span', { text: I18n.t('cadeditor.ui.newitem.choose') })
  ]);
  function choose() {
    pickItem(
      pick,
      function (id) {
        closeModal();
        openNewItemDoc(id);
      },
      { placeholder: I18n.t('cadeditor.ui.newitem.search') }
    );
  }
  activate(pick, choose);
  var mask = openModal(
    modalShell(
      I18n.t('cadeditor.ui.newitem.title'),
      I18n.t('cadeditor.ui.newitem.sub'),
      [kHint(I18n.t('cadeditor.ui.newitem.hint')), pick],
      [h('div', { class: 'grow' }), kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal)]
    ),
    true
  );
  setTimeout(function () {
    if ($('modal') === mask) choose();
  }, 0);
}
/* 以物品默认栈（只有 ID 和数量 1，组件全部继承原型）打开新物品页 */
function openNewItemDoc(id) {
  var wasVaultOnly = typeof VaultOnly !== 'undefined' && VaultOnly,
    before = NestedItem;
  function leave() {
    if (!wasVaultOnly) return;
    VaultOnly = true;
    document.body.classList.add('vault-only');
  }
  /* 独立保险库页没有编辑器窗口：编辑新物品期间显示出来，关窗口时不关页面；返回保险库时恢复 */
  if (wasVaultOnly) {
    VaultOnly = false;
    document.body.classList.remove('vault-only');
  }
  openNestedItem(
    { id: fullId(id), count: 1, comps: {}, removed: {} },
    {
      newItem: true,
      title: I18n.t('cadeditor.ui.newitem.back_title'),
      commitUnchanged: true,
      commit: function () {},
      leave: leave
    }
  );
  if (NestedItem === before) {
    leave();
    return;
  }
  /* 底栏「写回权限与范围」显示保险库取出的能力：每个保险库应答都带着当前的说明 */
  Vault.call('stats', {}, function () {
    if (NestedItem && NestedItem.options.newItem && Store.docs.length) drawFooter();
  });
}
function openNewItemApply() {
  if (itemRawBlocked()) {
    toast(I18n.t('cadeditor.ui.screens.original_data_unapplied_error_text'), 'warn');
    return;
  }
  var d = Store.doc(),
    errs = validateDoc(d).filter(function (p) {
      return p.level === 'error';
    }),
    region = NewItemRegion;
  var seg = kSeg(
    [
      { v: 'inventory', label: I18n.t('cadeditor.ui.newitem.region_inventory') },
      { v: 'hotbar', label: I18n.t('cadeditor.ui.newitem.region_hotbar') }
    ],
    region,
    function (v) {
      region = NewItemRegion = v;
    }
  );
  var body = [];
  if (errs.length)
    body.push(
      h('div', {
        class: 'k-effect bad',
        text: I18n.t(
          'cadeditor.ui.screens.errors_need_dealt_first',
          errs.length,
          errs
            .map(function (e) {
              return e.msg;
            })
            .join('；')
        )
      })
    );
  body.push(fieldRow(I18n.t('cadeditor.ui.newitem.region'), seg.el));
  body.push(kHint(I18n.t('cadeditor.ui.newitem.rules')));
  // Single line like the rule above (full text on hover), per the editor UI rules for resident descriptions.
  if (Vault.st.giveCapability) body.push(kHint(Vault.st.giveCapability));
  var give = kBtn(
    I18n.t('cadeditor.ui.newitem.give'),
    function () {
      if (errs.length) return;
      closeModal();
      newItemGive(d, region);
    },
    { cls: 'pri' + (errs.length ? ' dim' : ''), icon: 'download' }
  );
  var store = kBtn(
    I18n.t('cadeditor.ui.newitem.store'),
    function () {
      closeModal();
      openVaultSave();
    },
    { icon: 'chest' }
  );
  openModal(
    modalShell(I18n.t('cadeditor.ui.newitem.apply_title'), nameOfItem(d.id) + ' × ' + d.count, body, [
      kBtn(I18n.t('cadeditor.ui.common.cancel'), closeModal),
      h('div', { class: 'grow' }),
      store,
      give
    ]),
    true
  );
}
/* 一次只发一笔；大物品先分段上传（与保险库存大物品相同） */
function newItemGive(d, region) {
  if (NewItemGive) {
    toast(I18n.t('cadeditor.ui.newitem.pending'), 'info');
    return;
  }
  var stack;
  try {
    stack = hostTipStack(d);
  } catch (e) {
    if (typeof EditorDiag !== 'undefined') EditorDiag.error('newitem.serialize', e);
    toast(I18n.t('cadeditor.ui.screens.data_could_sequenced_submitted', e.message || e), 'error');
    return;
  }
  var token = (NewItemGive = { doc: d });
  function done(r) {
    if (NewItemGive !== token) return;
    NewItemGive = null;
    newItemResult(r);
  }
  var small;
  try {
    small = JSON.stringify({ stack: stack }).length < 7000;
  } catch (e) {
    small = false;
  }
  toast(I18n.t('cadeditor.ui.newitem.sending'), 'info', 'newitem');
  if (small) {
    Vault.call('give', { stack: stack, slot: region }, done);
    return;
  }
  Vault.upload(JSON.stringify(stack), function (u) {
    if (!u.ok) {
      done(u);
      return;
    }
    Vault.call('give', { uploadToken: u.token, slot: region }, done);
  });
}
/* 只有服务器确认（或装了 CAD Editor 的服务器放入成功）才算成功；创造模式只算已提交；草稿始终保留 */
function newItemResult(r) {
  r = r || {};
  var nl = String.fromCharCode(10);
  if (!r.ok) {
    var unknown = r.error === 'TIMEOUT' || r.code === 'request_timeout' || r.status === 'unknown';
    toast(
      (unknown ? I18n.t('cadeditor.ui.newitem.unknown') : r.reason || r.error || '') +
        nl +
        I18n.t('cadeditor.ui.newitem.draft_kept'),
      'error',
      'newitem'
    );
    return;
  }
  if (r.confirmed === false) {
    toast((r.reason ? r.reason + nl : '') + I18n.t('cadeditor.ui.newitem.creative_unconfirmed'), 'warn', 'newitem');
    return;
  }
  toast(r.reason || I18n.t('cadeditor.ui.newitem.given'), 'ok', 'newitem');
}
