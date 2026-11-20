/* Messages to the host that must arrive. Oriel lets a page send a short burst and then a steady rate per second,
   and drops the rest (oriel.send returns false). A dropped message waits here, in order, and is sent again shortly;
   a message with a key replaces a queued one with the same key (a preference's latest value). */
var HostOutbox = (function () {
  var queue = [],
    timer = null,
    delay = 0;
  function host() {
    return typeof oriel !== 'undefined' && !!oriel.send;
  }
  function raw(channel, data) {
    try {
      return oriel.send(channel, data) !== false;
    } catch (ignored) {
      return true; // a handler error is not a dropped message: sending it again would not help
    }
  }
  function schedule() {
    if (timer !== null || !queue.length) return;
    delay = Math.min(delay ? delay * 2 : 50, 400);
    timer = setTimeout(flush, delay);
  }
  function flush() {
    timer = null;
    while (queue.length) {
      if (!raw(queue[0].channel, queue[0].data)) {
        schedule();
        return;
      }
      queue.shift();
    }
    delay = 0;
  }
  return {
    /* True when sent or queued; false without a host or with a full queue. */
    send: function (channel, data, key) {
      if (!host()) return false;
      if (key !== undefined)
        for (var i = 0; i < queue.length; i++)
          if (queue[i].key === key) {
            queue[i].data = data;
            return true;
          }
      if (!queue.length && raw(channel, data)) return true;
      if (queue.length >= 256) return false;
      queue.push({ channel: channel, data: data, key: key });
      schedule();
      return true;
    },
    cancel: function (key) {
      queue = queue.filter(function (m) {
        return m.key !== key;
      });
    },
    pending: function () {
      return queue.length;
    }
  };
})();

/* Always-on failure reporting. No document/request snapshots; exception text may quote invalid input. */
var EditorDiag = (function () {
  var sites = {},
    count = 0,
    booted = false,
    batch = [],
    batchTimer = null,
    overflow = 0;
  /* Stage marks and log lines are batched (one diag_batch message every 150 ms) so they never use up the page's
     message budget that registry requests and edits need while the editor opens. */
  function flushBatch() {
    batchTimer = null;
    if (!batch.length) return;
    var items = batch.splice(0, 50);
    if (overflow) {
      items.push({
        channel: 'log',
        data: { level: 'warn', msg: '[CAD-Editor-UI] diagnostics queue full, dropped=' + overflow }
      });
      overflow = 0;
    }
    HostOutbox.send('diag_batch', { items: items });
    if (batch.length) batchTimer = setTimeout(flushBatch, 150);
  }
  function send(channel, data) {
    try {
      if (typeof oriel !== 'undefined' && oriel.send) {
        if (batch.length >= 200) overflow++;
        else batch.push({ channel: channel, data: data });
        if (batchTimer === null) batchTimer = setTimeout(flushBatch, 150);
        return true;
      }
      if (channel === 'log' && typeof console !== 'undefined' && console.warn) console.warn(data.msg);
    } catch (ignored) {
      /* A broken logger must not recursively report or stop editing. */
    }
    return false;
  }
  /* Load timing is measured on arrival: these few marks go out at once. */
  function sendNow(channel, data) {
    try {
      if (typeof oriel !== 'undefined' && oriel.send) return oriel.send(channel, data) !== false;
    } catch (ignored) {}
    return false;
  }
  function report(level, site, error) {
    site = String(site).substring(0, 100);
    var now = Date.now(),
      key = '$' + level + ':' + site,
      last = sites[key];
    if (last && now - last.at < 5000) {
      last.skipped++;
      return;
    }
    if (!last && count >= 64) return;
    var skipped = last ? last.skipped : 0;
    if (!last) count++;
    sites[key] = { at: now, skipped: 0 };
    var name = error && error.name ? String(error.name) : 'Error';
    var message = error && error.message ? String(error.message) : String(error);
    var stack = error && error.stack ? String(error.stack).substring(0, 650) : '';
    send('log', {
      level: level,
      msg:
        '[CAD-Editor-UI] site=' +
        site +
        ' ' +
        name +
        ': ' +
        message.substring(0, 550) +
        (skipped ? ' repeated=' + skipped : '') +
        (stack ? ' stack=' + stack : '')
    });
  }
  return {
    phase: function (site, fn) {
      var at = Date.now();
      send('editor_ready', { phase: 'work', stage: site, state: 'begin' });
      try {
        return fn();
      } catch (e) {
        report('error', site, e);
        throw e;
      } finally {
        send('editor_ready', { phase: 'work', stage: site, state: 'end', elapsedMs: Date.now() - at });
      }
    },
    error: function (site, error) {
      report('error', site, error);
    },
    /* 一行耗时记录写进游戏日志（[CAD-Editor-Perf] site=… k=v），排查「慢」时直接看实测数字 */
    perf: function (site, fields) {
      var text = '[CAD-Editor-Perf] site=' + site;
      for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) text += ' ' + k + '=' + fields[k];
      send('log', { level: 'info', msg: text.substring(0, 600) });
    },
    warn: function (site, error) {
      report('warn', site, error);
    },
    ready: function () {
      if (booted) return;
      booted = true;
      sendNow('editor_ready', { phase: 'boot' });
      if (typeof requestAnimationFrame === 'function')
        requestAnimationFrame(function () {
          sendNow('editor_ready', { phase: 'first_frame_callback' });
        });
    }
  };
})();
