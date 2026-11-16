package dev.rinorsi.editor.history;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** Turns one handled request (decoded request, last reply, handler facts) into its history record, or none. */
final class RequestRecords {
    private RequestRecords() {}

    static @Nullable HistoryRecord draft(
            EditorHistory.Actor actor,
            @Nullable JsonObject request,
            @Nullable JsonObject reply,
            HistoryContext context,
            int payloadChars,
            boolean forged,
            HistorySettings settings) {
        if (request == null && reply == null) return null; // an incomplete multi-part transfer
        String op = string(request, "op");
        // History records its own changes; closing and the join handshake change nothing.
        if (op.equals("history") || op.equals("close") || op.equals("hello")) return null;
        JsonObject slot = object(request, "slot");
        String kind = string(slot, "kind");
        String status = string(reply, "status");
        String code = string(reply, "code");

        String action;
        boolean read;
        if (request == null) {
            action = "request.invalid";
            read = false;
        } else if (op.equals("vault_give")) {
            action = "vault.give";
            read = false;
        } else if (op.equals("player_extended")) {
            String sub = string(request, "action");
            action = "player." + (sub.isEmpty() ? "request" : sub);
            read = !sub.equals("apply");
        } else if (kind.equals("block") || kind.equals("entity")) {
            boolean offline = kind.equals("entity") && "offline".equals(string(slot, "player"));
            action = offline ? "player.offline." + op : request.has("riding") ? "world.riding" : "world." + op;
            read = op.equals("open");
        } else if (kind.equals("inventory") || kind.equals("menu")) {
            action = "item." + op;
            read = op.equals("open");
        } else {
            action = "request." + (op.isEmpty() ? "unknown" : op);
            read = false;
        }

        String outcome = switch (status) {
            case "saved", "opened", "exported" -> "ok";
            case "commit" -> "pending";
            case "rejected" -> EditorHistory.DENIAL_CODES.contains(code) ? "denied" : "rejected";
            default -> reply == null ? "rejected" : "ok";
        };
        if (forged) outcome = "denied";
        if (read && outcome.equals("ok") && !forged) {
            if (action.equals("item.open") ? !settings.recordItemOpens() : !settings.recordReads()) return null;
        }

        String target = !context.target.isEmpty() ? context.target : target(request, slot, kind, reply);
        var detail = context.detail.deepCopy();
        detail.addProperty("payload_chars", payloadChars);
        if (op.equals("player_extended") && request != null && request.has("view"))
            detail.addProperty("view", string(request, "view"));
        if (outcome.equals("rejected") || outcome.equals("denied")) {
            String reason = string(reply, "reason");
            if (!reason.isEmpty()) detail.addProperty("reason", reason);
        }
        String requestId = string(request, "requestId");
        return HistoryRecord.draft(
                actor.id(),
                actor.name(),
                action,
                target,
                outcome,
                status.equals("commit") ? "commit" : outcome.equals("ok") ? "" : code,
                context.node,
                requestId,
                detail,
                "",
                forged ? List.of("forged") : List.of());
    }

    private static String target(
            @Nullable JsonObject request, @Nullable JsonObject slot, String kind, @Nullable JsonObject reply) {
        if (request == null) return "";
        switch (kind) {
            case "inventory":
                return "inventory[" + string(slot, "index") + "]" + itemId(reply);
            case "menu":
                return "menu#" + string(slot, "menuId") + "[" + string(slot, "index") + "]" + itemId(reply);
            case "block":
                return "block " + string(slot, "dim") + " " + string(slot, "x") + " " + string(slot, "y") + " "
                        + string(slot, "z") + worldType(reply, "block");
            case "entity":
                String uuid = string(slot, "uuid");
                return ("offline".equals(string(slot, "player")) ? "player " : "entity ")
                        + (uuid.isEmpty() ? string(slot, "id") : uuid)
                        + worldType(reply, "type");
            default:
        }
        if ("player_extended".equals(string(request, "op"))) {
            var target = object(request, "target");
            String uuid = string(target, "uuid");
            return "player " + (uuid.isEmpty() ? "self" : uuid)
                    + ("true".equals(string(target, "offline")) ? " (offline)" : "");
        }
        if ("vault_give".equals(string(request, "op")))
            return "inventory" + itemId(object(request, "stack") == null ? null : request);
        return "";
    }

    private static String itemId(@Nullable JsonObject reply) {
        var item = object(reply, "item");
        if (item == null) item = object(reply, "stack");
        String id = string(item, "id");
        return id.isEmpty() ? "" : " " + id;
    }

    private static String worldType(@Nullable JsonObject reply, String key) {
        var world = object(reply, "world");
        String value = string(world, key);
        if (value.isEmpty()) value = string(world, "type");
        return value.isEmpty() ? "" : " " + value;
    }

    static String string(@Nullable JsonObject json, String key) {
        if (json == null) return "";
        JsonElement value = json.get(key);
        return value == null || value.isJsonNull() || !value.isJsonPrimitive() ? "" : value.getAsString();
    }

    static @Nullable JsonObject object(@Nullable JsonObject json, String key) {
        if (json == null) return null;
        JsonElement value = json.get(key);
        return value != null && value.isJsonObject() ? value.getAsJsonObject() : null;
    }
}
