package dev.rinorsi.editor.history;

import com.google.gson.JsonObject;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/** Caps rejected and denied records per player and window; the rest become one {@code history.suppressed} record. */
final class FloodGuard {
    private record Window(long start, int written, int suppressed, String name) {}

    private final int limit;
    private final long windowMillis;
    private final Consumer<HistoryRecord> sink;
    private final Map<String, Window> windows = new HashMap<>();

    FloodGuard(int limit, long windowMillis, Consumer<HistoryRecord> sink) {
        this.limit = limit;
        this.windowMillis = windowMillis;
        this.sink = sink;
    }

    /** Whether to write {@code draft}; may first write the summary of the actor's previous window. */
    synchronized boolean admit(EditorHistory.Actor actor, HistoryRecord draft, long now) {
        if (!draft.outcome.equals("rejected") && !draft.outcome.equals("denied")) return true;
        var window = windows.get(actor.id());
        if (window == null || now - window.start >= windowMillis) {
            if (window != null && window.suppressed > 0) summary(actor, window);
            if (windows.size() > 4096) windows.clear();
            windows.put(actor.id(), new Window(now, 1, 0, actor.name()));
            return true;
        }
        if (window.written < limit) {
            windows.put(actor.id(), new Window(window.start, window.written + 1, window.suppressed, window.name));
            return true;
        }
        windows.put(actor.id(), new Window(window.start, window.written, window.suppressed + 1, window.name));
        return false;
    }

    /** Writes the summaries still open (on server stop). */
    synchronized void flush() {
        windows.forEach((id, window) -> {
            if (window.suppressed > 0) summary(new EditorHistory.Actor(id, window.name, null, false), window);
        });
        windows.clear();
    }

    private void summary(EditorHistory.Actor actor, Window window) {
        var detail = new JsonObject();
        detail.addProperty("suppressed", window.suppressed);
        detail.addProperty("window_ms", windowMillis);
        detail.addProperty("since", window.start);
        sink.accept(HistoryRecord.draft(
                actor.id(),
                actor.name(),
                "history.suppressed",
                "",
                "denied",
                "flood",
                "",
                "",
                detail,
                "",
                List.of("flood")));
    }
}
