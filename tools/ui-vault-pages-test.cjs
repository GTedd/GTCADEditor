// 保险库整理与导入（界面逻辑）：搜索语法补全、大小显示、排序 / 反向 / 页 / 网格请求、页签、网格格子与小窗、
// 分页管理（新建 / 改名 / 移动 / 删页去向确认）、升级（单条 / 全部按游标）、备份（立即备份 / 恢复需确认）、
// 导入（来源探测、长等待、预览分批读取、勾选排除、提交位串与去重选项、取消释放）。
const assert = require('node:assert/strict');
const H = require('./lib/ui-harness.cjs');
const t = H.create(),
  c = t.c;
c.snd = () => {};
const toasts = [];
c.toast = (m, kind) => toasts.push([m, kind]);
c.toastDismiss = () => {};
c.Store.doc = () => null;

const calls = [];
let replies = {};
c.Vault.call = (op, f, cb, view, timeout) => {
  calls.push({ op, f: JSON.parse(JSON.stringify(f || {})), view, timeout });
  const r = typeof replies[op] === 'function' ? replies[op](f) : replies[op];
  if (r === undefined) return;
  // 经过真实的 Vault.receive：统计、只读、保存状态都按页面的处理更新
  const id = 'mock' + calls.length;
  c.Vault.wait[id] = { cb, t: 0 };
  c.Vault.receive(Object.assign({ ok: true, op, requestId: id }, r));
};
const last = (op) => calls.filter((x) => x.op === op).at(-1);
const plain = (x) => JSON.parse(JSON.stringify(x)); // vm 里的数组换成本进程的，便于 deepEqual
const modal = () => t.doc.getElementById('modal');
const btnIn = (el, label) =>
  el
    .querySelectorAll('.k-btn')
    .filter(
      (x) => x.textContent.trim() === label || x.getAttribute('title') === label || x.getAttribute('data-tip') === label
    )[0];

const ENTRIES = [
  {
    id: 'a1',
    kind: 'item',
    name: '钻石剑',
    tags: [],
    note: '',
    item: { id: 'minecraft:diamond_sword', count: 1 },
    bytes: 2300,
    page: 'default',
    upgradable: true,
    mcDataVersion: 4189
  },
  {
    id: 'a2',
    kind: 'item',
    name: '钻石',
    tags: [],
    note: '',
    item: { id: 'minecraft:diamond', count: 32 },
    bytes: 512,
    page: 'p1'
  },
  {
    id: 'a3',
    kind: 'item',
    name: '坏物品',
    tags: [],
    note: '',
    item: { id: 'absent:gone', count: 1 },
    bytes: 300,
    incompatible: true,
    reason: 'unknown item'
  }
];
const PAGES = [
  { id: 'default', name: '', default: true, count: 2, bytes: 2600, kinds: { item: 2 } },
  { id: 'p1', name: '常用 物品', count: 1, bytes: 512, kinds: { item: 1 } }
];
function baseReplies() {
  replies = {
    list: { entries: ENTRIES, total: 3, offset: 0, nextOffset: 3, done: true, persisted: true },
    tags: { tags: [{ name: '武器', count: 1 }] },
    stats: { entries: 3, bytes: 1536000, persisted: true, upgradable: 1 },
    pages: { pages: PAGES, total: 2, done: true }
  };
}

// ---- 搜索语法补全与大小格式
{
  assert.equal(c.vaultSize(512), '512 B');
  assert.equal(c.vaultSize(2300), '2.2 KiB');
  assert.equal(c.vaultSize(1536000), '1.5 MiB');
  const fields = plain(c.vaultQueryHints('co').map((x) => x.text));
  assert.deepEqual(fields, ['count:'], '前缀补全字段名');
  assert.deepEqual(
    plain(c.vaultQueryHints('tag:武器 -ki').map((x) => x.text)),
    ['tag:武器 -kind:'],
    '取反前缀保留，只换最后一个词'
  );
  const kinds = plain(c.vaultQueryHints('kind:e').map((x) => x.text));
  assert.deepEqual(kinds, ['kind:entity '], '值补全');
  const page = c.vaultQueryHints('page:常', { pages: ['常用 物品'] })[0];
  assert.equal(page.text, 'page:"常用 物品" ', '含空格的页名加引号');
  assert.ok(page.done, '完整值可以直接搜索');
  assert.equal(c.vaultQueryHints('minecraft:sto').length, 0, '不认识的前缀不补全');
  assert.equal(c.vaultQueryHints('').length, 0, '空输入不出提示');
}

