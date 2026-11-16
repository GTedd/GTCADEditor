package cn.gtedd.cadeditorpaper;

import dev.rinorsi.editor.EditorPackets;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.handler.codec.DecoderException;
import net.minecraft.core.RegistryAccess;
import net.minecraft.network.RegistryFriendlyByteBuf;

/** The editor's request and reply channels as plugin messages, coded with the editor's own {@code EditorPackets}. */
public final class EditorChannel {
    /** Client to server: {@code cadeditor:request}. */
    public static final String REQUEST = EditorPackets.Request.TYPE.id().toString();
    /** Server to client: {@code cadeditor:reply}. */
    public static final String REPLY = EditorPackets.Reply.TYPE.id().toString();

    private EditorChannel() {}

    /**
     * A request body as the client sent it.
     *
     * @throws DecoderException when the body is not exactly one request (malformed, over the editor's limit, or with
     *                          bytes left over, which the vanilla packet decoder would also reject)
     */
    public static EditorPackets.Request decodeRequest(byte[] body, RegistryAccess registries) {
        RegistryFriendlyByteBuf buf = new RegistryFriendlyByteBuf(Unpooled.wrappedBuffer(body), registries);
        try {
            EditorPackets.Request request = EditorPackets.Request.CODEC.decode(buf);
            if (buf.isReadable()) throw new DecoderException(buf.readableBytes() + " bytes after the request");
            return request;
        } finally {
            buf.release();
        }
    }

    /** A reply body (one frame of {@code EditorWire.frames}) as the client decodes it. */
    public static byte[] encodeReply(EditorPackets.Reply reply, RegistryAccess registries) {
        ByteBuf raw = Unpooled.buffer();
        RegistryFriendlyByteBuf buf = new RegistryFriendlyByteBuf(raw, registries);
        try {
            EditorPackets.Reply.CODEC.encode(buf, reply);
            byte[] bytes = new byte[buf.readableBytes()];
            buf.readBytes(bytes);
            return bytes;
        } finally {
            buf.release();
        }
    }
}
