/* 分阶段启动。页面里的 <script> 会在第一帧之前全部跑完：以前 48 个脚本（约 2.5 MB）都编译执行完才画出第一帧，
   打开时游戏卡住 0.5～1.5 秒、什么也看不到。现在 index.html 只带样式、窗口骨架和加载动画，再加这个小脚本：
   1. 立刻按保存的偏好摆好窗口骨架（位置大小、最大化、背景不透明度、动画、字体），第一帧就画出来；
   2. 第一帧之后把下面的脚本分批插入（插入时同步执行），每帧约 30 毫秒（太碎了每帧的绘制开销会拖长总时间），批次之间游戏照常出帧、加载动画照常转；
   3. 最后一个 app.js 执行时 boot() 画出默认打开的界面；加载动画交给「正在读取游戏数据…」接着用，不先消失再出现。
   清单的顺序就是以前 index.html 里的顺序；tools/lib/ui-scripts.cjs 按它给测试载入脚本。 */
var EDITOR_SCRIPTS = [
  'js/diagnostics.js',
  'js/data.js',
  'js/i18n-catalogs.js',
  'js/i18n.js',
  'js/core.js',
  'js/labels.js',
  'js/pinyin-data.js',
  'js/search.js',
  'js/fieldindex.js',
  'js/fielddecl.js',
  'js/forms.js',
  'js/kit.js',
  'js/kit2.js',
  'js/colorpicker.js',
  'js/nbt.js',
  'js/code.js',
  'js/codeassist.js',
  'js/cmdassist.js',
  'js/xlist.js',
  'js/slots.js',
  'js/specs.js',
  'js/reg.js',
  'js/hostsearch.js',
  'js/spritepicker.js',
  'js/imageart.js',
  'js/tip.js',
  'js/picker.js',
  'js/cards1.js',
  'js/cards2.js',
  'js/cards3.js',
  'js/cards4.js',
  'js/cards5.js',
  'js/world.js',
  'js/rules.js',
  'js/spawn.js',
  'js/eschema.js',
  'js/pages.js',
  'js/detail.js',
  'js/banner.js',
  'js/toastkit.js',
  'js/screens.js',
  'js/changelog.js',
  'js/worldedit.js',
  'js/worldview.js',
  'js/worldentity.js',
  'js/itemspecial.js',
  'js/genericview.js',
  'js/worldplayer.js',
  'js/translate.js',
  'js/worldplayerx.js',
  'js/vaultworld.js',
  'js/mobsound.js',
  'js/vault.js',
  'js/vaultpages.js',
  'js/newitem.js',
  'js/history.js',
  'js/drafts.js',
  'js/app.js'
];
var EditorBoot = (function () {
  var FRAME_MS = 30,
    started = Date.now(),
    next = 0,
    frames = 0,
    work = 0,
    shellAt = 0;
  function data() {
    return (typeof oriel !== 'undefined' && oriel && oriel.data) || {};
  }
  /* 和 Prefs.init / applyPageOpacity / applyUiMotion / applyUiFont / applyWinStyle 同样的规则，只是提前到第一帧之前 */
  function shell() {
    var d = data(),
      p = d.prefs && typeof d.prefs === 'object' ? d.prefs : {},
      root = document.documentElement,
      win = document.getElementById('win'),
      overlay = document.getElementById('boot-loading'),
      opacity =
        typeof p.pageOpacity === 'number' && isFinite(p.pageOpacity)
          ? Math.min(100, Math.max(30, Math.round(p.pageOpacity)))
          : 60;
    root.style.setProperty('--page-opacity', opacity + '%');
    root.setAttribute('data-page-translucent', opacity < 100 ? 'true' : 'false');
    root.setAttribute('data-motion', p.uiAnimations === false ? 'reduced' : 'full');
    root.setAttribute('data-ed-font', p.uiFont === 'smooth' ? 'smooth' : 'mc');
    if (d.mode === 'vault' || d.mode === 'history') {
      /* 只开保险库 / 编辑历史：没有编辑器窗口，加载动画单独居中 */
      document.body.classList.add('vault-only'); // 和 enterVaultMode / 历史模式同一个开关：隐藏编辑器窗口
      if (overlay) {
        overlay.classList.add('bare');
        document.body.appendChild(overlay);
      }
      return;
    }
    if (!win) return;
    var mode = p.windowMode === 'maximized' || p.windowMode === 'windowed' ? p.windowMode : 'remember',
      maxed = mode === 'maximized' || (mode === 'remember' && p.windowMax === true),
      ww = typeof p.winW === 'number' && p.winW >= 320 ? p.winW : 0,
      wh = typeof p.winH === 'number' && p.winH >= 200 ? p.winH : 0,
      vw = window.innerWidth || 0,
      vh = window.innerHeight || 0;
    if (ww && vw) ww = Math.min(ww, vw - 20);
    if (wh && vh) wh = Math.min(wh, vh - 20);
    var style = '--cat:#6cc349;',
      positioned = position(p.winX) !== null && position(p.winY) !== null;
    if (ww) style += '--ww:' + ww + 'px;';
    if (wh) style += '--wh:' + wh + 'px;';
    if (positioned) style += '--wx:' + p.winX + 'px;--wy:' + p.winY + 'px;';
    win.setAttribute('style', style);
    if (maxed) win.classList.add('max');
    if (positioned) win.classList.add('positioned');
  }
  /* windowPos 的同一规则：0–32768 的整数，其余（含 -1）表示居中 */
  function position(v) {
    return typeof v === 'number' && Math.floor(v) === v && v >= 0 && v <= 32768 ? v : null;
  }
  function label() {
    var overlay = document.getElementById('boot-loading'),
      text = overlay && overlay.querySelector('.ed-load-text');
    if (text && !text.textContent && typeof I18n !== 'undefined' && I18n.t)
      text.textContent = I18n.t('cadeditor.ui.app.loading');
  }
  function insert(src) {
    var script = document.createElement('script');
    script.setAttribute('src', src);
    document.body.appendChild(script);
  }
  function step() {
    frames++;
    if (!shellAt) {
      shellAt = Date.now();
      try {
        if (typeof oriel !== 'undefined' && oriel.send) oriel.send('editor_ready', { phase: 'shell' });
      } catch (ignored) {}
    }
    var began = Date.now();
    while (next < EDITOR_SCRIPTS.length) {
      insert(EDITOR_SCRIPTS[next++]);
      label();
      if (Date.now() - began >= FRAME_MS) break;
    }
    work += Date.now() - began;
    if (next < EDITOR_SCRIPTS.length) requestAnimationFrame(step);
    else finished();
  }
  function finished() {
    if (typeof EditorDiag !== 'undefined' && EditorDiag.perf)
      EditorDiag.perf('boot.scripts', {
        shell_to_ready_ms: Date.now() - shellAt,
        work_ms: work, // 真正在跑脚本（含最后画出界面）的时间；差值是批次之间游戏照常出帧的时间

        total_ms: Date.now() - started,
        frames: frames
      });
    /* EditorLoading 接手了就由它撤；没有接手（保险库 / 历史 / 没有物品）就淡出 */
    var overlay = document.getElementById('boot-loading');
    if (!overlay) return;
    overlay.removeAttribute('id');
    overlay.classList.add('out');
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 220);
  }
  shell();
  /* 第一帧先画骨架：外层回调在第一帧绘制前运行，里层回调才是第二帧，此时骨架已经上屏 */
  requestAnimationFrame(function () {
    requestAnimationFrame(step);
  });
  return { scripts: EDITOR_SCRIPTS };
})();
