/* 放置与数据：显式规则、扁平列表、原始数据先校验再写入草稿。 */
var WORLD_DETAIL = [
  'can_place_on',
  'can_break',
  'block_state',
  'block_entity_data',
  'entity_data',
  'bucket_entity_data',
  'custom_data',
  'lock',
  'container_loot',
  'bees',
  'pot_decorations',
  'profile',
  'charged_projectiles',
  'recipes',
  'map_decorations',
  'lodestone_tracker',
  'debug_stick_state'
];
HEAD_AUTO.map_color = 1;
AUTO_BODY.map_color = function (card, cid, v) {
  var color = typeof v === 'number' ? v : 0xffffff,
    chip = h('span', { class: 'world-color-chip', style: 'background:' + hex6(color) });
  var choose = kBtn(hex6(color), function () {
    kColorPop(
      choose,
      color,
      function (x) {
        color = x;
        autoPut(cid, x);
        chip.setAttribute('style', 'background:' + hex6(x));
        choose.querySelector('span').textContent = hex6(x);
      },
      { cls: 'world-color-pop', width: 240, maxHeight: 160 }
    );
  });
  headCtl(card, h('div', { class: 'world-inline' }, [chip, choose]));
};
var WORLD_SEC_ICON = I18n.keyed({
  'cadeditor.ui.world.data_fields': 'code',
  'cadeditor.ui.world.player_skin': 'user',
  'cadeditor.data.unlock_recipes': 'book',
  'cadeditor.ui.structure.entries': 'list'
});
function worldSection(title, action) {
  return xSec(WORLD_SEC_ICON[title] || 'list', title, '', action);
}
/* 折叠区：一行文字开关 + 一句说明，不用按钮外观 */
function worldFold(title, content, opened, hint) {
  var box = h('div', { class: 'world-fold' }),
    body = h('div', { class: 'world-fold-body' }),
    on = !!opened;
  var chev = h('span', { class: 'wf-chev' }),
    head = h('div', { class: 'world-more', role: 'button' }, [
      chev,
      h('span', { class: 'wf-t', text: title }),
      hint ? h('span', { class: 'wf-hint', text: hint }) : null
    ]);
  activate(head, function () {
    on = !on;
    paint(true);
  });
  function paint(animate) {
    head.setAttribute('aria-expanded', String(on));
    chev.textContent = on ? '⌄' : '›';
    if (!animate) {
      body.style.display = on ? '' : 'none';
      return;
    }
    if (on) {
      body.style.display = '';
      uiSlide(body, true);
    } else
      uiSlide(body, false, function () {
        body.style.display = 'none';
      });
  }
  body.appendChild(content);
  box.appendChild(head);
  box.appendChild(body);
  paint(false);
  return box;
}
function worldError() {
  return h('div', { class: 'world-error', role: 'status' });
}
/* SNBT 文本框（写入前先解析 / 校验，错了不写，有「撤回输入」和「写入草稿」）。要让用户直接改一段 NBT / SNBT 时用它，不要再手搭 textarea。
   value 当前值，set(新值) 写入，validate?(新值) 不合格就 throw */
