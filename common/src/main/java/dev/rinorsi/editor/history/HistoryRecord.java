package dev.rinorsi.editor.history;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** One history record. The facts never change; only the note and the tags can be edited. */
public final class HistoryRecord {
    public static final Set<String> OUTCOMES = Set.of("ok", "pending", "rejected", "denied", "note");
    public static final int MAX_NOTE = 500, MAX_TAGS = 8, MAX_TAG = 32, MAX_TEXT = 200, MAX_DETAIL = 2048;
    private static final Pattern TAG = Pattern.compile("[a-z0-9_.-]{1," + MAX_TAG + "}");

    public final long id;
    public final long time;
    public final String actorId;
    public final String actorName;
    public final String action;
    public final String target;
    public final String outcome;
    public final String code;
    public final String node;
    public final String requestId;
    public final JsonObject detail;
    private String note;
    private List<String> tags;
    private String editedBy;
    private long editedAt;

    public HistoryRecord(
            long id,
            long time,
            String actorId,
            String actorName,
            String action,
            String target,
            String outcome,
            String code,
            String node,
            String requestId,
            JsonObject detail,
            String note,
            List<String> tags,
            String editedBy,
            long editedAt) {
        if (!OUTCOMES.contains(outcome)) throw new IllegalArgumentException("Unknown outcome " + outcome);
        this.id = id;
        this.time = time;
        this.actorId = text(actorId, 64);
        this.actorName = text(actorName, 64);
        this.action = text(action, 64);
        this.target = text(target, MAX_TEXT);
        this.outcome = outcome;
        this.code = text(code, 64);
        this.node = text(node, 64);
        this.requestId = text(requestId, 80);
        this.detail = boundedDetail(detail);
        this.note = note(note);
        this.tags = tags(tags);
        this.editedBy = text(editedBy, 64);
        this.editedAt = editedAt;
    }

    /** A new record; the store assigns id and time. */
    public static HistoryRecord draft(
            String actorId,
            String actorName,
            String action,
            String target,
            String outcome,
            String code,
            String node,
            String requestId,
            JsonObject detail,
            String note,
            List<String> tags) {
        return new HistoryRecord(
                0, 0, actorId, actorName, action, target, outcome, code, node, requestId, detail, note, tags, "", 0);
    }

    HistoryRecord withIdentity(long newId, long newTime) {
        return new HistoryRecord(
                newId, newTime, actorId, actorName, action, target, outcome, code, node, requestId, detail, note, tags,
                editedBy, editedAt);
    }

    public String note() {
        return note;
    }

    public List<String> tags() {
        return tags;
    }

    public String editedBy() {
        return editedBy;
    }

    public long editedAt() {
        return editedAt;
    }

    void edit(String newNote, List<String> newTags, String by, long at) {
        if (newNote != null) note = note(newNote);
        if (newTags != null) tags = tags(newTags);
        editedBy = text(by, 64);
        editedAt = at;
    }

    public JsonObject toJson() {
        var json = new JsonObject();
        json.addProperty("id", id);
        json.addProperty("time", time);
        var actor = new JsonObject();
        actor.addProperty("id", actorId);
        actor.addProperty("name", actorName);
        json.add("actor", actor);
        json.addProperty("action", action);
        json.addProperty("target", target);
        json.addProperty("outcome", outcome);
        if (!code.isEmpty()) json.addProperty("code", code);
        if (!node.isEmpty()) json.addProperty("node", node);
        if (!requestId.isEmpty()) json.addProperty("requestId", requestId);
        if (detail.size() > 0) json.add("detail", detail.deepCopy());
        if (!note.isEmpty()) json.addProperty("note", note);
        if (!tags.isEmpty()) {
            var array = new JsonArray();
            tags.forEach(array::add);
            json.add("tags", array);
        }
        if (editedAt > 0) {
            var edited = new JsonObject();
            edited.addProperty("by", editedBy);
            edited.addProperty("at", editedAt);
            json.add("edited", edited);
        }
        return json;
    }

    public static HistoryRecord fromJson(JsonObject json) {
        var actor = json.getAsJsonObject("actor");
        var edited = json.has("edited") ? json.getAsJsonObject("edited") : null;
        var tags = new ArrayList<String>();
        if (json.has("tags")) json.getAsJsonArray("tags").forEach(tag -> tags.add(tag.getAsString()));
        return new HistoryRecord(
                json.get("id").getAsLong(),
                json.get("time").getAsLong(),
                string(actor, "id"),
                string(actor, "name"),
                string(json, "action"),
                string(json, "target"),
                string(json, "outcome"),
                string(json, "code"),
                string(json, "node"),
                string(json, "requestId"),
                json.has("detail") ? json.getAsJsonObject("detail") : new JsonObject(),
                string(json, "note"),
                tags,
                edited == null ? "" : string(edited, "by"),
                edited == null ? 0 : edited.get("at").getAsLong());
    }

    /** Validates a note: at most 500 characters, no control characters except newlines. */
    public static String note(String note) {
        if (note == null) return "";
        if (note.codePointCount(0, note.length()) > MAX_NOTE)
            throw new IllegalArgumentException("note is longer than " + MAX_NOTE + " characters");
        return clean(note, true);
    }

    /** Validates tags: at most 8, each 1-32 of a-z 0-9 _ . - (lowercased), no duplicates. */
    public static List<String> tags(List<String> tags) {
        if (tags == null) return List.of();
        if (tags.size() > MAX_TAGS) throw new IllegalArgumentException("at most " + MAX_TAGS + " tags");
        var out = new ArrayList<String>();
        for (String raw : tags) {
            String tag = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
            if (!TAG.matcher(tag).matches())
                throw new IllegalArgumentException(
                        "invalid tag '" + raw + "' (a-z 0-9 _ . -, at most " + MAX_TAG + ")");
            if (!out.contains(tag)) out.add(tag);
        }
        return List.copyOf(out);
    }

    static String text(String value, int limit) {
        if (value == null) return "";
        String clean = clean(value, false);
        return clean.codePointCount(0, clean.length()) > limit
                ? clean.substring(0, clean.offsetByCodePoints(0, limit))
                : clean;
    }

    private static String clean(String text, boolean newlines) {
        var out = new StringBuilder();
        text.codePoints().forEach(c -> {
            int type = Character.getType(c);
            if (newlines && c == '\n') out.append('\n');
            else if (Character.isISOControl(c)
                    || type == Character.FORMAT
                    || type == Character.LINE_SEPARATOR
                    || type == Character.PARAGRAPH_SEPARATOR) out.append(' ');
            else out.appendCodePoint(c);
        });
        return out.toString();
    }

    private static JsonObject boundedDetail(JsonObject detail) {
        if (detail == null) return new JsonObject();
        var out = new JsonObject();
        for (var entry : detail.entrySet()) {
            JsonElement value = entry.getValue();
            if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isString())
                out.addProperty(text(entry.getKey(), 40), text(value.getAsString(), MAX_TEXT));
            else out.add(text(entry.getKey(), 40), value.deepCopy());
            if (out.toString().length() > MAX_DETAIL) {
                out.remove(text(entry.getKey(), 40));
                out.addProperty("truncated", true);
                break;
            }
        }
        return out;
    }

    private static String string(JsonObject json, String key) {
        var value = json.get(key);
        return value == null || value.isJsonNull() ? "" : value.getAsString();
    }
}
