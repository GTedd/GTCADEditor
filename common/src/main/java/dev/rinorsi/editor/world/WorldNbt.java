package dev.rinorsi.editor.world;

import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorSessions;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Objects;
import java.util.Set;
import net.minecraft.nbt.*;

/** Wire NBT is always SNBT, never a lossy JSON-to-NBT conversion. */
public final class WorldNbt {
    public static final int MAX_SNBT = dev.rinorsi.editor.EditorWire.MAX_NBT_CHARS;

    private WorldNbt() {}

    public static CompoundTag parse(String text) {
        var tag = parseValue(text);
        if (tag instanceof CompoundTag compound) return compound;
        throw new EditorSessions.Failure(
                "invalid_nbt", EditorI18n.tr("cadeditor.message.worldnbt.world_goal_data_must_compound"));
    }
    /** Same size/depth gate for typed values of normalized, allowlisted fields. */
    public static Tag parseValue(String text) {
        if (text.length() > MAX_SNBT)
            EditorSessions.fail(
                    "payload_too_large", EditorI18n.tr("cadeditor.message.worldnbt.world_target_snbt_over_1"));
        try {
            var tag = TagParser.create(NbtOps.INSTANCE).parseFully(text);
            checkDepth(tag, 0);
            return tag;
        } catch (com.mojang.brigadier.exceptions.CommandSyntaxException e) {
            EditorSessions.fail(
                    "invalid_nbt", EditorI18n.tr("cadeditor.message.worldnbt.snbt_invalid", (e.getMessage())));
        }
        throw new EditorSessions.Failure("invalid_nbt", EditorI18n.tr("cadeditor.message.worldnbt.snbt_invalid_2"));
    }

    private static void checkDepth(Tag tag, int depth) {
        if (depth > 32)
            EditorSessions.fail("invalid_nbt", EditorI18n.tr("cadeditor.message.worldnbt.nbt_nest_over_32_layer"));
        if (tag instanceof CompoundTag c) for (String key : c.keySet()) checkDepth(c.get(key), depth + 1);
        else if (tag instanceof ListTag l) for (Tag child : l) checkDepth(child, depth + 1);
    }
    /** Top-level keys whose values differ (ticking entity state excluded), for the history record. */
    public static String changedKeys(CompoundTag before, CompoundTag after) {
        var keys = new java.util.TreeSet<String>();
        var all = new java.util.HashSet<>(before.keySet());
        all.addAll(after.keySet());
        for (String key : all)
            if (!EntityVolatile.CURRENT.contains(key) && !java.util.Objects.equals(before.get(key), after.get(key)))
                keys.add(key);
        String joined = String.join(",", keys);
        return joined.length() > 180 ? joined.substring(0, 180) + "…" : joined;
    }

    public static String revision(CompoundTag tag) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            canonical(EntityVolatile.stable(BlockVolatile.stable(tag)), digest);
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new AssertionError(e);
        }
    }

    private static void canonical(Tag tag, MessageDigest digest) {
        part(digest, Byte.toString(tag.getId()));
        if (tag instanceof CompoundTag c) {
            for (String key : new java.util.TreeSet<>(c.keySet())) {
                part(digest, key);
                canonical(c.get(key), digest);
            }
        } else if (tag instanceof ListTag l) for (Tag child : l) canonical(child, digest);
        else part(digest, tag.toString());
        part(digest, ";");
    }

    private static void part(MessageDigest digest, String text) {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        digest.update(java.nio.ByteBuffer.allocate(4).putInt(bytes.length).array());
        digest.update(bytes);
    }
    // Security policy, not a registry/options list. Position/relationships need trusted operations.
    public static void protect(CompoundTag before, CompoundTag after, boolean entity) {
        Set<String> keys = entity
                ? Set.of(
                        "id",
                        "UUID",
                        "Pos",
                        "Rotation",
                        "Dimension",
                        "Passengers",
                        "RootVehicle",
                        "Leash",
                        "leash",
                        "PortalCooldown",
                        "TileX",
                        "TileY",
                        "TileZ",
                        "block_pos",
                        "Facing",
                        "facing",
                        "SleepingX",
                        "SleepingY",
                        "SleepingZ")
                : Set.of("id", "x", "y", "z", "keepPacked");
        for (String key : keys)
            if (!Objects.equals(before.get(key), after.get(key)))
                EditorSessions.fail("protected_field", EditorI18n.tr("cadeditor.message.worldnbt.field", (key)));
    }
    /** Legacy content-fingerprint assertion for probes. World session authorization uses the
     * frozen State.revision generation and must never compare this against a live save. */
    public static void requireRevision(String baseline, CompoundTag current) {
        if (baseline == null || !baseline.equals(revision(current)))
            EditorSessions.fail(
                    "target_changed",
                    EditorI18n.tr("cadeditor.message.worldnbt.targets_changed_during_editing_reread"));
    }

    public static void requireEditedFieldsRetained(CompoundTag before, CompoundTag requested, CompoundTag prepared) {
        var keys = new java.util.HashSet<>(requested.keySet());
        keys.addAll(before.keySet());
        for (String key : keys)
            if (!Objects.equals(before.get(key), requested.get(key))
                    && !editedFieldRetained(key, requested.get(key), prepared.get(key))
                    && !(key.equals("attributes")
                            && EntityVolatile.entity(requested)
                            && attributeOrderRetained(requested.get(key), prepared.get(key))))
                EditorSessions.fail(
                        "invalid_nbt",
                        EditorI18n.tr("cadeditor.message.worldnbt.vanilla_minecraft_loader_keep_modified", (key)));
    }
    /** Native AttributeMap saves in map iteration order. Ignore only row order: IDs must be
     * unique and every row (including numeric tag types, modifiers and unknown keys) stays exact.
     * This exception is entity-only; arbitrary block lists still retain ordered semantics. */
    private static boolean attributeOrderRetained(Tag requested, Tag prepared) {
        if (!(requested instanceof ListTag left) || !(prepared instanceof ListTag right) || left.size() != right.size())
            return false;
        var rows = new java.util.HashMap<String, CompoundTag>();
        for (Tag raw : left) {
            if (!(raw instanceof CompoundTag row)) return false;
            String id = row.getString("id").orElse("");
            if (id.isEmpty() || rows.putIfAbsent(id, row) != null) return false;
        }
        for (Tag raw : right) {
            if (!(raw instanceof CompoundTag row)) return false;
            String id = row.getString("id").orElse("");
            if (!row.equals(rows.remove(id))) return false;
        }
        return rows.isEmpty();
    }

    static boolean editedFieldRetained(String key, Tag requested, Tag prepared) {
        return Objects.equals(requested, prepared)
                || (key.equals("active_effects") && EffectNbt.retained(requested, prepared));
    }
}