function kSnbtEditor(value, set, validate) {
  var box = h('div', { class: 'world-raw' }),
    msg = worldError(),
    saved = toSnbt(value === undefined ? {} : value, null, true);
  var code = kCode({
    value: saved,
    height: 220,
    validate: function (t) {
      parseSnbtUser(t);
    },
    onInput: function () {
      msg.textContent = I18n.t('cadeditor.ui.world.written_draft');
    }
  });
  var save = kBtn(
    I18n.t('cadeditor.ui.world.write_draft'),
    function () {
      try {
        var next = parseSnbtUser(code.get());
        if (validate) validate(next);
        set(next);
        saved = code.get();
        msg.textContent = I18n.t('cadeditor.ui.world.written_draft_2');
      } catch (e) {
        msg.textContent = I18n.t('cadeditor.ui.world.written', e.message || e);
      }
    },
    { cls: 'pri' }
  );
  box.appendChild(code.el);
  box.appendChild(
    h('div', { class: 'world-actions' }, [
      msg,
      kBtn(I18n.t('cadeditor.ui.world.revert_input'), function () {
        code.set(saved, true);
        msg.textContent = '';
      }),
      save
    ])
  );
  return box;
}
/* 实体“常用字段”：来自游戏里新建的临时实体的默认 NBT（entity_info.default_nbt），不是手写清单 */
function suggestEntityFields(typeId, have, onPick, anchor) {
  if (!typeId) {
    toast(I18n.t('cadeditor.ui.world.choose_entity_type_first'), 'warn');
    return;
  }
  var info = Reg.entityInfo(typeId);
  if (info === null) {
    toast(I18n.t('cadeditor.ui.world.reading_entity_default_data_order'));
    return;
  }
  if (!info || !info.template_available || !info.default_nbt) {
    toast(I18n.t('cadeditor.ui.world.default_data_entity_cannot_read'), 'warn');
    return;
  }
  var nbt;
  try {
    nbt = parseSnbt(info.default_nbt);
  } catch (e) {
    toast(I18n.t('cadeditor.ui.world.default_data_cannot_parsed_add'), 'warn');
    return;
  }
  var entries = Object.keys(nbt)
    .filter(function (k) {
      return k !== 'id' && !have(k);
    })
    .map(function (k) {
      return { v: k, label: k, sub: toSnbt(nbt[k], null, false) };
    });
  if (!entries.length) {
    toast(I18n.t('cadeditor.ui.world.field_data_added_default'));
    return;
  }
  pickFrom(
    anchor,
    entries,
    function (e) {
      onPick(e.v, nbtTake(nbt, e.v));
    },
    { width: 260 }
  );
}
function worldCompound(v) {
  if (!isObj(v) || Array.isArray(v)) throw new Error(I18n.t('cadeditor.ui.world.needs_compound_data_key_value'));
}
function worldMap(value, set, strings, ph) {
  ph = ph || {};
  var obj = clone(isObj(value) ? value : {}),
    box = h('div', { class: 'world-map' }),
    add = h('div', { class: 'world-new' }),
    msg = worldError();
  function put() {
    set(clone(obj));
  }
  var TYPE = {
    string: ['edit', I18n.t('cadeditor.ui.code.text')],
    number: ['sliders', I18n.t('cadeditor.ui.cards4.number_2')],
    boolean: ['check', I18n.t('cadeditor.ui.cards4.toggle')]
  };
  var xl = xList({
    items: function () {
      return Object.keys(obj);
    },
    empty: '',
    row: function (key) {
      var val = obj[key],
        prim = typeof val === 'string' || typeof val === 'boolean' || typeof val === 'number';
      var t =
        TYPE[typeof val] ||
        (Array.isArray(val)
          ? ['list', I18n.t('cadeditor.ui.forms.list')]
          : ['folder', I18n.t('cadeditor.ui.world.compound_data')]);
      var rm = kBtn(
        '',
        function () {
          delete obj[key];
          put();
          xl.draw();
        },
        { icon: 'trash', title: I18n.t('cadeditor.ui.world.delete_field') }
      );
      if (prim) {
        var ctl,
          update = function (x) {
            nbtPut(obj, key, x);
            put();
          };
        if (typeof val === 'boolean') ctl = kToggle(val, update, '').el;
        else if (typeof val === 'number')
          ctl = numField5(
            val,
            0,
            { min: -9007199254740991, max: 9007199254740991, step: Number.isInteger(val) ? 1 : 0.1 },
            update
          );
        else {
          ctl = kInput(val, update, { placeholder: ph.val || I18n.t('cadeditor.ui.rules.property_value') });
          ctl.classList.add('world-inline-value');
        }
        ctl.setAttribute('aria-label', I18n.t('cadeditor.ui.world.value', key));
        return { icon: uiIcon(t[0], 14), title: key, sub: t[1], right: h('div', { class: 'x-rt' }, [ctl, rm]) };
      }
      var text = toSnbt(val, null, false);
      return {
        icon: uiIcon(t[0], 14),
        title: key,
        sub: text,
        tip: text,
        body: function () {
          return [
            kSnbtEditor(nbtTake(obj, key), function (x) {
              nbtPut(obj, key, x);
              put();
            }),
            xFoot('', function () {
              delete obj[key];
              put();
              xl.draw();
            })
          ];
        }
      };
    }
  });
  var key = kInput('', function () {}, {
      placeholder:
        ph.key || (strings ? I18n.t('cadeditor.ui.rules.property_name') : I18n.t('cadeditor.ui.world.field_name'))
    }),
    val = kInput('', function () {}, {
      placeholder:
        ph.val || (strings ? I18n.t('cadeditor.ui.rules.property_value') : I18n.t('cadeditor.ui.world.value_snbt'))
    });
  add.appendChild(key);
  add.appendChild(val);
  add.appendChild(
    kBtn(I18n.t('cadeditor.ui.cards3.add'), function () {
      try {
        var name = key.value.trim();
        if (!name) throw new Error(I18n.t('cadeditor.ui.world.enter_field_name'));
        if (Object.prototype.hasOwnProperty.call(obj, name))
          throw new Error(I18n.t('cadeditor.ui.world.field_name_already_exists'));
        var next = strings ? val.value : parseSnbtUser(val.value),
          candidate = clone(obj);
        nbtPut(candidate, name, next);
        set(candidate);
        obj = candidate;
        xl.draw();
        key.value = '';
        val.value = '';
        msg.textContent = '';
      } catch (e) {
        msg.textContent = e.message || String(e);
      }
    })
  );
  box.addField = function (name, next) {
    if (Object.prototype.hasOwnProperty.call(obj, name)) return false;
    var candidate = clone(obj);
    nbtPut(candidate, name, next);
    set(candidate);
    obj = candidate;
    xl.draw();
    return true;
  };
  box.appendChild(xl.el);
  box.appendChild(add);
  box.appendChild(msg);
  return box;
}

