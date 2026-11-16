/* 刷怪蛋 / 刷怪笼 / 试炼刷怪笼。
   数据全部来自游戏：entity_info（属性）、entity_schema（变种、常用开关、装备，见 eschema.js）、item_meta（默认实体、方块实体类型）、spawner_info（字段与默认值）。
   刷怪笼写在 block_entity_data 里（id = 方块实体类型，不是物品 ID）；数值范围对应游戏的 SpawnerData 校验，
   最终以 apply 时宿主的整栈校验为准。 */

function spNum(v) {
  return fmtNum(+(+v).toFixed(3));
}

/* The bucket tag has a limited loader. A matching entity_data component is
   loaded separately by EntityType before that loader, without changing species. */
function bucketMeta(d) {
  return Reg.itemMeta((d || Store.doc()).id) || {};
}
function bucketData(d) {
  var v = effectiveGet(d || Store.doc(), 'bucket_entity_data');
  return isObj(v) ? clone(v) : {};
}
function bucketFullEntity(d) {
  var v = effectiveGet(d || Store.doc(), 'entity_data');
  return isObj(v) ? clone(v) : {};
}
function bucketEntityMatches(meta, data) {
  return data.id === undefined || (typeof data.id === 'string' && Reg.full(data.id) === meta.bucket_entity);
}
function bucketHealthAttribute(meta) {
  var schema = meta.bucket_entity ? Reg.entitySchema(meta.bucket_entity) : null;
  return (
    schema &&
    schema.available &&
    (schema.attributes || []).filter(function (a) {
      return a.id === 'minecraft:max_health';
    })[0]
  );
}
function bucketHealthPlan(meta, requested) {
  // Sulfur growth can reset attributes after entity_data has loaded.
  if (meta.bucket_health_dynamic || requested < 0) return null;
  var attr = bucketHealthAttribute(meta),
    data = bucketFullEntity();
  if (!attr || !bucketEntityMatches(meta, data)) return null;
  var row =
    (data.attributes || []).filter(function (a) {
      return Reg.full(a.id) === attr.id;
    })[0] || {};
  var plan = linkedAttributePlan(attr, Object.assign({}, row, { base: esAttrBase(data, attr) }), requested);
  if (!plan.changed) return null;
  data.id = meta.bucket_entity;
  esAttrSet(data, attr, plan.base);
  return { data: data, before: plan.before, after: plan.effective };
}
function bucketWriteEntity(data) {
  var meta = bucketMeta(),
    before = bucketHealthRange(meta),
    after = bucketHealthRange(meta, data),
    values = { entity_data: data },
    bucket = bucketData();
  if (
    before &&
    after &&
    after.max < before.max &&
    bucket.Health !== undefined &&
    nbtNumberValue(bucket.Health) > after.max
  ) {
    nbtSetTyped(bucket, 'Health', after.max, 'f');
    values.bucket_entity_data = bucket;
  }
  Store.setLinked(values, I18n.t('cadeditor.ui.spawn.bucket_entity_attributes'));
}
function bucketPreview(d, old) {
  var meta = bucketMeta(d),
    data = bucketData(d),
    complete = bucketFullEntity(d),
    preview = bucketEntityMatches(meta, complete) ? complete : {},
    ageKey = meta.bucket_age_key;
  // Only the verified bucket age is a preview input. Full-entity equipment/Age
  // in an opaque bucket tag must not look effective when its loader ignores it.
  if (ageKey && data[ageKey] !== undefined) preview.Age = nbtNumberValue(data[ageKey]);
  var entity = heroEntity(meta.bucket_entity, preview, old),
    comps = effectiveView(d),
    parts = [];
  (meta.bucket_components || []).forEach(function (id) {
    var key = shortId(id);
    if (comps[key] !== undefined) parts.push(snbtKey(id) + ':' + toSnbt(comps[key], null, false));
  });
  if (parts.length) entity.setAttribute('components', '{' + parts.join(',') + '}');
  /* 桶的外观由物品组件决定，按实体数据做的悬停预览会把它盖掉：桶里的生物不参与悬停预览 */
  entity._esPeek = null;
  return entity;
}
CARDS.bucketEntity = function () {
  var card = eggCard(
      'bucketEntity',
      'paw',
      I18n.t('cadeditor.ui.pages.bucket_entity'),
      I18n.t('cadeditor.ui.spawn.type_determined_barrel_data_custom'),
      ['bucket_entity_data']
    ),
    meta = bucketMeta();
  if (meta.bucket_entity)
    card.body.appendChild(
      h('div', { class: 'egg-who' }, [
        h('span', { text: entityName(meta.bucket_entity), title: meta.bucket_entity }),
        h('span', { class: 'k-sub', text: meta.bucket_entity })
      ])
    );
  else
    card.body.appendChild(
      kHint(
        meta.bucket_metadata_error
          ? I18n.t('cadeditor.ui.spawn.could_load_bucket_information')
          : I18n.t('cadeditor.ui.spawn.loading_bucket_entity'),
        'note'
      )
    );
  if (!meta.bucket_fields_verified)
    card.body.appendChild(kHint(I18n.t('cadeditor.ui.spawn.special_field_confirmed_edits_original'), 'note'));
  return card;
};
function bucketHealthRange(meta, entityData) {
  var schema = meta.bucket_entity ? Reg.entitySchema(meta.bucket_entity) : null,
    health = null;
  if (schema && schema.available)
    (schema.flags || []).some(function (f) {
      if (f.id === 'health' && typeof f.max === 'number' && isFinite(f.max) && f.max > 0) {
        health = f;
        return true;
      }
      return false;
    });
  if (!health) return null;
  var ratio = meta.bucket_health_dynamic ? meta.bucket_health_size_ratio : 1;
  if (typeof ratio !== 'number' || !isFinite(ratio) || ratio < 1) return null;
  var max = health.max * ratio,
    complete = entityData || bucketFullEntity(),
    attr = bucketHealthAttribute(meta);
  if (!meta.bucket_health_dynamic && attr && bucketEntityMatches(meta, complete)) {
    var row =
      (complete.attributes || []).filter(function (a) {
        return Reg.full(a.id) === attr.id;
      })[0] || {};
    try {
      max = linkedAttributeValue(attr, row, esAttrBase(complete, attr));
    } catch (ignored) {}
  }
  return {
    min: typeof health.min === 'number' ? health.min : 0,
    max: max,
    templateMax: health.max,
    dynamic: !!meta.bucket_health_dynamic
  };
}
function bucketHealthControl(meta, value, put) {
  var hint = h('div', { class: 'k-sub link', title: I18n.t('cadeditor.ui.spawn.click_release_behavior') }),
    wrap = h('div'),
    input,
    number,
    detail = '';
  var initialMax = (bucketHealthRange(meta) || {}).max;
  function check() {
    var range = bucketHealthRange(meta),
      raw = input.value.trim(),
      n = Number(raw.replace(/[fFdD]$/, '')),
      valid = raw !== '' && isFinite(n) && isFinite(Math.fround(n));
    var message = I18n.t('cadeditor.ui.spawn.loading_released_entity_limits');
    detail = I18n.t('cadeditor.ui.spawn.bar_tags_save_health_maximum');
    if (range) {
      if (range.dynamic) {
        message = I18n.t('cadeditor.ui.spawn.release_cap', fmtNum(range.templateMax), fmtNum(range.max));
        detail += I18n.t('cadeditor.ui.spawn.ceiling_changes_size_growth_recreate');
      } else if (valid && (n < range.min || n > range.max)) {
        var plan = null;
        try {
          plan = bucketHealthPlan(meta, n);
        } catch (ignored) {}
        message = plan
          ? I18n.t('cadeditor.ui.spawn.upper_limit_sync', fmtNum(plan.before), fmtNum(plan.after))
          : I18n.t('cadeditor.ui.spawn.release', fmtNum(n), fmtNum(Math.max(range.min, Math.min(range.max, n))));
      } else
        message =
          initialMax !== undefined && range.max !== initialMax
            ? I18n.t('cadeditor.ui.spawn.upper_limit_sync', fmtNum(initialMax), fmtNum(range.max))
            : I18n.t('cadeditor.ui.spawn.release_cap_2', fmtNum(range.max));
    }
    if (!range && meta.bucket_entity) {
      var schema = Reg.entitySchema(meta.bucket_entity);
      if (schema && schema.error) {
        message = I18n.t('cadeditor.ui.spawn.could_load_released_entity_limits');
        detail = String(schema.error);
      } else if (schema === false || (schema && (schema.available === false || schema.available === true)))
        message = I18n.t('cadeditor.ui.spawn.released_entity_limit_unavailable');
    }
    if (raw && !valid) message = I18n.t('cadeditor.ui.spawn.enter_valid_float_value');
    hint.textContent = message;
    number.classList.toggle('bad', !!raw && !valid);
    return valid;
  }
  // The entity consumer's clamp is not a restriction on the bucket's NBT storage.
  // Valid custom floats are writable even while the consumer range is loading.
  number = wNum(
    { t: 'num', nbtType: 'f' },
    value,
    function (v) {
      if (check()) put(v);
    },
    {
      placeholder: I18n.t('cadeditor.ui.spawn.set_game_default'),
      onEmpty: function () {
        put(undefined);
      }
    }
  );
  input = number.querySelector('input');
  input.addEventListener('input', check);
  input.addEventListener('change', check);
  activate(hint, function () {
    kPopover(hint, kHint(detail, 'hint'), { width: 280 });
  });
  wrap.appendChild(number);
  wrap.appendChild(hint);
  check();
  return wrap;
}
CARDS.bucketFields = function () {
  var meta = bucketMeta(),
    card = eggCard(
      'bucketFields',
      'sliders',
      I18n.t('cadeditor.ui.spawn.bucket_mob_settings'),
      I18n.t('cadeditor.ui.spawn.leave_blank_game_default'),
      ['bucket_entity_data']
    );
  if (!meta.bucket_fields_verified) return null;
  (meta.bucket_fields || []).forEach(function (field) {
    var key = field.key,
      value = bucketData()[key],
      label =
        {
          Age: I18n.t('cadeditor.ui.spawn.age_ticks'),
          AgeLocked: I18n.t('cadeditor.ui.spawn.lock_age'),
          age: I18n.t('cadeditor.ui.spawn.age_ticks'),
          age_locked: I18n.t('cadeditor.ui.spawn.lock_age'),
          HuntingCooldown: I18n.t('cadeditor.ui.spawn.hunting_cooldown_ticks')
        }[key] || (Labels.entFlag[key] || [key])[0],
      node;
    function put(v) {
      var data = bucketData();
      if (v === undefined) delete data[key];
      else if (field.type === 'float' || field.type === 'int')
        nbtSetTyped(data, key, v, field.type === 'float' ? 'f' : 'i');
      else nbtPut(data, key, v);
      var plan = null;
      if (key === 'Health' && v !== undefined) {
        try {
          plan = bucketHealthPlan(meta, nbtNumberValue(v));
        } catch (ignored) {}
      }
      if (plan)
        Store.setLinked(
          { bucket_entity_data: data, entity_data: plan.data },
          I18n.t('cadeditor.ui.spawn.bucket_life_cap', fmtNum(plan.before), fmtNum(plan.after))
        );
      else Ctx.setSmart('bucket_entity_data', data, { label: I18n.t('cadeditor.ui.spawn.bucket_entity', label) });
    }
    if (key === 'Health' && field.type === 'float') node = bucketHealthControl(meta, value, put);
    else if (field.type === 'boolean') {
      node = kSeg(
        [
          { v: 'inherit', label: I18n.t('cadeditor.ui.common.unset') },
          { v: 'true', label: I18n.t('cadeditor.ui.labels.yes') },
          { v: 'false', label: I18n.t('cadeditor.ui.labels.no') }
        ],
        value === undefined
          ? 'inherit'
          : nbtNumberValue(value) === true || nbtNumberValue(value) === 1
            ? 'true'
            : 'false',
        function (v) {
          put(v === 'inherit' ? undefined : v === 'true');
        }
      ).el;
    } else if (field.type === 'long') {
      node = kInput(
        value === undefined ? '' : toSnbt(value, null, false).replace(/[lL]$/, ''),
        function (v) {
          if (!v.trim()) {
            put(undefined);
            return;
          }
          try {
            if (!/^[+-]?[0-9]+$/.test(v.trim())) throw new Error(I18n.t('cadeditor.ui.eschema.enter_integer'));
            put(parseSnbtUser(v.trim() + 'L'));
          } catch (e) {
            toast(I18n.t('cadeditor.ui.spawn.field', key, e.message || e), 'warn');
          }
        },
        { placeholder: I18n.t('cadeditor.ui.spawn.set_game_default') }
      );
    } else
      node = wNum(
        {
          t: field.type === 'int' ? 'int' : 'num',
          nbtType: field.type === 'float' ? 'f' : 'i',
          min: field.type === 'int' ? -2147483648 : undefined,
          max: field.type === 'int' ? 2147483647 : undefined
        },
        value,
        put,
        {
          placeholder: I18n.t('cadeditor.ui.spawn.set_game_default'),
          onEmpty: function () {
            put(undefined);
          }
        }
      );
    card.body.appendChild(fieldRow(label, node, key));
  });
  return card;
};
CARDS.bucketAppearance = function () {
  var meta = bucketMeta(),
    ids = meta.bucket_components || [];
  if (!ids.length) return null;
  var card = eggCard(
    'bucketAppearance',
    'palette',
    I18n.t('cadeditor.ui.spawn.bucket_mob_appearance'),
    I18n.t('cadeditor.ui.spawn.appearance_reserved_purpose_item'),
    ids.map(shortId)
  );
  ids.forEach(function (id) {
    var key = shortId(id),
      val = effectiveGet(Store.doc(), key);
    function put(v, o) {
      Ctx.setSmart(key, v, { key: o && o.key, label: I18n.t('cadeditor.ui.spawn.bucket_mob_appearance') });
    }
    var sc = CIDX[key] && CIDX[key].schema;
    // Even short enum lists retain manual IDs; options are the current host Codec/registry facts.
    var control =
      sc && sc.t === 'str' && sc.en && !dyeFieldFor(key, '')
        ? combo({
            value: val,
            options: function () {
              return liveEnumOptions(key, '') || Reg.schemaEnumOptions(sc);
            },
            free: true,
            placeholder: I18n.t('cadeditor.ui.spawn.select_manual_enter_id'),
            onPick: put
          })
        : renderComponentForm(key, val, put, Store.doc());
    card.body.appendChild(fieldRow(CIDX[key] ? CIDX[key].name : id, control, id));
  });
  return card;
};
CARDS.bucketAttrs = function () {
  var meta = bucketMeta(),
    data = bucketFullEntity();
  var card = eggCard(
    'bucketAttrs',
    'sliders',
    I18n.t('cadeditor.ui.spawn.entity_attributes'),
    I18n.t('cadeditor.ui.spawn.max_health_size_more'),
    ['entity_data']
  );
  if (!bucketEntityMatches(meta, data)) {
    card.body.appendChild(kHint(I18n.t('cadeditor.ui.spawn.entity_type_match_ignore_data'), 'note'));
    return card;
  }
  var schema = esReady(meta.bucket_entity, card.body);
  if (schema)
    card.body.appendChild(
      esAttrList(schema, {
        get: bucketFullEntity,
        set: function (obj) {
          obj.id = meta.bucket_entity;
          bucketWriteEntity(obj);
        },
        redraw: eggRedraw
      })
    );
  return card;
};
CARDS.bucketEntityData = function () {
  var meta = bucketMeta(),
    card = eggCard(
      'bucketEntityData',
      'code',
      I18n.t('cadeditor.ui.spawn.entity_data'),
      I18n.t('cadeditor.ui.spawn.snbt_custom_field'),
      ['entity_data']
    );
  var data = bucketFullEntity();
  if (!data.id && meta.bucket_entity) data.id = meta.bucket_entity;
  card.body.appendChild(
    worldMap(
      data,
      function (obj) {
        bucketWriteEntity(obj);
      },
      false
    )
  );
  card.body.appendChild(Valid.badge('entity_data'));
  return card;
};

