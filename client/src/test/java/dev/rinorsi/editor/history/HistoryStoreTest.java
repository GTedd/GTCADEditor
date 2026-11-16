package dev.rinorsi.editor.history;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The history's create/read/update/delete, its journal on disk, retention and damaged files. */
class HistoryStoreTest {
    @TempDir
    Path dir;

    private final AtomicLong clock = new AtomicLong(1_000_000L);

    private HistoryStore open(HistorySettings settings) throws Exception {
        return HistoryStore.open(dir, settings, clock::get);
    }

    private static HistoryRecord draft(String actor, String action, String target, String outcome) {
        return HistoryRecord.draft(
                "uuid-" + actor, actor, action, target, outcome, "", "", "req", new JsonObject(), "", List.of());
    }

    @Test
    void createReadUpdateDeleteSurviveReopen() throws Exception {
        long a, b, c;
        try (var store = open(HistorySettings.DEFAULT)) {
            a = store.add(draft("Steve", "item.apply", "inventory[0] minecraft:stone", "ok")).id;
            clock.addAndGet(10);
            b = store.add(draft("Alex", "world.apply", "block minecraft:overworld 1 2 3 minecraft:chest", "ok")).id;
            clock.addAndGet(10);
            c = store.add(draft("Steve", "world.open", "entity minecraft:cow", "denied")).id;
            assertEquals(List.of(a + 1, a + 2), List.of(b, c));

            var page = store.query(HistoryQuery.ALL, 0, 2);
            assertEquals(3, page.total());
            assertEquals(List.of(c, b), page.records().stream().map(r -> r.id).toList(), "newest first");
            assertEquals(
                    List.of(a),
                    store.query(HistoryQuery.ALL, 1, 2).records().stream()
                            .map(r -> r.id)
                            .toList());

            var edited = store.edit(b, "checked by owner", List.of("Reviewed", "chest"), "Owner (console)");
            assertEquals("checked by owner", edited.note());
            assertEquals(List.of("reviewed", "chest"), edited.tags());
            assertEquals("world.apply", edited.action, "facts stay");
            assertEquals(clock.get(), edited.editedAt());

            assertEquals(List.of(a), store.delete(List.of(a, 999L), "Owner (console)"));
            assertEquals(2, store.size());
        }
        try (var store = open(HistorySettings.DEFAULT)) {
            assertEquals(2, store.size());
            assertTrue(store.get(a).isEmpty());
            var record = store.get(b).orElseThrow();
            assertEquals("checked by owner", record.note());
            assertEquals(List.of("reviewed", "chest"), record.tags());
            assertEquals("Owner (console)", record.editedBy());
            assertEquals(c + 1, store.add(draft("Steve", "item.apply", "", "ok")).id, "ids continue after reopen");
        }
    }

    @Test
    void idsAreNeverReusedAfterDeletingTheNewestAndCompacting() throws Exception {
        long last;
        try (var store = open(HistorySettings.DEFAULT)) {
            store.add(draft("Steve", "item.apply", "", "ok"));
            last = store.add(draft("Steve", "item.apply", "", "ok")).id;
            store.delete(List.of(last), "test");
        }
        // Damaged content forces a rewrite to the live records on the next open.
        Files.writeString(dir.resolve(HistoryStore.FILE), "not json\n", StandardOpenOption.APPEND);
        try (var store = open(HistorySettings.DEFAULT)) {
            assertEquals(1, store.size());
            assertEquals(last + 1, store.add(draft("Steve", "item.apply", "", "ok")).id);
        }
        try (var store = open(HistorySettings.DEFAULT)) {
            assertEquals(2, store.size());
        }
    }

    @Test
    void purgeNeedsAFilterAndRemovesOnlyMatches() throws Exception {
        try (var store = open(HistorySettings.DEFAULT)) {
            store.add(draft("Steve", "world.apply", "chest", "ok"));
            store.add(draft("Alex", "world.apply", "chest", "denied"));
            store.add(draft("Alex", "item.apply", "stone", "ok"));
            assertThrows(IllegalArgumentException.class, () -> store.purge(HistoryQuery.ALL, "test"));
            var removed = store.purge(
                    HistoryQuery.parse("player:alex action:world", clock.get(), java.time.ZoneOffset.UTC), "test");
            assertEquals(1, removed.size());
            assertEquals(2, store.size());
        }
    }