/* 对象列表：行结构同「其它属性加成」。ops: add/remove/changed/summary，可选 title(it,i) 与 icon(it,i) */
function list5(host, items, rowFn, ops, label, empty) {
  var xl = xList({
    items: items,
    empty: empty || I18n.t('cadeditor.ui.world.entries'),
    add: {
      text: label || I18n.t('cadeditor.ui.cards3.add'),
      fn: function () {
        var n = items().length;
        ops.add();
        xl.select(items().length > n ? n : -1);
      }
    },
    row: function (it, i) {
      return {
        icon: ops.icon ? ops.icon(it, i) : uiIcon('list', 14),
        title: ops.title ? ops.title(it, i) : I18n.t('cadeditor.ui.world.item', i + 1),
        sub: ops.summary ? ops.summary(it, i) : '',
        body: function () {
          var body = h('div', { class: 'x-b' });
          rowFn(body, it, i, function () {
            ops.changed();
          });
          return [
            body,
            xFoot('', function () {
              ops.remove(i);
              xl.select(-1);
            })
          ];
        }
      };
    }
  });
  host.appendChild(xl.el);
}

function worldBlockPicker(current, set, title) {
  openTagPicker({
    title: title || I18n.t('cadeditor.ui.world.choose_target_block'),
    tagsReg: 'block',
    entryReg: 'block',
    multi: true,
    selected: (current === undefined ? [] : Array.isArray(current) ? current : [current]).map(pickerId),
    entryIcon: function (e) {
      return refIcon('block', e.v);
    },
    onConfirm: function (ids) {
      var tags = ids.filter(function (x) {
          return x.charAt(0) === '#';
        }),
        entries = ids.filter(function (x) {
          return x.charAt(0) !== '#';
        });
      if (tags.length && (tags.length > 1 || entries.length)) {
        toast(I18n.t('cadeditor.ui.world.one_rule_only_use_one'), 'warn');
        return;
      }
      set(tags.length ? tags[0] : entries.length === 1 ? entries[0] : entries);
    }
  });
}
function worldBlockName(blocks) {
  if (blocks === undefined) return I18n.t('cadeditor.ui.rules.any_block');
  if (Array.isArray(blocks))
    return blocks
      .map(function (id) {
        return worldBlockName(id);
      })
      .join('、');
  if (blocks.charAt(0) === '#') return blocks;
  var nm = Reg.nameOf2('block', blocks);
  return nm || blocks;
}
/* 一项条件：标题 + 一句人话说明 + 控件 */
function worldCond(title, hint, action, content) {
  return h('div', { class: 'world-cond' }, [
    h('div', { class: 'world-cond-h' }, [h('b', { text: title }), h('div', { class: 'grow' }), action || null]),
    hint ? h('div', { class: 'world-hint', text: hint }) : null,
    content
  ]);
}

