package dev.rinorsi.editor.client;

import com.google.gson.*;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorWriteLog;
import dev.rinorsi.editor.StackCodec;
import dev.rinorsi.editor.world.PlayerWorldEdit;
import java.util.*;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import net.minecraft.nbt.CompoundTag;

/** Vanilla self-only fallback. No Player NBT writes, optimistic client mutations or retries. */
final class SelfPlayerCommands {
    private final Object connection, player, level;
    private final JsonObject slot;
    private JsonObject baseline;
    private String operation;
    private long deadline;
    private Consumer<JsonObject> completion;
    private boolean sent;
    private int queries, replies;
    private String permissionContext = "";
    private Runnable nextStep;
    private Runnable readback;
    private long readbackAt;
    private java.util.function.Supplier<Object> currentDocument;
    private DocumentBinding documentBinding;

    /** A reload permanently retires this session, even if an old Document reappears. */
    static final class DocumentBinding {
        private Object document;
        private boolean stale;

        DocumentBinding(Object document) {
            this.document = document;
        }

        boolean accept(Object current) {
            if (stale) return false;
            if (document == null) {
                document = current;
                return current != null;
            }
            if (document != current) stale = true;
            return !stale;
        }
    }

    void bindDocument(java.util.function.Supplier<Object> current) {
        if (documentBinding != null)
            throw new IllegalStateException(
                    EditorI18n.tr("cadeditor.message.selfplayercommands.home_command_session_cannot_migrated"));
        currentDocument = current;
        documentBinding = new DocumentBinding(current.get());
    }

    boolean documentCurrent() {
        if (documentBinding != null && documentBinding.accept(currentDocument.get())) return true;
        cancel();
        return false;
    }

    boolean documentStale() {
        return documentBinding != null && documentBinding.stale;
    }

    String documentReason() {
        return sent
                ? EditorI18n.tr("cadeditor.message.selfplayercommands.pages_reloaded_commands_sent_results")
                : EditorI18n.tr("cadeditor.message.selfplayercommands.pages_reloaded_old_queries_stopped");
    }

    SelfPlayerCommands(Minecraft mc) {
        connection = mc.getConnection();
        player = mc.player;
        level = mc.level;
        slot = new JsonObject();
        slot.addProperty("kind", "entity");
        slot.addProperty("player", "self");
        slot.addProperty("uuid", mc.player.getStringUUID());
        slot.addProperty("id", mc.player.getId());
        slot.addProperty("dim", mc.level.dimension().identifier().toString());
        slot.addProperty("token", UUID.randomUUID().toString());
    }

    private boolean connected(Minecraft mc) {
        return mc.getConnection() == connection && mc.player == player && mc.level == level;
    }

    static boolean command(Minecraft mc, String... path) {
        if (mc.getConnection() == null) return false;
        com.mojang.brigadier.tree.CommandNode<?> node =
                mc.getConnection().getCommands().getRoot();
        for (String name : path) {
            node = node.getChild(name);
            if (node == null) return false;
        }
        return true;
    }

    private static boolean queryAvailable(Minecraft mc) {
        return command(mc, "data", "get", "entity");
    }

    private static String permissions(Minecraft mc) {
        return "backend=vanilla_self target=self connected=" + (mc.getConnection() != null)
                + " data_get_entity_visible=" + queryAvailable(mc)
                + " gamemode_visible=" + command(mc, "gamemode")
                + " experience_set_visible=" + command(mc, "experience", "set")
                + " teleport_visible=" + command(mc, "teleport")
                + " attribute_visible=" + command(mc, "attribute")
                + " advertised_gamemaster="
                + (mc.player != null
                        && mc.player
                                .permissions()
                                .hasPermission(net.minecraft.server.permissions.Permissions.COMMANDS_GAMEMASTER))
                + " creative=" + (mc.player != null && mc.player.isCreative())
                + " vanilla_closed=" + ClientInventoryCommands.closed(mc)
                + " command_tree_is_hint=true";
    }

    private void log(String stage, String detail) {
        EditorWriteLog.event(
                "client.self." + stage,
                operation,
                "sent=" + sent + " queries=" + queries + " replies=" + replies + " " + detail);
    }

    private void logFailure(String stage, RuntimeException error) {
        EditorWriteLog.failure(
                "client.self." + stage,
                operation,
                "sent=" + sent + " queries=" + queries + " replies=" + replies + " " + permissionContext,
                error);
    }

