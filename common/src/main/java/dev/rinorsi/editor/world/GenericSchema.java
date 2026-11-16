package dev.rinorsi.editor.world;

import com.google.gson.*;
import com.mojang.serialization.Codec;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorSessions;
import java.util.*;
import net.minecraft.core.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.*;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;

/** Conservative shape observations. No field names, mod IDs or sample data imply semantics. */
public final class GenericSchema {
    private static final int MAX_SCHEMA_CHARS = 18000, MAX_NODES = 256, MAX_DEPTH = 8;

    private GenericSchema() {}

    public static List<String> ids(String kind) {
        return switch (kind) {
            case "entity" ->
                BuiltInRegistries.ENTITY_TYPE.keySet().stream()
                        .map(Object::toString)
                        .sorted()
                        .toList();
            case "block_entity" ->
                BuiltInRegistries.BLOCK_ENTITY_TYPE.keySet().stream()
                        .map(Object::toString)
                        .sorted()
                        .toList();
            default ->
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.genericschema.kind_must_entity_block_entity"));
        };
    }

    public static JsonObject template(String kind, String id, Level level) {
        try {
            var key = Identifier.parse(id);
            if (kind.equals("entity")) {
                var type = BuiltInRegistries.ENTITY_TYPE
                        .getOptional(key)
                        .orElseThrow(() -> new IllegalArgumentException(
                                EditorI18n.tr("cadeditor.message.genericschema.unknown_entity_type")));
                var entity = type.create(level, EntitySpawnReason.LOAD);
                if (entity == null)
                    throw new IllegalArgumentException(
                            EditorI18n.tr("cadeditor.message.genericschema.entity_factory_return_default_instance"));
                var nbt = WorldTarget.saveEntity(entity, level.registryAccess());
                return describe(
                        kind, id, nbt, level.registryAccess(), specialized(entity, nbt, level.registryAccess()));
            }
            if (!kind.equals("block_entity"))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.genericschema.unknown_schema_type"));
            var type = BuiltInRegistries.BLOCK_ENTITY_TYPE
                    .getOptional(key)
                    .orElseThrow(() -> new IllegalArgumentException(
                            EditorI18n.tr("cadeditor.message.genericschema.unknown_block_entity_type")));
            var state = BuiltInRegistries.BLOCK.stream()
                    .map(b -> b.defaultBlockState())
                    .filter(type::isValid)
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException(
                            EditorI18n.tr("cadeditor.message.genericschema.default_block_status_available")));
            var block = type.create(BlockPos.ZERO, state);
            if (block == null)
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.genericschema.block_entity_factory_return_default"));
            return describe(
                    kind,
                    id,
                    saveBlock(block, level.registryAccess()),
                    level.registryAccess(),
                    BlockViews.hasSpecialized(block));
        } catch (RuntimeException error) {
            return unavailable(
                    kind,
                    id,
                    EditorI18n.tr(
                            "cadeditor.message.genericschema.failed_create_save_default_instance",
                            (String.valueOf(error.getMessage()))));
        }
    }

    public static JsonObject unavailable(String kind, String id, String reason) {
        var out = header(kind, id, false);
        out.addProperty("available", false);
        out.addProperty("editable", "snbt_only");
        out.addProperty("editable_reason", reason.substring(0, Math.min(500, reason.length())));
        return out;
    }

    public static CompoundTag saveBlock(BlockEntity block, RegistryAccess access) {
        var problems = new net.minecraft.util.ProblemReporter.Collector();
        var output = net.minecraft.world.level.storage.TagValueOutput.createWithContext(problems, access);
        block.saveWithFullMetadata(output);
        if (!problems.isEmpty())
            throw new IllegalArgumentException(EditorI18n.tr(
                    "cadeditor.message.genericschema.block_entity_sequence_failed", (problems.getReport())));
        return output.buildResult();
    }

    private static JsonObject header(String kind, String id, boolean specialized) {
        var out = new JsonObject();
        out.addProperty("schema_version", 1);
        out.addProperty("kind", kind);
        out.addProperty("id", id);
        out.addProperty("source", "runtime_nbt_shape");
        out.addProperty("available", true);
        out.addProperty("specialized", specialized);
        out.addProperty("editable", specialized ? "readonly" : "structured");
        out.add("fields", new JsonObject());
        if (specialized)
            out.addProperty(
                    "editable_reason", EditorI18n.tr("cadeditor.message.genericschema.use_existing_dedicated_view"));
        return out;
    }

    public static JsonObject describe(
            String kind, String id, CompoundTag nbt, RegistryAccess access, boolean specialized) {
        var out = header(kind, id, specialized);
        if (specialized) return out;
        String snbt = nbt.toString();
        if (snbt.length() > MAX_SCHEMA_CHARS || nbt.size() > MAX_NODES)
            return unavailable(
                    kind, id, EditorI18n.tr("cadeditor.message.genericschema.nbt_structure_exceeds_extrapolated"));
        out.addProperty("default_snbt", snbt);
        var inspector = new Inspector(access);
        var fields = out.getAsJsonObject("fields");
        for (String key : new TreeSet<>(nbt.keySet())) {
            var field = inspector.field(nbt.get(key), List.of(key), 0);
            var changed = nbt.copy();
            changed.remove(key);
            // Reuse the existing world identity guard rather than maintaining another field table.
            try {
                WorldNbt.protect(nbt, changed, kind.equals("entity"));
            } catch (EditorSessions.Failure protectedField) {
                fallback(
                        field,
                        "readonly",
                        EditorI18n.tr("cadeditor.message.genericschema.identity_location_association_field"));
            }
            fields.add(key, field);
        }
        // A single oversized mod must not break enumeration or the world snapshot.
        if (out.toString().length() > MAX_SCHEMA_CHARS)
            return unavailable(
                    kind, id, EditorI18n.tr("cadeditor.message.genericschema.nbt_structure_exceeds_single_budget"));
        return out;
    }

    public static boolean specialized(Entity entity, CompoundTag saved, RegistryAccess access) {
        return specialized(EntityWorldEdit.specializedViews(entity, saved, access));
    }

    static boolean specialized(JsonObject views) {
        // Shared relationship/read-only sections are not a type-specific editor.
        return views.keySet().stream()
                .anyMatch(key -> !Set.of("riding", "team", "leash").contains(key));
    }

    public static JsonObject view(String kind, String id, CompoundTag nbt, RegistryAccess access) {
        var row = new JsonObject();
        var schema = describe(kind, id, nbt, access, false);
        row.add("schema", schema);
        var value = new JsonObject();
        if (schema.get("available").getAsBoolean())
            for (String key : nbt.keySet()) value.addProperty(key, nbt.get(key).toString());
        row.add("value", value); // The complete SNBT already travels on world.snbt; do not duplicate huge data.
        if (nbt.toString().length() <= MAX_SCHEMA_CHARS) row.addProperty("snbt", nbt.toString());
        return row;
    }

    public static CompoundTag apply(String kind, String id, CompoundTag base, JsonObject edits, RegistryAccess access) {
        var schema = describe(kind, id, base, access, false);
        if (!schema.get("available").getAsBoolean())
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.genericschema.type_only_edited_data_page"));
        var fields = schema.getAsJsonObject("fields");
        var next = base.copy();
        for (var edit : edits.entrySet()) {
            String key = edit.getKey();
            var field = fields.getAsJsonObject(key);
            if (field == null || !field.get("editable").getAsString().equals("structured"))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.genericschema.field_only_edited_protected_data", (key)));
            if (!edit.getValue().isJsonPrimitive()
                    || !edit.getValue().getAsJsonPrimitive().isString())
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.genericschema.generic_field_must_snbt_string"));
            // Parse exactly one bounded SNBT value; a wrapper would accept injected duplicate keys.
            Tag value = dev.rinorsi.editor.ComponentValidation.parseSnbt(
                    edit.getValue().getAsString());
            if (value == null || value.getId() != base.get(key).getId())
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.genericschema.unchangeable_nbt_save_type", (key)));
            next.put(key, value.copy());
        }
        WorldNbt.protect(base, next, kind.equals("entity"));
        return next;
    }

    public static void requireRetained(CompoundTag requested, CompoundTag saved) {
        for (String key : requested.keySet())
            if (!Objects.equals(requested.get(key), saved.get(key)))
                throw new EditorSessions.Failure(
                        "invalid_nbt",
                        EditorI18n.tr("cadeditor.message.genericschema.load_saving_lose_change_field", (key)));
    }

    public static boolean hasEdits(JsonObject request) {
        return (request.has("views")
                        && dev.rinorsi.editor.StackCodec.object(request, "views")
                                .has("generic"))
                || (request.has("entity")
                        && dev.rinorsi.editor.StackCodec.object(request, "entity")
                                .has("generic"));
    }

    private static void fallback(JsonObject out, String editable, String reason) {
        out.addProperty("editable", editable);
        out.addProperty("read_only", true);
        out.addProperty("editable_reason", reason);
        out.addProperty("read_only_reason", reason);
    }

    private static final class Inspector {
        final RegistryAccess access;
        final List<HolderLookup.RegistryLookup<?>> worldRegistries;
        final List<Registry<?>> staticRegistries = new ArrayList<>();
        final Map<Identifier, SortedSet<String>> registryIds = new HashMap<>();
        int nodes;

        Inspector(RegistryAccess access) {
            this.access = access;
            // World registry values take precedence; static registries fill unsynchronized gaps.
            // Query only the actual strings in this NBT, not every entry of every registry per entity.
            worldRegistries = access.listRegistries().toList();
            var seen = new HashSet<String>();
            worldRegistries.forEach(
                    registry -> seen.add(registry.key().identifier().toString()));
            for (var registry : BuiltInRegistries.REGISTRY) {
                String name = registry.key().identifier().toString();
                if (!seen.contains(name)) staticRegistries.add(registry);
            }
        }

        private SortedSet<String> matches(Identifier id) {
            return registryIds.computeIfAbsent(id, key -> {
                var matches = new TreeSet<String>();
                for (var registry : worldRegistries)
                    if (contains(registry, key))
                        matches.add(registry.key().identifier().toString());
                for (var registry : staticRegistries)
                    if (registry.containsKey(key))
                        matches.add(registry.key().identifier().toString());
                return matches;
            });
        }

        @SuppressWarnings("unchecked")
        private static <T> boolean contains(HolderLookup.RegistryLookup<T> registry, Identifier id) {
            // RegistryLookup exposes a covariant registry key; the lookup itself is its authority.
            var key = (net.minecraft.resources.ResourceKey<? extends Registry<T>>)
                    (net.minecraft.resources.ResourceKey<?>) registry.key();
            return registry.get(net.minecraft.resources.ResourceKey.create(key, id))
                    .isPresent();
        }

        JsonObject field(Tag value, List<String> path, int depth) {
            var out = new JsonObject();
            String type = "unknown";
            out.addProperty(
                    "nbt_type",
                    switch (value.getId()) {
                        case Tag.TAG_BYTE_ARRAY -> "byte_array";
                        case Tag.TAG_INT_ARRAY -> "int_array";
                        case Tag.TAG_LONG_ARRAY -> "long_array";
                        default -> value.getType().getName().toLowerCase(Locale.ROOT);
                    });
            var p = new JsonArray();
            path.forEach(p::add);
            out.add("nbtPath", p);
            out.addProperty("default_snbt", value.toString());
            out.addProperty("nullable", false);
            out.addProperty("editable", "structured");
            out.addProperty("read_only", false);
            out.addProperty("authority", "runtime_nbt_shape_and_detached_loader");
            if (++nodes > MAX_NODES || depth > MAX_DEPTH)
                fallback(
                        out,
                        "snbt_only",
                        EditorI18n.tr("cadeditor.message.genericschema.structure_exceeds_extrapolated_budget"));
            else if (value instanceof ByteTag b && (b.byteValue() == 0 || b.byteValue() == 1)) {
                fallback(
                        out,
                        "snbt_only",
                        EditorI18n.tr("cadeditor.message.genericschema.single_byte_sample_cannot_prove"));
            } else if (value instanceof ByteTag
                    || value instanceof ShortTag
                    || value instanceof IntTag
                    || value instanceof LongTag) type = "integer";
            else if (value instanceof FloatTag || value instanceof DoubleTag) type = "number";
            else if (value instanceof StringTag s) {
                type = "string";
                Identifier id = Identifier.tryParse(s.value());
                var matches = id == null ? null : matches(id);
                if (matches != null && !matches.isEmpty()) {
                    type = "identifier";
                    var registries = new JsonArray();
                    matches.forEach(registries::add);
                    out.add("registry_matches", registries);
                    var source = new JsonObject();
                    source.addProperty("kind", "registry");
                    source.add("registries", registries.deepCopy());
                    out.add("candidate_source", source);
                    out.addProperty("allowManual", true);
                }
            } else if (value instanceof CompoundTag compound) {
                if (exact(ItemStack.CODEC, value)) type = "stack";
                else if (exact(BlockState.CODEC, value)) type = "block_state";
                else {
                    type = "object";
                    var children = new JsonObject();
                    for (String key : new TreeSet<>(compound.keySet())) {
                        if (nodes >= MAX_NODES) break;
                        var nested = new ArrayList<>(path);
                        nested.add(key);
                        children.add(key, field(compound.get(key), nested, depth + 1));
                    }
                    out.add("fields", children);
                    out.addProperty("fields_complete", children.size() == compound.size());
                }
                fallback(
                        out, "snbt_only", EditorI18n.tr("cadeditor.message.genericschema.complex_field_must_keep_all"));
            } else if (value instanceof ListTag list) {
                type = "array";
                var elements = new JsonArray();
                for (int i = 0; i < list.size() && nodes < MAX_NODES; i++) {
                    var nested = new ArrayList<>(path);
                    nested.add(Integer.toString(i));
                    elements.add(field(list.get(i), nested, depth + 1));
                }
                out.add("elements", elements);
                out.addProperty("elements_complete", elements.size() == list.size());
                out.addProperty("length", list.size());
                fallback(
                        out,
                        "snbt_only",
                        EditorI18n.tr("cadeditor.message.genericschema.sample_prove_structure_future_list"));
            } else
                fallback(
                        out,
                        "snbt_only",
                        EditorI18n.tr("cadeditor.message.genericschema.nbt_array_unknown_type_field"));
            out.addProperty("type", type);
            out.addProperty("kind", type);
            return out;
        }

        private <T> boolean exact(Codec<T> codec, Tag value) {
            try {
                var ops = access.createSerializationContext(NbtOps.INSTANCE);
                var parsed = codec.parse(ops, value);
                return parsed.isSuccess()
                        && codec.encodeStart(ops, parsed.getOrThrow())
                                .result()
                                .filter(value::equals)
                                .isPresent();
            } catch (RuntimeException error) {
                return false;
            }
        }
    }
}