/* ---------- 刷怪蛋 ---------- */
function eggDefaultEntity() {
  var id = Ctx.doc().id,
    m = Reg.live() ? Reg.itemMeta(id) : false;
  if (m && m.spawn_egg_entity) return m.spawn_egg_entity;
  var dc = Reg.live() ? Reg.defaultsOf(fullId(id)) : null,
    ed = dc && dc.entity_data;
  return isObj(ed) && typeof ed.id === 'string' ? ed.id : '';
}
/* 蛋现在会生成的生物：entity_data.id，没有就用蛋本来的生物 */
function eggEntityOf(d) {
  var ed = effectiveView(d).entity_data;
  if (isObj(ed) && typeof ed.id === 'string' && ed.id) return ed.id;
  var m = Reg.live() ? Reg.itemMeta(d.id) : false;
  return m && m.spawn_egg_entity ? m.spawn_egg_entity : '';
}
/* 刷怪蛋页：生物、外观、常用设置、其他数据；装备单独一页。都读写 entity_data，数据和选项来自游戏的 entity_info / entity_schema */
function eggCur() {
  var ed = Ctx.get('entity_data');
  return isObj(ed) && typeof ed.id === 'string' && ed.id ? ed.id : eggDefaultEntity();
}
function eggData() {
  var ed = Ctx.get('entity_data');
  return isObj(ed) ? ed : {};
}
function eggWrite(o) {
  var id = eggCur();
  if (id) o.id = Reg.full(id);
  Ctx.setSmart('entity_data', o, { label: I18n.t('cadeditor.ui.spawn.spawn_egg_data') });
}
/* 开关、选择、装备改完后重画整页：几张卡片互相有关（比如显示手臂会影响装备） */
function eggRedraw() {
  var b = $('edbody');
  if (b && UI.tab) UI.bodyScroll[UI.tab] = b.scrollTop;
  try {
    drawTabBody();
  } catch (e) {}
}
/* 这只蛋的生物完整数据（带类型的 SNBT 文本），存保险库用 */
function eggEntityText() {
  var t = null;
  try {
    t = Valid.textOf(Store.doc(), 'entity_data');
  } catch (e) {}
  return t || toSnbt(eggData(), null, false);
}
function eggIo() {
  return { get: eggData, set: eggWrite, redraw: eggRedraw };
}
/* 生物对应的刷怪蛋图标（entity_info.spawn_eggs），没有就用通用图标 */
function eggIconOf(id, size) {
  var info = id ? Reg.entityInfo(id) : null,
    eggs = info && info.spawn_eggs;
  return eggs && eggs.length ? itemIcon(eggs[0], size) : uiIcon('paw', size > 20 ? 32 : 16);
}
function eggCard(id, icon, title, desc, comps) {
  if (UIOpen['card:' + id] === undefined) UIOpen['card:' + id] = false; // 刷怪蛋页的卡片默认展开
  return kCard({ id: id, icon: icon, title: title, desc: desc, comps: comps || [], span: 2, eager: true }, Ctx);
}

