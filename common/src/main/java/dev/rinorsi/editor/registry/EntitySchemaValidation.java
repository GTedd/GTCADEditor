package dev.rinorsi.editor.registry;

import com.google.gson.*;
import dev.rinorsi.editor.EditorI18n;
import java.util.*;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.*;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;

/** Apply-time entity loading and semantic validation; runs on the caller's world thread. */
public final class EntitySchemaValidation {
    private EntitySchemaValidation() {}

    private static final Map<Level, Map<String, JsonObject>> CACHE = new WeakHashMap<>();

    public static synchronized void invalidate() {
        CACHE.clear();
    }

    public static synchronized JsonObject schema(String id, Level level) {
        return CACHE.computeIfAbsent(level, k -> new HashMap<>())
                .computeIfAbsent(id, k -> {
                    var type = BuiltInRegistries.ENTITY_TYPE
                            .getOptional(Identifier.parse(k))
                            .orElseThrow(() -> new IllegalArgumentException(
                                    EditorI18n.tr("cadeditor.message.entityregistrychannel.unknown_entity_id", (k))));
                    return EntitySchema.describe(type, level, level.registryAccess());
                })
                .deepCopy();
    }

    public static void validateStack(ItemStack stack, Level level) {
        var entity = stack.get(DataComponents.ENTITY_DATA);
        if (entity != null) {
            CompoundTag tag = entity.copyTagWithoutId();
            tag.putString(
                    "id", BuiltInRegistries.ENTITY_TYPE.getKey(entity.type()).toString());
            validate(tag, level, 0);
        }
        var block = stack.get(DataComponents.BLOCK_ENTITY_DATA);
        if (block != null
                && (block.type() == net.minecraft.world.level.block.entity.BlockEntityTypes.MOB_SPAWNER
                        || block.type() == net.minecraft.world.level.block.entity.BlockEntityTypes.TRIAL_SPAWNER))
            scanSpawns(block.copyTagWithoutId(), level, 0);
    }

    private static void scanSpawns(Tag value, Level level, int depth) {
        if (depth > 32)
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.entityschemavalidation.data_embedded_too_deep"));
        if (value instanceof CompoundTag compound) {
            for (String key : compound.keySet()) {
                Tag child = compound.get(key);
                if (key.equals("entity") && child instanceof CompoundTag tag) {
                    if (!tag.isEmpty()) {
                        if (!tag.contains("id"))
                            throw new IllegalArgumentException(EditorI18n.tr(
                                    "cadeditor.message.entityschemavalidation.scrubbing_entity_non_hours_must"));
                        validate(tag, level, 0);
                    }
                } else scanSpawns(child, level, depth + 1);
            }
        } else if (value instanceof ListTag list) for (Tag child : list) scanSpawns(child, level, depth + 1);
    }

