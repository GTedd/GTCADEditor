package dev.rinorsi.editor.history;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.Set;

/**
 * The "history" block of cadeditor.json.
 *
 * @param enabled whether the server records anything
 * @param recordReads also record successful reads of world and player data (opening a block, an entity, a player)
 * @param recordItemOpens also record successful opens of one's own items (frequent, usually not interesting)
 * @param maxRecords the oldest records beyond this many are dropped
 * @param retentionDays records older than this are dropped; 0 keeps them until maxRecords
 */
public record HistorySettings(
        boolean enabled, boolean recordReads, boolean recordItemOpens, int maxRecords, int retentionDays) {
    public static final HistorySettings DEFAULT = new HistorySettings(true, true, false, 50_000, 180);
    private static final Set<String> KEYS =
            Set.of("enabled", "recordReads", "recordItemOpens", "maxRecords", "retentionDays");

    public HistorySettings {
        if (maxRecords < 100 || maxRecords > 1_000_000)
            throw new IllegalArgumentException("history.maxRecords must be 100-1000000");
        if (retentionDays < 0 || retentionDays > 36_500)
            throw new IllegalArgumentException("history.retentionDays must be 0-36500");
    }

    public static HistorySettings parse(JsonElement element) {
        if (element == null) return DEFAULT;
        if (!element.isJsonObject()) throw new IllegalArgumentException("history must be an object");
        var json = element.getAsJsonObject();
        for (String key : json.keySet())
            if (!KEYS.contains(key)) throw new IllegalArgumentException("history." + key + " is not a setting");
        return new HistorySettings(
                bool(json, "enabled", DEFAULT.enabled),
                bool(json, "recordReads", DEFAULT.recordReads),
                bool(json, "recordItemOpens", DEFAULT.recordItemOpens),
                integer(json, "maxRecords", DEFAULT.maxRecords),
                integer(json, "retentionDays", DEFAULT.retentionDays));
    }

    public JsonObject toJson() {
        var json = new JsonObject();
        json.addProperty("enabled", enabled);
        json.addProperty("recordReads", recordReads);
        json.addProperty("recordItemOpens", recordItemOpens);
        json.addProperty("maxRecords", maxRecords);
        json.addProperty("retentionDays", retentionDays);
        return json;
    }

    private static boolean bool(JsonObject json, String key, boolean fallback) {
        var value = json.get(key);
        if (value == null) return fallback;
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean())
            throw new IllegalArgumentException("history." + key + " must be true or false");
        return value.getAsBoolean();
    }

    private static int integer(JsonObject json, String key, int fallback) {
        var value = json.get(key);
        if (value == null) return fallback;
        if (!value.isJsonPrimitive()
                || !value.getAsJsonPrimitive().isNumber()
                || value.getAsDouble() != Math.rint(value.getAsDouble()))
            throw new IllegalArgumentException("history." + key + " must be a whole number");
        return value.getAsInt();
    }
}
