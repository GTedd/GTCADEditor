package dev.rinorsi.editor.history;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

/** Facts noted while a request is handled (denied node, target, details) for its history record; thread-local. */
public final class HistoryContext {
    private static final ThreadLocal<HistoryContext> CURRENT = new ThreadLocal<>();

    String node = "";
    String target = "";
    final JsonObject detail = new JsonObject();

    private HistoryContext() {}

    /** Starts the scope of one request; close it with {@link #end()}. */
    static HistoryContext begin() {
        var context = new HistoryContext();
        CURRENT.set(context);
        return context;
    }

    static void end() {
        CURRENT.remove();
    }

    /** The permission node a denial was about. */
    public static void node(String node) {
        var context = CURRENT.get();
        if (context != null && context.node.isEmpty()) context.node = node;
    }

    /** A human-readable target resolved by the server (block id and position, entity type, player name). */
    public static void target(String target) {
        var context = CURRENT.get();
        if (context != null) context.target = target;
    }

    public static void detail(String key, String value) {
        var context = CURRENT.get();
        if (context != null && value != null) context.detail.addProperty(key, value);
    }

    public static void detail(String key, Number value) {
        var context = CURRENT.get();
        if (context != null && value != null) context.detail.addProperty(key, value);
    }

    public static void detail(String key, JsonElement value) {
        var context = CURRENT.get();
        if (context != null && value != null) context.detail.add(key, value.deepCopy());
    }
}