// ---- 打开窗口：请求带排序 / 反向 / 页；统计显示总大小；只有一页时不显示页签
{
  baseReplies();
  replies.pages = { pages: [PAGES[0]], total: 1, done: true };
  c.VaultUi.sort = 'size';
  c.VaultUi.reverse = true;
  c.VaultUi.page = '';
  c.VaultUi.view = 'list';
  c.openVault({});
  const list = last('list').f;
  assert.equal(list.sort, 'size');
  assert.equal(list.reverse, true);
  assert.equal(list.page, undefined, '全部页不带 page');
  assert.equal(list.limit, 40);
  const win = modal();
  assert.ok(win.querySelector('.vt-stat').textContent.includes('1.5 MiB'), '顶部显示总大小');
  assert.equal(win.querySelector('.vt-pages').style.display, 'none', '只有默认页时不显示页签');
  assert.ok(win.textContent.includes('2.2 KiB'), '列表行显示单条大小');
  assert.ok(win.textContent.includes('旧版本'), '旧版本条目有标记');
  assert.ok(win.querySelector('.vt-warn').textContent.includes('1 个物品来自旧游戏版本'), '可升级数量提示');
  c.closeModal();
}

// ---- 页签：多页时出现；点页签只看该页；页被删时自动回到全部
{
  baseReplies();
  c.VaultUi.sort = 'recent';
  c.VaultUi.reverse = false;
  c.openVault({});
  const win = modal();
  const chips = win.querySelector('.vt-pages').querySelectorAll('.k-chip');
  assert.equal(chips.length, 3, '全部 + 两页');
  assert.ok(chips[2].textContent.includes('常用 物品') && chips[2].textContent.includes('1'), '页名和条数');
  assert.ok(chips[1].textContent.includes('默认页'), '默认页本地化名称');
  chips[2].fire('click');
  assert.equal(last('list').f.page, 'p1');
  assert.equal(c.VaultUi.page, 'p1', '记住当前页');
  replies.list = { ok: false, error: 'PAGE_NOT_FOUND', reason: 'gone' };
  const before = calls.length;
  c.Vault.call = ((orig) => (op, f, cb, view, timeout) => {
    if (op === 'list' && f.page) {
      calls.push({ op, f: JSON.parse(JSON.stringify(f)) });
      cb({ ok: false, op, error: 'PAGE_NOT_FOUND', reason: 'gone' });
      return;
    }
    orig(op, f, cb, view, timeout);
  })(c.Vault.call);
  replies.list = { entries: ENTRIES, total: 3, done: true };
  win.querySelector('.vt-pages').querySelectorAll('.k-chip')[2].fire('click');
  const after = calls.slice(before).filter((x) => x.op === 'list');
  assert.equal(after.at(-1).f.page, undefined, '页不存在时回到全部页重新读取');
  assert.equal(c.VaultUi.page, '');
  c.closeModal();
}

// ---- 网格视图：格子图标 + 数量，悬停名称 / 数量 / 大小，点开是同一套操作
{
  baseReplies();
  c.VaultUi.view = 'grid';
  c.openVault({});
  assert.equal(last('list').f.limit, 100, '网格一次多读');
  const win = modal();
  const cells = win.querySelectorAll('.vt-cell');
  assert.equal(cells.length, 3);
  assert.equal(win.querySelector('.x-list').style.display, 'none', '网格时隐藏列表');
  const tip = cells[1].getAttribute('data-tip');
  assert.ok(tip.includes('钻石') && tip.includes('× 32') && tip.includes('512 B'), '悬停：名称、数量、大小');
  assert.ok(cells[1].textContent.includes('32'), '格子显示数量');
  assert.ok(
    cells[2].classList.contains('bad') && cells[2].getAttribute('data-tip').includes('unknown item'),
    '打不开的格子标出原因'
  );
  cells[0].fire('click');
  const pop = t.doc.getElementById('overlays').querySelector('.vt-pop');
  assert.ok(pop, '点格子打开小窗');
  assert.ok(btnIn(pop, '给我'), '小窗有给我');
  assert.ok(btnIn(pop, '升级'), '旧版本物品可升级');
  assert.ok(btnIn(pop, '复制一份') && btnIn(pop, '删除'), '复制 / 删除');
  // 移到另一页：所在页选择
  assert.ok(pop.textContent.includes('所在页'), '多页时可改所在页');
  // 单条升级
  replies.upgrade = { results: [{ id: 'a1', ok: true, from: 4189, to: 4500 }], upgraded: 1, failed: 0 };
  btnIn(pop, '升级').fire('click');
  assert.deepEqual(last('upgrade').f.ids, ['a1']);
  assert.ok(last('upgrade').timeout >= 30000, '升级给足等待时间');
  c.kPopClose();
  c.closeModal();
  c.VaultUi.view = 'list';
}

