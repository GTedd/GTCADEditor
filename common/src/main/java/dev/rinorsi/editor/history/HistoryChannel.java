package dev.rinorsi.editor.history;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorPolicy;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import net.minecraft.server.level.ServerPlayer;

/** The editor UI's {@code op:"history"} requests; every action checks the player's nodes. */
public final class HistoryChannel {
    private static final int BURST = 8;
    private static final long WINDOW_NANOS = 1_000_000_000L;
    private static final Map<UUID, ArrayDeque<Long>> RECENT = new HashMap<>();
    private static final Map<String, Set<String>> KEYS = Map.of(
            "capabilities", Set.of(),
            "list", Set.of("filter", "page", "size"),
            "get", Set.of("id"),
            "add", Set.of("note", "target", "tags"),
            "edit", Set.of("id", "note", "tags"),
            "delete", Set.of("ids"),
            "purge", Set.of("filter"));

    private HistoryChannel() {}

    public static void forget(UUID player) {
        RECENT.remove(player);
    }

    public static void clear() {
        RECENT.clear();
    }

    /** Handles the request when it is a history request; false for every other request. */
    public static boolean route(ServerPlayer player, JsonObject request, Consumer<JsonObject> sink) {
        if (!request.has("op")
                || !request.get("op").isJsonPrimitive()
                || !"history".equals(request.get("op").getAsString())) return false;
        String requestId = string(request, "requestId");
        String action = string(request, "action");
        try {
            if (requestId.isEmpty() || requestId.length() > 80)
                throw new IllegalArgumentException("requestId must be 1-80 characters");
            var allowed = KEYS.get(action);
            if (allowed == null) throw new IllegalArgumentException("unknown history action '" + action + "'");
            for (String key : request.keySet())
                if (!Set.of("op", "requestId", "action").contains(key) && !allowed.contains(key))
                    throw new IllegalArgumentException("unexpected key " + key);
            rateLimit(player.getUUID());
            var actor = EditorHistory.Actor.of(player);
            var reply = reply("history", requestId, action);
            switch (action) {
                case "capabilities" -> {
                    var capabilities = new JsonObject();
                    EditorPolicy.current().capabilities(player).forEach(capabilities::addProperty);
                    reply.add("capabilities", capabilities);
                    reply.addProperty("enabled", EditorHistory.enabled());
                    reply.addProperty("self", player.getStringUUID());
                }
                case "list" -> {
                    int page = integer(request, "page", 0, 0, 100_000);
                    int size = integer(request, "size", 25, 1, 100);
                    var result = EditorHistory.list(actor, HistoryQuery.fromJson(request.get("filter")), page, size);
                    var records = new JsonArray();
                    result.records().forEach(r -> records.add(r.toJson()));
                    reply.addProperty("total", result.total());
                    reply.addProperty("page", result.page());
                    reply.addProperty("size", result.size());
                    reply.addProperty(
                            "scope", actor.can(dev.rinorsi.editor.EditorPermission.HISTORY_VIEW) ? "all" : "own");
                    reply.add("records", records);
                }
                case "get" -> {
                    long id = id(request.get("id"));
                    var record = EditorHistory.get(actor, id)
                            .orElseThrow(() ->
                                    new Failure("not_found", EditorI18n.tr("cadeditor.message.history.notfound", id)));
                    reply.add("record", record.toJson());
                }
                case "add" ->
                    reply.add(
                            "record",
                            EditorHistory.addNote(
                                            actor,
                                            string(request, "target"),
                                            string(request, "note"),
                                            tags(request.get("tags")))
                                    .toJson());
                case "edit" -> {
                    if (!request.has("note") && !request.has("tags"))
                        throw new IllegalArgumentException("edit needs note or tags");
                    reply.add(
                            "record",
                            EditorHistory.edit(
                                            actor,
                                            id(request.get("id")),
                                            request.has("note") ? string(request, "note") : null,
                                            request.has("tags") ? tags(request.get("tags")) : null)
                                    .toJson());
                }
                case "delete" -> {
                    var ids = new ArrayList<Long>();
                    if (!request.has("ids") || !request.get("ids").isJsonArray())
                        throw new IllegalArgumentException("ids must be an array");
                    for (var element : request.getAsJsonArray("ids")) ids.add(id(element));
                    reply.add("deleted", longs(EditorHistory.delete(actor, ids)));
                }
                case "purge" ->
                    reply.addProperty(
                            "deleted",
                            EditorHistory.purge(actor, HistoryQuery.fromJson(request.get("filter")))
                                    .size());
                default -> throw new IllegalStateException(action);
            }
            sink.accept(reply);
        } catch (RuntimeException e) {
            String code;
            String reason;
            if (e instanceof EditorHistory.HistoryDenied denied) {
                code = "permission_denied";
                reason = EditorI18n.tr("cadeditor.message.permission.denied", denied.node);
                if (Set.of("add", "edit", "delete", "purge").contains(action))
                    EditorHistory.recordDenied(
                            EditorHistory.Actor.of(player), "history." + action, target(request), denied.node);
            } else if (e instanceof EditorHistory.HistoryUnavailable) {
                code = "history_unavailable";
                reason = EditorI18n.tr("cadeditor.message.history.unavailable");
            } else if (e instanceof Failure failure) {
                code = failure.code;
                reason = failure.getMessage();
            } else {
                code = "invalid_request";
                reason = EditorI18n.tr("cadeditor.message.history.invalid", String.valueOf(e.getMessage()));
            }
            var reply = reply("rejected", requestId, action);
            reply.addProperty("code", code);
            reply.addProperty("reason", reason);
            sink.accept(reply);
        }
        return true;
    }

