package dev.rinorsi.editor.client;

import com.google.gson.JsonObject;
import dev.rinorsi.editor.EditorHandshake;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorPackets;
import dev.rinorsi.editor.EditorSessions;
import dev.rinorsi.editor.EditorWriteLog;
import dev.rinorsi.editor.platform.ClientPlatform;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import org.jspecify.annotations.Nullable;

/**
 * Join handshake: whether the current server runs the editor. Starts again on every new connection, including proxy
 * server switches; nothing else is sent before it settles.
 */
public final class ServerLink {
    public enum State {
        OFFLINE,
        PROBING,
        CONNECTED,
        ABSENT
    }

    /** Wait this long after joining for the server to announce the editor channel. */
    static final long CHANNEL_WAIT_NANOS = 4_000_000_000L;
    /** Wait this long for the answer to hello. */
    static final long REPLY_WAIT_NANOS = 6_000_000_000L;

    private static final Machine MACHINE = new Machine();
    private static Object connection;

    private ServerLink() {}

    public static void initialize() {
        ClientPlatform.get().onTick(ServerLink::tick);
        ClientPlatform.get().onDisconnect(mc -> {
            connection = null;
            MACHINE.reset(false, System.nanoTime());
        });
    }

    private static void tick(Minecraft mc) {
        Object current = mc.getConnection();
        long now = System.nanoTime();
        if (current != connection) {
            connection = current;
            MACHINE.reset(current != null, now);
        }
        if (current == null) return;
        String hello = MACHINE.tick(ClientPlatform.get().canSend(EditorPackets.Request.TYPE), now);
        if (hello != null) {
            var request = new JsonObject();
            request.addProperty("op", "hello");
            request.addProperty("requestId", hello);
            request.addProperty("protocol", EditorHandshake.PROTOCOL);
            try {
                ClientPlatform.get().send(new EditorPackets.Request(request.toString()));
                EditorWriteLog.event("client.hello.sent", hello, "protocol=" + EditorHandshake.PROTOCOL);
            } catch (RuntimeException e) {
                EditorWriteLog.failure("client.hello.send_failure", hello, "", e);
                MACHINE.absent("send_failed");
            }
        }
    }

    /** Consumes the reply to our hello; false for every other reply. */
    public static boolean receive(JsonObject reply) {
        String id = reply.has("requestId") && reply.get("requestId").isJsonPrimitive()
                ? reply.get("requestId").getAsString()
                : "";
        boolean ours = MACHINE.answer(id, reply);
        if (ours)
            EditorWriteLog.event("client.hello.reply", id, "state=" + MACHINE.state + " reason=" + MACHINE.reason);
        return ours;
    }

    public static State state() {
        return MACHINE.state;
    }

    /** The server answered the handshake: editor requests may be sent. */
    public static boolean connected() {
        return MACHINE.state == State.CONNECTED;
    }

    /** What the server said in its hello (protocol, version, capability hints), or null. */
    public static @Nullable JsonObject info() {
        return MACHINE.info == null ? null : MACHINE.info.deepCopy();
    }

    /** Fails while the handshake is still running, so nothing is sent (or done by vanilla means) before it settles. */
    public static void requireSettled() {
        if (MACHINE.state == State.PROBING)
            throw new EditorSessions.Failure(
                    "handshake_pending", EditorI18n.tr("cadeditor.message.serverlink.pending"));
    }

    /** The handshake itself: one hello per connection, a channel wait and a reply wait. */
    static final class Machine {
        State state = State.OFFLINE;
        String reason = "";

        @Nullable
        String hello;

        @Nullable
        JsonObject info;

        long since;
        long sent;

        void reset(boolean joined, long now) {
            state = joined ? State.PROBING : State.OFFLINE;
            reason = "";
            hello = null;
            info = null;
            since = now;
            sent = 0;
        }

        /** Advances the handshake; returns the id of a hello to send now, or null. */
        @Nullable
        String tick(boolean channel, long now) {
            if (state == State.ABSENT && reason.equals("no_channel") && channel) reset(true, now); // late registration
            if (state != State.PROBING) return null;
            if (hello == null) {
                if (channel) {
                    hello = "hello-" + UUID.randomUUID();
                    sent = now;
                    return hello;
                }
                if (now - since > CHANNEL_WAIT_NANOS) absent("no_channel");
                return null;
            }
            if (now - sent > REPLY_WAIT_NANOS) absent("no_reply");
            return null;
        }

        /**
         * True when {@code id} is our hello (also when it arrives after the reply wait); a server that does not know
         * hello (an older editor) still counts as one with the editor.
         */
        boolean answer(String id, JsonObject reply) {
            if (hello == null || !hello.equals(id) || state == State.OFFLINE) return false;
            hello = null;
            String status = reply.has("status") && reply.get("status").isJsonPrimitive()
                    ? reply.get("status").getAsString()
                    : "";
            if (!status.equals("hello")) {
                state = State.CONNECTED;
                reason = "legacy";
                info = null;
                return true;
            }
            int protocol;
            try {
                protocol = reply.get("protocol").getAsInt();
            } catch (RuntimeException e) {
                protocol = 0;
            }
            if (protocol != EditorHandshake.PROTOCOL) {
                absent("protocol_" + protocol);
                return true;
            }
            state = State.CONNECTED;
            reason = "hello";
            info = reply.deepCopy();
            return true;
        }

        void absent(String why) {
            state = State.ABSENT;
            reason = why;
        }
    }
}