CARDS.spawnEgg = function () {
  var card = eggCard(
    'spawnEgg',
    'paw',
    I18n.t('cadeditor.ui.spawn.spawned_entity'),
    I18n.t('cadeditor.ui.spawn.mob_generated_clicking_ground_egg'),
    ['entity_data']
  );
  var id = eggCur(),
    def = eggDefaultEntity(),
    info = id ? Reg.entityInfo(id) : null;
  var sub = id ? Reg.full(id) : '',
    originHint = id && def && Reg.full(id) !== Reg.full(def) ? I18n.t('cadeditor.ui.spawn.used', entityName(def)) : '';
  card.body.appendChild(
    esEntityHeader({
      id: id,
      sub: sub,
      originHint: originHint,
      iconFn: function (n) {
        return eggIconOf(id, n);
      },
      onPick: function (x) {
        var o = clone(eggData());
        o.id = Reg.full(x);
        Ctx.setSmart('entity_data', o, { label: I18n.t('cadeditor.ui.spawn.spawn_egg_entity') });
        eggRedraw();
      },
      onEntityNbt: function (snbt) {
        var o = vaultEntityObj(snbt);
        NBT_FORCE.entity_data = true;
        Ctx.setSmart('entity_data', o, { label: I18n.t('cadeditor.ui.spawn.spawn_egg_entity') });
        eggRedraw();
      },
      snbtText: eggEntityText
    })
  );
  if (id && info === null) card.body.appendChild(xEmpty(I18n.t('cadeditor.ui.spawn.reading_mob_message_game')));
  card.body.appendChild(Valid.badge('entity_data'));
  return card;
};
CARDS.eggLook = function () {
  var id = eggCur(),
    s = id ? Reg.entitySchema(id) : null;
  if (s && s.available && !(s.variants || []).length) return null; // 这只生物没有可选的外观，不显示这张卡
  var card = eggCard(
    'eggLook',
    'palette',
    I18n.t('cadeditor.ui.eschema.appearance'),
    I18n.t('cadeditor.ui.spawn.varieties_colors_etc_left_3')
  );
  var ok = esReady(id, card.body);
  /* 有交易的生物：职业和等级放在「交易」卡里（itemspecial.js），这里不重复 */
  if (ok && typeof itemTradeApplies === 'function' && itemTradeApplies(ok, eggData()))
    ok = Object.assign({}, ok, {
      variants: (ok.variants || []).filter(function (v) {
        return !/villager\/(profession|level)$/.test(String(v.id));
      })
    });
  if (ok) card.body.appendChild(esVariantList(ok, eggIo()));
  return card;
};
CARDS.eggFlags = function () {
  var id = eggCur(),
    card = eggCard(
      'eggFlags',
      'sliders',
      I18n.t('cadeditor.ui.eschema.common_settings'),
      I18n.t('cadeditor.ui.spawn.name_health_early_childhood_behavior')
    );
  var ok = esReady(id, card.body);
  if (ok) card.body.appendChild(esFlagList(ok, eggIo()));
  return card;
};
CARDS.eggAttrs = function () {
  var id = eggCur(),
    s = id ? Reg.entitySchema(id) : null;
  if (
    s &&
    s.available &&
    !(s.attributes || []).some(function (a) {
      return a.common;
    })
  )
    return null;
  var card = eggCard(
    'eggAttrs',
    'sword',
    I18n.t('cadeditor.ui.eschema.attributes'),
    I18n.t('cadeditor.ui.spawn.size_maximum_life_speed_attack')
  );
  var ok = esReady(id, card.body);
  if (ok) {
    var tr = esTagsRow(ok, eggIo());
    card.body.appendChild(esAttrList(ok, eggIo()));
    if (tr) card.body.appendChild(tr);
  }
  return card;
};
CARDS.eggEffects = function () {
  var id = eggCur(),
    s = id ? Reg.entitySchema(id) : null;
  if (s && s.available && !(s.effects && s.effects.common)) return null;
  var card = eggCard(
    'eggEffects',
    'flask',
    I18n.t('cadeditor.ui.eschema.status_effects'),
    I18n.t('cadeditor.ui.spawn.effect_body_time_creation')
  );
  var ok = esReady(id, card.body);
  if (ok) card.body.appendChild(esEffects(ok, eggIo()));
  return card;
};
CARDS.eggGear = function () {
  var id = eggCur(),
    card = eggCard(
      'eggGear',
      'helmet',
      I18n.t('cadeditor.ui.eschema.equipment'),
      I18n.t('cadeditor.ui.spawn.pointing_item_item_grid_opens')
    );
  card.el.classList.add('es-open');
  card.onHead = function () {
    return true;
  }; // 不折叠：装备直接摆在页面里
  var ok = esReady(id, card.body);
  if (ok) card.body.appendChild(esGearGrid(ok, eggIo(), id));
  return card;
};
/* 其余字段（原始数据）；id 由「生成的生物」管，上面几张卡管的字段不重复显示 */
CARDS.eggData = function () {
  var id = eggCur(),
    card = eggCard(
      'eggData',
      'code',
      I18n.t('cadeditor.ui.spawn.other_data'),
      I18n.t('cadeditor.ui.spawn.field_found_above_added_directly')
    );
  var owned = esOwnedKeys(id ? Reg.entitySchema(id) : null),
    cur = eggData();
  /* 交易卡管 Offers 和经验：不在这里重复，免得旧快照盖掉交易卡的修改 */
  if (typeof itemTradeApplies === 'function' && itemTradeApplies(id ? Reg.entitySchema(id) : null, cur)) {
    owned.Offers = 1;
    owned.Xp = 1;
  }
  var rest = {};
  Object.keys(cur).forEach(function (k) {
    if (k !== 'id' && !Object.prototype.hasOwnProperty.call(owned, k)) nbtPut(rest, k, nbtTake(cur, k));
  });
  var sug = kBtn(
    I18n.t('cadeditor.ui.spawn.common_fields'),
    function () {
      suggestEntityFields(
        id,
        function (k) {
          return Object.prototype.hasOwnProperty.call(owned, k) || Object.prototype.hasOwnProperty.call(rest, k);
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
    { title: I18n.t('cadeditor.ui.spawn.pick_field_default_data_mob') }
  );
  var mapEl = worldMap(
    rest,
    function (x) {
      if (Object.prototype.hasOwnProperty.call(x, 'id'))
        throw new Error(I18n.t('cadeditor.ui.spawn.mob_replace_generated_mob'));
      Object.keys(x).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(owned, k))
          throw new Error(I18n.t('cadeditor.ui.spawn.change_card_above', k));
      });
      var base = eggData(),
        o = clone(x);
      Object.keys(base).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(owned, k)) nbtPut(o, k, nbtTake(base, k));
      });
      eggWrite(o);
    },
    false
  );
  card.body.appendChild(h('div', { class: 'egg-datahd' }, [h('div', { class: 'grow' }), sug]));
  card.body.appendChild(mapEl);
  return card;
};

