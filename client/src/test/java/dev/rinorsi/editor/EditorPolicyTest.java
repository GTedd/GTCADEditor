package dev.rinorsi.editor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.rinorsi.editor.EditorPolicy.Facts;
import dev.rinorsi.editor.history.HistorySettings;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** cadeditor.json and the permission decision rule (defaults, explicit grants and denials, the USE gate). */
class EditorPolicyTest {
    private static final Facts SURVIVAL = new Facts(false, false, false);
    private static final Facts CREATIVE = new Facts(false, false, true);
    private static final Facts ADMIN = new Facts(true, false, false);
    private static final Facts OWNER = new Facts(true, true, false);
    /** No permission plugin: every node takes the editor's default. */
    private static final EditorPolicy.Provider DEFAULTS = (node, fallback) -> fallback;

    private static EditorPolicy.Provider explicit(Map<String, Boolean> settings) {
        return (node, fallback) -> settings.getOrDefault(node, fallback);
    }

    @Test
    void defaultsMatchTheNodeTable() {
        var policy = EditorPolicy.DEFAULT;
        assertTrue(policy.decide(EditorPermission.USE, SURVIVAL, DEFAULTS));
        assertTrue(policy.decide(EditorPermission.HISTORY_OWN, SURVIVAL, DEFAULTS));
        for (var node : new EditorPermission[] {
            EditorPermission.ITEM_EDIT,
            EditorPermission.ITEM_CREATIVE,
            EditorPermission.WORLD_READ,
            EditorPermission.WORLD_EDIT,
            EditorPermission.PLAYER_EDIT,
            EditorPermission.PLAYER_OFFLINE,
            EditorPermission.VAULT_GIVE,
            EditorPermission.ITEM_BYPASS,
            EditorPermission.TESTKIT,
            EditorPermission.HISTORY_VIEW,
            EditorPermission.HISTORY_EDIT,
            EditorPermission.HISTORY_DELETE
        }) assertFalse(policy.decide(node, SURVIVAL, DEFAULTS), "survival player without operator level: " + node.node);

        // Creative keeps the vanilla item capability, but not the world (this fork's default).
        assertTrue(policy.decide(EditorPermission.ITEM_CREATIVE, CREATIVE, DEFAULTS));
        assertTrue(policy.decide(EditorPermission.TESTKIT, CREATIVE, DEFAULTS));
        assertFalse(policy.decide(EditorPermission.ITEM_EDIT, CREATIVE, DEFAULTS));
        assertFalse(policy.decide(EditorPermission.WORLD_READ, CREATIVE, DEFAULTS));
        assertFalse(policy.decide(EditorPermission.WORLD_EDIT, CREATIVE, DEFAULTS));
        assertFalse(policy.decide(EditorPermission.PLAYER_EDIT, CREATIVE, DEFAULTS));

        for (var node : EditorPermission.values())
            assertEquals(
                    node != EditorPermission.HISTORY_DELETE,
                    policy.decide(node, ADMIN, DEFAULTS),
                    "admin: " + node.node);
        for (var node : EditorPermission.values())
            assertTrue(policy.decide(node, OWNER, DEFAULTS), "owner: " + node.node);
    }

    @Test
    void creativeWorldEditIsAConfigSwitch() {
        var builders = new EditorPolicy(2, true, true, HistorySettings.DEFAULT);
        assertTrue(builders.decide(EditorPermission.WORLD_EDIT, CREATIVE, DEFAULTS));
        assertFalse(builders.decide(EditorPermission.WORLD_EDIT, SURVIVAL, DEFAULTS));
        var noCreativeItems = new EditorPolicy(2, false, false, HistorySettings.DEFAULT);
        assertFalse(noCreativeItems.decide(EditorPermission.ITEM_CREATIVE, CREATIVE, DEFAULTS));
        assertTrue(noCreativeItems.decide(EditorPermission.ITEM_CREATIVE, ADMIN, DEFAULTS));
    }

    @Test
    void explicitSettingsWinAndUseGatesEverything() {
        var policy = EditorPolicy.DEFAULT;
        var grants = new HashMap<String, Boolean>();
        grants.put("cadeditor.world.edit", true);
        assertTrue(
                policy.decide(EditorPermission.WORLD_EDIT, SURVIVAL, explicit(grants)),
                "a permission plugin can grant a builder");
        assertFalse(policy.decide(EditorPermission.WORLD_READ, SURVIVAL, explicit(grants)), "nodes are independent");

        var denied = Map.of("cadeditor.item.edit", false);
        assertFalse(
                policy.decide(EditorPermission.ITEM_EDIT, OWNER, explicit(denied)),
                "an explicit denial beats operator level");

        var banned = Map.of("cadeditor.use", false, "cadeditor.world.edit", true);
        for (var node : EditorPermission.values())
            assertFalse(policy.decide(node, OWNER, explicit(banned)), "cadeditor.use=false blocks " + node.node);
    }

