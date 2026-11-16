package dev.rinorsi.editor.history;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.Locale;
import java.util.Set;

/**
 * A filter over history records; empty fields match everything. Text matching is case-insensitive.
 *
 * @param actor a player name or UUID (exact)
 * @param action an action or its prefix ("world" matches "world.apply")
 * @param outcome ok, pending, rejected, denied or note
 * @param target part of the target
 * @param tag one tag the record must have
 * @param text part of the note, target, action, code or detail
 * @param since records at or after this time (epoch milliseconds, 0 = any)
 * @param until records before this time (epoch milliseconds, 0 = any)
 */
public record HistoryQuery(
        String actor, String action, String outcome, String target, String tag, String text, long since, long until) {
    public static final HistoryQuery ALL = new HistoryQuery("", "", "", "", "", "", 0, 0);
    private static final Set<String> JSON_KEYS =
            Set.of("actor", "action", "outcome", "target", "tag", "text", "since", "until");

    public HistoryQuery {
        actor = norm(actor);
        action = norm(action);
        outcome = norm(outcome);
        target = norm(target);
        tag = norm(tag);
        text = norm(text);
        if (!outcome.isEmpty() && !HistoryRecord.OUTCOMES.contains(outcome))
            throw new IllegalArgumentException("unknown outcome '" + outcome + "'");
        if (since < 0 || until < 0) throw new IllegalArgumentException("negative time");
    }

    public boolean isEmpty() {
        return equals(ALL);
    }

    public HistoryQuery withActor(String newActor) {
        return new HistoryQuery(newActor, action, outcome, target, tag, text, since, until);
    }

    public boolean matches(HistoryRecord record) {
        if (!actor.isEmpty()
                && !actor.equals(record.actorId.toLowerCase(Locale.ROOT))
                && !actor.equals(record.actorName.toLowerCase(Locale.ROOT))) return false;
        if (!action.isEmpty()
                && !(record.action.equals(action)
                        || record.action.startsWith(action.endsWith(".") ? action : action + "."))) return false;
        if (!outcome.isEmpty() && !record.outcome.equals(outcome)) return false;
        if (!target.isEmpty() && !record.target.toLowerCase(Locale.ROOT).contains(target)) return false;
        if (!tag.isEmpty() && !record.tags().contains(tag)) return false;
        if (since > 0 && record.time < since) return false;
        if (until > 0 && record.time >= until) return false;
        if (!text.isEmpty()) {
            String haystack = (record.note()
                            + '\n'
                            + record.target
                            + '\n'
                            + record.action
                            + '\n'
                            + record.code
                            + '\n'
                            + record.detail)
                    .toLowerCase(Locale.ROOT);
            if (!haystack.contains(text)) return false;
        }
        return true;
    }

    /**
     * Command syntax: space-separated {@code key:value} terms (player: actor: action: outcome: target: tag: since:
     * until:); since/until take a duration back from now (30m, 12h, 7d) or a date (2026-11-01, server time zone).
     * Words without a key are matched as text.
     */
    public static HistoryQuery parse(String query, long now, ZoneId zone) {
        String actor = "", action = "", outcome = "", target = "", tag = "";
        var text = new StringBuilder();
        long since = 0, until = 0;
        for (String term : query == null ? new String[0] : query.trim().split("\\s+")) {
            if (term.isEmpty()) continue;
            int colon = term.indexOf(':');
            String key = colon > 0 ? term.substring(0, colon).toLowerCase(Locale.ROOT) : "";
            String value = colon > 0 ? term.substring(colon + 1) : term;
            switch (key) {
                case "player", "actor" -> actor = value;
                case "action" -> action = value;
                case "outcome", "result" -> outcome = value;
                case "target" -> target = value;
                case "tag" -> tag = value;
                case "since" -> since = time(value, now, zone);
                case "until" -> until = time(value, now, zone);
                default -> text.append(text.isEmpty() ? "" : " ").append(term);
            }
        }
        return new HistoryQuery(actor, action, outcome, target, tag, text.toString(), since, until);
    }

    /** The editor UI's filter object; unknown keys are rejected. */
    public static HistoryQuery fromJson(JsonElement element) {
        if (element == null || element.isJsonNull()) return ALL;
        if (!element.isJsonObject()) throw new IllegalArgumentException("filter must be an object");
        JsonObject json = element.getAsJsonObject();
        for (String key : json.keySet())
            if (!JSON_KEYS.contains(key)) throw new IllegalArgumentException("unknown filter " + key);
        return new HistoryQuery(
                string(json, "actor"),
                string(json, "action"),
                string(json, "outcome"),
                string(json, "target"),
                string(json, "tag"),
                string(json, "text"),
                number(json, "since"),
                number(json, "until"));
    }

    public JsonObject toJson() {
        var json = new JsonObject();
        if (!actor.isEmpty()) json.addProperty("actor", actor);
        if (!action.isEmpty()) json.addProperty("action", action);
        if (!outcome.isEmpty()) json.addProperty("outcome", outcome);
        if (!target.isEmpty()) json.addProperty("target", target);
        if (!tag.isEmpty()) json.addProperty("tag", tag);
        if (!text.isEmpty()) json.addProperty("text", text);
        if (since > 0) json.addProperty("since", since);
        if (until > 0) json.addProperty("until", until);
        return json;
    }

    static long time(String value, long now, ZoneId zone) {
        String v = value.trim().toLowerCase(Locale.ROOT);
        try {
            if (v.matches("\\d+[smhdw]")) {
                long amount = Long.parseLong(v.substring(0, v.length() - 1));
                Duration unit = switch (v.charAt(v.length() - 1)) {
                    case 's' -> Duration.ofSeconds(1);
                    case 'm' -> Duration.ofMinutes(1);
                    case 'h' -> Duration.ofHours(1);
                    case 'd' -> Duration.ofDays(1);
                    default -> Duration.ofDays(7);
                };
                return Math.max(1, now - unit.multipliedBy(amount).toMillis());
            }
            return LocalDate.parse(v).atStartOfDay(zone).toInstant().toEpochMilli();
        } catch (DateTimeParseException | ArithmeticException | NumberFormatException e) {
            throw new IllegalArgumentException("'" + value + "' is not a time: use 30m, 12h, 7d, 2w or 2026-11-01");
        }
    }

    private static String norm(String value) {
        return value == null ? "" : HistoryRecord.text(value.trim(), 100).toLowerCase(Locale.ROOT);
    }

    private static String string(JsonObject json, String key) {
        var value = json.get(key);
        if (value == null || value.isJsonNull()) return "";
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString())
            throw new IllegalArgumentException(key + " must be a string");
        return value.getAsString();
    }

    private static long number(JsonObject json, String key) {
        var value = json.get(key);
        if (value == null || value.isJsonNull()) return 0;
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber())
            throw new IllegalArgumentException(key + " must be a number");
        return value.getAsLong();
    }
}