/* ---------- 刷怪笼 ---------- */
function spInfo(beId) {
  var t = Reg.live() ? Reg.table('spawner_info') : null;
  if (!t) return null;
  for (var i = 0; i < t.length; i++) if (t[i].id === beId) return t[i];
  return false;
}
/* 游戏给的默认值；数据没到 / 离线时用 fb（原版默认） */
function spDefault(beId, key, fb) {
  var e = spInfo(beId),
    f = e && e.fields && e.fields[key];
  return f && typeof f.default === 'number' ? f.default : fb;
}
function spCfgDefault(name, key, fb) {
  var e = spInfo('minecraft:trial_spawner'),
    c = e && e.defaults && e.defaults[name];
  return c && typeof c[key] === 'number' ? c[key] : fb;
}
function spBlockEntity() {
  var m = Reg.live() ? Reg.itemMeta(Ctx.doc().id) : false;
  if (m && m.block_entity_type) return m.block_entity_type;
  return shortId(Ctx.doc().id) === 'trial_spawner' ? 'minecraft:trial_spawner' : 'minecraft:mob_spawner';
}

/* 一行数值：图标 + 名称 + 说明，右边是数字。get/set 读写；ticks 为真时说明里顺带换算成秒 */
function spNumRow(o) {
  function sub(v) {
    return (
      (o.desc || '') +
      (o.ticks && v > 0
        ? I18n.t('cadeditor.ui.spawn.moment_seconds', (o.desc ? ' · ' : '') + spNum(v), spNum(v / 20))
        : '')
    );
  }
  return xNum({
    icon: uiIcon(o.icon || 'sliders', 14),
    title: o.title,
    sub: sub(o.get()),
    subOf: sub,
    tip: o.tip || '',
    value: +o.get(),
    round: true,
    min: o.min,
    max: o.max,
    step: o.step,
    dec: o.dec,
    unit: o.ticks ? '' : o.unit || '',
    stop: true,
    onChange: o.set
  });
}

