package dev.rinorsi.editor;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.rinorsi.editor.history.HistoryContext;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import net.minecraft.core.RegistryAccess;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtOps;
import net.minecraft.nbt.NumericTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.nbt.Tag;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * Item rules for players without {@code cadeditor.item.bypass}: no banned items, no added, changed or stripped
 * restricted components and no command click events. Compares the saved NBT before and after a write.
 */
public final class ItemRules {
    /** Click actions that make the client run something on the server when a player clicks the text. */
    private static final Set<String> COMMAND_CLICKS = Set.of("run_command", "custom");

    private static final ThreadLocal<ServerPlayer> ACTOR = new ThreadLocal<>();

    private ItemRules() {}

    /**
     * The "itemRules" block of cadeditor.json.
     *
     * @param bannedItems item ids nobody without the bypass node may add (default: vanilla's operator items)
     * @param restrictedComponents data components nobody without the bypass node may add, change, copy or strip
     * @param blockCommandClicks reject new text click events that run commands (run_command, custom)
     */
    public record Settings(Set<String> bannedItems, Set<String> restrictedComponents, boolean blockCommandClicks) {
        public static final Settings DEFAULT = new Settings(
                ids(
                        List.of(
                                "minecraft:command_block",
                                "minecraft:chain_command_block",
                                "minecraft:repeating_command_block",
                                "minecraft:command_block_minecart",
                                "minecraft:structure_block",
                                "minecraft:structure_void",
                                "minecraft:jigsaw",
                                "minecraft:barrier",
                                "minecraft:light",
                                "minecraft:debug_stick",
                                "minecraft:test_block",
                                "minecraft:test_instance_block"),
                        "bannedItems"),
                ids(
                        List.of(
                                "minecraft:custom_data",
                                "minecraft:block_entity_data",
                                "minecraft:entity_data",
                                "minecraft:can_break",
                                "minecraft:can_place_on"),
                        "restrictedComponents"),
                true);
        private static final Set<String> KEYS = Set.of("bannedItems", "restrictedComponents", "blockCommandClicks");

        public Settings {
            bannedItems = Collections.unmodifiableSet(new LinkedHashSet<>(bannedItems));
            restrictedComponents = Collections.unmodifiableSet(new LinkedHashSet<>(restrictedComponents));
        }

        public static Settings parse(@Nullable JsonElement element) {
            if (element == null) return DEFAULT;
            if (!element.isJsonObject()) throw new IllegalArgumentException("itemRules must be an object");
            var json = element.getAsJsonObject();
            for (String key : json.keySet())
                if (!KEYS.contains(key)) throw new IllegalArgumentException("itemRules." + key + " is not a setting");
            return new Settings(
                    list(json, "bannedItems", DEFAULT.bannedItems),
                    list(json, "restrictedComponents", DEFAULT.restrictedComponents),
                    bool(json, "blockCommandClicks", DEFAULT.blockCommandClicks));
        }

        public JsonObject toJson() {
            var json = new JsonObject();
            var banned = new JsonArray();
            bannedItems.forEach(banned::add);
            json.add("bannedItems", banned);
            var restricted = new JsonArray();
            restrictedComponents.forEach(restricted::add);
            json.add("restrictedComponents", restricted);
            json.addProperty("blockCommandClicks", blockCommandClicks);
            return json;
        }

        private static Set<String> list(JsonObject json, String key, Set<String> fallback) {
            var value = json.get(key);
            if (value == null) return fallback;
            if (!value.isJsonArray()) throw new IllegalArgumentException("itemRules." + key + " must be a list of ids");
            var out = new java.util.ArrayList<String>();
            for (var element : value.getAsJsonArray()) {
                if (!element.isJsonPrimitive() || !element.getAsJsonPrimitive().isString())
                    throw new IllegalArgumentException("itemRules." + key + " must be a list of ids");
                out.add(element.getAsString());
            }
            return ids(out, "itemRules." + key);
        }

        private static boolean bool(JsonObject json, String key, boolean fallback) {
            var value = json.get(key);
            if (value == null) return fallback;
            if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean())
                throw new IllegalArgumentException("itemRules." + key + " must be true or false");
            return value.getAsBoolean();
        }

