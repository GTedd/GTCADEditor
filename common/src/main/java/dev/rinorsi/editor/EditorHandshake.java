package dev.rinorsi.editor;

import com.google.gson.JsonObject;
import dev.rinorsi.editor.platform.Platform;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import net.minecraft.server.level.ServerPlayer;

/** Answers the client's {@code hello} after it joins: protocol, version and capability hints. Not recorded. */
public final class EditorHandshake {
    /** Bumped when a change to the requests would break an older client or server. */
    public static final int PROTOCOL = 1;

    private static final long WINDOW_NANOS = 10_000_000_000L;
    private static final int BURST = 4;
    private static final Map<UUID, long[]> RECENT = new HashMap<>();

    private EditorHandshake() {}

    public static void forget(UUID player) {
        RECENT.remove(player);
    }

    public static void clear() {
        RECENT.clear();
    }

    /** Answers a hello; false for every other request. */
    public static boolean route(ServerPlayer player, JsonObject request, Consumer<JsonObject> sink) {
        if (!request.has("op")
                || !request.get("op").isJsonPrimitive()
                || !"hello".equals(request.get("op").getAsString())) return false;
        String requestId = request.has("requestId") && request.get("requestId").isJsonPrimitive()
                ? request.get("requestId").getAsString()
                : "";
        if (requestId.isEmpty() || requestId.length() > 80) return true; // nothing to correlate a reply with
        if (!admit(player.getUUID(), System.nanoTime())) return true; // a client never needs more than one per join
        var reply = new JsonObject();
        reply.addProperty("status", "hello");
        reply.addProperty("op", "hello");
        reply.addProperty("requestId", requestId);
        reply.addProperty("protocol", PROTOCOL);
        reply.addProperty("version", version());
        reply.addProperty(
                "platform",
                Platform.get()
                        .getClass()
                        .getSimpleName()
                        .replace("Platform", "")
                        .toLowerCase(java.util.Locale.ROOT));
        var capabilities = new JsonObject();
        EditorPolicy.current().capabilities(player).forEach(capabilities::addProperty);
        reply.add("capabilities", capabilities);
        reply.addProperty("history", dev.rinorsi.editor.history.EditorHistory.enabled());
        sink.accept(reply);
        EditorWriteLog.event(
                "server.hello",
                requestId,
                "player=" + player.getUUID() + " client_protocol=" + request.get("protocol"));
        return true;
    }

    static boolean admit(UUID player, long now) {
        long[] times = RECENT.computeIfAbsent(player, ignored -> new long[BURST]);
        int oldest = 0;
        for (int i = 1; i < times.length; i++) if (times[i] < times[oldest]) oldest = i;
        if (times[oldest] != 0 && now - times[oldest] < WINDOW_NANOS) return false;
        times[oldest] = now;
        return true;
    }

    private static String version() {
        try {
            return Platform.get().modVersion("cadeditor");
        } catch (RuntimeException e) {
            return "unknown";
        }
    }
}
