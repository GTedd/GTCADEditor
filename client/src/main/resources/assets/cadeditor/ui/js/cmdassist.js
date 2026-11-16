/* 命令框辅助：CommandAssist.attach(textarea, opts) → detach()。
   输入停顿后按服务器下发给本玩家的命令树检查语法（command_assist 通道，CommandChannel.java，只解析不执行），
   显示“语法通过 / 错误（行:列，点击定位）/ 无法检查（未进入世界、命令树里没有该命令、过长）”；
   Ctrl+Space 或按钮取补全候选。默认不把命令发给服务器：只有服务器才能给的候选会被跳过，并提供一行显式“向服务器请求”。
   opts：{ host: 状态行与候选列表的挂载点（省略时插在 textarea 后面）, onApply: function (newText)（采纳候选后回调） }
   前导 / 可有可无并原样保留。 */
var CMD_ASSIST_MAX = 32767;
var CmdAssistHost = {
  seq: 0,
  views: {},
  supported: null,
  listening: false,
  listen: function () {
    if (this.listening || typeof oriel === 'undefined' || !oriel.on) return;
    this.listening = true;
    var me = this;
    oriel.on('patch', function (p) {
      if (p && p.key === 'command_assist.result') me.receive(p.value);
    });
  },
  request: function (view, msg, cb, ms) {
    if (
      this.supported === false ||
      typeof oriel === 'undefined' ||
      !oriel.send ||
      (typeof Reg !== 'undefined' && Reg.live && !Reg.live())
    )
      return false;
    this.listen();
    var me = this,
      id = 'cm' + ++this.seq,
      old = this.views[view];
    if (old) clearTimeout(old.timer);
    msg.requestId = id;
    msg.view = view;
    var v = (this.views[view] = { id: id, cb: cb, view: view, timer: null });
    v.timer = setTimeout(
      function () {
        if (me.views[view] !== v) return;
        delete me.views[view];
        if (me.supported !== true) me.supported = false;
        cb({ fallback: true });
      },
      ms || (this.supported === true ? 5000 : 3000)
    );
    var sent = false;
    try {
      sent = oriel.send('command_assist', msg);
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
    try {
      oriel.send('command_assist', { requestId: 'cx' + ++this.seq, view: view, cancel: true });
    } catch (e) {}
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
    v.cb(r.ok ? r : { fallback: true, error: r.error || 'ERROR', reason: r.reason });
  }
};
/* 单行命令里 cursor 的 行:列（1 起），多行命令也对 */
function cmdLineCol(text, cursor) {
  var before = text.substring(0, Math.max(0, cursor)),
    line = before.split('\n').length;
  return { line: line, col: cursor - (before.lastIndexOf('\n') + 1) + 1 };
}
var CommandAssist = {
  seq: 0,
  attach: function (ta, opts) {
    opts = opts || {};
    var view = 'cmd' + ++CommandAssist.seq,
      alive = true,
      timer = null,
      last = null,
      items = [],
      index = 0,
      askServer = false,
      listOpen = false;
    var status = h('div', { class: 'cma-st k-sub', role: 'status', title: I18n.t('cadeditor.ui.cmdassist.hint') }),
      button = kBtn(
        '',
        function () {
          suggest(false);
        },
        { icon: 'sparkle', cls: 'sm cma-btn', title: I18n.t('cadeditor.ui.cmdassist.suggest') }
      ),
      list = h('div', { class: 'cma-pop', role: 'listbox' }),
      bar = h('div', { class: 'cma' }, [h('div', { class: 'cma-row' }, [status, button]), list]);
    button.setAttribute('aria-label', I18n.t('cadeditor.ui.cmdassist.suggest'));
    list.style.display = 'none';
    if (opts.host) opts.host.appendChild(bar);
    else if (ta.parentNode) ta.parentNode.insertBefore(bar, ta.nextSibling);
    function value() {
      return String(ta.value === undefined || ta.value === null ? '' : ta.value);
    }
    function caret() {
      var c = ta.selectionEnd;
      return typeof c === 'number' && isFinite(c) ? c : value().length;
    }
    function paint(r) {
      last = r;
      status.classList.remove('ok');
      status.classList.remove('bad');
      var s = r.status;
      if (s === 'ok') {
        status.textContent = I18n.t('cadeditor.ui.cmdassist.ok');
        status.classList.add('ok');
      } else if (s === 'error' || s === 'incomplete') {
        var text = r.text === undefined ? value() : r.text,
          at = typeof r.start === 'number' && r.start >= 0 ? cmdLineCol(text, r.start) : null;
        status.textContent = at
          ? I18n.t('cadeditor.ui.cmdassist.error', at.line, at.col, r.message || '')
          : I18n.t('cadeditor.ui.cmdassist.error_nopos', r.message || '');
        status.classList.add('bad');
      } else if (s === 'unchecked') {
        var reason = r.reason || 'failed';
        status.textContent =
          reason === 'unknown_root'
            ? I18n.t('cadeditor.ui.cmdassist.unchecked_root', r.root || '')
            : reason === 'offline'
              ? I18n.t('cadeditor.ui.cmdassist.unchecked_offline')
              : reason === 'too_long'
                ? I18n.t('cadeditor.ui.cmdassist.unchecked_too_long', CMD_ASSIST_MAX)
                : reason === 'nohost'
                  ? I18n.t('cadeditor.ui.cmdassist.unchecked_nohost')
                  : I18n.t('cadeditor.ui.cmdassist.unchecked_failed');
      } else status.textContent = s === 'pending' ? I18n.t('cadeditor.ui.cmdassist.checking') : '';
    }
    function check() {
      if (!alive) return;
      var text = value();
      if (text.length > CMD_ASSIST_MAX) {
        paint({ status: 'unchecked', reason: 'too_long' });
        return;
      }
      if (!text.replace(/^\//, '').trim()) {
        paint({ status: 'empty' });
        return;
      }
      paint({ status: 'pending' });
      var sent = CmdAssistHost.request(view, { op: 'check', text: text }, function (r) {
        if (!alive || value() !== text) return;
        r.text = text;
        paint(r.fallback ? { status: 'unchecked', reason: r.error === 'BUSY' ? 'failed' : 'nohost' } : r);
      });
      if (!sent) paint({ status: 'unchecked', reason: 'nohost' });
    }
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(check, 300);
    }
    function closeList() {
      listOpen = false;
      items = [];
      list.style.display = 'none';
      clear(list);
    }
    function row(cls, text, detail, fn) {
      var r = h('div', { class: cls, role: 'option' }, [
        h('span', { class: 'cma-v', text: text }),
        detail ? h('span', { class: 'cma-d', text: detail }) : null
      ]);
      r.addEventListener('mousedown', function (e) {
        e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        fn();
      });
      return r;
    }
    function showList(note) {
      clear(list);
      listOpen = true;
      list.style.display = '';
      if (!items.length)
        list.appendChild(
          h('div', { class: 'cma-empty', text: note || I18n.t('cadeditor.ui.cmdassist.no_candidates') })
        );
      items.forEach(function (it, i) {
        list.appendChild(
          row('cma-i' + (i === index ? ' on' : ''), it.text, it.tooltip || '', function () {
            accept(it);
          })
        );
      });
      if (askServer)
        list.appendChild(
          row('cma-ask', I18n.t('cadeditor.ui.cmdassist.ask_server'), '', function () {
            suggest(true);
          })
        );
      var on = list.querySelector('.cma-i.on');
      if (on && on.scrollIntoView)
        try {
          on.scrollIntoView({ block: 'nearest' });
        } catch (e) {}
    }
    function suggest(server) {
      var text = value(),
        cursor = caret();
      if (text.length > CMD_ASSIST_MAX) {
        items = [];
        askServer = false;
        showList(I18n.t('cadeditor.ui.cmdassist.unchecked_too_long', CMD_ASSIST_MAX));
        return;
      }
      var sent = CmdAssistHost.request(
        view + ':s',
        { op: 'suggest', text: text, cursor: cursor, server: !!server },
        function (r) {
          if (!alive || value() !== text) return;
          index = 0;
          if (r.fallback) {
            items = [];
            askServer = false;
            showList(
              r.reason
                ? I18n.t('cadeditor.ui.cmdassist.suggest_failed', r.reason)
                : I18n.t('cadeditor.ui.cmdassist.unchecked_nohost')
            );
            return;
          }
          if (r.status === 'unchecked') {
            items = [];
            askServer = false;
            showList(
              r.reason === 'too_long'
                ? I18n.t('cadeditor.ui.cmdassist.unchecked_too_long', CMD_ASSIST_MAX)
                : I18n.t('cadeditor.ui.cmdassist.unchecked_offline')
            );
            return;
          }
          items = (r.suggestions || []).slice(0, 80);
          askServer = !!r.askServer && !server;
          showList();
        },
        server ? 6000 : 0
      );
      if (!sent) {
        items = [];
        askServer = false;
        showList(I18n.t('cadeditor.ui.cmdassist.unchecked_nohost'));
      } else if (server) toast(I18n.t('cadeditor.ui.cmdassist.server_sent'), 'info', 'cma-server');
    }
    function accept(it) {
      var text = value(),
        from = Math.max(0, Math.min(text.length, it.from)),
        to = Math.max(from, Math.min(text.length, it.to)),
        next = text.substring(0, from) + it.text + text.substring(to),
        at = from + it.text.length;
      closeList();
      if (
        document.documentElement &&
        document.documentElement.getAttribute('data-editor-code-edit') === 'ready' &&
        typeof ta.dispatchEvent === 'function'
      ) {
        // The field's own text model: one undo step and the usual input events.
        ta.setAttribute(
          'data-code-edit',
          JSON.stringify({ from: from, to: to, text: it.text, length: text.length, selStart: at, selEnd: at })
        );
        try {
          ta.dispatchEvent(new CustomEvent('ed:code-edit', { bubbles: true }));
        } catch (e) {}
        ta.removeAttribute('data-code-edit');
      }
      if (value() === text && next !== text) {
        ta.value = next;
        if (typeof ta.setSelectionRange === 'function') ta.setSelectionRange(at, at);
        if (typeof ta.dispatchEvent === 'function' && typeof Event === 'function')
          try {
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          } catch (e) {}
      }
      if (ta.focus) ta.focus();
      if (opts.onApply) opts.onApply(value());
      schedule();
    }
    function onInput() {
      if (listOpen) closeList();
      schedule();
    }
    function onKey(e) {
      var ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.altKey && (e.key === ' ' || e.key === 'Space' || e.code === 'Space')) {
        e.preventDefault();
        suggest(false);
        return;
      }
      if (!listOpen) return;
      var k = e.key;
      if ((k === 'ArrowDown' || k === 'ArrowUp') && items.length) {
        e.preventDefault();
        index = (index + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        showList();
      } else if ((k === 'Enter' || k === 'Tab') && !e.shiftKey && !ctrl && !e.altKey) {
        if (!items.length) {
          closeList();
          return;
        }
        e.preventDefault();
        accept(items[index]);
      } else if (k === 'Escape') {
        e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        closeList();
      } else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') closeList();
    }
    function onBlur() {
      setTimeout(function () {
        if (alive && document.activeElement !== ta) closeList();
      }, 0);
    }
    activate(status, function () {
      if (!last || (last.status !== 'error' && last.status !== 'incomplete') || !(last.start >= 0)) return;
      if (ta.focus) ta.focus();
      var n = value().length,
        a = Math.min(n, last.start);
      if (typeof ta.setSelectionRange === 'function') ta.setSelectionRange(a, Math.min(n, a + 1));
    });
    ta.addEventListener('input', onInput);
    ta.addEventListener('keydown', onKey);
    ta.addEventListener('blur', onBlur);
    check();
    return function detach() {
      if (!alive) return;
      alive = false;
      clearTimeout(timer);
      ta.removeEventListener('input', onInput);
      ta.removeEventListener('keydown', onKey);
      ta.removeEventListener('blur', onBlur);
      CmdAssistHost.cancel(view);
      CmdAssistHost.cancel(view + ':s');
      bar.remove();
    };
  }
};