/* 带权重的实体池（SpawnPotentials / spawn_potentials）：[{data:{entity:{id}}, weight}] */
/* 池条目的「装备战利品表」：SpawnData.equipment = { loot_table, slot_drop_chances? }。
   和上面装备格里直接放的物品（entity.equipment）是两回事；没有表就不能有 slot_drop_chances（游戏会拒绝）。掠落概率不是 0..1 的限制，已有的大于 1 的值原样保留。
   数据结构见 docs/registry-contract.md「SpawnData 装备」。 */
var SP_DROP_DEFAULT = 0.085; // 原版装备默认掉落概率
function spEquipTable(it, onChange, redraw) {
  var box = h('div', { class: 'sp-equip' });
  function eq() {
    return it.data && isObj(it.data.equipment) ? it.data.equipment : null;
  }
  function put(e) {
    it.data = it.data || {};
    if (e) it.data.equipment = e;
    else delete it.data.equipment;
    onChange();
  }
  var cur = eq(),
    table = cur && typeof cur.loot_table === 'string' ? cur.loot_table : '';
  var sel = kRegSelect({
    reg: 'loot_table',
    value: table,
    title: I18n.t('cadeditor.ui.spawn.choose_loot_table'),
    empty: I18n.t('cadeditor.ui.pages.none'),
    allowClear: true,
    onChange: function (id) {
      if (!id) put(null);
      else {
        var e = clone(eq() || {});
        e.loot_table = id;
        put(e);
      }
      redraw();
    }
  });
  box.appendChild(xSec('helmet', I18n.t('cadeditor.ui.spawn.equipment_loot_table')));
  box.appendChild(
    xRow({
      icon: false,
      title: I18n.t('cadeditor.ui.spawn.loot_table'),
      sub: I18n.t('cadeditor.ui.spawn.press_table_give_equipment_generated'),
      right: sel.el
    })
  );
  if (!table) return box;
  var dc = cur.slot_drop_chances,
    mode = typeof dc === 'number' ? 'all' : isObj(dc) && Object.keys(dc).length ? 'slot' : 'none';
  var info = typeof spInfo === 'function' ? spInfo('minecraft:trial_spawner') : null,
    sch =
      info &&
      info.spawn_data_schema &&
      info.spawn_data_schema.equipment &&
      info.spawn_data_schema.equipment.slot_drop_chances;
  var slots = (sch && sch.slots) || ['mainhand', 'offhand', 'feet', 'legs', 'chest', 'head', 'body', 'saddle'];
  function setDc(v) {
    var e = clone(eq() || {});
    if (v === undefined) delete e.slot_drop_chances;
    else e.slot_drop_chances = v;
    put(e);
  }
  box.appendChild(
    xSeg({
      title: I18n.t('cadeditor.ui.eschema.drop_chance'),
      sub: I18n.t('cadeditor.ui.spawn.overwrite_equipment_drop_probability'),
      options: [
        { v: 'none', label: I18n.t('cadeditor.ui.cards2.keep_default') },
        { v: 'all', label: I18n.t('cadeditor.ui.spawn.all') },
        { v: 'slot', label: I18n.t('cadeditor.ui.spawn.per_slot') }
      ],
      value: mode,
      onChange: function (m) {
        if (m === 'none') setDc(undefined);
        else if (m === 'all') setDc(typeof dc === 'number' ? dc : SP_DROP_DEFAULT);
        else
          setDc(
            isObj(dc) && Object.keys(dc).length
              ? dc
              : (function () {
                  var o = {};
                  o[slots.indexOf('head') >= 0 ? 'head' : slots[0]] = SP_DROP_DEFAULT;
                  return o;
                })()
          );
        redraw();
      }
    })
  );
  if (mode === 'all')
    box.appendChild(
      xNum({
        icon: false,
        title: I18n.t('cadeditor.ui.spawn.shared_chance'),
        value: dc,
        step: 0.05,
        dec: 3,
        noSlider: true,
        onChange: function (x) {
          setDc(x);
        }
      })
    );
  if (mode === 'slot') {
    function cmap() {
      var e = eq();
      return e && isObj(e.slot_drop_chances) ? clone(e.slot_drop_chances) : {};
    }
    Object.keys(dc).forEach(function (s) {
      var rm = kBtn(
        '',
        function () {
          var m = cmap();
          delete m[s];
          setDc(Object.keys(m).length ? m : undefined);
          redraw();
        },
        { icon: 'trash', title: I18n.t('cadeditor.ui.spawn.remove_override_slot') }
      );
      var n = xNumCtl(
        dc[s],
        {
          step: 0.05,
          dec: 3,
          noSlider: true,
          onChange: function (x) {
            var m = cmap();
            m[s] = x;
            setDc(m);
          }
        },
        true
      );
      box.appendChild(
        xRow({ icon: false, title: Labels.slotEquip[s] || s, tip: s, right: h('div', { class: 'k-row' }, [n.el, rm]) })
      );
    });
    var rest = slots.filter(function (s) {
      return dc[s] === undefined;
    });
    if (rest.length)
      box.appendChild(
        xRow({
          icon: false,
          title: I18n.t('cadeditor.ui.spawn.add_slot'),
          right: combo({
            value: '',
            options: rest.map(function (s) {
              return { v: s, label: Labels.slotEquip[s] || s };
            }),
            reset: true,
            placeholder: I18n.t('cadeditor.ui.spawn.choose_slot'),
            onPick: function (s) {
              var m = cmap();
              m[s] = SP_DROP_DEFAULT;
              setDc(m);
              redraw();
            }
          })
        })
      );
  }
  return box;
}
function spPool(arr, onChange, emptyText) {
  var xl = xList({
    items: function () {
      return arr;
    },
    empty: emptyText,
    add: {
      text: I18n.t('cadeditor.ui.spawn.add_entity'),
      fn: function () {
        openRegPick({
          reg: 'entity_type',
          title: I18n.t('cadeditor.ui.eschema.choose_entity'),
          onEntityNbt: function (snbt) {
            var o = vaultEntityObj(snbt);
            NBT_FORCE.block_entity_data = true;
            NBT_FORCE.spawn_potentials = true;
            arr.push({ data: { entity: o }, weight: 1 });
            onChange();
            xl.select(arr.length - 1);
          },
          onPick: function (id) {
            arr.push({ data: { entity: { id: Reg.full(id) } }, weight: 1 });
            onChange();
            xl.select(arr.length - 1);
          }
        });
      }
    },
    row: function (it, i) {
      var eid = it.data && it.data.entity && typeof it.data.entity.id === 'string' ? it.data.entity.id : '';
      var wt = xNumCtl(
        typeof it.weight === 'number' ? it.weight : 1,
        {
          min: 1,
          max: 1000000,
          step: 1,
          noSlider: true,
          onChange: function (v) {
            it.weight = v;
            onChange();
          }
        },
        true
      );
      return {
        chevron: true,
        icon: eid ? entityIcon(eid, 14) : uiIcon('paw', 14),
        title: eid ? entityName(eid) : I18n.t('cadeditor.ui.spawn.entity_selected'),
        sub: eid || '',
        tip: eid,
        right: wt.el,
        onDelete: function () {
          arr.splice(i, 1);
          onChange();
          xl.select(-1);
        },
        body: function () {
          return [
            esEntityHeader({
              id: eid,
              empty: I18n.t('cadeditor.ui.banner.selected'),
              snbtText: function () {
                return nbtMerge(it.data.entity, null);
              },
              onPick: function (x) {
                it.data = it.data || {};
                it.data.entity = it.data.entity || {};
                it.data.entity.id = Reg.full(x);
                onChange();
                xl.draw();
              },
              onEntityNbt: function (snbt) {
                it.data = it.data || {};
                it.data.entity = vaultEntityObj(snbt);
                NBT_FORCE.block_entity_data = true;
                onChange();
                xl.draw();
              }
            }),
            eid
              ? esPanel({
                  type: Reg.full(eid),
                  trades: 'spawner:pool:' + i,
                  get: function () {
                    return (it.data && it.data.entity) || { id: eid };
                  },
                  set: function (e) {
                    it.data = it.data || {};
                    it.data.entity = e;
                    onChange();
                  }
                })
              : null,
            eid
              ? spEquipTable(it, onChange, function () {
                  xl.draw();
                })
              : null,
            kHint(I18n.t('cadeditor.ui.spawn.bigger_weight_easier_choose'))
          ];
        }
      };
    }
  });
  return xl;
}