['block_entity_data', 'entity_data', 'bucket_entity_data', 'custom_data'].forEach(function (cid) {
  AUTO_BODY[cid] = function (card, id, v) {
    var obj = clone(isObj(v) ? v : {}),
      typed = cid === 'block_entity_data' || cid === 'entity_data';
    var DATA_NOTE = {
      block_entity_data: I18n.t('cadeditor.ui.world.item_down_block_block_internal'),
      entity_data: I18n.t('cadeditor.ui.world.using_item_generate_entity_entity'),
      bucket_entity_data: I18n.t('cadeditor.ui.world.let_out_bucket_mob_i'),
      custom_data: I18n.t('cadeditor.ui.world.custom_data_saved_item_game')
    };
    card.body.appendChild(h('div', { class: 'world-note', text: DATA_NOTE[cid] }));
    function put() {
      autoPut(id, clone(obj));
    }
    if (typed)
      card.body.appendChild(
        fieldRow(
          I18n.t('cadeditor.ui.labels.type'),
          kRegSelect({
            reg: cid === 'entity_data' ? 'entity_type' : 'block_entity_type',
            value: obj.id || '',
            title: I18n.t('cadeditor.ui.world.choose_type'),
            entityText: function () {
              return nbtMerge(obj, null);
            },
            onChange: function (x) {
              obj.id = x;
              put();
            },
            onEntityNbt:
              cid === 'entity_data'
                ? function (snbt) {
                    obj = vaultEntityObj(snbt);
                    Store.set(id, obj, { label: I18n.t('cadeditor.ui.spawn.entity_data'), structural: false });
                    clear(card.body);
                    AUTO_BODY[cid](card, id, obj);
                  }
                : null
          }).el
        )
      );
    var extra = clone(obj);
    if (typed) delete extra.id;
    var mapEl = worldMap(
      extra,
      function (x) {
        if (typed && Object.prototype.hasOwnProperty.call(x, 'id'))
          throw new Error(I18n.t('cadeditor.ui.world.type_modified_top_selection'));
        var type = obj.id;
        obj = x;
        if (typed) obj.id = type;
        put();
      },
      false
    );
    var sug =
      cid === 'entity_data'
        ? kBtn(
            I18n.t('cadeditor.ui.spawn.common_fields'),
            function () {
              suggestEntityFields(
                obj.id,
                function (k) {
                  return Object.prototype.hasOwnProperty.call(obj, k);
                },
                function (k, val) {
                  try {
                    mapEl.addField(k, val);
                  } catch (e) {
                    toast(e.message || String(e), 'warn');
                  }
                },
                sug
              );
            },
            { title: I18n.t('cadeditor.ui.world.pick_field_default_data_entity') }
          )
        : null;
    card.body.appendChild(worldSection(I18n.t('cadeditor.ui.world.data_fields'), sug));
    card.body.appendChild(mapEl);
    card.body.appendChild(Valid.badge(id));
  };
});
AUTO_BODY.lock = function (card, cid, v) {
  card.body.appendChild(Valid.badge(cid));
  card.body.appendChild(h('div', { class: 'world-note', text: I18n.t('cadeditor.ui.world.key_matching_condition') }));
  var obj = clone(isObj(v) ? v : {});
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.world.key_item'),
      wHolderSet('item', obj.items === undefined ? [] : obj.items, function (x) {
        if (Array.isArray(x) && !x.length) delete obj.items;
        else obj.items = x;
        autoPut(cid, obj);
      })
    )
  );
  var rest = clone(obj);
  delete rest.items;
  card.body.appendChild(
    worldFold(
      I18n.t('cadeditor.ui.world.other_conditions'),
      kSnbtEditor(rest, function (x) {
        worldCompound(x);
        if (x.items !== undefined) throw new Error(I18n.t('cadeditor.ui.world.choose_key_item_above'));
        var items = obj.items;
        obj = x;
        if (items !== undefined) obj.items = items;
        autoPut(cid, obj);
      }),
      Object.keys(rest).length > 0
    )
  );
};
AUTO_BODY.container_loot = function (card, cid, v) {
  var obj = clone(isObj(v) ? v : {});
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.spawn.loot_table'),
      kRegSelect({
        reg: 'loot_table',
        value: obj.loot_table || '',
        title: I18n.t('cadeditor.ui.spawn.choose_loot_table'),
        onChange: function (x) {
          obj.loot_table = x;
          autoPut(cid, obj);
        }
      }).el
    )
  );
  var msg = worldError(),
    seed = kInput(
      obj.seed === undefined ? '0' : String(obj.seed),
      function (x) {
        if (!/^-?\d+$/.test(x)) {
          msg.textContent = I18n.t('cadeditor.ui.world.enter_integer_seed');
          return;
        }
        var next = Number(x);
        if (!Number.isSafeInteger(next)) {
          msg.textContent = I18n.t('cadeditor.ui.world.seed_beyond_precise_integer_range');
          return;
        }
        obj.seed = next;
        autoPut(cid, obj);
        msg.textContent = '';
      },
      { placeholder: I18n.t('cadeditor.ui.world.n0_means_random') }
    );
  card.body.appendChild(fieldRow(I18n.t('cadeditor.ui.world.random_seed'), seed));
  card.body.appendChild(
    h('div', { class: 'world-note', text: I18n.t('cadeditor.ui.world.n0_means_every_random_generation') })
  );
  card.body.appendChild(msg);
};
AUTO_BODY.pot_decorations = function (card, cid, v) {
  var arr = clone(Array.isArray(v) ? v : []);
  /* Codec 的四个位置顺序固定；这是位置标签，不是可选数据清单。 */
  [
    I18n.t('cadeditor.ui.world.back'),
    I18n.t('cadeditor.ui.world.left'),
    I18n.t('cadeditor.ui.world.right'),
    I18n.t('cadeditor.ui.picker.positive')
  ].forEach(function (label, i) {
    card.body.appendChild(
      fieldRow(
        label,
        kRegSelect({
          reg: 'item',
          value: arr[i] || '',
          empty: I18n.t('cadeditor.ui.world.brick_default'),
          title: I18n.t('cadeditor.ui.world.select_decoration', label),
          onChange: function (x) {
            while (arr.length <= i) arr.push('minecraft:brick');
            arr[i] = x;
            autoPut(cid, arr);
          }
        }).el
      )
    );
  });
};
AUTO_BODY.recipes = function (card, cid, v) {
  var arr = clone(Array.isArray(v) ? v : []);
  var xl = xList({
    items: function () {
      return arr;
    },
    empty: I18n.t('cadeditor.ui.world.additional_unlocked_recipes'),
    add: {
      text: I18n.t('cadeditor.ui.world.add_recipe'),
      fn: function () {
        openRegPick({
          reg: 'recipe',
          title: I18n.t('cadeditor.ui.world.choose_recipe'),
          onPick: function (id) {
            if (arr.indexOf(id) < 0) {
              arr.push(id);
              autoPut(cid, arr);
              xl.draw();
            }
          }
        });
      }
    },
    row: function (id, i) {
      return {
        icon: uiIcon('book', 14),
        title: Reg.nameOf2('recipe', id) || id,
        sub: id,
        tip: id,
        right: kBtn(
          '',
          function () {
            arr.splice(i, 1);
            autoPut(cid, arr);
            xl.draw();
          },
          { icon: 'trash', title: I18n.t('cadeditor.ui.cards1.remove') }
        )
      };
    }
  });
  card.body.appendChild(kHint(I18n.t('cadeditor.ui.world.using_item_player_extra_unlocked'), 'note'));
  card.body.appendChild(xl.el);
};
AUTO_BODY.charged_projectiles = function (card, cid, v) {
  var arr = clone(Array.isArray(v) ? v : []);
  card.body.appendChild(Valid.badge(cid));
  list5(
    card.body,
    function () {
      return arr;
    },
    function (body, it, i, ch) {
      body.appendChild(
        fieldRow(
          I18n.t('cadeditor.ui.world.ammunition'),
          kRegSelect({
            reg: 'item',
            value: it.id || '',
            title: I18n.t('cadeditor.ui.world.choose_ammunition'),
            onChange: function (x) {
              it.id = x;
              ch();
            }
          }).el
        )
      );
      if (it.id)
        body.appendChild(
          kBtn(
            I18n.t('cadeditor.ui.cards3.edit_item'),
            function () {
              editNestedStack(
                it,
                I18n.t('cadeditor.ui.world.loaded_ammunition'),
                function (next) {
                  arr[i] = next;
                  NBT_FORCE.charged_projectiles = true;
                  autoPut(cid, arr);
                },
                drawDetail
              );
            },
            { icon: 'edit' }
          )
        );
      body.appendChild(
        fieldRow(
          I18n.t('cadeditor.ui.pages.count'),
          numField5(it.count, 1, { min: 1, max: 99, unit: I18n.t('cadeditor.ui.cards3.items') }, function (n) {
            it.count = n;
            ch();
          })
        )
      );
      var rest = clone(it);
      delete rest.id;
      delete rest.count;
      body.appendChild(
        worldFold(
          I18n.t('cadeditor.ui.world.ammunition_data'),
          kSnbtEditor(rest, function (x) {
            worldCompound(x);
            if (x.id !== undefined || x.count !== undefined)
              throw new Error(I18n.t('cadeditor.ui.world.item_count_change_above'));
            var id = it.id,
              n = it.count;
            Object.keys(it).forEach(function (k) {
              delete it[k];
            });
            Object.keys(x).forEach(function (k) {
              nbtPut(it, k, nbtTake(x, k));
            });
            it.id = id;
            it.count = n;
            ch();
          }),
          false
        )
      );
    },
    {
      add: function () {
        openRegPick({
          reg: 'item',
          title: I18n.t('cadeditor.ui.world.add_ammunition'),
          onPick: function (id) {
            arr.push({ id: id, count: 1 });
            autoPut(cid, arr);
            drawDetail();
          }
        });
      },
      remove: function (i) {
        arr.splice(i, 1);
        autoPut(cid, arr);
      },
      changed: function () {
        autoPut(cid, arr);
      },
      title: function (it) {
        return nameOfItem(it.id);
      },
      icon: function (it) {
        return itemIcon(it.id, 16);
      },
      summary: function (it) {
        return '× ' + (it.count || 1);
      }
    },
    I18n.t('cadeditor.ui.world.add_ammunition'),
    I18n.t('cadeditor.ui.world.ammunition_loaded')
  );
  card.body.appendChild(
    h('div', { class: 'k-row' }, [
      kBtn(
        I18n.t('cadeditor.ui.world.get_item_vault'),
        function () {
          openVault({
            pick: function (stack) {
              arr.push(vaultNested(stack));
              NBT_FORCE.charged_projectiles = true;
              autoPut(cid, arr);
              drawDetail();
            }
          });
        },
        { icon: 'chest', title: I18n.t('cadeditor.ui.world.take_all_custom_component_put') }
      )
    ])
  );
};

