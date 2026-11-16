package dev.rinorsi.editor.history;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Which record (if any) one handled request becomes. */
class RequestRecordsTest {
    private static final EditorHistory.Actor STEVE = new EditorHistory.Actor("uuid-steve", "Steve", null, false);

    @AfterEach
    void endScope() {
        HistoryContext.end();
    }

    private static JsonObject json(String text) {
        return JsonParser.parseString(text).getAsJsonObject();
    }

    private static HistoryRecord draft(String request, String reply, HistorySettings settings) {
        return RequestRecords.draft(
                STEVE,
                request == null ? null : json(request),
                reply == null ? null : json(reply),
                HistoryContext.begin(),
                42,
                false,
                settings);
    }

    @Test
    void itemWritesAreRecordedWithTheServersFacts() {
        var context = HistoryContext.begin();
        HistoryContext.detail("before", "minecraft:stone x1");
        HistoryContext.detail("changed", "minecraft:custom_name");
        var record = RequestRecords.draft(
                STEVE,
                json("{\"op\":\"apply\",\"requestId\":\"r1\",\"slot\":{\"kind\":\"inventory\",\"index\":3}}"),
                json("{\"status\":\"saved\",\"requestId\":\"r1\",\"item\":{\"id\":\"minecraft:stone\"}}"),
                context,
                42,
                false,
                HistorySettings.DEFAULT);
        assertNotNull(record);
        assertEquals("item.apply", record.action);
        assertEquals("ok", record.outcome);
        assertEquals("inventory[3] minecraft:stone", record.target);
        assertEquals("r1", record.requestId);
        assertEquals("minecraft:custom_name", record.detail.get("changed").getAsString());
        assertEquals(42, record.detail.get("payload_chars").getAsInt());
        assertEquals("Steve", record.actorName);
    }

    @Test
    void creativeCommitIsPendingAndPermissionRejectionsAreDenied() {
        var commit = draft(
                "{\"op\":\"apply\",\"slot\":{\"kind\":\"inventory\",\"index\":0}}",
                "{\"status\":\"commit\",\"code\":\"ok\"}",
                HistorySettings.DEFAULT);
        assertEquals("pending", commit.outcome);
        assertEquals("commit", commit.code);

        var context = HistoryContext.begin();
        HistoryContext.node("cadeditor.world.edit");
        var denied = RequestRecords.draft(
                STEVE,
                json(
                        "{\"op\":\"apply\",\"slot\":{\"kind\":\"block\",\"dim\":\"minecraft:overworld\",\"x\":1,\"y\":2,\"z\":3}}"),
                json(
                        "{\"status\":\"rejected\",\"code\":\"not_allowed\",\"reason\":\"Missing editor permission cadeditor.world.edit\"}"),
                context,
                10,
                false,
                HistorySettings.DEFAULT);
        assertEquals("world.apply", denied.action);
        assertEquals("denied", denied.outcome);
        assertEquals("not_allowed", denied.code);
        assertEquals("cadeditor.world.edit", denied.node);
        assertEquals("block minecraft:overworld 1 2 3", denied.target);
        assertTrue(denied.detail.get("reason").getAsString().contains("cadeditor.world.edit"));

        var invalid = draft(
                "{\"op\":\"apply\",\"slot\":{\"kind\":\"inventory\",\"index\":0}}",
                "{\"status\":\"rejected\",\"code\":\"slot_changed\"}",
                HistorySettings.DEFAULT);
        assertEquals("rejected", invalid.outcome);
    }

    @Test
    void readsFollowTheSettings() {
        String itemOpen = "{\"op\":\"open\",\"slot\":{\"kind\":\"inventory\",\"index\":0}}";
        String worldOpen = "{\"op\":\"open\",\"slot\":{\"kind\":\"entity\",\"uuid\":\"u\"}}";
        String opened = "{\"status\":\"opened\",\"world\":{\"type\":\"minecraft:cow\"}}";
        assertNull(
                draft(itemOpen, "{\"status\":\"opened\"}", HistorySettings.DEFAULT),
                "own item opens are off by default");
        var worldRead = draft(worldOpen, opened, HistorySettings.DEFAULT);
        assertEquals("world.open", worldRead.action);
        assertEquals("entity u minecraft:cow", worldRead.target);
        var quiet = new HistorySettings(true, false, false, 1000, 0);
        assertNull(draft(worldOpen, opened, quiet));
        assertNotNull(
                draft(worldOpen, "{\"status\":\"rejected\",\"code\":\"not_allowed\"}", quiet),
                "denied reads are always recorded");
        assertNotNull(draft(itemOpen, "{\"status\":\"opened\"}", new HistorySettings(true, true, true, 1000, 0)));
    }

    @Test
    void forgedClaimsAreDeniedAndTagged() {
        var record = RequestRecords.draft(
                STEVE,
                json("{\"op\":\"apply\",\"gamemaster\":true,\"slot\":{\"kind\":\"inventory\",\"index\":0}}"),
                json("{\"status\":\"rejected\",\"code\":\"forged_privilege\"}"),
                HistoryContext.begin(),
                5,
                true,
                HistorySettings.DEFAULT);
        assertEquals("denied", record.outcome);
        assertEquals(List.of("forged"), record.tags());
        assertEquals("forged_privilege", record.code);
    }

    @Test
    void routesAndNonEvents() {
        assertNull(draft(null, null, HistorySettings.DEFAULT), "an unfinished multi-part transfer");
        assertNull(draft("{\"op\":\"close\",\"slot\":{\"kind\":\"block\"}}", null, HistorySettings.DEFAULT));
        assertNull(
                draft("{\"op\":\"history\",\"action\":\"list\"}", "{\"status\":\"history\"}", HistorySettings.DEFAULT),
                "history records itself");
        assertEquals(
                "request.invalid",
                draft(null, "{\"status\":\"rejected\",\"code\":\"invalid_request\"}", HistorySettings.DEFAULT).action);
        assertEquals(
                "vault.give",
                draft("{\"op\":\"vault_give\"}", "{\"status\":\"saved\"}", HistorySettings.DEFAULT).action);
        var player = draft(
                "{\"op\":\"player_extended\",\"action\":\"apply\",\"view\":\"stats\",\"target\":{\"uuid\":\"p\",\"offline\":true}}",
                "{\"status\":\"saved\"}",
                HistorySettings.DEFAULT);
        assertEquals("player.apply", player.action);
        assertEquals("player p (offline)", player.target);
        assertEquals("stats", player.detail.get("view").getAsString());
        assertEquals(
                "player.offline.apply",
                draft(
                                "{\"op\":\"apply\",\"slot\":{\"kind\":\"entity\",\"player\":\"offline\",\"uuid\":\"p\"}}",
                                "{\"status\":\"saved\"}",
                                HistorySettings.DEFAULT)
                        .action);
        assertEquals(
                "world.riding",
                draft(
                                "{\"op\":\"apply\",\"riding\":{},\"slot\":{\"kind\":\"entity\",\"uuid\":\"e\"}}",
                                "{\"status\":\"saved\"}",
                                HistorySettings.DEFAULT)
                        .action);
    }
}