CARDS.spawner = function () {
  if (UIOpen['card:spawner'] === undefined) UIOpen['card:spawner'] = false; // 这一页只有它，默认展开
  var beId = spBlockEntity(),
    trial = beId === 'minecraft:trial_spawner';
  var card = kCard(
    {
      id: 'spawner',
      icon: 'paw',
      title: trial ? I18n.t('cadeditor.ui.spawn.trial_spawner') : I18n.t('cadeditor.ui.pages.spawner'),
      desc: trial
        ? I18n.t('cadeditor.ui.spawn.press_player_increase_number_integer')
        : I18n.t('cadeditor.ui.spawn.mob_how_often_how_many'),
      comps: ['block_entity_data'],
      span: 2,
      eager: true
    },
    Ctx
  );
  var obj = clone(isObj(Ctx.get('block_entity_data')) ? Ctx.get('block_entity_data') : {});
  function put() {
    var rest = clone(obj);
    delete rest.id;
    if (!Object.keys(rest).length) {
      Ctx.disable('block_entity_data', { structural: false });
      return;
    }
    obj.id = beId;
    Ctx.setSmart('block_entity_data', clone(obj), {
      label: trial ? I18n.t('cadeditor.ui.spawn.trial_spawner') : I18n.t('cadeditor.ui.pages.spawner')
    });
  }
  var body = card.body;
  if (obj.id && Reg.full(obj.id) !== beId) {
    body.appendChild(xEmpty(I18n.t('cadeditor.ui.spawn.block_entity_data_type_item', obj.id)));
  }
  if (!trial) buildMobSpawner(body, obj, beId, put);
  else buildTrialSpawner(body, obj, beId, put);
  body.appendChild(Valid.badge('block_entity_data'));
  return card;
};

