package dev.rinorsi.editor.client;

import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorSessions;

/** Client state machine, no prediction, chat parsing, retries or permission assumptions. */
public final class HotbarCommandSession {
    public record Context(
            Object connection, Object world, Object player, Object menu, int syncRevision, String fingerprint) {}

    public enum Outcome {
        WAITING,
        SAVED,
        CHANGED,
        UNKNOWN
    }

    private final Context opened;
    private final int index;
    private String baseline;
    private String expected;
    private String requestId;
    private int sentRevision;
    private long deadline;
    private boolean blocked;
    private boolean confirmed;

    public HotbarCommandSession(int index, Context opened) {
        HotbarCommandCodec.requireSlot(index);
        this.index = index;
        this.opened = opened;
        baseline = opened.fingerprint();
    }

    public int index() {
        return index;
    }

    public boolean pending() {
        return expected != null;
    }

    public String requestId() {
        return requestId;
    }

    public boolean confirmed() {
        return confirmed;
    }

    public void begin(Context current, String id, String nextFingerprint, long now) {
        if (blocked)
            EditorSessions.fail(
                    "session_stale",
                    EditorI18n.tr("cadeditor.message.hotbarcommandsession.session_disabled_result_unknown_read"));
        if (pending())
            EditorSessions.fail(
                    "request_pending",
                    EditorI18n.tr("cadeditor.message.hotbarcommandsession.previous_changes_synchronized_server"));
        if (!sameContext(current) || !baseline.equals(current.fingerprint())) {
            blocked = true;
            EditorSessions.fail(
                    "item_changed",
                    EditorI18n.tr("cadeditor.message.hotbarcommandsession.connection_world_session_original_item"));
        }
        if (baseline.equals(nextFingerprint))
            EditorSessions.fail(
                    "no_changes", EditorI18n.tr("cadeditor.message.hotbarcommandsession.item_change_command_send"));
        if (id == null || id.isBlank())
            EditorSessions.fail(
                    "invalid_request",
                    EditorI18n.tr("cadeditor.message.hotbarcommandsession.lack_effective_marking_requests"));
        requestId = id;
        confirmed = false;
        expected = nextFingerprint;
        sentRevision = current.syncRevision();
        deadline = now + 10_000_000_000L;
    }

    public Outcome observe(Context current, String activeRequestId, long now) {
        if (!pending()) {
            if (!sameContext(current) || !baseline.equals(current.fingerprint())) blocked = true;
            return Outcome.WAITING;
        }
        if (!requestId.equals(activeRequestId)) return stop(Outcome.UNKNOWN);
        if (!sameContext(current)) return stop(Outcome.UNKNOWN);
        if (now >= deadline) return stop(Outcome.UNKNOWN);
        // ItemCommands broadcasts its menu changes. A match without a new server
        // menu state is insufficient: a local value alone never confirms a save.
        if (current.syncRevision() != sentRevision && expected.equals(current.fingerprint())) {
            baseline = expected;
            expected = null;
            confirmed = true;
            return Outcome.SAVED;
        }
        if (!baseline.equals(current.fingerprint()) && !expected.equals(current.fingerprint()))
            return stop(Outcome.CHANGED);
        return Outcome.WAITING;
    }

    public void invalidate() {
        blocked = true;
        expected = null;
    }

    private Outcome stop(Outcome result) {
        invalidate();
        return result;
    }

    private boolean sameContext(Context current) {
        return current != null
                && current.connection() == opened.connection()
                && current.world() == opened.world()
                && current.player() == opened.player()
                && current.menu() == opened.menu();
    }
}
