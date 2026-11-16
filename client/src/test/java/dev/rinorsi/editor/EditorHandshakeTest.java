package dev.rinorsi.editor;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The server answers at most four hellos per player in ten seconds. */
class EditorHandshakeTest {
    @Test
    void helloIsRateLimited() {
        EditorHandshake.clear();
        var player = UUID.randomUUID();
        long second = 1_000_000_000L;
        for (int i = 1; i <= 4; i++) assertTrue(EditorHandshake.admit(player, i * second));
        assertFalse(EditorHandshake.admit(player, 5 * second));
        assertTrue(EditorHandshake.admit(UUID.randomUUID(), 5 * second), "per player");
        assertTrue(EditorHandshake.admit(player, 12 * second), "the window moves on");
        EditorHandshake.clear();
    }
}