AUTO_BODY.bees = function (card, cid, v) {
  var arr = clone(Array.isArray(v) ? v : []);
  list5(
    card.body,
    function () {
      return arr;
    },
    function (body, it, i, ch) {
      body.appendChild(
        esEntityHeader({
          id: (it.entity_data && it.entity_data.id) || 'minecraft:bee',
          snbtText: function () {
            return nbtMerge(it.entity_data || { id: 'minecraft:bee' }, null);
          },
          onPick: function (id) {
            it.entity_data = clone(it.entity_data || {});
            it.entity_data.id = id;
            ch();
            drawDetail();
          },
          onEntityNbt: function (snbt) {
            it.entity_data = vaultEntityObj(snbt);
            NBT_FORCE.bees = true;
            ch();
            drawDetail();
          }
        })
      );
      body.appendChild(
        fieldRow(
          I18n.t('cadeditor.ui.world.time_hive'),
          numField5(it.ticks_in_hive, 0, { min: 0, step: 20, unit: I18n.t('cadeditor.ui.cards2.ticks') }, function (n) {
            it.ticks_in_hive = n;
            ch();
          })
        )
      );
      body.appendChild(
        fieldRow(
          I18n.t('cadeditor.ui.world.min_time_hive'),
          numField5(
            it.min_ticks_in_hive,
            600,
            { min: 0, step: 20, unit: I18n.t('cadeditor.ui.cards2.ticks') },
            function (n) {
              it.min_ticks_in_hive = n;
              ch();
            }
          )
        )
      );
      body.appendChild(
        h('div', { class: 'world-note', text: I18n.t('cadeditor.ui.world.n20_1_seconds_allowed_leave') })
      );
      body.appendChild(
        worldFold(
          I18n.t('cadeditor.ui.world.bee_entity_data'),
          kSnbtEditor(it.entity_data || {}, function (x) {
            worldCompound(x);
            if (!x.id) throw new Error(I18n.t('cadeditor.ui.world.entity_data_requires_id'));
            it.entity_data = x;
            ch();
          }),
          false
        )
      );
    },
    {
      add: function () {
        arr.push({ entity_data: { id: 'minecraft:bee' }, ticks_in_hive: 0, min_ticks_in_hive: 600 });
        autoPut(cid, arr);
      },
      remove: function (i) {
        arr.splice(i, 1);
        autoPut(cid, arr);
      },
      changed: function () {
        autoPut(cid, arr);
      },
      title: function (it, i) {
        return I18n.t('cadeditor.ui.world.bee', i + 1);
      },
      icon: function () {
        return uiIcon('flower', 14);
      },
      summary: function (it) {
        return I18n.t(
          'cadeditor.ui.world.s_required_s',
          fmtNum((it.ticks_in_hive || 0) / 20),
          fmtNum((it.min_ticks_in_hive || 0) / 20)
        );
      }
    },
    I18n.t('cadeditor.ui.world.add_bee'),
    I18n.t('cadeditor.ui.world.bees_hive')
  );
};
AUTO_BODY.profile = function (card, cid, v) {
  var obj = clone(typeof v === 'string' ? { name: v } : isObj(v) ? v : {});
  function put() {
    autoPut(cid, Object.keys(obj).length === 1 && obj.name !== undefined ? obj.name : clone(obj));
  }
  function input(key, ph) {
    return kInput(
      obj[key] || '',
      function (x) {
        if (x) obj[key] = x;
        else delete obj[key];
        put();
      },
      { placeholder: ph || I18n.t('cadeditor.ui.world.optional') }
    );
  }
  card.body.appendChild(worldSection(I18n.t('cadeditor.ui.world.player_skin')));
  card.body.appendChild(
    fieldRow(I18n.t('cadeditor.ui.screens.player_name'), input('name', I18n.t('cadeditor.ui.world.enter_player_name')))
  );
  card.body.appendChild(
    h('div', { class: 'world-note', text: I18n.t('cadeditor.ui.world.game_network_gets_skin_player') })
  );
  var resources = h('div');
  /* 贴图 ID 写入值是去掉 textures/ 和 .png 的 ns:path；游戏资源包里有的列出来选，也能手输 */
  function res(key, reg) {
    return Reg.live()
      ? kRegSelect({
          reg: reg,
          value: obj[key] || '',
          title: I18n.t('cadeditor.ui.world.choose_texture'),
          empty: I18n.t('cadeditor.ui.spawn.specified'),
          allowClear: true,
          onChange: function (x) {
            if (x) obj[key] = x;
            else delete obj[key];
            put();
          }
        }).el
      : input(key, I18n.t('cadeditor.ui.world.id_example_minecraft_entity_player'));
  }
  [
    ['texture', I18n.t('cadeditor.ui.world.skin_texture'), 'profile_texture'],
    ['cape', I18n.t('cadeditor.ui.world.cape'), 'profile_cape'],
    ['elytra', I18n.t('cadeditor.ui.cards2.elytra'), 'profile_elytra']
  ].forEach(function (f) {
    resources.appendChild(fieldRow(f[1], res(f[0], f[2])));
  });
  resources.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.world.arm_model'),
      kInput(
        obj.model || '',
        function (x) {
          if (x) obj.model = x;
          else delete obj.model;
          put();
        },
        { placeholder: I18n.t('cadeditor.ui.world.model_name_resource_definition') }
      )
    )
  );
  card.body.appendChild(
    worldFold(
      I18n.t('cadeditor.ui.world.resource_pack_skin_override'),
      resources,
      !!(obj.texture || obj.cape || obj.elytra)
    )
  );
  var advanced = {};
  Object.keys(obj).forEach(function (k) {
    if (['name', 'texture', 'cape', 'elytra', 'model'].indexOf(k) < 0) nbtPut(advanced, k, nbtTake(obj, k));
  });
  card.body.appendChild(
    worldFold(
      I18n.t('cadeditor.ui.world.uuid_signed_properties'),
      kSnbtEditor(advanced, function (x) {
        worldCompound(x);
        Object.keys(x).forEach(function (k) {
          if (['name', 'texture', 'cape', 'elytra', 'model'].indexOf(k) >= 0)
            throw new Error(I18n.t('cadeditor.ui.world.modify_relation_field', k));
        });
        Object.keys(advanced).forEach(function (k) {
          delete obj[k];
        });
        Object.keys(x).forEach(function (k) {
          nbtPut(obj, k, nbtTake(x, k));
        });
        advanced = clone(x);
        put();
      }),
      false
    )
  );
};
AUTO_BODY.map_decorations = function (card, cid, v) {
  var obj = clone(isObj(v) ? v : {}),
    arr = Object.keys(obj).map(function (k) {
      return { key: k, val: obj[k] };
    });
  function put() {
    var out = {};
    arr.forEach(function (e) {
      out[e.key] = e.val;
    });
    autoPut(cid, out);
  }
  list5(
    card.body,
    function () {
      return arr;
    },
    function (body, e, i, ch) {
      var err = worldError();
      body.appendChild(
        fieldRow(
          I18n.t('cadeditor.ui.world.marker_name'),
          kInput(
            e.key,
            function (x) {
              var k = x.trim();
              if (
                !k ||
                arr.some(function (a, j) {
                  return j !== i && a.key === k;
                })
              ) {
                err.textContent = I18n.t('cadeditor.ui.world.name_cannot_empty_nor_repeated');
                return;
              }
              e.key = k;
              err.textContent = '';
              ch();
            },
            { placeholder: I18n.t('cadeditor.ui.world.unique_name') }
          )
        )
      );
      body.appendChild(err);
      body.appendChild(
        fieldRow(
          I18n.t('cadeditor.ui.world.marker_icon'),
          kRegSelect({
            reg: 'map_decoration_type',
            value: e.val.type || '',
            title: I18n.t('cadeditor.ui.world.choose_marker_icon'),
            onChange: function (x) {
              e.val.type = x;
              ch();
            }
          }).el
        )
      );
      ['x', 'z'].forEach(function (k) {
        body.appendChild(
          fieldRow(
            I18n.t('cadeditor.ui.world.world', k.toUpperCase()),
            numField5(e.val[k], 0, { step: 1 }, function (n) {
              e.val[k] = n;
              ch();
            })
          )
        );
      });
      body.appendChild(
        fieldRow(
          I18n.t('cadeditor.ui.world.rotation'),
          numField5(e.val.rotation, 0, { step: 15, unit: I18n.t('cadeditor.ui.specs.degrees') }, function (n) {
            e.val.rotation = n;
            ch();
          })
        )
      );
    },
    {
      add: function () {
        var n = 1;
        while (
          arr.some(function (e) {
            return e.key === 'mark' + n;
          })
        )
          n++;
        openRegPick({
          reg: 'map_decoration_type',
          title: I18n.t('cadeditor.ui.world.choose_icon_new_marker'),
          onPick: function (id) {
            arr.push({ key: 'mark' + n, val: { type: id, x: 0, z: 0, rotation: 0 } });
            put();
            drawDetail();
          }
        });
      },
      remove: function (i) {
        arr.splice(i, 1);
        put();
      },
      changed: put,
      title: function (e) {
        return e.key;
      },
      icon: function () {
        return uiIcon('map', 14);
      },
      summary: function (e) {
        return 'X ' + fmtNum(e.val.x || 0) + ' / Z ' + fmtNum(e.val.z || 0);
      }
    },
    I18n.t('cadeditor.ui.world.add_marker'),
    I18n.t('cadeditor.ui.world.additional_map_markers')
  );
};
AUTO_BODY.lodestone_tracker = function (card, cid, v) {
  var obj = clone(isObj(v) ? v : {}),
    target = clone(obj.target || { pos: [0, 64, 0] }),
    box = h('div');
  function put() {
    autoPut(cid, clone(obj));
  }
  card.body.appendChild(
    fieldRow(
      I18n.t('cadeditor.ui.world.fixed_target'),
      kToggle(
        !!obj.target,
        function (on) {
          if (on) obj.target = clone(target);
          else delete obj.target;
          put();
          draw();
        },
        ''
      ).el
    )
  );
  card.body.appendChild(box);
  function draw() {
    clear(box);
    if (!obj.target) {
      box.appendChild(h('div', { class: 'world-note', text: I18n.t('cadeditor.ui.world.lodestone_target_specified') }));
      return;
    }
    var t = obj.target;
    if (!Array.isArray(t.pos)) t.pos = [0, 64, 0];
    box.appendChild(
      fieldRow(
        I18n.t('cadeditor.ui.world.dimension'),
        kRegSelect({
          reg: 'dimension',
          value: t.dimension || '',
          title: I18n.t('cadeditor.ui.world.choose_target_dimension'),
          empty: I18n.t('cadeditor.ui.world.choose_dimension'),
          onChange: function (x) {
            t.dimension = x;
            target = clone(t);
            put();
          }
        }).el
      )
    );
    ['X', 'Y', 'Z'].forEach(function (ax, i) {
      box.appendChild(
        fieldRow(
          I18n.t('cadeditor.ui.world.coordinate', ax),
          numField5(t.pos[i], 0, { step: 1 }, function (n) {
            t.pos[i] = Math.round(n);
            target = clone(t);
            put();
          })
        )
      );
    });
    box.appendChild(
      fieldRow(
        I18n.t('cadeditor.ui.world.track_lodestone'),
        kToggle(
          obj.tracked !== false,
          function (on) {
            obj.tracked = on;
            put();
          },
          ''
        ).el
      )
    );
    box.appendChild(
      h('div', { class: 'world-note', text: I18n.t('cadeditor.ui.world.lodestone_removed_compass_disabled_start') })
    );
  }
  draw();
};
