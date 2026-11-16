package cn.gtedd.cadeditorpaper.probe;

import dev.rinorsi.editor.EditorPackets;
import io.netty.buffer.Unpooled;
import net.minecraft.core.RegistryAccess;
import net.minecraft.network.RegistryFriendlyByteBuf;

/** Decodes what the plugin sent as a cadeditor:reply plugin message, for probes that record a player's packets. */
public final class ProbeTransport {
    private ProbeTransport() {}

    public static String replyJson(byte[] body) {
        RegistryFriendlyByteBuf buf = new RegistryFriendlyByteBuf(Unpooled.wrappedBuffer(body), RegistryAccess.EMPTY);
        try {
            String json = EditorPackets.Reply.CODEC.decode(buf).json();
            if (buf.isReadable()) throw new IllegalStateException(buf.readableBytes() + " bytes after the reply");
            return json;
        } finally {
            buf.release();
        }
    }
}