// ---- 全部升级：先确认，再按游标分批直到 done，汇报失败
{
  baseReplies();
  c.VaultUi.page = '';
  c.openVault({});
  const win = modal();
  let n = 0;
  replies.upgrade = (f) => {
    n++;
    return n === 1
      ? { results: [{ id: 'a1', ok: true }], upgraded: 1, failed: 0, nextAfter: 'a1', done: false }
      : {
          results: [{ id: 'a3', name: '坏物品', ok: false, reason: '未知物品' }],
          upgraded: 0,
          failed: 1,
          nextAfter: 'a3',
          done: true
        };
  };
  toasts.length = 0;
  btnIn(win.querySelector('.vt-warn'), '全部升级').fire('click');
  assert.equal(calls.filter((x) => x.op === 'upgrade' && x.f.all).length, 0, '确认前不发送');
  btnIn(modal(), '全部升级').fire('click');
  const ups = calls.filter((x) => x.op === 'upgrade' && x.f.all);
  assert.equal(ups.length, 2, '分批直到 done');
  assert.equal(ups[0].f.after, '');
  assert.equal(ups[1].f.after, 'a1', '游标前进');
  assert.ok(
    toasts.some((x) => x[0].includes('1 个保持原样') && x[0].includes('坏物品')),
    '失败的保持原样并给原因'
  );
  c.closeModal();
}

// ---- 分页管理：新建、改名、移动、删空页直接删、删非空页先问去向
{
  baseReplies();
  c.openVaultPages(() => {});
  const win = modal();
  const rows = win.querySelectorAll('.vt-prow');
  assert.equal(rows.length, 2);
  assert.equal(btnIn(rows[0], '删除页'), undefined, '默认页不能删');
  btnIn(rows[1], '上移').fire('click');
  assert.deepEqual(last('page_move').f, { page: 'p1', to: 0 });
  const input = win.querySelector('.vt-pnew').querySelector('input');
  input.value = '材料';
  btnIn(win, '新建页').fire('click');
  assert.deepEqual(last('page_create').f, { name: '材料' });
  btnIn(rows[1], '删除页').fire('click');
  assert.equal(calls.filter((x) => x.op === 'page_delete').length, 0, '非空页先确认');
  const confirm = modal();
  assert.ok(confirm.textContent.includes('1 条'), '说明条目数量');
  replies.page_delete = { deleted: 1, token: 'tok', expires: 1 };
  btnIn(confirm, '连同条目删除').fire('click');
  assert.deepEqual(last('page_delete').f, { page: 'p1', entries: 'delete' });
  assert.equal(c.Vault.undo.token, 'tok', '可撤销');
  c.closeModal();
  const empty = { id: 'p9', name: '空页', count: 0, bytes: 0 };
  c.vaultDeletePage(empty, () => {});
  assert.deepEqual(last('page_delete').f, { page: 'p9' }, '空页直接删');
}

// ---- 备份：列表、立即备份、恢复需二次确认且带 confirm
{
  baseReplies();
  replies.backups = {
    backups: [{ name: 'vault-20261115-101500-000-daily.json', time: 1794050000000, reason: 'daily', bytes: 4096 }],
    maxBackups: 20
  };
  c.openVaultBackups(() => {});
  const win = modal();
  assert.ok(win.textContent.includes('每日') && win.textContent.includes('4.0 KiB'), '原因与大小');
  assert.ok(win.textContent.includes('保留最近 20 份'), '轮转说明');
  replies.backup_now = { name: 'x' };
  btnIn(win, '立即备份').fire('click');
  assert.ok(last('backup_now'));
  btnIn(win, '恢复').fire('click');
  assert.equal(calls.filter((x) => x.op === 'backup_restore').length, 0, '恢复先确认');
  replies.backup_restore = { restored: 3 };
  btnIn(modal(), '用备份替换').fire('click');
  assert.deepEqual(last('backup_restore').f, { name: 'vault-20261115-101500-000-daily.json', confirm: true });
  c.closeModal();
}

