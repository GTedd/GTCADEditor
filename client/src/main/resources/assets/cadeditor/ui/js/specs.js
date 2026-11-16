/* 组件专用表单说明书：字段怎么分段、叫什么、什么单位。数据（有哪些字段、类型、默认值）仍然来自组件的真实结构，这里只管排版与文案 */
var COND_SPEC = {
  compact: true,
  order: ['max_duration_ticks', 'min_speed', 'min_relative_speed'],
  over: {
    max_duration_ticks: {
      label: I18n.t('cadeditor.ui.specs.effective_duration'),
      unit: I18n.t('cadeditor.ui.cards2.ticks'),
      hint: I18n.t('cadeditor.ui.specs.start_use_only_possible_trigger')
    },
    min_speed: {
      label: I18n.t('cadeditor.ui.specs.lowest_speed_yourself'),
      hint: I18n.t('cadeditor.ui.specs.least_ll_fast_re_running')
    },
    min_relative_speed: {
      label: I18n.t('cadeditor.ui.specs.minimum_speed_relative_target'),
      hint: I18n.t('cadeditor.ui.specs.relative_speed_target_must_least')
    }
  }
};

SPEC_FORMS.blocks_attacks = {
  compact: true,
  order: [
    { sec: I18n.t('cadeditor.ui.cards3.block') },
    'block_delay_seconds',
    'disable_cooldown_scale',
    { sec: I18n.t('cadeditor.ui.specs.damage_reduction') },
    'damage_reductions',
    { sec: I18n.t('cadeditor.ui.specs.shield_damage') },
    'item_damage',
    { sec: I18n.t('cadeditor.ui.specs.exceptions_sound') },
    'bypassed_by',
    'block_sound',
    'disabled_sound'
  ],
  over: {
    block_delay_seconds: {
      label: I18n.t('cadeditor.ui.specs.block_delay'),
      unit: I18n.t('cadeditor.ui.cards2.sec'),
      step: 0.05,
      hint: I18n.t('cadeditor.ui.specs.how_many_seconds_wait_until'),
      dtxt: I18n.t('cadeditor.ui.specs.default_0_seconds_immediate_take')
    },
    disable_cooldown_scale: {
      label: I18n.t('cadeditor.ui.specs.break_cooldown_multiplier'),
      unit: I18n.t('cadeditor.ui.cards2.text'),
      step: 0.1,
      hint: I18n.t('cadeditor.ui.specs.shield_cooldown_time_multiples_after')
    },
    damage_reductions: {
      flatList: true,
      label: I18n.t('cadeditor.ui.specs.damage_reduction_rules'),
      hint: I18n.t('cadeditor.ui.specs.may_more_one_rule_each'),
      itemSummary: function (it) {
        var a = it.horizontal_blocking_angle === undefined ? 90 : it.horizontal_blocking_angle;
        var t =
          it.type === undefined
            ? I18n.t('cadeditor.ui.specs.all_damage')
            : Array.isArray(it.type)
              ? I18n.t('cadeditor.ui.forms.type_damage', it.type.length)
              : String(it.type);
        return I18n.t(
          'cadeditor.ui.specs.less_points',
          a,
          t,
          it.base || 0,
          Math.round((it.factor === undefined ? 1 : it.factor) * 100)
        );
      },
      itemSpec: {
        compact: true,
        order: ['horizontal_blocking_angle', 'type', 'base', 'factor'],
        over: {
          horizontal_blocking_angle: {
            label: I18n.t('cadeditor.ui.specs.blocking_arc'),
            unit: I18n.t('cadeditor.ui.specs.degrees'),
            min: 0,
            max: 180,
            step: 5,
            hint: I18n.t('cadeditor.ui.specs.attack_blocked_degrees_right_left')
          },
          type: {
            label: I18n.t('cadeditor.ui.specs.applicable_damage'),
            dtxt: I18n.t('cadeditor.ui.specs.all_damage'),
            hint: I18n.t('cadeditor.ui.specs.set_all_damage_take_effect')
          },
          base: {
            label: I18n.t('cadeditor.ui.specs.fixed_reduction'),
            unit: I18n.t('cadeditor.ui.cards2.points'),
            hint: I18n.t('cadeditor.ui.specs.fixed_damage_each_time')
          },
          factor: {
            label: I18n.t('cadeditor.ui.specs.proportional_relief'),
            step: 0.05,
            hint: I18n.t('cadeditor.ui.specs.less_proportion_damage_blocked_1')
          }
        }
      }
    },
    item_damage: {
      flatten: true,
      label: I18n.t('cadeditor.ui.specs.shield_damage'),
      hint: I18n.t('cadeditor.ui.specs.how_much_shield_loss_blockage'),
      spec: {
        compact: true,
        order: ['threshold', 'base', 'factor'],
        over: {
          threshold: {
            label: I18n.t('cadeditor.ui.specs.damage_threshold'),
            unit: I18n.t('cadeditor.ui.cards2.points'),
            hint: I18n.t('cadeditor.ui.specs.shield_durability_lost_below_damage')
          },
          base: {
            label: I18n.t('cadeditor.ui.specs.base_durability_damage'),
            unit: I18n.t('cadeditor.ui.cards2.points')
          },
          factor: {
            label: I18n.t('cadeditor.ui.specs.damage_multiplier'),
            unit: I18n.t('cadeditor.ui.cards2.text'),
            step: 0.1,
            hint: I18n.t('cadeditor.ui.specs.wear_base_wear_block_damage')
          }
        }
      }
    },
    bypassed_by: {
      label: I18n.t('cadeditor.ui.specs.ignore_shield_damage'),
      hint: I18n.t('cadeditor.ui.specs.damage_blocked')
    },
    block_sound: { label: I18n.t('cadeditor.ui.specs.block_sound') },
    disabled_sound: { label: I18n.t('cadeditor.ui.specs.shield_disable_sound') }
  }
};

