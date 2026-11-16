package dev.rinorsi.editor.vault;

import com.google.gson.JsonObject;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorSessions;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.function.Supplier;

/** Connection-lifetime idempotency. Never evict successful ids and accidentally execute them again. */
public final class GiveRequests {
    private record Entry(String digest, JsonObject response) {}

    private final Map<String, Entry> entries = new HashMap<>();

    public JsonObject execute(JsonObject request, Supplier<JsonObject> write) {
        String id = dev.rinorsi.editor.StackCodec.string(request, "requestId");
        if (id.isBlank() || id.length() > 80)
            EditorSessions.fail(
                    "invalid_request", EditorI18n.tr("cadeditor.message.giverequests.retrieve_request_number_invalid"));
        String digest;
        try {
            digest = HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256")
                            .digest(request.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
        Entry old = entries.get(id);
        if (old != null) {
            if (!old.digest.equals(digest))
                EditorSessions.fail(
                        "request_id_conflict",
                        EditorI18n.tr("cadeditor.message.giverequests.same_retrieve_request_number_cannot"));
            return old.response.deepCopy();
        }
        if (entries.size() >= 4096)
            EditorSessions.fail(
                    "rate_limited",
                    EditorI18n.tr("cadeditor.message.giverequests.too_many_requests_connection_retrieve"));
        JsonObject result = write.get();
        entries.put(id, new Entry(digest, result.deepCopy()));
        return result;
    }
}
