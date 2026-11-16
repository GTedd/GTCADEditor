package dev.rinorsi.editor.client;

import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorSessions;

/**
 * Which write route a player may use. A server that runs the CAD Editor (handshake connected, including singleplayer
 * and LAN hosts) decides everything itself. Without it, creative mode keeps the vanilla creative-slot packet; outside
 * creative mode the vanilla command routes (item apply, vault give, own player page) are closed unless the player holds
 * operator command permission. Evaluated again before every submission: permission can change mid-session (deop), and
 * the server still authorises each command it receives.
 */
public final class VanillaWriteRule {
    /** Error code of a write refused locally because the vanilla command routes are closed. */
    public static final String CLOSED = "vanilla_closed";

    public enum Route {
        SERVER,
        CREATIVE,
        COMMAND,
        CLOSED
    }

    private VanillaWriteRule() {}

    public static Route route(boolean serverInstalled, boolean creative, boolean gamemaster) {
        if (serverInstalled) return Route.SERVER;
        if (creative) return Route.CREATIVE;
        return gamemaster ? Route.COMMAND : Route.CLOSED;
    }

    /** The vanilla command routes are closed: not creative and no operator command permission. */
    public static boolean commandsClosed(boolean creative, boolean gamemaster) {
        return !creative && !gamemaster;
    }

    /** Refuses a vanilla command write before anything is sent; the draft stays. */
    public static void requireCommands(boolean creative, boolean gamemaster) {
        if (commandsClosed(creative, gamemaster)) EditorSessions.fail(CLOSED, closedReason());
    }

    public static String closedReason() {
        return EditorI18n.tr("cadeditor.message.vanillawriterule.closed");
    }

    /** Item page capability when closed. */
    public static String itemCapability() {
        return EditorI18n.tr("cadeditor.message.vanillawriterule.item_capability");
    }

    /** Vault give capability when closed. */
    public static String vaultCapability() {
        return EditorI18n.tr("cadeditor.message.vanillawriterule.vault_capability");
    }

    /** Own player page capability when closed. */
    public static String selfCapability() {
        return EditorI18n.tr("cadeditor.message.vanillawriterule.self_capability");
    }
}