    @Test
    void retentionDropsTheOldestAndTheExpired() throws Exception {
        var settings = new HistorySettings(true, true, false, 100, 30);
        try (var store = open(settings)) {
            for (int i = 0; i < 105; i++) store.add(draft("Steve", "item.apply", "#" + i, "ok"));
            assertEquals(100, store.size());
            assertEquals("#5", store.query(HistoryQuery.ALL, 0, 100).records().getLast().target);
        }
        clock.addAndGet(TimeUnit.DAYS.toMillis(31));
        try (var store = open(settings)) {
            assertEquals(0, store.size(), "older than retentionDays when reopened");
            store.add(draft("Steve", "item.apply", "new", "ok"));
            assertEquals(1, store.size());
        }
    }

    @Test
    void journalIsJsonLinesAndSurvivesADamagedLine() throws Exception {
        try (var store = open(HistorySettings.DEFAULT)) {
            store.add(draft("Steve", "item.apply", "a", "ok"));
            store.add(draft("Steve", "item.apply", "b", "ok"));
        }
        var lines = Files.readAllLines(dir.resolve(HistoryStore.FILE), StandardCharsets.UTF_8);
        assertTrue(lines.stream().allMatch(l -> l.startsWith("{\"op\":")), String.join("\n", lines));
        Files.writeString(
                dir.resolve(HistoryStore.FILE), "{\"op\":\"add\",\"record\":{broken\n", StandardOpenOption.APPEND);
        try (var store = open(HistorySettings.DEFAULT)) {
            assertEquals(2, store.size());
        }
    }

    @Test
    void recordsValidateNotesTagsAndBoundTheirText() {
        assertThrows(IllegalArgumentException.class, () -> HistoryRecord.note("x".repeat(501)));
        assertThrows(IllegalArgumentException.class, () -> HistoryRecord.tags(List.of("has space")));
        assertThrows(
                IllegalArgumentException.class,
                () -> HistoryRecord.tags(List.of("1", "2", "3", "4", "5", "6", "7", "8", "9")));
        assertEquals(List.of("a", "b"), HistoryRecord.tags(List.of("A", "b", "a")));
        assertEquals("line one\nline two", HistoryRecord.note("line one\nline two"));
        var record = draft("Ste\u0000ve", "item.apply", "t".repeat(500), "ok");
        assertEquals("Ste ve", record.actorName, "control characters are replaced");
        assertEquals(HistoryRecord.MAX_TEXT, record.target.length());
        assertThrows(IllegalArgumentException.class, () -> draft("Steve", "item.apply", "", "maybe"));
        var detail = new JsonObject();
        for (int i = 0; i < 100; i++) detail.addProperty("key" + i, "v".repeat(100));
        var big = HistoryRecord.draft("u", "n", "a", "", "ok", "", "", "", detail, "", List.of());
        assertTrue(big.detail.toString().length() <= HistoryRecord.MAX_DETAIL + 40, "detail is bounded");
        assertTrue(big.detail.has("truncated"));
    }

    @Test
    void editRejectsUnknownRecordsAndInvalidInput() throws Exception {
        try (var store = open(HistorySettings.DEFAULT)) {
            long id = store.add(draft("Steve", "item.apply", "", "ok")).id;
            assertThrows(IllegalArgumentException.class, () -> store.edit(id + 1, "x", null, "test"));
            assertThrows(IllegalArgumentException.class, () -> store.edit(id, "x".repeat(501), null, "test"));
            assertEquals("", store.get(id).orElseThrow().note(), "a rejected edit changes nothing");
            assertThrows(IllegalArgumentException.class, () -> store.query(HistoryQuery.ALL, 0, 101));
        }
    }
}