    @Test
    void configFileParsing() {
        var defaults = EditorPolicy.parse(new JsonObject());
        assertEquals(EditorPolicy.DEFAULT, defaults);
        assertEquals(defaults, EditorPolicy.parse(defaults.toJson()), "round trip");

        // Upstream files (permissionLevel / creativeOnly only) load with this fork's defaults.
        var legacy = EditorPolicy.parse(JsonParser.parseString("{\"permissionLevel\":2,\"creativeOnly\":true}")
                .getAsJsonObject());
        assertEquals(EditorPolicy.DEFAULT, legacy);

        var custom = EditorPolicy.parse(JsonParser.parseString(
                        "{\"adminLevel\":3,\"creativeWorldEdit\":true,\"history\":{\"recordReads\":false,\"maxRecords\":1000,\"retentionDays\":0}}")
                .getAsJsonObject());
        assertEquals(3, custom.adminLevel());
        assertTrue(custom.creativeWorldEdit());
        assertFalse(custom.history().recordReads());
        assertEquals(1000, custom.history().maxRecords());

        assertThrows(
                IllegalArgumentException.class,
                () -> EditorPolicy.parse(
                        JsonParser.parseString("{\"adminLevel\":5}").getAsJsonObject()));
        assertThrows(
                IllegalArgumentException.class,
                () -> EditorPolicy.parse(
                        JsonParser.parseString("{\"adminLevel\":2.5}").getAsJsonObject()));
        assertThrows(
                IllegalArgumentException.class,
                () -> EditorPolicy.parse(
                        JsonParser.parseString("{\"creativeItemEdit\":\"yes\"}").getAsJsonObject()));
        assertThrows(
                IllegalArgumentException.class,
                () -> EditorPolicy.parse(JsonParser.parseString("{\"history\":{\"maxRecords\":5}}")
                        .getAsJsonObject()));
        assertThrows(
                IllegalArgumentException.class,
                () -> EditorPolicy.parse(
                        JsonParser.parseString("{\"history\":{\"unknown\":1}}").getAsJsonObject()));

        // Console trace off and the vanilla operator items banned unless the file says otherwise.
        assertFalse(defaults.debugLog());
        assertTrue(defaults.itemRules().bannedItems().contains("minecraft:command_block"));
        assertTrue(defaults.itemRules().restrictedComponents().contains("minecraft:custom_data"));
        var rules = EditorPolicy.parse(JsonParser.parseString(
                        "{\"debugLog\":true,\"itemRules\":{\"bannedItems\":[\"bedrock\"],\"restrictedComponents\":[],\"blockCommandClicks\":false}}")
                .getAsJsonObject());
        assertTrue(rules.debugLog());
        assertEquals(java.util.Set.of("minecraft:bedrock"), rules.itemRules().bannedItems(), "ids are namespaced");
        assertTrue(rules.itemRules().restrictedComponents().isEmpty());
        assertFalse(rules.itemRules().blockCommandClicks());
        assertEquals(rules, EditorPolicy.parse(rules.toJson()), "round trip with rules");
        assertThrows(
                IllegalArgumentException.class,
                () -> EditorPolicy.parse(JsonParser.parseString("{\"itemRules\":{\"bannedItems\":[\"Not An Id\"]}}")
                        .getAsJsonObject()));
        assertThrows(
                IllegalArgumentException.class,
                () -> EditorPolicy.parse(JsonParser.parseString("{\"itemRules\":{\"maxLevel\":5}}")
                        .getAsJsonObject()));
    }

    @Test
    void forgedKeysNeverOverlapTheProtocol() {
        for (String key : new String[] {
            "op",
            "requestId",
            "slot",
            "action",
            "target",
            "view",
            "revision",
            "patch",
            "baseline",
            "commitBaseline",
            "stack",
            "snbt",
            "entity",
            "container",
            "views",
            "riding",
            "filter",
            "ids",
            "note",
            "tags",
            "id",
            "page",
            "size",
            "protocol"
        }) assertFalse(EditorMod.FORGED_KEYS.contains(key), key);
        assertTrue(EditorMod.FORGED_KEYS.contains("gamemaster"));
        assertTrue(EditorMod.FORGED_KEYS.contains("permissionLevel"));
    }
}
