package cn.gtedd.cadeditorpaper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.rinorsi.editor.EditorPackets;
import dev.rinorsi.editor.EditorWire;
import io.netty.buffer.Unpooled;
import io.netty.handler.codec.DecoderException;
import java.util.Arrays;
import java.util.List;
import net.minecraft.core.RegistryAccess;
import net.minecraft.network.RegistryFriendlyByteBuf;
import org.junit.jupiter.api.Test;

/** The plugin-message transport against the editor's own codecs and framing, as the client uses them. */
class EditorChannelTest {
    private static final RegistryAccess REGISTRIES = RegistryAccess.EMPTY;

    @Test
    void channelsAreTheEditors() {
        assertEquals("cadeditor:request", EditorChannel.REQUEST);
        assertEquals("cadeditor:reply", EditorChannel.REPLY);
    }

    @Test
    void decodesWhatTheClientEncodes() {
        String json = "{\"op\":\"open\",\"requestId\":\"open-1\",\"name\":\"苹果 😀\"}";
        assertEquals(
                json,
                EditorChannel.decodeRequest(clientRequest(json), REGISTRIES).json());
    }

    @Test
    void rejectsBodiesTheVanillaDecoderWouldReject() {
        byte[] valid = clientRequest("{}");
        assertThrows(
                DecoderException.class,
                () -> EditorChannel.decodeRequest(Arrays.copyOf(valid, valid.length + 1), REGISTRIES));
        assertThrows(
                RuntimeException.class,
                () -> EditorChannel.decodeRequest(Arrays.copyOf(valid, valid.length - 1), REGISTRIES));
        // Over EditorPackets.MAX_JSON characters: the editor's codec refuses it, so the plugin does too.
        byte[] tooLong = rawString("x".repeat(EditorPackets.MAX_JSON + 1));
        assertThrows(DecoderException.class, () -> EditorChannel.decodeRequest(tooLong, REGISTRIES));
    }

    @Test
    void largeRepliesRoundTripThroughFramesAndThePluginEncoding() {
        String original = bigObject(400_000);
        List<String> frames = EditorWire.frames(original);
        assertTrue(frames.size() > 1, "a reply this large is split");
        EditorWire.Receiver receiver = new EditorWire.Receiver();
        String result = null;
        for (int i = 0; i < frames.size(); i++) {
            byte[] body = EditorChannel.encodeReply(new EditorPackets.Reply(frames.get(i)), REGISTRIES);
            assertTrue(body.length <= Short.MAX_VALUE, "each frame fits one plugin message comfortably");
            String frame = clientReply(body);
            result = receiver.accept(frame);
            if (i < frames.size() - 1) assertNull(result, "no partial result before the last frame");
        }
        assertEquals(JsonParser.parseString(original), JsonParser.parseString(result));
    }

    @Test
    void largeRequestsRoundTripThroughTheServersReceiver() {
        String original = bigObject(300_000);
        EditorWire.Receiver receiver = new EditorWire.Receiver();
        String result = null;
        for (String frame : EditorWire.frames(original)) {
            result = receiver.accept(EditorChannel.decodeRequest(clientRequest(frame), REGISTRIES)
                    .json());
        }
        assertEquals(JsonParser.parseString(original), JsonParser.parseString(result));
    }

    @Test
    void smallPayloadsAreSentAsOneFrame() {
        String small = "{\"status\":\"opened\",\"requestId\":\"r\"}";
        assertEquals(List.of(small), EditorWire.frames(small));
        assertEquals(small, clientReply(EditorChannel.encodeReply(new EditorPackets.Reply(small), REGISTRIES)));
    }

    private static String bigObject(int chars) {
        JsonObject object = new JsonObject();
        object.addProperty("status", "opened");
        StringBuilder text = new StringBuilder(chars);
        for (int i = 0; text.length() < chars; i++)
            text.append(i % 3 == 0 ? "方块实体" : "snbt:").append(i).append(',');
        object.addProperty("snbt", text.toString());
        return object.toString();
    }

    /** A request body as the client's EditorPackets.Request.CODEC writes it. */
    private static byte[] clientRequest(String json) {
        RegistryFriendlyByteBuf buf = new RegistryFriendlyByteBuf(Unpooled.buffer(), REGISTRIES);
        EditorPackets.Request.CODEC.encode(buf, new EditorPackets.Request(json));
        byte[] bytes = new byte[buf.readableBytes()];
        buf.readBytes(bytes);
        return bytes;
    }

    /** A reply body as the client's EditorPackets.Reply.CODEC reads it, rejecting leftover bytes. */
    private static String clientReply(byte[] body) {
        RegistryFriendlyByteBuf buf = new RegistryFriendlyByteBuf(Unpooled.wrappedBuffer(body), REGISTRIES);
        String json = EditorPackets.Reply.CODEC.decode(buf).json();
        assertEquals(0, buf.readableBytes());
        return json;
    }

    /** A VarInt-prefixed UTF-8 string without the codec's length check. */
    private static byte[] rawString(String value) {
        byte[] utf8 = value.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        var buf = Unpooled.buffer();
        int v = utf8.length;
        while ((v & ~0x7F) != 0) {
            buf.writeByte((v & 0x7F) | 0x80);
            v >>>= 7;
        }
        buf.writeByte(v);
        buf.writeBytes(utf8);
        byte[] bytes = new byte[buf.readableBytes()];
        buf.readBytes(bytes);
        return bytes;
    }
}
