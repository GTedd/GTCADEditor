package dev.rinorsi.editor.history;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** A player flooding rejected requests cannot push everyone's records out of the history. */
class FloodGuardTest {
    private static final EditorHistory.Actor MALLORY = new EditorHistory.Actor("uuid-m", "Mallory", null, false);
    private static final EditorHistory.Actor ALICE = new EditorHistory.Actor("uuid-a", "Alice", null, false);

    private static HistoryRecord record(EditorHistory.Actor actor, String outcome) {
        return HistoryRecord.draft(
                actor.id(), actor.name(), "item.apply", "", outcome, "x", "", "", null, "", List.of());
    }

    @Test
    void deniedFloodIsCappedPerPlayerAndSummarised() {
        var summaries = new ArrayList<HistoryRecord>();
        var guard = new FloodGuard(3, 1000, summaries::add);
        int written = 0;
        for (int i = 0; i < 50; i++)
            if (guard.admit(MALLORY, record(MALLORY, i % 2 == 0 ? "denied" : "rejected"), 100)) written++;
        assertEquals(3, written);
        assertTrue(guard.admit(ALICE, record(ALICE, "denied"), 100), "other players are not affected");
        assertTrue(guard.admit(MALLORY, record(MALLORY, "ok"), 100), "successful requests are never suppressed");
        assertTrue(summaries.isEmpty());

        assertTrue(guard.admit(MALLORY, record(MALLORY, "denied"), 1200), "a new window starts");
        assertEquals(1, summaries.size());
        var summary = summaries.getFirst();
        assertEquals("history.suppressed", summary.action);
        assertEquals("Mallory", summary.actorName);
        assertEquals(47, summary.detail.get("suppressed").getAsInt());
        assertEquals(List.of("flood"), summary.tags());

        for (int i = 0; i < 10; i++) guard.admit(MALLORY, record(MALLORY, "denied"), 1300);
        guard.flush();
        assertEquals(2, summaries.size(), "open summaries are written on stop");
        assertEquals(8, summaries.get(1).detail.get("suppressed").getAsInt());
    }
}