    JsonObject world(Minecraft mc) {
        var snapshot = PlayerWorldEdit.values(mc.player);
        // Ender inventory and entity tags are not authoritative client snapshots.
        snapshot.remove("ender");
        snapshot.remove("Tags");
        snapshot.remove("CustomName");
        snapshot.remove("active_effects");
        var schema = PlayerWorldEdit.schema(mc.player);
        SelfPlayerCommandPlan.addSnapshot(mc, snapshot, schema);
        var world = new JsonObject();
        world.addProperty("kind", "entity");
        world.addProperty("type", "minecraft:player");
        world.add("slot", slot.deepCopy());
        world.addProperty("revision", UUID.randomUUID().toString());
        world.addProperty("snbt", "{}");
        world.add("nbt", new JsonObject());
        world.addProperty("canUndo", false);
        var p = new JsonObject();
        p.addProperty("self", true);
        p.addProperty("name", mc.player.getName().getString());
        world.add("player", p);
        var group = new JsonObject();
        group.add("value", snapshot.deepCopy());
        group.add("schema", schema);
        var views = new JsonObject();
        views.add("player", group);
        world.add("views", views);
        var caps = new JsonObject();
        caps.addProperty("backend", "vanilla_self");
        var fields = new JsonArray();
        var supported = new JsonArray();
        for (String field :
                List.of("playerGameType", "experience.XpLevel", "experience.XpP", "commandPosition", "attributes.base"))
            supported.add(field);
        caps.add("supported", supported);
        // No editor on the server, not creative, not an operator: the command route is closed (drafts only).
        boolean closed = ClientInventoryCommands.closed(mc);
        caps.addProperty("closed", closed);
        if (queryAvailable(mc) && !closed) {
            if (command(mc, "gamemode")) fields.add("playerGameType");
            if (command(mc, "experience", "set")) {
                fields.add("experience.XpLevel");
                fields.add("experience.XpP");
            }
            if (command(mc, "teleport")) fields.add("commandPosition");
            if (command(mc, "attribute")) fields.add("attributes.base");
        }
        caps.add("editable", fields);
        permissionContext = permissions(mc);
        EditorWriteLog.event(
                "client.self.capabilities",
                null,
                permissionContext + " editable=" + fields + " read_only=" + fields.isEmpty() + " blocker="
                        + (closed
                                ? "vanilla_closed"
                                : !queryAvailable(mc)
                                        ? "data_get_entity_not_advertised"
                                        : fields.isEmpty() ? "supported_write_commands_not_advertised" : "none"));
        caps.addProperty(
                "reason",
                closed
                        ? VanillaWriteRule.selfCapability()
                        : fields.isEmpty()
                                ? EditorI18n.tr(
                                        "cadeditor.message.selfplayercommands.self_available_player_command_permission")
                                : EditorI18n.tr(
                                        "cadeditor.message.selfplayercommands.server_installed_editor_game_mode"));
        world.add("capabilities", caps);
        if (baseline == null) baseline = snapshot.deepCopy();
        return world;
    }

    void apply(Minecraft mc, JsonObject request, Consumer<JsonObject> done) {
        permissionContext = permissions(mc);
        EditorWriteLog.event("client.self.preflight", StackCodec.string(request, "requestId"), permissionContext);
        if (!documentCurrent()) throw new IllegalArgumentException(documentReason());
        if (operation != null)
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.selfplayercommands.last_self_order_player_yet"));
        if (!connected(mc))
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.selfplayercommands.world_connection_changed_open_own"));
        // Re-read for every submission: a deop since the page opened closes the route before anything is sent.
        if (ClientInventoryCommands.closed(mc))
            dev.rinorsi.editor.EditorSessions.fail(VanillaWriteRule.CLOSED, VanillaWriteRule.closedReason());
        if (!queryAvailable(mc))
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.selfplayercommands.vanilla_minecraft_command_authority"));
        for (String key : request.keySet())
            if (!Set.of("op", "requestId", "revision", "slot", "entity").contains(key))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.selfplayercommands.pure_client_support_player_field"));
        if (!"apply".equals(StackCodec.string(request, "op")))
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.selfplayercommands.unsupported_backend_command_read_again"));
        var entity = StackCodec.object(request, "entity");
        if (entity.size() != 1)
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.ui.worldplayer.only_own_player_fields_allowed"));
        var patch = StackCodec.object(entity, "player");
        var plan = SelfPlayerCommandPlan.create(mc, baseline, patch);
        HotbarCommandCodec.requireLength(plan.command()); // longer commands get the client disconnected by proxies
        operation = StackCodec.string(request, "requestId");
        completion = done;
        sent = false;
        queries = 0;
        replies = 0;
        deadline = System.nanoTime() + 8_000_000_000L;
        log(
                "query.begin",
                "phase=before command_kind=" + patch.keySet().iterator().next());
        String id = operation;
        query(mc, id, tag -> {
            if (tag == null || !plan.before().test(tag)) {
                finish(
                        "rejected",
                        "target_changed",
                        EditorI18n.tr("cadeditor.message.selfplayercommands.server_data_send_changes_page"),
                        null);
                return;
            }
            // One command only. The query response is correlated by vanilla transaction id.
            sent = true;
            mc.getConnection().sendCommand(plan.command());
            log("command.sent", "phase=after");
            confirm(mc, id, plan);
        });
    }