/* 刷怪笼里当前生物的完整数据（带类型的 SNBT 文本） */
function spEntityText(obj) {
  var e = obj && obj.SpawnData && obj.SpawnData.entity;
  if (!e) return '{}';
  var t = null;
  try {
    var n = nbtParse(Valid.textOf(Store.doc(), 'block_entity_data'));
    if (n && n.map && n.map.SpawnData && n.map.SpawnData.map && n.map.SpawnData.map.entity)
      t = nbtPrint(n.map.SpawnData.map.entity, false);
  } catch (x) {}
  return t || toSnbt(e, null, false);
}
function buildMobSpawner(body, obj, beId, put) {
  /* 当前刷怪实体：SpawnData.entity.id（没写 = 新放下的刷怪笼还没有指定） */
  var entityRegion = h('div', { class: 'spawner-entity' });
  body.appendChild(entityRegion);
  function paintEntity() {
    clear(entityRegion);
    var eid =
      obj.SpawnData && obj.SpawnData.entity && typeof obj.SpawnData.entity.id === 'string'
        ? obj.SpawnData.entity.id
        : '';
    entityRegion.appendChild(xSec('paw', I18n.t('cadeditor.ui.spawn.entity_spawn')));
    entityRegion.appendChild(
      esEntityHeader({
        id: eid,
        empty: I18n.t('cadeditor.ui.spawn.specified'),
        snbtText: function () {
          return spEntityText(obj);
        },
        onPick: function (x) {
          obj.SpawnData = isObj(obj.SpawnData) ? obj.SpawnData : {};
          obj.SpawnData.entity = isObj(obj.SpawnData.entity) ? obj.SpawnData.entity : {};
          obj.SpawnData.entity.id = Reg.full(x);
          put();
          paintEntity();
        },
        onEntityNbt: function (snbt) {
          obj.SpawnData = isObj(obj.SpawnData) ? obj.SpawnData : {};
          obj.SpawnData.entity = vaultEntityObj(snbt);
          NBT_FORCE.block_entity_data = true;
          put();
          paintEntity();
        }
      })
    );
    if (eid) {
      entityRegion.appendChild(
        xSec(
          'paw',
          I18n.t('cadeditor.ui.spawn.spawned_entity_2'),
          I18n.t('cadeditor.ui.spawn.appearance_attribute_effects_equipment')
        )
      );
      entityRegion.appendChild(
        esPanel({
          type: Reg.full(eid),
          trades: 'spawner:data',
          get: function () {
            return obj.SpawnData.entity;
          },
          set: function (e) {
            obj.SpawnData.entity = e;
            put();
          }
        })
      );
    }
  }
  paintEntity();
  body.appendChild(
    xSec('list', I18n.t('cadeditor.ui.spawn.random_pool'), I18n.t('cadeditor.ui.spawn.s_pool_each_time_press'))
  );
  var pot = Array.isArray(obj.SpawnPotentials) ? obj.SpawnPotentials : [];
  var pool = spPool(
    pot,
    function () {
      if (pot.length) obj.SpawnPotentials = pot;
      else delete obj.SpawnPotentials;
      put();
    },
    I18n.t('cadeditor.ui.spawn.s_random_pool_just_mob')
  );
  body.appendChild(pool.el);
  /* 数值：范围对应游戏的 SpawnerData 校验（整数 0..32767；Delay 可为 -1） */
  body.appendChild(
    xSec('sliders', I18n.t('cadeditor.ui.forms.value'), I18n.t('cadeditor.ui.spawn.leave_blank_game_defaults'))
  );
  var err = worldError();
  function checkDelay() {
    var a = spVal('MinSpawnDelay', 200),
      b = spVal('MaxSpawnDelay', 800);
    err.textContent = b < a ? I18n.t('cadeditor.ui.spawn.maximum_interval_must_less_shortest') : '';
  }
  function spVal(key, fb) {
    return typeof obj[key] === 'number' ? obj[key] : spDefault(beId, key, fb);
  }
  var P = [
    [
      'RequiredPlayerRange',
      I18n.t('cadeditor.ui.spawn.activation_range'),
      I18n.t('cadeditor.ui.spawn.player_gets_within_distance_get'),
      'target',
      I18n.t('cadeditor.ui.cards2.blocks'),
      0,
      32767,
      16
    ],
    [
      'SpawnRange',
      I18n.t('cadeditor.ui.spawn.spawn_range'),
      I18n.t('cadeditor.ui.spawn.find_place_area_around_cage'),
      'cube',
      I18n.t('cadeditor.ui.cards2.blocks'),
      0,
      32767,
      4
    ],
    [
      'SpawnCount',
      I18n.t('cadeditor.ui.spawn.every_count_brush'),
      I18n.t('cadeditor.ui.spawn.most_try_generate_few_once'),
      'paw',
      I18n.t('cadeditor.ui.spawn.entities'),
      0,
      32767,
      4
    ],
    [
      'MaxNearbyEntities',
      I18n.t('cadeditor.ui.spawn.mob_cap_around'),
      I18n.t('cadeditor.ui.spawn.same_people_neighborhood_don_t'),
      'layers',
      I18n.t('cadeditor.ui.spawn.entities'),
      0,
      32767,
      6
    ],
    [
      'MinSpawnDelay',
      I18n.t('cadeditor.ui.spawn.min_delay'),
      I18n.t('cadeditor.ui.spawn.least_wait_between_two_brushing'),
      'clock',
      I18n.t('cadeditor.ui.cards2.ticks'),
      0,
      32767,
      200,
      true
    ],
    [
      'MaxSpawnDelay',
      I18n.t('cadeditor.ui.spawn.max_delay'),
      I18n.t('cadeditor.ui.spawn.waiting_between_two_brushing_freaks'),
      'clock',
      I18n.t('cadeditor.ui.cards2.ticks'),
      0,
      32767,
      800,
      true
    ],
    [
      'Delay',
      I18n.t('cadeditor.ui.spawn.current_countdown'),
      I18n.t('cadeditor.ui.spawn.wait_before_first_brushing_after'),
      'clock',
      I18n.t('cadeditor.ui.cards2.ticks'),
      -1,
      32767,
      20,
      true
    ]
  ];
  var list = h('div', { class: 'x-list' });
  P.forEach(function (p) {
    list.appendChild(
      spNumRow({
        title: p[1],
        desc: p[2],
        icon: p[3],
        unit: p[4],
        min: p[5],
        max: p[6],
        ticks: p[8],
        tip: p[0],
        get: function () {
          return spVal(p[0], p[7]);
        },
        set: function (v) {
          obj[p[0]] = v;
          put();
          checkDelay();
        }
      })
    );
  });
  body.appendChild(list);
  body.appendChild(err);
  checkDelay();
  body.appendChild(
    kBtn(
      I18n.t('cadeditor.ui.spawn.restore_defaults_all'),
      function () {
        P.forEach(function (p) {
          delete obj[p[0]];
        });
        put();
        drawDetailSafe();
      },
      { icon: 'undo' }
    )
  );
}

