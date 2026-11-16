package dev.rinorsi.editor.history;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonParser;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class HistoryQueryTest {
    private static final long NOW = 1_800_000_000_000L;

    private static HistoryRecord record(
            String name, String action, String target, String outcome, long time, List<String> tags, String note) {
        return new HistoryRecord(
                1,
                time,
                "11111111-2222-3333-4444-555555555555",
                name,
                action,
                target,
                outcome,
                "code_x",
                "",
                "",
                null,
                note,
                tags,
                "",
                0);
    }

    @Test
    void commandSyntax() {
        var query = HistoryQuery.parse(
                "player:Steve action:world outcome:denied tag:Forged since:7d until:2027-01-01 chest lid",
                NOW,
                ZoneOffset.UTC);
        assertEquals("steve", query.actor());
        assertEquals("world", query.action());
        assertEquals("denied", query.outcome());
        assertEquals("forged", query.tag());
        assertEquals("chest lid", query.text());
        assertEquals(NOW - 7L * 24 * 3600 * 1000, query.since());
        assertEquals(
                LocalDate.parse("2027-01-01")
                        .atStartOfDay(ZoneOffset.UTC)
                        .toInstant()
                        .toEpochMilli(),
                query.until());
        assertTrue(HistoryQuery.parse("  ", NOW, ZoneOffset.UTC).isEmpty());
        assertThrows(IllegalArgumentException.class, () -> HistoryQuery.parse("since:yesterday", NOW, ZoneOffset.UTC));
        assertThrows(IllegalArgumentException.class, () -> HistoryQuery.parse("outcome:great", NOW, ZoneOffset.UTC));
    }

    @Test
    void matching() {
        var r = record(
                "Steve",
                "world.apply",
                "block minecraft:overworld 1 2 3 minecraft:chest",
                "denied",
                NOW,
                List.of("forged"),
                "Lid opened");
        assertTrue(HistoryQuery.ALL.matches(r));
        assertTrue(HistoryQuery.parse("player:STEVE", NOW, ZoneOffset.UTC).matches(r), "name, any case");
        assertTrue(
                HistoryQuery.parse("player:11111111-2222-3333-4444-555555555555", NOW, ZoneOffset.UTC)
                        .matches(r),
                "uuid");
        assertTrue(HistoryQuery.parse("action:world", NOW, ZoneOffset.UTC).matches(r), "prefix");
        assertTrue(HistoryQuery.parse("action:world.apply", NOW, ZoneOffset.UTC).matches(r));
        assertFalse(HistoryQuery.parse("action:wor", NOW, ZoneOffset.UTC).matches(r), "prefixes end at a dot");
        assertTrue(HistoryQuery.parse("target:CHEST", NOW, ZoneOffset.UTC).matches(r));
        assertTrue(HistoryQuery.parse("lid", NOW, ZoneOffset.UTC).matches(r), "text searches the note");
        assertTrue(HistoryQuery.parse("code_x", NOW, ZoneOffset.UTC).matches(r), "and the code");
        assertFalse(HistoryQuery.parse("tag:reviewed", NOW, ZoneOffset.UTC).matches(r));
        assertFalse(HistoryQuery.parse("since:1s", NOW + 5000, ZoneOffset.UTC).matches(r));
        assertTrue(
                HistoryQuery.parse("player:Alex", NOW, ZoneOffset.UTC)
                        .withActor("steve")
                        .matches(r),
                "own-records scope replaces the actor");
    }

    @Test
    void uiFilterObject() {
        var query =
                HistoryQuery.fromJson(JsonParser.parseString("{\"actor\":\"Steve\",\"outcome\":\"ok\",\"since\":5}"));
        assertEquals("steve", query.actor());
        assertEquals(5, query.since());
        assertEquals(query, HistoryQuery.fromJson(query.toJson()));
        assertThrows(
                IllegalArgumentException.class,
                () -> HistoryQuery.fromJson(JsonParser.parseString("{\"gamemaster\":true}")));
        assertThrows(
                IllegalArgumentException.class,
                () -> HistoryQuery.fromJson(JsonParser.parseString("{\"since\":\"yesterday\"}")));
        assertEquals(HistoryQuery.ALL, HistoryQuery.fromJson(null));
    }
}
