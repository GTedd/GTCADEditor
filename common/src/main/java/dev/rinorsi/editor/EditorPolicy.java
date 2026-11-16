package dev.rinorsi.editor;

import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.rinorsi.editor.history.HistoryContext;
import dev.rinorsi.editor.history.HistorySettings;
import dev.rinorsi.editor.platform.Platform;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.Permission;
import net.minecraft.server.permissions.PermissionLevel;
import net.minecraft.server.permissions.Permissions;
import org.slf4j.LoggerFactory;

/**
 * The editor policy (cadeditor.json) and the permission decisions, based only on the server-side player.
 *
 * @param adminLevel operator level that counts as editor admin for the ADMIN defaults (1-4, default 2 = gamemaster)
 * @param creativeItemEdit creative-mode players without ITEM_EDIT may still write their own items (vanilla capability)
 * @param creativeWorldEdit creative-mode players without the world nodes may read and write blocks and entities
 * @param history what the server records and keeps
 * @param itemRules what players without cadeditor.item.bypass may not write (banned items, restricted components)
 * @param debugLog print every request's trace to the console (off: the console stays quiet, the history keeps records)
 */
public record EditorPolicy(
        int adminLevel,
        boolean creativeItemEdit,
        boolean creativeWorldEdit,
        HistorySettings history,
        ItemRules.Settings itemRules,
        boolean debugLog) {
    private static final Set<String> KEYS = Set.of(
            "adminLevel",
            "creativeItemEdit",
            "creativeWorldEdit",
            "itemRules",
            "history",
            "debugLog",
            "permissionLevel",
            "creativeOnly");
    /** Upstream's defaults, for code and tests that predate the permission nodes. */
    public static final EditorPolicy LEGACY = new EditorPolicy(2, true, true, HistorySettings.DEFAULT);
    /** This fork's defaults: creative players keep their item capability, the world needs an admin or a node. */
    public static final EditorPolicy DEFAULT = new EditorPolicy(2, true, false, HistorySettings.DEFAULT);

    private static volatile EditorPolicy current = DEFAULT;

    public EditorPolicy {
        if (adminLevel < 1 || adminLevel > 4) throw new IllegalArgumentException("adminLevel must be 1-4");
        java.util.Objects.requireNonNull(history);
        java.util.Objects.requireNonNull(itemRules);
    }

    /** The default item rules, console quiet. */
    public EditorPolicy(int adminLevel, boolean creativeItemEdit, boolean creativeWorldEdit, HistorySettings history) {
        this(adminLevel, creativeItemEdit, creativeWorldEdit, history, ItemRules.Settings.DEFAULT, false);
    }

    /** Upstream's two-key constructor (permissionLevel and creativeOnly were already ignored there). */
    public EditorPolicy(int permissionLevel, boolean creativeOnly) {
        this(2, true, true, HistorySettings.DEFAULT);
    }

    /** The policy every request and command is checked against. */
    public static EditorPolicy current() {
        return current;
    }

    /** Makes {@code policy} current (load does this; tests and probes install their own). */
    public static void install(EditorPolicy policy) {
        current = java.util.Objects.requireNonNull(policy);
        EditorWriteLog.verbose(policy.debugLog() || Boolean.getBoolean("cadeditor.debug"));
    }

    /** Loads cadeditor.json (writing missing keys with their defaults) and makes it the current policy. */
    public static EditorPolicy load() {
        var path = Platform.get().configDir().resolve("cadeditor.json");
        try {
            JsonObject json = Files.exists(path)
                    ? JsonParser.parseString(Files.readString(path)).getAsJsonObject()
                    : new JsonObject();
            for (String key : json.keySet())
                if (!KEYS.contains(key))
                    LoggerFactory.getLogger("cadeditor").warn("[CAD-Editor] {}: unknown key {} ignored", path, key);
            var policy = parse(json);
            var complete = policy.toJson();
            // Legacy keys stay readable (ignored, as upstream already did) but are not written again.
            if (!complete.equals(withoutLegacy(json))) {
                Files.createDirectories(path.getParent());
                var temporary = path.resolveSibling("cadeditor.json.tmp");
                Files.writeString(
                        temporary,
                        new GsonBuilder().setPrettyPrinting().create().toJson(complete) + "\n");
                Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            }
            install(policy);
            return policy;
        } catch (IOException | RuntimeException e) {
            throw new IllegalStateException(
                    EditorI18n.tr("cadeditor.message.editorpolicy.unable_read", (path), (e.getMessage())), e);
        }
    }

    /** cadeditor.json's content; missing keys take this fork's defaults, legacy keys are ignored. */
    public static EditorPolicy parse(JsonObject json) {
        return new EditorPolicy(
                integer(json, "adminLevel", DEFAULT.adminLevel, 1, 4),
                bool(json, "creativeItemEdit", DEFAULT.creativeItemEdit),
                bool(json, "creativeWorldEdit", DEFAULT.creativeWorldEdit),
                HistorySettings.parse(json.get("history")),
                ItemRules.Settings.parse(json.get("itemRules")),
                bool(json, "debugLog", DEFAULT.debugLog));
    }

    public JsonObject toJson() {
        var json = new JsonObject();
        json.addProperty("adminLevel", adminLevel);
        json.addProperty("creativeItemEdit", creativeItemEdit);
        json.addProperty("creativeWorldEdit", creativeWorldEdit);
        json.add("itemRules", itemRules.toJson());
        json.add("history", history.toJson());
        json.addProperty("debugLog", debugLog);
        return json;
    }

    // ---- Decisions ----

    /** The node's decision for this player; USE gates every other node. */
    public boolean allowed(ServerPlayer player, EditorPermission permission) {
        var facts = new Facts(
                admin(player), player.permissions().hasPermission(Permissions.COMMANDS_OWNER), player.isCreative());
        return decide(permission, facts, (node, fallback) -> {
            try {
                return Platform.get().hasPermission(player, node, fallback);
            } catch (LinkageError
                    | IllegalStateException
                    | java.util.ServiceConfigurationError
                    | java.util.NoSuchElementException e) {
                // Headless tests without a platform: the editor's own default.
                return fallback;
            }
        });
    }

    /** What the server knows about the player; never anything the client sent. */
    public record Facts(boolean admin, boolean owner, boolean creative) {}

    /** A permission provider: the node's decision given the editor's default (explicit settings win). */
    @FunctionalInterface
    public interface Provider {
        boolean decide(String node, boolean fallback);
    }

    /** The decision rule itself: USE first, then the provider, which falls back to the node's default. */
    public boolean decide(EditorPermission permission, Facts facts, Provider provider) {
        if (permission != EditorPermission.USE && !decide(EditorPermission.USE, facts, provider)) return false;
        return provider.decide(permission.node, fallback(facts, permission.fallback));
    }

    /** Fails with {@code code} (the route's protocol code) unless the node is granted; the history notes the node. */
    public void require(ServerPlayer player, EditorPermission permission, String code) {
        if (allowed(player, permission)) return;
        HistoryContext.node(permission.node);
        EditorSessions.fail(code, EditorI18n.tr("cadeditor.message.permission.denied", permission.node));
    }

    /** Fails unless at least one of the nodes is granted. */
    public void requireAny(ServerPlayer player, String code, EditorPermission... permissions) {
        for (var permission : permissions) if (allowed(player, permission)) return;
        HistoryContext.node(permissions[0].node);
        EditorSessions.fail(code, EditorI18n.tr("cadeditor.message.permission.denied", permissions[0].node));
    }

    /** Every node's decision, for the editor UI (display only: the server checks again on every request). */
    public Map<String, Boolean> capabilities(ServerPlayer player) {
        var out = new LinkedHashMap<String, Boolean>();
        for (var permission : EditorPermission.values()) out.put(permission.key(), allowed(player, permission));
        // Read-only hint, not a node: whether new run_command/custom click events would pass the item rules.
        out.put(
                "item.command_clicks",
                !itemRules.blockCommandClicks() || allowed(player, EditorPermission.ITEM_BYPASS));
        return out;
    }

    public boolean admin(ServerPlayer player) {
        return player.permissions().hasPermission(level(adminLevel));
    }

    private boolean fallback(Facts facts, EditorPermission.Default rule) {
        return switch (rule) {
            case EVERYONE -> true;
            case ADMIN -> facts.admin();
            case OWNER -> facts.owner();
            case CREATIVE_ITEMS -> facts.admin() || (creativeItemEdit && facts.creative());
            case CREATIVE_WORLD -> facts.admin() || (creativeWorldEdit && facts.creative());
        };
    }

    public static Permission level(int level) {
        return new Permission.HasCommandLevel(PermissionLevel.byId(level));
    }

    // ---- Upstream entry points ----

    /** Item writes: ITEM_EDIT, or the creative capability (ITEM_CREATIVE in creative mode). */
    public void require(ServerPlayer player) {
        require(player, EditorPermission.USE, "permission_denied");
        if (allowed(player, EditorPermission.ITEM_EDIT)) return;
        if (player.isCreative() && allowed(player, EditorPermission.ITEM_CREATIVE)) return;
        HistoryContext.node(EditorPermission.ITEM_EDIT.node);
        EditorSessions.fail(
                "permission_denied", EditorI18n.tr("cadeditor.message.editorpolicy.editing_needs_editor_s_item"));
    }

    /** Vanilla gamemaster (operator level 2): command blocks, operator-only NBT, spectator access. Never a node. */
    public static boolean gameMaster(ServerPlayer player) {
        return player.permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER);
    }

    /** Online player data (one's own included). */
    public void requirePlayerEdit(ServerPlayer player) {
        require(player, EditorPermission.PLAYER_EDIT, "player_forbidden");
    }

    // Upstream's pure rule for the creative capability; kept for its tests.
    public boolean allows(boolean creative, boolean permitted) {
        return creative || permitted;
    }

    // ---- cadeditor.json ----

    private static JsonObject withoutLegacy(JsonObject json) {
        var copy = json.deepCopy();
        copy.remove("permissionLevel");
        copy.remove("creativeOnly");
        return copy;
    }

    private static boolean bool(JsonObject json, String key, boolean fallback) {
        JsonElement value = json.get(key);
        if (value == null) return fallback;
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean())
            throw new IllegalArgumentException(EditorI18n.tr("cadeditor.message.policy.invalid", key, "true / false"));
        return value.getAsBoolean();
    }

    static int integer(JsonObject json, String key, int fallback, int min, int max) {
        JsonElement value = json.get(key);
        if (value == null) return fallback;
        if (!value.isJsonPrimitive()
                || !value.getAsJsonPrimitive().isNumber()
                || value.getAsDouble() != Math.rint(value.getAsDouble())
                || value.getAsDouble() < min
                || value.getAsDouble() > max)
            throw new IllegalArgumentException(EditorI18n.tr("cadeditor.message.policy.invalid", key, min + "-" + max));
        return value.getAsInt();
    }
}
