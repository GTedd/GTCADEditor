package dev.rinorsi.editor.client;

import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorSessions;
import dev.rinorsi.editor.EditorWriteLog;
import net.minecraft.client.Minecraft;
import net.minecraft.world.item.ItemStack;

/** Shared client-only transport for editor saves and detached vault inserts. */
public final class ClientInventoryCommands {
    private static HotbarCommandSession inFlight;
    private static Object leaseConnection;
    private static long leaseUntil;

    private ClientInventoryCommands() {}

    public static HotbarCommandSession.Context context(Minecraft mc, int index) {
        if (mc.player == null || mc.level == null || mc.getConnection() == null) return null;
        HotbarCommandCodec.requireSlot(index);
        return new HotbarCommandSession.Context(
                mc.getConnection(),
                mc.level,
                mc.player,
                mc.player.containerMenu,
                mc.player.containerMenu.getStateId(),
                fingerprint(mc.player.getInventory().getItem(index), mc));
    }

    public static String fingerprint(ItemStack stack, Minecraft mc) {
        return stack.isEmpty() ? "empty-inventory-slot" : EditorSessions.fingerprint(stack, mc.level.registryAccess());
    }

    public static void requireAvailable(Minecraft mc) {
        if (mc.player == null || mc.level == null || mc.getConnection() == null)
            EditorSessions.fail(
                    "not_connected",
                    EditorI18n.tr("cadeditor.message.clientinventorycommands.currently_connected_world_draft_vault"));
        // Re-read for every submission: an operator may have been deopped since the page opened.
        VanillaWriteRule.requireCommands(mc.player.isCreative(), gamemaster(mc));
        if (leaseBlocks(inFlight, mc.getConnection() == leaseConnection, System.nanoTime(), leaseUntil))
            EditorSessions.fail(
                    "request_pending",
                    EditorI18n.tr("cadeditor.message.clientinventorycommands.previous_item_command_synchronised"));
        var root = mc.player.connection.getCommands().getRoot();
        requireCommands(root.getChild("execute") != null, root.getChild("item") != null);
    }

    /** Operator command permission as the server last announced it to this client. */
    public static boolean gamemaster(Minecraft mc) {
        return mc.player != null
                && mc.player
                        .permissions()
                        .hasPermission(net.minecraft.server.permissions.Permissions.COMMANDS_GAMEMASTER);
    }

    /** No editor on the server, not creative and not an operator: the vanilla command routes are closed. */
    public static boolean closed(Minecraft mc) {
        return mc.player != null
                && !ServerLink.connected()
                && VanillaWriteRule.commandsClosed(mc.player.isCreative(), gamemaster(mc));
    }

    /**
     * The last gate before a command is sent: the write rule for the player's state right now, then the session start.
     * A refused submission sends nothing and leaves the bound session usable (for example after being opped again).
     */
    static void begin(
            HotbarCommandSession session,
            HotbarCommandSession.Context current,
            boolean creative,
            boolean gamemaster,
            String id,
            String nextFingerprint,
            long now) {
        VanillaWriteRule.requireCommands(creative, gamemaster);
        session.begin(current, id, nextFingerprint, now);
    }

    // Closing/reloading a page invalidates its callback, not an already sent network command.
    static boolean leaseBlocks(HotbarCommandSession session, boolean sameConnection, long now, long until) {
        return session != null && sameConnection && !session.confirmed() && now < until;
    }

    public static void requireCommands(boolean execute, boolean item) {
        if (!execute || !item)
            EditorSessions.fail(
                    "command_unavailable",
                    EditorI18n.tr("cadeditor.message.clientinventorycommands.vanilla_minecraft_command_available"));
    }

    public static String capabilityHint(Minecraft mc) {
        if (mc.player == null || mc.level == null || mc.getConnection() == null)
            return EditorI18n.tr("cadeditor.message.clientinventorycommands.retrieve_inventory_currently_available");
        if (closed(mc)) return VanillaWriteRule.itemCapability();
        var root = mc.player.connection.getCommands().getRoot();
        if (root.getChild("execute") == null || root.getChild("item") == null)
            return EditorI18n.tr("cadeditor.message.clientinventorycommands.vanilla_minecraft_command_available_2");
        return EditorI18n.tr("cadeditor.message.clientinventorycommands.command_mode_only_supports_own");
    }

    public static void send(Minecraft mc, HotbarCommandSession session, String id, ItemStack original, ItemStack next) {
        var commands =
                mc.player == null ? null : mc.player.connection.getCommands().getRoot();
        EditorWriteLog.event(
                "client.command.preflight",
                id,
                "inventory_index=" + session.index()
                        + " execute_visible=" + (commands != null && commands.getChild("execute") != null)
                        + " item_visible=" + (commands != null && commands.getChild("item") != null));
        requireAvailable(mc);
        String command;
        try {
            command = HotbarCommandCodec.compile(session.index(), original, next, mc.level.registryAccess());
        } catch (RuntimeException failure) {
            EditorWriteLog.failure(
                    "client.command.compile_rejected", id, "inventory_index=" + session.index(), failure);
            throw failure;
        }
        long now = System.nanoTime();
        begin(
                session,
                context(mc, session.index()),
                mc.player.isCreative(),
                gamemaster(mc),
                id,
                fingerprint(next, mc),
                now);
        inFlight = session;
        leaseConnection = mc.getConnection();
        leaseUntil = now + 10_000_000_000L;
        try {
            mc.player.connection.sendCommand(command);
            EditorWriteLog.event(
                    "client.command.sent",
                    id,
                    "inventory_index=" + session.index() + " command_chars=" + command.length() + " menu_revision="
                            + mc.player.containerMenu.getStateId());
        } catch (RuntimeException failure) {
            EditorWriteLog.failure("client.command.send_failure", id, "inventory_index=" + session.index(), failure);
            session.invalidate();
            throw failure;
        }
    }
}