function buildTrialSpawner(body, obj, beId, put) {
  function top(key, fb) {
    return typeof obj[key] === 'number' ? obj[key] : spDefault(beId, key, fb);
  }
  body.appendChild(xSec('sliders', I18n.t('cadeditor.ui.spawn.basic')));
  var l0 = h('div', { class: 'x-list' });
  l0.appendChild(
    spNumRow({
      title: I18n.t('cadeditor.ui.spawn.activation_range'),
      desc: I18n.t('cadeditor.ui.spawn.player_starts_distance'),
      icon: 'target',
      unit: I18n.t('cadeditor.ui.cards2.blocks'),
      min: 1,
      max: 128,
      tip: 'required_player_range',
      get: function () {
        return top('required_player_range', 14);
      },
      set: function (v) {
        obj.required_player_range = v;
        put();
      }
    })
  );
  l0.appendChild(
    spNumRow({
      title: I18n.t('cadeditor.ui.spawn.cooldown'),
      desc: I18n.t('cadeditor.ui.spawn.waiting_before_completing_test'),
      icon: 'clock',
      unit: I18n.t('cadeditor.ui.cards2.ticks'),
      min: 0,
      max: 2147483647,
      ticks: true,
      tip: 'target_cooldown_length',
      get: function () {
        return top('target_cooldown_length', 36000);
      },
      set: function (v) {
        obj.target_cooldown_length = v;
        put();
      }
    })
  );
  body.appendChild(l0);
  [
    ['normal_config', I18n.t('cadeditor.ui.spawn.normal_configuration'), I18n.t('cadeditor.ui.spawn.use_s_bad_news')],
    [
      'ominous_config',
      I18n.t('cadeditor.ui.spawn.ominous_configuration'),
      I18n.t('cadeditor.ui.spawn.player_uses_bad_omens')
    ]
  ].forEach(function (c) {
    var name = c[0],
      cfg = obj[name];
    body.appendChild(xSec('flame', c[1], c[2]));
    if (typeof cfg === 'string') {
      var defs = spInfo(beId),
        dcfg = defs && defs.defaults && defs.defaults[name];
      body.appendChild(
        xRow({
          icon: uiIcon('pin', 14),
          title: I18n.t('cadeditor.ui.spawn.quoted_configuration'),
          sub: cfg,
          tip: cfg,
          right: dcfg
            ? kBtn(
                I18n.t('cadeditor.ui.spawn.expand_configuration_internal_unions'),
                function () {
                  obj[name] = clone(dcfg);
                  put();
                  drawDetailSafe();
                },
                { icon: 'edit', title: I18n.t('cadeditor.ui.spawn.generate_editable_configuration_game') }
              )
            : null
        })
      );
      return;
    }
    cfg = isObj(cfg) ? cfg : {};
    function cv(key, fb) {
      return typeof cfg[key] === 'number' ? cfg[key] : spCfgDefault(name, key, fb);
    }
    function setv(key, v) {
      cfg[key] = v;
      obj[name] = cfg;
      put();
    }
    var F = [
      [
        'spawn_range',
        I18n.t('cadeditor.ui.spawn.spawn_range'),
        I18n.t('cadeditor.ui.spawn.find_place_area_around_cage'),
        'cube',
        I18n.t('cadeditor.ui.cards2.blocks'),
        1,
        128,
        1,
        4
      ],
      [
        'total_mobs',
        I18n.t('cadeditor.ui.spawn.total_count'),
        I18n.t('cadeditor.ui.spawn.how_many_painted_single_trial'),
        'paw',
        I18n.t('cadeditor.ui.spawn.entities'),
        0,
        3.4e38,
        1,
        6,
        false,
        3
      ],
      [
        'simultaneous_mobs',
        I18n.t('cadeditor.ui.spawn.s_ceiling_same_time'),
        I18n.t('cadeditor.ui.spawn.most_few_same_time'),
        'layers',
        I18n.t('cadeditor.ui.spawn.entities'),
        0,
        3.4e38,
        1,
        2,
        false,
        3
      ],
      [
        'total_mobs_added_per_player',
        I18n.t('cadeditor.ui.spawn.player_per_extra_total_increase'),
        '',
        'users',
        I18n.t('cadeditor.ui.spawn.entities'),
        0,
        3.4e38,
        1,
        2,
        false,
        3
      ],
      [
        'simultaneous_mobs_added_per_player',
        I18n.t('cadeditor.ui.spawn.each_more_player_increases_same'),
        '',
        'users',
        I18n.t('cadeditor.ui.spawn.entities'),
        0,
        3.4e38,
        1,
        1,
        false,
        3
      ],
      [
        'ticks_between_spawn',
        I18n.t('cadeditor.ui.spawn.spawn_interval'),
        I18n.t('cadeditor.ui.spawn.waiting_between_two_brushes'),
        'clock',
        I18n.t('cadeditor.ui.cards2.ticks'),
        0,
        2147483647,
        1,
        40,
        true
      ]
    ];
    var lst = h('div', { class: 'x-list' });
    F.forEach(function (f) {
      lst.appendChild(
        spNumRow({
          title: f[1],
          desc: f[2],
          icon: f[3] === 'users' ? 'paw' : f[3],
          unit: f[4],
          min: f[5],
          max: f[6],
          step: f[7],
          dec: f[10],
          ticks: f[9],
          tip: f[0],
          get: function () {
            return cv(f[0], f[8]);
          },
          set: function (v) {
            setv(f[0], v);
          }
        })
      );
    });
    body.appendChild(lst);
    var tpot = Array.isArray(cfg.spawn_potentials) ? cfg.spawn_potentials : [];
    body.appendChild(
      spPool(
        tpot,
        function () {
          if (tpot.length) cfg.spawn_potentials = tpot;
          else delete cfg.spawn_potentials;
          obj[name] = cfg;
          put();
        },
        I18n.t('cadeditor.ui.spawn.mob_pool_specified_follow_game')
      ).el
    );
  });
  body.appendChild(kHint(I18n.t('cadeditor.ui.spawn.loot_table_wait_rest_field')));
}
/* 重绘当前卡片所在的页（数值被整体恢复 / 配置被展开后用） */
function drawDetailSafe() {
  try {
    if (typeof drawTabBody === 'function') drawTabBody();
  } catch (e) {}
}
