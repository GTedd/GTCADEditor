package dev.rinorsi.editor.registry;

import com.google.gson.*;
import dev.rinorsi.editor.EditorI18n;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;

/** Bounded JSON transport, not a data filter. One large logical response commits atomically. */
public final class RegistryFragments {
    public static final String ENCODING = "registry-json-fragments-v1";
    public static final int MAX_RESPONSE_CHARS = 2_097_152;
    public static final int MAX_ROWS = 16_384;
    public static final int MAX_FRAGMENTS = 256;
    public static final int MAX_WIRE_CHARS = 4_194_304;
    private static final AtomicLong IDS = new AtomicLong();

    private RegistryFragments() {}

    static List<JsonObject> split(JsonObject logical) {
        JsonArray rows = logical.getAsJsonArray("entries");
        if (rows.size() > MAX_ROWS)
            throw new IllegalArgumentException(EditorI18n.tr(
                    "cadeditor.message.registryfragments.registry_fractional_entries_exceed", (MAX_ROWS)));
        String payload = logical.toString();
        if (payload.length() > MAX_RESPONSE_CHARS)
            throw new IllegalArgumentException(EditorI18n.tr(
                    "cadeditor.message.registryfragments.registry_complete_response_exceeding",
                    (MAX_RESPONSE_CHARS),
                    (logical.get("name"))));
        JsonObject header = logical.deepCopy();
        header.add("entries", new JsonArray());
        header.addProperty("version", 2);
        header.addProperty("encoding", ENCODING);
        header.addProperty("transferId", "registry-fragment-" + IDS.incrementAndGet());
        header.addProperty("responseChars", payload.length());
        header.addProperty("checksum", checksum(payload));
        List<JsonObject> pages = new ArrayList<>();
        int offset = 0, wireChars = 0;
        while (offset < payload.length()) {
            if (pages.size() >= MAX_FRAGMENTS)
                throw new IllegalArgumentException(EditorI18n.tr(
                        "cadeditor.message.registryfragments.registry_fractions_exceed", (MAX_FRAGMENTS)));
            // Search using the worst count/index widths. Escaped quotes/backslashes count
            // against the real JSON envelope; UTF-16 surrogate pairs never cross a frame.
            int low = 1, high = Math.min(payload.length() - offset, RegistryPages.MAX_CHARS), length = 0;
            while (low <= high) {
                int mid = (low + high) >>> 1;
                JsonObject probe =
                        frame(header, MAX_FRAGMENTS, MAX_FRAGMENTS, offset, payload.substring(offset, offset + mid));
                if (probe.toString().length() <= RegistryPages.MAX_CHARS) {
                    length = mid;
                    low = mid + 1;
                } else high = mid - 1;
            }
            if (length > 0
                    && offset + length < payload.length()
                    && Character.isHighSurrogate(payload.charAt(offset + length - 1))
                    && Character.isLowSurrogate(payload.charAt(offset + length))) length--;
            if (length <= 0)
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.registryfragments.registry_sub_envelope_content_space"));
            JsonObject page =
                    frame(header, pages.size(), MAX_FRAGMENTS, offset, payload.substring(offset, offset + length));
            wireChars += page.toString().length();
            if (wireChars > MAX_WIRE_CHARS)
                throw new IllegalArgumentException(EditorI18n.tr(
                        "cadeditor.message.registryfragments.registry_split_bus_sizes_greater", (MAX_WIRE_CHARS)));
            pages.add(page);
            offset += length;
        }
        for (JsonObject page : pages) page.addProperty("fragmentCount", pages.size());
        return List.copyOf(pages);
    }

    private static JsonObject frame(JsonObject header, int index, int count, int offset, String payload) {
        JsonObject page = header.deepCopy();
        page.addProperty("fragmentIndex", index);
        page.addProperty("fragmentCount", count);
        page.addProperty("fragmentOffset", offset);
        page.addProperty("payload", payload);
        return page;
    }
    /** FNV-1a over UTF-16 code units, shared with the page; integrity check, not authentication. */
    public static String checksum(String text) {
        int hash = 0x811c9dc5;
        for (int i = 0; i < text.length(); i++) hash = (hash ^ text.charAt(i)) * 0x01000193;
        return String.format(java.util.Locale.ROOT, "%08x", hash);
    }
}