SPEC_FORMS.kinetic_weapon = {
  compact: true,
  order: [
    { sec: I18n.t('cadeditor.ui.detail.basic') },
    'contact_cooldown_ticks',
    'delay_ticks',
    'forward_movement',
    'damage_multiplier',
    { sec: I18n.t('cadeditor.ui.specs.conditions') },
    'dismount_conditions',
    'knockback_conditions',
    'damage_conditions',
    { sec: I18n.t('cadeditor.ui.cards3.sound') },
    'sound',
    'hit_sound'
  ],
  over: {
    contact_cooldown_ticks: {
      label: I18n.t('cadeditor.ui.specs.spacing_target'),
      unit: I18n.t('cadeditor.ui.cards2.ticks'),
      hint: I18n.t('cadeditor.ui.specs.least_how_many_miles_between')
    },
    delay_ticks: {
      label: I18n.t('cadeditor.ui.specs.charge_delay'),
      unit: I18n.t('cadeditor.ui.cards2.ticks'),
      hint: I18n.t('cadeditor.ui.specs.how_long_before_starts_take')
    },
    forward_movement: {
      label: I18n.t('cadeditor.ui.specs.forward_movement_modifier'),
      step: 0.1,
      hint: I18n.t('cadeditor.ui.specs.moves_forward_extra_bits_during')
    },
    damage_multiplier: {
      label: I18n.t('cadeditor.ui.specs.speed_damage_multiplier'),
      step: 0.1,
      hint: I18n.t('cadeditor.ui.specs.damage_base_damage_x_speed')
    },
    dismount_conditions: {
      label: I18n.t('cadeditor.ui.specs.make_target_dismount'),
      hint: I18n.t('cadeditor.ui.specs.conditions_met_hit_target_off'),
      spec: COND_SPEC
    },
    knockback_conditions: {
      label: I18n.t('cadeditor.ui.specs.knock_back_target'),
      hint: I18n.t('cadeditor.ui.specs.target_knockback_conditions_met'),
      spec: COND_SPEC
    },
    damage_conditions: {
      label: I18n.t('cadeditor.ui.specs.deal_damage'),
      hint: I18n.t('cadeditor.ui.specs.damage_created_only_conditions_met'),
      spec: COND_SPEC
    },
    sound: { label: I18n.t('cadeditor.ui.specs.charge_sound') },
    hit_sound: { label: I18n.t('cadeditor.ui.specs.hit_sound') }
  }
};

SPEC_FORMS.piercing_weapon = {
  order: [
    { sec: I18n.t('cadeditor.ui.picker.effect') },
    'deals_knockback',
    'dismounts',
    { sec: I18n.t('cadeditor.ui.cards3.sound') },
    'sound',
    'hit_sound'
  ],
  over: {
    deals_knockback: { label: I18n.t('cadeditor.ui.specs.knock_back_target') },
    dismounts: { label: I18n.t('cadeditor.ui.specs.make_target_dismount') },
    sound: { label: I18n.t('cadeditor.ui.specs.attack_sound') },
    hit_sound: { label: I18n.t('cadeditor.ui.specs.hit_sound') }
  }
};
