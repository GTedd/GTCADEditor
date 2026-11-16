package dev.rinorsi.editor.client;

import com.google.gson.*;
import dev.rinorsi.editor.*;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.world.WorldEditSessions;
import java.util.*;

/** Pure host-side target binding, shared by page navigation and apply/undo. */
public final class WorldPageTarget {
    private WorldPageTarget() {}

    public static JsonObject playerSlot(JsonObject message, String dimension) {
        var slot = new JsonObject();
        slot.addProperty("kind", "entity");
        slot.addProperty("dim", dimension);
        if (message.size() == 1
                && message.has("self")
                && message.get("self").isJsonPrimitive()
                && message.getAsJsonPrimitive("self").isBoolean()
                && message.get("self").getAsBoolean()) slot.addProperty("player", "self");
        else if (message.size() == 1 && message.has("uuid")) {
            slot.addProperty("player", "online");
            slot.addProperty(
                    "uuid", UUID.fromString(StackCodec.string(message, "uuid")).toString());
        } else if (message.size() == 2
                && message.has("uuid")
                && message.has("offline")
                && message.get("offline").isJsonPrimitive()
                && message.getAsJsonPrimitive("offline").isBoolean()
                && message.get("offline").getAsBoolean()) {
            slot.addProperty("player", "offline");
            slot.addProperty(
                    "uuid", UUID.fromString(StackCodec.string(message, "uuid")).toString());
        } else
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.worldpagetarget.select_player_uuid_offline_true"));
        return slot;
    }

    /** readOnly: a client-side view (no CAD Editor on the server); set by the host, never by the page. */
    public record Binding(JsonObject slot, String revision, boolean readOnly) {
        public Binding(JsonObject slot, String revision) {
            this(slot, revision, false);
        }

        public Binding {
            slot = slot.deepCopy();
        }

        @Override
        public JsonObject slot() {
            return slot.deepCopy();
        }

        public static Binding opened(JsonObject world) {
            return new Binding(
                    StackCodec.object(world, "slot"),
                    StackCodec.string(world, "revision"),
                    world.has("readOnly") && world.get("readOnly").getAsBoolean());
        }

        public JsonObject bind(JsonObject edit, boolean undo) {
            if (readOnly) throw new EditorSessions.Failure("read_only", EditorI18n.tr("cadeditor.ui.world.readonly"));
            var supplied = StackCodec.object(edit, "slot");
            if (!WorldEditSessions.sameTarget(slot, supplied)
                    || !Objects.equals(slot.get("token"), supplied.get("token")))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.worldpagetarget.page_target_match_current_edit"));
            var request = edit.deepCopy();
            request.addProperty("op", undo ? "undo" : "apply");
            request.add("slot", slot.deepCopy());
            request.addProperty("revision", revision);
            return request;
        }
    }
}