    private void confirm(Minecraft mc, String id, SelfPlayerCommandPlan plan) {
        query(mc, id, actual -> {
            if (actual == null || !plan.after().test(actual)) {
                // Chat commands and tag queries use different server queues. A query
                // may legitimately observe the old value. Retry reads, NEVER the command.
                readback = () -> confirm(mc, id, plan);
                readbackAt = System.nanoTime() + 200_000_000L;
                return;
            }
            var world = world(mc);
            var values =
                    world.getAsJsonObject("views").getAsJsonObject("player").getAsJsonObject("value");
            plan.project().accept(values, actual);
            baseline = values.deepCopy();
            finish(
                    "saved",
                    "command_confirmed",
                    EditorI18n.tr("cadeditor.message.selfplayercommands.server_readback_confirmation"),
                    world);
        });
    }

    private void query(Minecraft mc, String id, Consumer<CompoundTag> callback) {
        queries++;
        mc.getConnection().getDebugQueryHandler().queryEntityTag(mc.player.getId(), tag -> {
            if (!documentCurrent()) return;
            if (!Objects.equals(operation, id)) return;
            replies++;
            // DebugQueryHandler clears its callback AFTER calling it. Never start the next
            // query reentrantly: that would clear the newly installed response handler.
            nextStep = () -> {
                if (!documentCurrent()) return;
                if (!Objects.equals(operation, id)) return;
                if (!connected(mc)) {
                    finish(
                            "rejected",
                            "connection_changed",
                            EditorI18n.tr(
                                    "cadeditor.message.selfplayercommands.connection_world_changed_outcome_unknown"),
                            null);
                    return;
                }
                try {
                    callback.accept(tag);
                } catch (RuntimeException e) {
                    logFailure("query.callback_failure", e);
                    finish(
                            "rejected",
                            "command_unconfirmed",
                            EditorI18n.tr("cadeditor.message.selfplayercommands.query_command_interruption_draft"),
                            null);
                }
            };
        });
    }

    void tick(Minecraft mc) {
        if (!documentCurrent()) return;
        if (operation != null && (!connected(mc) || System.nanoTime() > deadline))
            finish(
                    "rejected",
                    "command_unconfirmed",
                    sent
                            ? EditorI18n.tr("cadeditor.message.selfplayercommands.command_sent_but_read_back")
                            : EditorI18n.tr("cadeditor.message.selfplayercommands.authority_query_received_permission"),
                    null);
        var step = nextStep;
        nextStep = null;
        if (step != null) step.run();
        if (operation != null && readback != null && System.nanoTime() >= readbackAt) {
            var retry = readback;
            readback = null;
            try {
                retry.run();
            } catch (RuntimeException e) {
                logFailure("query.retry_failure", e);
                finish(
                        "rejected",
                        "command_unconfirmed",
                        EditorI18n.tr("cadeditor.message.selfplayercommands.command_sent_but_readback_interrupted"),
                        null);
            }
        }
    }

    void cancel() {
        if (operation != null)
            log(
                    "cancel",
                    "outcome=" + (sent ? "unknown" : "not_sent") + " reason=session_cancelled_or_document_changed");
        operation = null;
        completion = null;
        nextStep = null;
        readback = null;
    }

    private void finish(String status, String code, String reason, JsonObject world) {
        String context = "status=" + status + " code=" + code + " sent=" + sent + " queries=" + queries + " replies="
                + replies + " permission_unknown=true " + permissionContext + " reason=" + reason;
        if ("saved".equals(status)) EditorWriteLog.event("client.self.result", operation, context);
        else EditorWriteLog.warning("client.self.result", operation, context);
        var out = new JsonObject();
        out.addProperty("requestId", operation);
        out.addProperty("status", status);
        out.addProperty("code", code);
        out.addProperty("reason", reason);
        if (world != null) out.add("world", world);
        var done = completion;
        operation = null;
        cancel();
        if (done != null) done.accept(out);
        if (status.equals("saved")) sent = false;
    }
}