    /** What a refused change was aimed at, for its record. */
    private static String target(JsonObject request) {
        if (request.has("id")) return "#" + request.get("id");
        if (request.has("ids")) return "ids " + request.get("ids");
        if (request.has("filter")) return "filter " + request.get("filter");
        return "";
    }

    private static void rateLimit(UUID player) {
        long now = System.nanoTime();
        var recent = RECENT.computeIfAbsent(player, ignored -> new ArrayDeque<>());
        while (!recent.isEmpty() && now - recent.peekFirst() > WINDOW_NANOS) recent.removeFirst();
        if (recent.size() >= BURST)
            throw new Failure("rate_limited", EditorI18n.tr("cadeditor.message.history.ratelimited"));
        recent.addLast(now);
    }

    private static JsonObject reply(String status, String requestId, String action) {
        var reply = new JsonObject();
        reply.addProperty("status", status);
        reply.addProperty("op", "history");
        reply.addProperty("requestId", requestId);
        reply.addProperty("action", action);
        return reply;
    }

    private static long id(JsonElement element) {
        if (element == null
                || !element.isJsonPrimitive()
                || !element.getAsJsonPrimitive().isNumber()
                || element.getAsLong() < 1) throw new IllegalArgumentException("id must be a positive number");
        return element.getAsLong();
    }

    private static List<String> tags(JsonElement element) {
        if (element == null || element.isJsonNull()) return List.of();
        if (!element.isJsonArray()) throw new IllegalArgumentException("tags must be an array");
        var out = new ArrayList<String>();
        for (var tag : element.getAsJsonArray()) {
            if (!tag.isJsonPrimitive() || !tag.getAsJsonPrimitive().isString())
                throw new IllegalArgumentException("tags must be strings");
            out.add(tag.getAsString());
        }
        return HistoryRecord.tags(out);
    }

    private static int integer(JsonObject request, String key, int fallback, int min, int max) {
        var value = request.get(key);
        if (value == null) return fallback;
        if (!value.isJsonPrimitive()
                || !value.getAsJsonPrimitive().isNumber()
                || value.getAsInt() < min
                || value.getAsInt() > max) throw new IllegalArgumentException(key + " must be " + min + "-" + max);
        return value.getAsInt();
    }

    private static String string(JsonObject json, String key) {
        var value = json.get(key);
        if (value == null || value.isJsonNull()) return "";
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString())
            throw new IllegalArgumentException(key + " must be a string");
        return value.getAsString();
    }

    private static JsonArray longs(List<Long> values) {
        var array = new JsonArray();
        values.forEach(array::add);
        return array;
    }

    private static final class Failure extends RuntimeException {
        final String code;

        Failure(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
