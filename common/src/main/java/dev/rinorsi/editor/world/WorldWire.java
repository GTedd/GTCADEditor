package dev.rinorsi.editor.world;

import com.google.gson.*;
import dev.rinorsi.editor.*;
import dev.rinorsi.editor.EditorI18n;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.zip.*;

/** Host-only compression; UI still receives ordinary JSON. Bounded before allocation. */
public final class WorldWire {
    public static final int MAX_DECODED_BYTES = 8 * 1024 * 1024;

    private WorldWire() {}

    public static String encode(JsonObject value) {
        byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_DECODED_BYTES)
            EditorSessions.fail(
                    "payload_too_large",
                    EditorI18n.tr("cadeditor.message.worldwire.world_target_launch_snapshot_over"));
        if (value.toString().length() <= 16000 && bytes.length < 30000) return value.toString();
        try {
            var buffer = new ByteArrayOutputStream();
            try (var gzip = new GZIPOutputStream(buffer)) {
                gzip.write(bytes);
            }
            var envelope = new JsonObject();
            envelope.addProperty("worldEncoding", "gzip-base64");
            envelope.addProperty("data", Base64.getEncoder().encodeToString(buffer.toByteArray()));
            String json = envelope.toString();
            // The shared packet transport splits large envelopes before sending.
            return json;
        } catch (IOException e) {
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.worldwire.world_target_compression_failed"), e);
        }
    }

    public static JsonObject decode(JsonObject value) {
        if (!value.has("worldEncoding")) return value;
        if (!"gzip-base64".equals(value.get("worldEncoding").getAsString()))
            EditorSessions.fail(
                    "invalid_request",
                    EditorI18n.tr("cadeditor.message.worldwire.unknown_world_edit_compression_format"));
        try {
            byte[] zipped = Base64.getDecoder().decode(StackCodec.string(value, "data"));
            try (var gzip = new GZIPInputStream(new ByteArrayInputStream(zipped))) {
                byte[] bytes = gzip.readNBytes(MAX_DECODED_BYTES + 1);
                if (bytes.length > MAX_DECODED_BYTES)
                    EditorSessions.fail(
                            "payload_too_large",
                            EditorI18n.tr("cadeditor.message.worldwire.world_target_launcher_more_8"));
                var result = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8))
                        .getAsJsonObject();
                if (result.has("worldEncoding"))
                    EditorSessions.fail(
                            "invalid_request",
                            EditorI18n.tr("cadeditor.message.worldwire.embedded_compression_messages_allowed"));
                if (result.has("op")) {
                    if ("player_extended".equals(StackCodec.string(result, "op"))) {
                        // Player views address an explicit UUID target, not the legacy world slot.
                        // Authorization and target/view validation remain in PlayerExtendedEditor.
                        if (result.has("target")) StackCodec.object(result, "target");
                    } else {
                        var slot = StackCodec.object(result, "slot");
                        String kind = StackCodec.string(slot, "kind");
                        if (!kind.equals("block") && !kind.equals("entity"))
                            EditorSessions.fail(
                                    "invalid_request",
                                    EditorI18n.tr("cadeditor.message.worldwire.compression_transmission_only_world"));
                    }
                }
                return result;
            }
        } catch (IOException e) {
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.worldwire.world_target_compression_data_invalid"), e);
        }
    }
}