// ---- 导入：探测来源 → 打开（选文件长等待）→ 预览分批读取 → 勾选排除 → 提交位串
{
  baseReplies();
  replies.import_scan = {
    sources: [
      { source: 'nbteditor', files: 2 },
      { source: 'librarian', files: 0 },
      { source: 'hotbar', files: 1 }
    ],
    world: true
  };
  let opened = 0;
  c.openVaultImportMenu(() => opened++);
  const menu = modal();
  const opts = menu.querySelectorAll('.vt-iopt');
  assert.equal(opts.length, 5, '粘贴 / 文件 / NBT Editor / Librarian / 原版快捷栏');
  assert.ok(opts[2].textContent.includes('2 页'), 'NBT Editor 页数');
  assert.ok(opts[3].classList.contains('dis'), '没找到的来源不可点');
  const rows = [];
  for (let i = 0; i < 130; i++)
    rows.push({
      i,
      g: i < 120 ? 0 : 1,
      kind: 'item',
      id: 'minecraft:stone',
      count: 1,
      name: '石头' + i,
      bytes: 200,
      ok: true
    });
  rows[5] = Object.assign({}, rows[5], { ok: false, kept: true, reason: 'unknown enchantment' });
  rows[6] = Object.assign({}, rows[6], { ok: false, reason: 'no id' });
  rows[7] = Object.assign({}, rows[7], { duplicate: true });
  replies.import_open = {
    token: 'imp',
    total: 130,
    valid: 127,
    kept: 1,
    invalid: 1,
    duplicates: 1,
    groups: [
      { index: 0, label: 'NBT Editor · 矿物', count: 120 },
      { index: 1, label: 'NBT Editor · 第 2 页', count: 10 }
    ],
    warnings: ['page3.nbt skipped']
  };
  replies.import_preview = (f) => ({
    token: 'imp',
    rows: rows.slice(f.offset, f.offset + 100),
    total: 130,
    nextOffset: Math.min(130, f.offset + 100),
    done: f.offset + 100 >= 130
  });
  opts[1].fire('click');
  assert.equal(last('import_open').f.source, 'file');
  assert.ok(last('import_open').timeout >= 600000, '选文件等待足够久');
  const preview = modal();
  assert.ok(preview !== menu, '菜单换成预览');
  assert.equal(calls.filter((x) => x.op === 'import_preview').length, 2, '分批读取全部行');
  assert.ok(preview.textContent.includes('page3.nbt skipped'), '显示读取警告');
  assert.ok(preview.textContent.includes('NBT Editor · 矿物'), '按来源分组');
  assert.ok(preview.textContent.includes('原样保留') && preview.textContent.includes('已存过'), '标出保留与重复');
  const toggles = preview.querySelectorAll('.k-toggle');
  assert.ok(toggles[6].classList.contains('dis') && !toggles[6].classList.contains('on'), '无法读取的行不能勾选');
  assert.ok(toggles[5].classList.contains('on'), '原样保留的行默认导入');
  toggles[0].fire('click');
  replies.import_commit = {
    imported: 127,
    skipped: 1,
    failed: 0,
    pages: [
      { id: 'np', name: 'NBT Editor · 矿物', count: 117 },
      { id: 'nq', name: 'x', count: 10 }
    ],
    errors: []
  };
  btnIn(preview, '导入为新页').fire('click');
  const commit = last('import_commit').f;
  assert.equal(commit.token, 'imp');
  assert.equal(commit.dedupe, 'skip', '默认跳过重复');
  assert.equal(commit.selected.length, 130);
  assert.equal(commit.selected[0], '0', '取消勾选的不导入');
  assert.equal(commit.selected[6], '0', '无法读取的不导入');
  assert.equal(commit.selected[5], '1');
  assert.equal(opened, 1, '完成后刷新保险库');
  assert.ok(toasts.some((x) => x[0].includes('127') && x[0].includes('跳过重复 1')));
  assert.equal(calls.filter((x) => x.op === 'import_cancel').length, 0, '已提交不再取消');

  // 取消预览：释放宿主暂存
  c.openVaultImportMenu(() => {});
  modal().querySelectorAll('.vt-iopt')[4].fire('click');
  assert.equal(last('import_open').f.source, 'hotbar');
  c.closeModal();
  assert.equal(last('import_cancel').f.token, 'imp', '关闭预览释放宿主暂存');
}

// ---- 选文件取消：不报错、不打开预览
{
  baseReplies();
  replies.import_scan = { sources: [], world: true };
  replies.import_open = { ok: false, error: 'CANCELLED', reason: 'no file' };
  toasts.length = 0;
  c.openVaultImportMenu(() => {});
  const menu = modal();
  menu.querySelectorAll('.vt-iopt')[1].fire('click');
  assert.equal(modal(), menu, '取消后留在菜单');
  assert.ok(!toasts.some((x) => x[1] === 'error'), '取消不当成错误');
  c.closeModal();
}

console.log(
  'PASS vault pages UI: query hints, size, sort/reverse/page/grid requests, page chips, grid tips and actions, upgrade one/all, page manager, backups, imports.'
);
