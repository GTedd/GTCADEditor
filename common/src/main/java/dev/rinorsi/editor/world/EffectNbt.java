package dev.rinorsi.editor.world;

import dev.rinorsi.editor.EditorI18n;
import java.util.*;
import net.minecraft.nbt.*;
import net.minecraft.world.effect.MobEffectInstance;

/** Only active_effects gets vanilla Codec equivalence; every other edited field stays exact.
 * Defaults, integer tag representation and map iteration order are not lost edits. Unknown
 * fields are included in the comparison, so a loader dropping them still rejects the write. */
final class EffectNbt {
    private static final Set<String> FIELDS =
            Set.of("id", "amplifier", "duration", "ambient", "show_particles", "show_icon", "hidden_effect");

    private EffectNbt() {}

    static boolean retained(Tag requested, Tag prepared) {
        try {
            return canonical(requested).equals(canonical(prepared));
        } catch (RuntimeException invalid) {
            return false;
        }
    }

    private static Map<String, CompoundTag> canonical(Tag input) {
        var result = new TreeMap<String, CompoundTag>();
        if (input == null) return result;
        if (!(input instanceof ListTag list))
            throw new IllegalArgumentException(EditorI18n.tr("cadeditor.message.effectnbt.effect_must_list"));
        for (Tag value : list) {
            if (!(value instanceof CompoundTag raw))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.effectnbt.effect_must_compound_data"));
            checkNumbers(raw);
            var effect = MobEffectInstance.CODEC.parse(NbtOps.INSTANCE, raw).getOrThrow();
            var encoded = (CompoundTag)
                    MobEffectInstance.CODEC.encodeStart(NbtOps.INSTANCE, effect).getOrThrow();
            // Do not accept constructor clamping as a representation-only normalization.
            if (raw.contains("amplifier") && ((NumericTag) raw.get("amplifier")).intValue() != effect.getAmplifier())
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.effectnbt.effect_level_cut_vanilla_minecraft"));
            if (raw.contains("duration") && ((NumericTag) raw.get("duration")).intValue() != effect.getDuration())
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.effectnbt.effect_length_cut_vanilla_minecraft"));
            retainUnknown(raw, encoded);
            String id = encoded.getString("id").orElseThrow();
            if (result.putIfAbsent(id, encoded) != null)
                throw new IllegalArgumentException(EditorI18n.tr("cadeditor.message.effectnbt.effect_id_repeat", (id)));
        }
        return result;
    }

    private static void checkNumbers(CompoundTag raw) {
        for (String key : List.of("amplifier", "duration", "ambient", "show_particles", "show_icon")) {
            if (!raw.contains(key)) continue;
            if (!(raw.get(key) instanceof NumericTag value)
                    || !Double.isFinite(value.doubleValue())
                    || value.doubleValue() != value.intValue())
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.effectnbt.effect_field_must_reserved_integer", (key)));
            if (key.equals("amplifier")
                    && (value.intValue() < MobEffectInstance.MIN_AMPLIFIER
                            || value.intValue() > MobEffectInstance.MAX_AMPLIFIER))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.effectnbt.effect_level_cannot_cut_vanilla"));
            if (!key.equals("amplifier") && !key.equals("duration") && value.intValue() != 0 && value.intValue() != 1)
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.effectnbt.effect_boolean_field_must_0", (key)));
        }
        raw.getCompound("hidden_effect").ifPresent(EffectNbt::checkNumbers);
    }

    private static void retainUnknown(CompoundTag raw, CompoundTag encoded) {
        for (String key : raw.keySet())
            if (!FIELDS.contains(key)) encoded.put(key, raw.get(key).copy());
        raw.getCompound("hidden_effect").ifPresent(hidden -> {
            var out = encoded.getCompound("hidden_effect").orElseGet(CompoundTag::new);
            retainUnknown(hidden, out);
            if (hidden.contains("id")) out.put("id", hidden.get("id").copy());
            // An ignored nested value is still significant; never invent a retained hidden effect.
            if (!out.isEmpty()) encoded.put("hidden_effect", out);
        });
    }
}