    public static void validate(CompoundTag tag, Level level, int depth) {
        if (depth > 16)
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.entityschemavalidation.entity_passenger_nesting_over_16"));
        String id = tag.getString("id")
                .orElseThrow(() -> new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.entityschemavalidation.entity_id_must_string")));
        Identifier parsed = Identifier.tryParse(id);
        var type = parsed == null
                ? null
                : BuiltInRegistries.ENTITY_TYPE.getOptional(parsed).orElse(null);
        if (type == null)
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.entityregistrychannel.unknown_entity_id", (id)));
        JsonObject schema = schema(id, level);
        if (!schema.get("available").getAsBoolean())
            throw new IllegalArgumentException(EditorI18n.tr(
                    "cadeditor.message.entityschemavalidation.entity_cannot_create_secure_loading",
                    (id),
                    (schema.get("warnings"))));
        validateLists(tag, level);
        var variants = schema.getAsJsonArray("variants");
        for (var raw : variants) {
            JsonObject variant = raw.getAsJsonObject(), nbt = variant.getAsJsonObject("nbt");
            List<String> path = path(nbt.getAsJsonArray("path"));
            Tag input = EntitySchema.get(tag, path);
            if (input == null) continue;
            boolean shared = 0
                    < variants.asList().stream()
                            .filter(v -> v.getAsJsonObject()
                                    .getAsJsonObject("nbt")
                                    .get("path")
                                    .equals(nbt.get("path")))
                            .skip(1)
                            .count();
            boolean ok = false;
            for (var o : variant.getAsJsonArray("options")) {
                JsonElement candidate = o.getAsJsonObject().get("value");
                if (shared
                        && nbt.has("mask")
                        && input instanceof NumericTag n
                        && candidate.isJsonPrimitive()
                        && candidate.getAsJsonPrimitive().isNumber()) {
                    long mask = nbt.get("mask").getAsLong();
                    if (n.doubleValue() == n.longValue() && (n.longValue() & mask) == (candidate.getAsLong() & mask))
                        ok = true;
                } else if (sameJson(input, candidate)) ok = true;
            }
            if (!ok)
                throw new IllegalArgumentException(EditorI18n.tr(
                        "cadeditor.message.entityschemavalidation.variable_should_supported_entity",
                        (String.join(".", path)),
                        (input)));
        }
        for (var raw : schema.getAsJsonArray("flags")) {
            JsonObject flag = raw.getAsJsonObject();
            if (!flag.get("common").getAsBoolean()) continue;
            String key = flag.get("key").getAsString();
            Tag value = tag.get(key);
            if (value == null) continue;
            String kind = flag.get("type").getAsString();
            if (kind.equals("byte-bool")
                    && (!(value instanceof NumericTag n) || n.doubleValue() != 0 && n.doubleValue() != 1))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.entityschemavalidation.must_0_1_boolean", (key)));
            if (kind.equals("int")
                    && (!(value instanceof NumericTag n)
                            || !Double.isFinite(n.doubleValue())
                            || n.doubleValue() != n.intValue()))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.entityschemavalidation.must_32_bit_integer", (key)));
            if (flag.has("max")) {
                CompoundTag withoutHealth = tag.copy();
                withoutHealth.remove(key);
                var probe = EntitySchema.load(type, level, level.registryAccess(), withoutHealth);
                double max = probe instanceof net.minecraft.world.entity.LivingEntity living
                        ? living.getMaxHealth()
                        : flag.get("max").getAsDouble();
                if (!(value instanceof NumericTag n)
                        || !Double.isFinite(n.doubleValue())
                        || n.doubleValue() < flag.get("min").getAsDouble()
                        || n.doubleValue() > max)
                    throw new IllegalArgumentException(EditorI18n.tr(
                            "cadeditor.message.entityschemavalidation.beyond_entity_range",
                            (key),
                            (flag.get("min")),
                            (max)));
            }
        }
        CompoundTag saved;
        try {
            saved = EntitySchema.loadSave(type, level, level.registryAccess(), tag);
        } catch (RuntimeException ex) {
            throw new IllegalArgumentException(
                    EditorI18n.tr(
                            "cadeditor.message.entityschemavalidation.entity_cannot_loaded", (id), (ex.getMessage())),
                    ex);
        }
        for (var raw : variants) {
            List<String> path =
                    path(raw.getAsJsonObject().getAsJsonObject("nbt").getAsJsonArray("path"));
            Tag value = EntitySchema.get(tag, path);
            if (value != null && !same(value, EntitySchema.get(saved, path)))
                throw new IllegalArgumentException(EditorI18n.tr(
                        "cadeditor.message.entityschemavalidation.loaded_kept_check_variable_value",
                        (String.join(".", path))));
        }
        for (var raw : schema.getAsJsonArray("flags")) {
            JsonObject flag = raw.getAsJsonObject();
            if (!flag.get("common").getAsBoolean()) continue;
            String key = flag.get("key").getAsString();
            Tag value = tag.get(key);
            if (value != null && !same(value, saved.get(key))) {
                boolean falseOmitted = flag.get("type").getAsString().equals("byte-bool")
                        && value instanceof NumericTag n
                        && n.doubleValue() == 0
                        && saved.get(key) == null;
                boolean ageSign = flag.has("roundtrip")
                        && flag.get("roundtrip").getAsString().equals("baby-sign-only")
                        && value instanceof NumericTag n
                        && saved.get(key) instanceof NumericTag sn
                        && (n.intValue() < 0) == (sn.intValue() < 0);
                boolean component = flag.get("type").getAsString().equals("component")
                        && saved.get(key) != null
                        && componentEqual(value, saved.get(key), level);
                if (!falseOmitted && !ageSign && !component)
                    throw new IllegalArgumentException(EditorI18n.tr(
                            "cadeditor.message.entityschemavalidation.loaded_kept_check_data_type", (key)));
            }
        }
        for (var raw : schema.getAsJsonArray("equipment")) {
            List<String> path = path(raw.getAsJsonObject().getAsJsonArray("nbtPath"));
            Tag value = EntitySchema.get(tag, path);
            if (value == null) continue;
            try {
                var ops = level.registryAccess().createSerializationContext(NbtOps.INSTANCE);
                ItemStack stack = ItemStack.CODEC.parse(ops, value).getOrThrow();
                ItemStack.validateStrict(stack).getOrThrow();
                Tag stored = EntitySchema.get(saved, path);
                if (stored == null
                        || !ItemStack.matches(
                                stack, ItemStack.CODEC.parse(ops, stored).getOrThrow()))
                    throw new IllegalArgumentException(
                            EditorI18n.tr("cadeditor.message.entityschemavalidation.equipment_unreserved"));
            } catch (RuntimeException ex) {
                throw new IllegalArgumentException(
                        EditorI18n.tr(
                                "cadeditor.message.entityschemavalidation.equipment_invalid",
                                (String.join(".", path)),
                                (ex.getMessage())),
                        ex);
            }
        }
        if (tag.get("Passengers") instanceof ListTag passengers)
            for (Tag passenger : passengers) {
                if (!(passenger instanceof CompoundTag child))
                    throw new IllegalArgumentException(EditorI18n.tr(
                            "cadeditor.message.entityschemavalidation.passengers_must_entity_compound_list"));
                validate(child, level, depth + 1);
            }
    }

    private static void validateLists(CompoundTag tag, Level level) {
        var ops = level.registryAccess().createSerializationContext(NbtOps.INSTANCE);
        if (tag.contains("attributes")) {
            if (!(tag.get("attributes") instanceof ListTag list))
                throw new IllegalArgumentException(EditorI18n.tr(
                        "cadeditor.message.entityschemavalidation.attributes_must_attribute_compound_list"));
            for (int i = 0; i < list.size(); i++) {
                String path = "attributes[" + i + "]";
                try {
                    var packed = net.minecraft.world.entity.ai.attributes.AttributeInstance.Packed.CODEC
                            .parse(ops, list.get(i))
                            .getOrThrow();
                    double base = packed.baseValue();
                    if (!Double.isFinite(base))
                        throw new IllegalArgumentException(
                                EditorI18n.tr("cadeditor.message.entityschemavalidation.base_must_limited_number"));
                    if (packed.attribute().value()
                                    instanceof net.minecraft.world.entity.ai.attributes.RangedAttribute range
                            && (base < range.getMinValue() || base > range.getMaxValue()))
                        throw new IllegalArgumentException(EditorI18n.tr(
                                "cadeditor.message.entityschemavalidation.base_beyond_range",
                                (range.getMinValue()),
                                (range.getMaxValue())));
                } catch (RuntimeException ex) {
                    throw new IllegalArgumentException(
                            EditorI18n.tr(
                                    "cadeditor.message.entityschemavalidation.attribute_invalid",
                                    (path),
                                    (ex.getMessage())),
                            ex);
                }
            }
        }
        if (tag.contains("active_effects")) {
            if (!(tag.get("active_effects") instanceof ListTag list))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.entityschemavalidation.active_effects_must_effect_compound"));
            for (int i = 0; i < list.size(); i++)
                try {
                    net.minecraft.world.effect.MobEffectInstance.CODEC
                            .parse(ops, list.get(i))
                            .getOrThrow();
                } catch (RuntimeException ex) {
                    throw new IllegalArgumentException(
                            EditorI18n.tr(
                                    "cadeditor.message.entityschemavalidation.active_effects_invalid_effect",
                                    (i),
                                    (ex.getMessage())),
                            ex);
                }
        }
        if (tag.contains("Passengers") && !(tag.get("Passengers") instanceof ListTag))
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.entityschemavalidation.passengers_must_entity_compound_list"));
    }

    private static boolean sameJson(Tag tag, JsonElement json) {
        return EntitySchema.json(tag).equals(json);
    }

    private static boolean componentEqual(Tag a, Tag b, Level level) {
        var ops = level.registryAccess().createSerializationContext(NbtOps.INSTANCE);
        var codec = net.minecraft.network.chat.ComponentSerialization.CODEC;
        return codec.parse(ops, a).getOrThrow().equals(codec.parse(ops, b).getOrThrow());
    }

    private static boolean same(Tag a, Tag b) {
        if (a == null || b == null) return a == b;
        if (a instanceof NumericTag x && b instanceof NumericTag y)
            return Double.isFinite(x.doubleValue())
                    && Math.abs(x.doubleValue() - y.doubleValue()) <= 1e-5 * Math.max(1, Math.abs(x.doubleValue()));
        return a.equals(b);
    }

    static List<String> path(JsonArray array) {
        List<String> out = new ArrayList<>();
        array.forEach(v -> out.add(v.getAsString()));
        return out;
    }
}