        private static Set<String> ids(List<String> raw, String where) {
            var out = new LinkedHashSet<String>();
            for (String id : raw) {
                String normalized = normalize(id);
                if (normalized == null)
                    throw new IllegalArgumentException(where + ": '" + id + "' is not a namespaced id");
                out.add(normalized);
            }
            return out;
        }
    }

    /** Why a write was refused: the kind of rule, and the item or component and the item it was found on. */
    public record Violation(Kind kind, String subject, String item) {
        public enum Kind {
            BANNED,
            COMPONENT,
            STRIPPED,
            CLICK
        }

        public String message() {
            return switch (kind) {
                case BANNED -> EditorI18n.tr("cadeditor.message.itemrules.banned", subject);
                case COMPONENT -> EditorI18n.tr("cadeditor.message.itemrules.component", subject, item);
                case STRIPPED -> EditorI18n.tr("cadeditor.message.itemrules.stripped", item);
                case CLICK -> EditorI18n.tr("cadeditor.message.itemrules.click", subject);
            };
        }

        /** The history detail: a short machine-readable account. */
        public String detail() {
            return kind.name().toLowerCase(Locale.ROOT) + " " + subject
                    + (item.isEmpty() || item.equals(subject) ? "" : " on " + item);
        }
    }

    // ---- The requesting player (set by EditorMod for one request) ----

    /** Makes {@code player} the actor whose writes {@link #checkCurrent} checks, until the scope closes. */
    public static Scope enter(ServerPlayer player) {
        var previous = ACTOR.get();
        ACTOR.set(player);
        return () -> {
            if (previous == null) ACTOR.remove();
            else ACTOR.set(previous);
        };
    }

    @FunctionalInterface
    public interface Scope extends AutoCloseable {
        @Override
        void close();
    }

    // ---- Checks ----

    /** Whether the rules do not apply to this player ({@code cadeditor.item.bypass}). */
    public static boolean exempt(ServerPlayer player) {
        return EditorPolicy.current().allowed(player, EditorPermission.ITEM_BYPASS);
    }

    /** Fails with {@code item_restricted} when the change from {@code before} to {@code after} breaks a rule. */
    public static void check(ServerPlayer actor, ItemStack before, ItemStack after) {
        if (exempt(actor)) return;
        require(find(
                EditorPolicy.current().itemRules(),
                encode(before, actor.registryAccess()),
                encode(after, actor.registryAccess())));
    }

    /** The same for saved data (block entity, entity, player data). */
    public static void check(ServerPlayer actor, @Nullable Tag before, @Nullable Tag after) {
        if (exempt(actor)) return;
        require(find(EditorPolicy.current().itemRules(), before, after));
    }

    /** {@link #check(ServerPlayer, ItemStack, ItemStack)} for the request's actor; no actor (console, tests): no check. */
    public static void checkCurrent(ItemStack before, ItemStack after) {
        var actor = ACTOR.get();
        if (actor != null) check(actor, before, after);
    }

    /** The first rule the stack breaks for this actor (testkit filtering), or null. */
    public static @Nullable Violation violation(ServerPlayer actor, ItemStack before, ItemStack after) {
        if (exempt(actor)) return null;
        return find(
                EditorPolicy.current().itemRules(),
                encode(before, actor.registryAccess()),
                encode(after, actor.registryAccess()));
    }

    private static void require(@Nullable Violation violation) {
        if (violation == null) return;
        HistoryContext.node(EditorPermission.ITEM_BYPASS.node);
        HistoryContext.detail("item_rule", violation.detail());
        EditorSessions.fail("item_restricted", violation.message());
    }

    private static @Nullable Tag encode(ItemStack stack, RegistryAccess registries) {
        if (stack == null || stack.isEmpty()) return null;
        return ItemStack.CODEC
                .encodeStart(registries.createSerializationContext(NbtOps.INSTANCE), stack)
                .getOrThrow();
    }

    // ---- The rule itself (pure: no player, no registries) ----

    /** The first rule broken by turning {@code before} into {@code after}, or null when the write is allowed. */
    public static @Nullable Violation find(Settings settings, @Nullable Tag before, @Nullable Tag after) {
        var old = Scan.of(settings, before);
        var now = Scan.of(settings, after);
        // New or altered flagged items (banned id, or restricted components with their values and the stack size).
        for (var entry : now.flagged.entrySet()) {
            if (entry.getValue() <= old.flagged.getOrDefault(entry.getKey(), 0)) continue;
            var key = now.keys.get(entry.getKey());
            if (settings.bannedItems().contains(key.id)) return new Violation(Violation.Kind.BANNED, key.id, key.id);
            return new Violation(Violation.Kind.COMPONENT, String.join(", ", key.restricted.keySet()), key.id);
        }
        // Restricted data stripped off an item: a flagged stack went away while a plain stack of that item appeared.
        for (var entry : old.flaggedIds.entrySet()) {
            String id = entry.getKey();
            int lost = 0;
            for (var flagged : old.flagged.entrySet())
                if (old.keys.get(flagged.getKey()).id.equals(id))
                    lost += Math.max(0, flagged.getValue() - now.flagged.getOrDefault(flagged.getKey(), 0));
            if (lost > 0 && now.plain.getOrDefault(id, 0) > old.plain.getOrDefault(id, 0))
                return new Violation(Violation.Kind.STRIPPED, id, id);
        }
        if (settings.blockCommandClicks())
            for (var entry : now.clicks.entrySet())
                if (entry.getValue() > old.clicks.getOrDefault(entry.getKey(), 0))
                    return new Violation(Violation.Kind.CLICK, now.clickActions.get(entry.getKey()), "");
        return null;
    }

    private record ItemKey(String id, Map<String, String> restricted) {}

    /** Every item-like compound (a compound with an "id") and every command click event in one tag tree. */
    private static final class Scan {
        final Map<String, Integer> flagged = new HashMap<>();
        final Map<String, ItemKey> keys = new HashMap<>();
        final Map<String, Integer> flaggedIds = new HashMap<>();
        final Map<String, Integer> plain = new HashMap<>();
        final Map<String, Integer> clicks = new HashMap<>();
        final Map<String, String> clickActions = new HashMap<>();

        static Scan of(Settings settings, @Nullable Tag root) {
            var scan = new Scan();
            if (root == null) return scan;
            var pending = new ArrayDeque<Tag>();
            pending.push(root);
            while (!pending.isEmpty()) {
                var tag = pending.pop();
                if (tag instanceof CompoundTag compound) {
                    scan.item(settings, compound);
                    scan.click(compound);
                    for (String key : compound.keySet()) pending.push(compound.get(key));
                } else if (tag instanceof ListTag list) {
                    for (Tag element : list) pending.push(element);
                }
            }
            return scan;
        }

        private void item(Settings settings, CompoundTag compound) {
            if (!(compound.get("id") instanceof StringTag(String raw))) return;
            String id = normalize(raw);
            if (id == null) return;
            var restricted = new TreeMap<String, String>();
            if (compound.get("components") instanceof CompoundTag components) {
                for (String key : components.keySet()) {
                    boolean removal = key.startsWith("!");
                    String component = normalize(removal ? key.substring(1) : key);
                    if (component != null && settings.restrictedComponents().contains(component))
                        restricted.put(component, removal ? "<removed>" : String.valueOf(components.get(key)));
                }
            }
            if (!settings.bannedItems().contains(id) && restricted.isEmpty()) {
                plain.merge(id, 1, Integer::sum);
                return;
            }
            int count = compound.get("count") instanceof NumericTag number ? number.intValue() : 1;
            String key = id + "*" + count + restricted;
            flagged.merge(key, 1, Integer::sum);
            keys.putIfAbsent(key, new ItemKey(id, restricted));
            flaggedIds.merge(id, 1, Integer::sum);
        }

        private void click(CompoundTag compound) {
            for (String field : new String[] {"click_event", "clickEvent"}) {
                if (!(compound.get(field) instanceof CompoundTag event)) continue;
                if (!(event.get("action") instanceof StringTag(String action))) continue;
                String normalized = action.toLowerCase(Locale.ROOT);
                if (!COMMAND_CLICKS.contains(normalized)) continue;
                String key = normalized + event;
                clicks.merge(key, 1, Integer::sum);
                clickActions.putIfAbsent(key, normalized);
            }
        }
    }

    /** "barrier" and "minecraft:barrier" are the same id; null when the text is not an id at all. */
    static @Nullable String normalize(String raw) {
        if (raw == null) return null;
        String id = raw.trim().toLowerCase(Locale.ROOT);
        if (!id.contains(":")) id = "minecraft:" + id;
        return id.matches("[a-z0-9_.-]+:[a-z0-9_./-]+") ? id : null;
    }
}
