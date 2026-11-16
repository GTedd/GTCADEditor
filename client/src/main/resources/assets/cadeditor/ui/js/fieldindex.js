/* Ctrl+K 字段搜索：当前物品所有分页（含「更多」里的通用分页）的卡片与字段。
   不为建索引渲染卡片：专用卡片读声明（js/fielddecl.js 由 tools/field-decl-gen.cjs 生成，卡片也可用 FieldIndex.declare 自己声明），
   通用组件卡片读实时组件结构（schema 字段）；没声明字段的卡片仍按卡片名、组件 ID 命中。
   检索词：当前语言的标签、英文原文（I18n.en）、组件 ID / 字段键、拼音（kMatch）。排序：完全匹配 > 前缀 > 子串 > 拼音。
   索引按物品、分页、语言缓存，只在打开命令面板后第一次输入时构建。 */
var FieldIndex = (function () {
  var DECL = {},
    cache = null,
    textKeys = null;
  /* key：PAGES 里的卡片键；spec = { id: 卡片 data-card, title: 标题的翻译键, fields: [字段标签的翻译键…] } */
  function declare(key, spec) {
    if (!key || !spec) return;
    var old = DECL[key] || { id: '', title: '', fields: [] },
      fields = (spec.fields || []).slice();
    old.fields.forEach(function (f) {
      if (fields.indexOf(f) < 0) fields.push(f);
    });
    DECL[key] = { id: spec.id || old.id, title: spec.title || old.title, fields: fields };
    cache = null;
  }
  function declareAll(map) {
    Object.keys(map || {}).forEach(function (key) {
      declare(key, map[key]);
    });
  }
  /* Translation keys behind component names and schema field descriptions (data.js text paths), for English terms. */
  function keys() {
    if (textKeys) return textKeys;
    textKeys = { name: {}, field: {} };
    (typeof EditorTextFields !== 'undefined' ? EditorTextFields : []).forEach(function (t) {
      var p = t.path;
      if (p[0] !== 'comps') return;
      var comp = EDATA.comps[p[1]];
      if (!comp) return;
      if (p.length === 3 && p[2] === 'name') textKeys.name[comp.id] = t.key;
      else if (p.length === 6 && p[2] === 'schema' && p[3] === 'f' && p[5] === 'd') {
        var f = comp.schema && comp.schema.f && comp.schema.f[p[4]];
        if (f) textKeys.field[comp.id + '|' + f.k] = t.key;
      }
    });
    return textKeys;
  }
  function shortLabel(text) {
    return String(text || '')
      .split(/[，；;：:（(]/)[0]
      .trim();
  }
  function compName(cid) {
    return CIDX[cid] ? CIDX[cid].name : humanId(cid);
  }
  function compEn(cid) {
    var k = keys().name[cid];
    return k ? I18n.en(k) : '';
  }
  function cardTitle(spec, key, decl, cids) {
    if (Array.isArray(spec) && typeof spec[2] === 'string') return spec[2];
    if (decl && decl.title) return I18n.t(decl.title);
    if (cids[0]) return compName(cids[0]);
    return humanId(key);
  }
  function schemaFields(cid) {
    var c = CIDX[cid],
      sc = c && c.schema;
    if (!sc || sc.t !== 'obj' || !sc.f) return [];
    var over = (typeof SPEC_FORMS !== 'undefined' && SPEC_FORMS[cid] && SPEC_FORMS[cid].over) || {};
    return sc.f.map(function (f) {
      var ov = over[f.k] || {},
        k = keys().field[cid + '|' + f.k];
      return {
        label: ov.label || shortLabel(f.d) || f.k,
        en: k ? shortLabel(I18n.en(k)) : '',
        key: f.k
      };
    });
  }
  function itemTabs(kind) {
    return tabsOfKind(kind)
      .concat(typeof hiddenUniTabs === 'function' ? hiddenUniTabs(kind) : [])
      .filter(function (t) {
        return t.id !== 'item-stack';
      });
  }
  function build() {
    var d = Store.docs.length ? Store.doc() : null;
    if (!d) return [];
    var kind = kindOfItem(d.id),
      tabs = itemTabs(kind),
      sig = [
        d.id,
        d.changeSerial || 0, // 启用 / 移除组件会改变哪些卡片适用
        kind,
        I18n.locale,
        EDATA.comps.length,
        tabs
          .map(function (t) {
            return t.id + ':' + t.cards.length;
          })
          .join(',')
      ].join('|');
    if (cache && cache.sig === sig) return cache.list;
    var list = [],
      id = Ctx.id();
    tabs.forEach(function (tab) {
      tab.cards.forEach(function (spec) {
        try {
          add(tab, spec);
        } catch (e) {
          if (typeof EditorDiag !== 'undefined') EditorDiag.error('fieldindex.card', e); // 一张卡片出错不影响其他结果
        }
      });
    });
    function add(tab, spec) {
      var key = Array.isArray(spec) ? spec[0] : spec;
      if (typeof key !== 'string' || !CARDS[key]) return; // 分段标题
      if (!tab.force && !cardApplies(key, id, kind)) return;
      var cids = cardComps(spec).filter(Boolean),
        decl = DECL[key],
        title = cardTitle(spec, key, decl, cids),
        en = decl && decl.title ? I18n.en(decl.title) : cids[0] ? compEn(cids[0]) : '',
        cardId = key === 'auto' ? 'auto-' + spec[1] : (decl && decl.id) || '';
      var base = { tab: tab.id, tabLabel: tab.label, spec: spec, key: key, cardId: cardId, title: title, cids: cids };
      list.push(
        entry(base, null, en, [title, en, key].concat(cids), {
          path: tab.label + ' › ' + title
        })
      );
      var fields = [];
      if (decl)
        decl.fields.forEach(function (k) {
          fields.push({ label: I18n.t(k), en: I18n.en(k), key: '' });
        });
      if (key === 'auto') fields = fields.concat(schemaFields(spec[1]));
      var seen = {};
      fields.forEach(function (f) {
        if (!f.label || seen[f.label]) return;
        seen[f.label] = 1;
        list.push(
          entry(base, f, f.en, [f.label, f.en, f.key], {
            path: tab.label + ' › ' + title + ' › ' + f.label
          })
        );
      });
    }
    cache = { sig: sig, list: list };
    return list;
  }
  function entry(base, field, en, texts, extra) {
    var e = {};
    Object.keys(base).forEach(function (k) {
      e[k] = base[k];
    });
    e.field = field ? field.label : null;
    e.fieldKey = field ? field.key : '';
    e.en = en || '';
    e.texts = texts.filter(function (t, i) {
      return t && texts.indexOf(t) === i;
    });
    e.path = extra.path;
    return e;
  }
  /* 4 完全匹配，3 前缀，2 子串，1 拼音，0 不匹配。命名空间 ID 和下划线键也按去掉前缀 / 换成空格后的形式比 */
  function rank(text, q) {
    var t = String(text || '').toLowerCase();
    if (!t || !q) return 0;
    var forms = [t];
    if (t.indexOf(':') > 0) forms.push(t.substring(t.indexOf(':') + 1));
    if (t.indexOf('_') >= 0) forms.push(t.replace(/_/g, ' '));
    var best = 0;
    forms.forEach(function (f) {
      if (f === q) best = 4;
      else if (best < 3 && f.indexOf(q) === 0) best = 3;
      else if (best < 2 && f.indexOf(q) >= 0) best = 2;
    });
    if (best) return best;
    return kMatch(t, q) ? 1 : 0;
  }
  function score(e, q) {
    var best = 0;
    for (var i = 0; i < e.texts.length && best < 4; i++) best = Math.max(best, rank(e.texts[i], q));
    return best;
  }
  /* 匹配到的条目（{ e, score }），按分数、字段优先于卡片、原顺序排序 */
  function search(query, limit) {
    var q = String(query || '')
      .trim()
      .toLowerCase();
    if (!q) return [];
    var out = [];
    build().forEach(function (e, i) {
      var s = score(e, q);
      if (s) out.push({ e: e, score: s, i: i });
    });
    out.sort(function (a, b) {
      return b.score - a.score || (b.e.field ? 1 : 0) - (a.e.field ? 1 : 0) || a.i - b.i;
    });
    return limit ? out.slice(0, limit) : out;
  }
  function ownText(el) {
    var t = el && el.textContent ? String(el.textContent) : '';
    return t.replace(/\s*\*\s*$/, '').trim();
  }
  /* 卡片（或详细窗口）里显示这个标签的字段行；找不到返回 null */
  function findField(root, label) {
    if (!root || !label || !root.querySelectorAll) return null;
    var sels = ['.lt', '.fk', '.pr-k', '.k-togl'];
    for (var s = 0; s < sels.length; s++) {
      var found = root.querySelectorAll(sels[s]);
      for (var i = 0; i < found.length; i++) {
        var el = found[i],
          text = sels[s] === '.pr-k' && el.children && el.children[0] ? ownText(el.children[0]) : ownText(el);
        if (text !== label) continue;
        var row = el.closest ? el.closest('.k-fld') || el.closest('.fld') || el.closest('.k-togrow') : null;
        return row || el;
      }
    }
    return null;
  }
  function findCard(e) {
    var cards = (UI.page && UI.page.cards) || [],
      i;
    if (e.cardId) for (i = 0; i < cards.length; i++) if (cards[i].spec && cards[i].spec.id === e.cardId) return i;
    for (i = 0; i < cards.length; i++) if (cards[i].spec && cards[i].spec.title === e.title) return i;
    if (e.cids.length)
      for (i = 0; i < cards.length; i++)
        if ((cards[i].comps || []).indexOf(e.cids[0]) >= 0 && cards[i].comps.length === e.cids.length) return i;
    return -1;
  }
  function scrollTo(host, el) {
    if (!host || !el || !el.getBoundingClientRect) return;
    var scale = typeof uiScaleFactor === 'function' ? uiScaleFactor() : 1;
    host.scrollTop = Math.max(
      0,
      host.scrollTop + (el.getBoundingClientRect().top - host.getBoundingClientRect().top) / scale - 24
    );
  }
  function flash(el) {
    if (!el || !el.classList) return;
    el.classList.add('m-attention');
    setTimeout(function () {
      el.classList.remove('m-attention');
    }, 1800);
  }
  /* 详细窗口：组件结构表单分段时，先选中字段所在的那一段 */
  function openDetailOf(card, e) {
    var cid = e.cids[0] || '';
    if (e.fieldKey && cid && typeof detailSections === 'function' && CIDX[cid]) {
      var sec = detailSections(cid).filter(function (s) {
        return !s.keys || s.keys.indexOf(e.fieldKey) >= 0;
      })[0];
      if (sec) {
        UI.detailCid = cid;
        UI.detailSel = sec.id;
      }
    }
    return !!card.onHead(null);
  }
  function reveal(e) {
    var d = Store.docs.length ? Store.doc() : null;
    if (!d) return false;
    var kind = kindOfItem(d.id),
      visible = tabsOfKind(kind).some(function (t) {
        return t.id === e.tab;
      });
    if (!visible) UI.uni[e.tab] = 1;
    if (UI.tab !== e.tab || !visible) {
      var body = $('edbody');
      if (body && UI.tab) UI.bodyScroll[UI.tab] = body.scrollTop;
      UI.tab = e.tab;
      UI.autoDefaultTab = null;
      drawTabbar();
      drawTabBody();
    }
    var at = findCard(e);
    if (at < 0) {
      toast(I18n.t('cadeditor.ui.fieldindex.not_on_page', e.path), 'info');
      return false;
    }
    var card = UI.page.cards[at],
      host = $('edbody');
    /* 详细卡片在独立窗口里编辑：字段去窗口里找（卡片本身只是入口） */
    if (e.field && card.el.classList.contains('det-card') && card.onHead) {
      if (!card.el.classList.contains('det-on')) {
        setTimeout(function () {
          scrollTo(host, card.el);
          flash(card.el);
        }, 30);
        toast(I18n.t('cadeditor.ui.fieldindex.enable_first', e.title), 'info');
        return true;
      }
      if (openDetailOf(card, e)) {
        var main = $('detailmain'),
          inWindow = findField(main, e.field);
        setTimeout(function () {
          scrollTo(main, inWindow);
          flash(inWindow);
        }, 30);
        return true;
      }
    }
    if (card.setCollapsed && !card.el.classList.contains('det-card')) card.setCollapsed(false);
    card = UI.page.cards[at] || card; // 懒加载卡片展开后换成了真卡片
    var target = e.field ? findField(card.el, e.field) : null;
    setTimeout(function () {
      scrollTo(host, target || card.el);
      flash(target || card.el);
    }, 30);
    return true;
  }
  return {
    declare: declare,
    declareAll: declareAll,
    build: build,
    search: search,
    rank: rank,
    reveal: reveal,
    findField: findField,
    reset: function () {
      cache = null;
    }
  };
})();
