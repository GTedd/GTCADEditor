package dev.rinorsi.editor.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import dev.rinorsi.editor.EditorHandshake;
import dev.rinorsi.editor.client.ServerLink.State;
import org.junit.jupiter.api.Test;

/** The join handshake: nothing is decided before the server answered or the waits ran out. */
class ServerLinkTest {
    private static final long S = 1_000_000_000L;

    private static JsonObject hello(String id, int protocol) {
        var reply = new JsonObject();
        reply.addProperty("status", "hello");
        reply.addProperty("requestId", id);
        reply.addProperty("protocol", protocol);
        return reply;
    }

    @Test
    void serverWithTheEditor() {
        var machine = new ServerLink.Machine();
        machine.reset(true, 0);
        assertEquals(State.PROBING, machine.state);
        assertNull(machine.tick(false, S), "no hello before the server announces the channel");
        String id = machine.tick(true, 2 * S);
        assertNotNull(id);
        assertNull(machine.tick(true, 3 * S), "one hello per connection");
        assertFalse(machine.answer("someone-else", hello("someone-else", EditorHandshake.PROTOCOL)));
        assertEquals(State.PROBING, machine.state);
        assertTrue(machine.answer(id, hello(id, EditorHandshake.PROTOCOL)));
        assertEquals(State.CONNECTED, machine.state);
        assertNotNull(machine.info);
    }

    @Test
    void serverWithoutTheEditor() {
        var machine = new ServerLink.Machine();
        machine.reset(true, 0);
        assertNull(machine.tick(false, ServerLink.CHANNEL_WAIT_NANOS + 1));
        assertEquals(State.ABSENT, machine.state, "a lobby without the plugin");
        assertEquals("no_channel", machine.reason);
        // The channel can be announced late (slow proxies): probe again then.
        assertNotNull(machine.tick(true, ServerLink.CHANNEL_WAIT_NANOS + 2));
        assertEquals(State.PROBING, machine.state);
    }

    @Test
    void noReplyAndLateReply() {
        var machine = new ServerLink.Machine();
        machine.reset(true, 0);
        String id = machine.tick(true, 0);
        machine.tick(true, ServerLink.REPLY_WAIT_NANOS + 1);
        assertEquals(State.ABSENT, machine.state);
        assertEquals("no_reply", machine.reason);
        assertTrue(machine.answer(id, hello(id, EditorHandshake.PROTOCOL)), "a late answer still settles it");
        assertEquals(State.CONNECTED, machine.state);
    }

    @Test
    void olderAndIncompatibleServers() {
        var machine = new ServerLink.Machine();
        machine.reset(true, 0);
        String id = machine.tick(true, 0);
        var rejected = new JsonObject();
        rejected.addProperty("status", "rejected");
        rejected.addProperty("requestId", id);
        assertTrue(machine.answer(id, rejected));
        assertEquals(State.CONNECTED, machine.state, "an editor server from before the handshake still answers");
        assertEquals("legacy", machine.reason);

        machine.reset(true, 0);
        id = machine.tick(true, 0);
        assertTrue(machine.answer(id, hello(id, EditorHandshake.PROTOCOL + 1)));
        assertEquals(State.ABSENT, machine.state, "an incompatible protocol is not used");

        machine.reset(false, 0);
        assertEquals(State.OFFLINE, machine.state);
        assertNull(machine.tick(true, S));
    }
}
