package dev.rinorsi.editor;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.rinorsi.editor.platform.Platform;
import java.util.UUID;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Server-owned concurrency protection; cache loss is recoverable using the caller's baseline. */
public final class EditorMod {
    private static final EditorSessions SESSIONS = new EditorSessions();
    private static final java.util.Map<UUID, EditorWire.Receiver> TRANSFERS = new java.util.HashMap<>();
    private static final Logger LOG = LoggerFactory.getLogger("cadeditor");
    /** Request keys that claim an identity or a privilege; a request with one is rejected and tagged "forged". */
    static final java.util.Set<String> FORGED_KEYS = java.util.Set.of(
            "actor",
            "actorId",
            "actorName",
            "actorUuid",
            "player_uuid",
            "gamemaster",
            "gameMaster",
            "admin",
            "isAdmin",
            "isOp",
            "operator",
            "opLevel",
            "permissionLevel",
            "permissions",
            "permission",
            "trusted",
            "bypass",
            "sudo");

    public void onInitialize() {
        Platform.get().onServerStarting(server -> TRANSFERS.clear());
        Platform.get().onServerStopped(server -> TRANSFERS.clear());
        Platform.get().onServerStarting(server -> dev.rinorsi.editor.vault.VaultGiveServer.clear());
        Platform.get().onServerStopped(server -> dev.rinorsi.editor.vault.VaultGiveServer.clear());
        Platform.get().onDataReload(() -> dev.rinorsi.editor.registry.EntitySchemaValidation.invalidate());
        dev.rinorsi.editor.world.WorldEditor.initialize();
        TestKitCommand.register(EditorPolicy::current);
        dev.rinorsi.editor.history.HistoryCommand.register();
        Platform.get().onServerStarting(server -> {
            var policy = EditorPolicy.load();
            dev.rinorsi.editor.history.EditorHistory.start(server, policy.history());
            SESSIONS.clear();
            dev.rinorsi.editor.vault.InventoryWrites.clear();
            EditorHandshake.clear();
            // The only line the editor prints on a normal start; requests go to the history, not the console.
            int records = dev.rinorsi.editor.history.EditorHistory.size();
            LOG.info(
                    "CAD Editor server ready (protocol {}): history {}, console trace {}",
                    EditorHandshake.PROTOCOL,
                    records < 0 ? "off" : records + " record(s)",
                    policy.debugLog() ? "on (debugLog)" : "off");
        });
        Platform.get().onServerStopped(server -> {
            SESSIONS.clear();
            dev.rinorsi.editor.vault.InventoryWrites.clear();
            EditorHandshake.clear();
            dev.rinorsi.editor.history.HistoryChannel.clear();
            dev.rinorsi.editor.history.EditorHistory.stop();
        });
        Platform.get().onDisconnect(player -> {
            TRANSFERS.remove(player.getUUID());
            SESSIONS.remove(player.getUUID());
            EditorHandshake.forget(player.getUUID());
            dev.rinorsi.editor.vault.InventoryWrites.remove(player.getUUID());
            dev.rinorsi.editor.vault.VaultGiveServer.remove(player.getUUID());
            dev.rinorsi.editor.history.HistoryChannel.forget(player.getUUID());
        });
        Platform.get().receive((player, packet) -> {
            try (var language =
                    EditorI18n.forLanguage(player.clientInformation().language())) {
                handle(player, packet.json());
            }
        });
    }

    /** One history record per complete request, whatever route handles it (EditorHistory.Scope). */
    private static void handle(ServerPlayer player, String json) {
        try (var audit = dev.rinorsi.editor.history.EditorHistory.begin(player, json.length());
                var actor = ItemRules.enter(player)) {
            handle(player, json, audit);
        }
    }

    private static void handle(ServerPlayer player, String json, dev.rinorsi.editor.history.EditorHistory.Scope audit) {
        String requestId = "";
        boolean vaultGive = false;
        try {
            if (json.length() > EditorPackets.MAX_JSON)
                EditorSessions.fail(
                        "payload_too_large",
                        EditorI18n.tr("cadeditor.message.editormod.item_request_exceeds_32767_characters"));
            json = TRANSFERS
                    .computeIfAbsent(player.getUUID(), ignored -> new EditorWire.Receiver())
                    .accept(json);
            if (json == null) return;
            audit.payload(json.length());
            JsonObject request = JsonParser.parseString(json).getAsJsonObject();
            request = dev.rinorsi.editor.world.WorldWire.decode(request);
            audit.request(request);
            var forged = request.keySet().stream()
                    .filter(FORGED_KEYS::contains)
                    .sorted()
                    .toList();
            if (!forged.isEmpty()) {
                audit.forged();
                requestId = request.has("requestId") && request.get("requestId").isJsonPrimitive()
                        ? request.get("requestId").getAsString()
                        : "";
                if (requestId.length() > 80) requestId = requestId.substring(0, 80);
                if (EditorWriteLog.verbose())
                    LOG.warn(
                            "[CAD-Editor] forged privilege keys {} from {} ({}): rejected",
                            forged,
                            player.getScoreboardName(),
                            player.getUUID());
                EditorSessions.fail(
                        "forged_privilege",
                        EditorI18n.tr("cadeditor.message.permission.forged", String.join(", ", forged)));
            }
            if (EditorHandshake.route(player, request, reply -> send(player, reply))) return;
            if (dev.rinorsi.editor.history.HistoryChannel.route(player, request, reply -> send(player, reply))) return;
            vaultGive = request.has("op") && request.get("op").getAsString().equals("vault_give");
            if (vaultGive) {
                requestId = StackCodec.string(request, "requestId");
                if (requestId.isEmpty() || requestId.length() > 80)
                    EditorSessions.fail(
                            "invalid_request", EditorI18n.tr("cadeditor.message.editormod.invalid_request_id"));
                send(player, dev.rinorsi.editor.vault.VaultGiveServer.give(player, request));
                return;
            }
            if (dev.rinorsi.editor.world.WorldEditor.route(player, request, EditorPolicy::current)) return;
            requestId = StackCodec.string(request, "requestId");
            if (requestId.length() > 80)
                StackCodec.fail(EditorI18n.tr("cadeditor.message.editormod.request_id_too_long"));
            dev.rinorsi.editor.vault.InventoryWrites.rateLimit(player.getUUID());
            dev.rinorsi.editor.vault.VaultStore.checkDepth(request);
            String operation = StackCodec.string(request, "op");
            EditorWriteLog.event(
                    "server.request.received",
                    requestId,
                    "op=" + operation
                            + " creative=" + player.isCreative() + " gamemaster=" + EditorPolicy.gameMaster(player)
                            + " payload_chars=" + json.length());
            JsonObject slot;
            try {
                slot = StackCodec.object(request, "slot");
                EditorSessions.sameSlot(slot, slot);
            } catch (RuntimeException e) {
                EditorSessions.fail(
                        "slot_invalid", EditorI18n.tr("cadeditor.message.editormod.invalid_slot_data_draft_kept"));
                return;
            }
            if (operation.equals("close")) {
                SESSIONS.close(player.getUUID(), slot);
                return;
            }
            var policy = EditorPolicy.current();
            policy.require(player, EditorPermission.USE, "permission_denied");
            Target target = target(player, slot, operation.equals("open"));
            if (operation.equals("open")) {
                JsonObject canonical = new JsonObject();
                canonical.addProperty("kind", target.inventoryIndex >= 0 ? "inventory" : "menu");
                canonical.addProperty(
                        "index", target.inventoryIndex >= 0 ? target.inventoryIndex : target.menuSlot.index);
                if (target.menu != null) canonical.addProperty("menuId", target.menu.containerId);
                canonical.addProperty("token", UUID.randomUUID().toString());
                var session = SESSIONS.open(player.getUUID(), canonical, target.current(player));
                var reply = result("opened", requestId);
                reply.add("item", target.snapshot(session.original, player, session.slot));
                send(player, reply);
                return;
            }
            if (!operation.equals("apply") && !operation.equals("confirm"))
                StackCodec.fail(EditorI18n.tr("cadeditor.message.editormod.unknown_operation", (operation)));
            // ITEM_EDIT writes directly in any game mode; without it, only the creative capability (ITEM_CREATIVE).
            boolean direct = policy.allowed(player, EditorPermission.ITEM_EDIT);
            if (!direct) policy.require(player);
            EditorWriteLog.event(
                    "server.permission.allowed",
                    requestId,
                    "op=" + operation + " inventory_index=" + target.inventoryIndex + " direct=" + direct);
            var current = target.current(player);
            if (operation.equals("confirm")) {
                if (!player.isCreative() || target.inventoryIndex < 0)
                    EditorSessions.fail(
                            "not_allowed",
                            EditorI18n.tr("cadeditor.message.editormod.only_creative_inventory_writes_confirmed"));
                boolean missing = SESSIONS.get(player.getUUID()) == null;
                var session = SESSIONS.confirm(
                        player.getUUID(),
                        slot,
                        requestId,
                        optionalBaseline(request, "commitBaseline"),
                        current,
                        player.registryAccess());
                if (missing) EditorWriteLog.event("server.confirm.recovered", requestId, "baseline=committed");
                saved(player, target, session, requestId);
                return;
            }
            boolean missing = SESSIONS.get(player.getUUID()) == null;
            var session = SESSIONS.apply(
                    player.getUUID(), slot, optionalBaseline(request, "baseline"), current, player.registryAccess());
            if (missing) EditorWriteLog.event("server.apply.sessionless", requestId, "baseline=client");
            ItemStack next = StackCodec.decode(request, player.registryAccess(), session.original);
            dev.rinorsi.editor.registry.EntitySchemaValidation.validateStack(next, player.level());
            // Banned items, restricted components and command clicks: only what this write adds or alters counts.
            ItemRules.check(player, current, next);
            if (target.menuSlot != null && !target.menuSlot.mayPlace(next))
                EditorSessions.fail(
                        "slot_invalid", EditorI18n.tr("cadeditor.message.editormod.slot_accept_item_draft_kept"));
            if (target.menuSlot != null && next.getCount() > target.menuSlot.getMaxStackSize(next))
                EditorSessions.fail(
                        "slot_invalid", EditorI18n.tr("cadeditor.message.editormod.count_exceeds_slot_s_capacity"));
            dev.rinorsi.editor.history.HistoryContext.detail("before", summary(current));
            dev.rinorsi.editor.history.HistoryContext.detail("after", summary(next));
            dev.rinorsi.editor.history.HistoryContext.detail("changed", changed(current, next));
            if (!direct && target.inventoryIndex >= 0) {
                session.prepared = next;
                session.preparedRequest = requestId;
                var reply = result("commit", requestId);
                reply.add("item", target.snapshot(next, player, session.slot));
                reply.addProperty("creativeSlot", target.creativeSlot(player));
                send(player, reply);
            } else {
                if (target.inventoryIndex >= 0) player.getInventory().setItem(target.inventoryIndex, next);
                else {
                    target.menuSlot.set(next);
                    target.menuSlot.setChanged();
                }
                player.getInventory().setChanged();
                player.inventoryMenu.broadcastChanges();
                player.containerMenu.broadcastChanges();
                if (target.inventoryIndex >= 0)
                    player.connection.send(new net.minecraft.network.protocol.game.ClientboundSetPlayerInventoryPacket(
                            target.inventoryIndex, next.copy()));
                session.original = next.copy();
                session.prepared = null;
                saved(player, target, session, requestId);
            }
        } catch (RuntimeException e) {
            if (!(e instanceof IllegalArgumentException))
                EditorDiagnostics.failure("item.request", "request=" + requestId, e);
            var reply = result("rejected", requestId);
            String code = e instanceof EditorSessions.Failure failure ? failure.code : "invalid_request";
            if (code.equals("item_changed")) code = "slot_changed";
            if (vaultGive) reply.addProperty("op", "vault_give");
            reply.addProperty("code", code);
            String reason = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            reply.addProperty("reason", reason.length() > 1500 ? reason.substring(0, 1500) : reason);
            EditorWriteLog.warning(
                    "server.request.rejected",
                    requestId,
                    "player=" + player.getUUID() + " code=" + code + " reason=" + reason);
            send(player, reply);
        }
    }

    private static String summary(ItemStack stack) {
        return stack.isEmpty()
                ? "empty"
                : net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(stack.getItem()) + " x"
                        + stack.getCount();
    }

    /** The data components (and item/count) that differ, for the history record. */
    private static String changed(ItemStack before, ItemStack after) {
        var keys = new java.util.TreeSet<String>();
        if (!before.is(after.getItem())) keys.add("item");
        if (before.getCount() != after.getCount()) keys.add("count");
        var types = new java.util.HashSet<net.minecraft.core.component.DataComponentType<?>>(
                before.getComponents().keySet());
        types.addAll(after.getComponents().keySet());
        for (var type : types)
            if (!java.util.Objects.equals(before.get(type), after.get(type)))
                keys.add(String.valueOf(
                        net.minecraft.core.registries.BuiltInRegistries.DATA_COMPONENT_TYPE.getKey(type)));
        return String.join(",", keys);
    }

    private static String optionalBaseline(JsonObject request, String key) {
        if (!request.has(key)) return null;
        var value = request.get(key);
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString())
            EditorSessions.fail(
                    "session_lost", EditorI18n.tr("cadeditor.message.editormod.original_item_baseline_invalid_draft"));
        return value.getAsString();
    }

    private static Target target(ServerPlayer player, JsonObject slot, boolean opening) {
        if (!player.isAlive() || (player.isSpectator() && !EditorPolicy.gameMaster(player)))
            EditorSessions.fail(
                    "permission_denied", EditorI18n.tr("cadeditor.message.editormod.current_player_state_allow_item"));
        try {
            String kind = StackCodec.string(slot, "kind");
            Target target;
            if (kind.equals("inventory")) {
                int index = StackCodec.integer(
                        slot, "index", 0, player.getInventory().getContainerSize() - 1);
                target = new Target(index, null, null);
            } else if (kind.equals("menu")) {
                var menu = player.containerMenu;
                if (menu == player.inventoryMenu
                        || !menu.stillValid(player)
                        || StackCodec.integer(slot, "menuId", 0, Integer.MAX_VALUE) != menu.containerId)
                    throw new IllegalArgumentException(
                            EditorI18n.tr("cadeditor.message.editormod.container_closed_out_range_inaccessible"));
                var menuSlot = menu.getSlot(StackCodec.integer(slot, "index", 0, menu.slots.size() - 1));
                if (!menuSlot.mayPickup(player) || !menuSlot.isActive())
                    throw new IllegalArgumentException(EditorI18n.tr("cadeditor.message.editormod.slot_cannot_edited"));
                target = new Target(-1, menu, menuSlot);
            } else throw new IllegalArgumentException(EditorI18n.tr("cadeditor.message.editormod.unknown_slot_type"));
            if (opening && target.current(player).isEmpty())
                throw new IllegalArgumentException(EditorI18n.tr("cadeditor.message.editormod.selected_slot_empty"));
            return target;
        } catch (RuntimeException e) {
            EditorSessions.fail(
                    "slot_invalid",
                    EditorI18n.tr("cadeditor.message.editormod.current_item_overwritten_draft_kept", (e.getMessage())));
            return null;
        }
    }

    private static void saved(ServerPlayer player, Target target, EditorSessions.State session, String requestId) {
        var reply = result("saved", requestId);
        reply.add("item", target.snapshot(session.original, player, session.slot));
        send(player, reply);
    }

    private static JsonObject result(String status, String requestId) {
        var result = new JsonObject();
        result.addProperty("status", status);
        result.addProperty("requestId", requestId);
        result.addProperty("code", status.equals("rejected") ? "invalid_request" : "ok");
        result.addProperty(
                "reason",
                switch (status) {
                    case "opened" -> EditorI18n.tr("cadeditor.message.editormod.item_loaded");
                    case "saved" -> EditorI18n.tr("cadeditor.message.editormod.changes_saved");
                    case "commit" -> EditorI18n.tr("cadeditor.message.editormod.waiting_creative_write_confirmation");
                    default -> EditorI18n.tr("cadeditor.message.editormod.request_incomplete");
                });
        return result;
    }

    private static void send(ServerPlayer player, JsonObject json) {
        dev.rinorsi.editor.history.EditorHistory.observe(json);
        String text = json.toString();
        String status = json.get("status").getAsString();
        if (text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > EditorWire.MAX_JSON_BYTES) {
            EditorWriteLog.warning(
                    "server.reply.oversize",
                    json.get("requestId").getAsString(),
                    "status=" + status + " payload_chars=" + text.length() + " outcome_requires_reread=true");
            var error = result("rejected", json.get("requestId").getAsString());
            error.addProperty("code", "payload_too_large");
            error.addProperty(
                    "reason", EditorI18n.tr("cadeditor.message.editormod.item_snapshot_exceeds_message_limit"));
            text = error.toString();
            status = "rejected";
        }
        Platform.get().send(player, new EditorPackets.Reply(text));
        EditorWriteLog.event(
                "server.reply.sent",
                json.get("requestId").getAsString(),
                "status=" + status + " payload_chars=" + text.length());
    }

    private record Target(int inventoryIndex, AbstractContainerMenu menu, Slot menuSlot) {
        ItemStack current(ServerPlayer player) {
            return inventoryIndex >= 0 ? player.getInventory().getItem(inventoryIndex) : menuSlot.getItem();
        }

        int creativeSlot(ServerPlayer player) {
            return player.inventoryMenu.slots.stream()
                    .filter(s -> s.container == player.getInventory() && s.getContainerSlot() == inventoryIndex)
                    .mapToInt(s -> s.index)
                    .filter(i -> i >= 1 && i <= 45)
                    .findFirst()
                    .orElseThrow(() -> new EditorSessions.Failure(
                            "slot_invalid",
                            EditorI18n.tr("cadeditor.message.editormod.slot_support_vanilla_minecraft_creation")));
        }

        JsonObject snapshot(ItemStack stack, ServerPlayer player, JsonObject slot) {
            String label = inventoryIndex >= 0
                    ? (inventoryIndex < 9
                            ? EditorI18n.tr("cadeditor.message.editormod.hotbar", ((inventoryIndex + 1)))
                            : EditorI18n.tr("cadeditor.message.editormod.inventory_slot", (inventoryIndex)))
                    : EditorI18n.tr("cadeditor.message.editormod.container_slot", (menuSlot.index));
            if (inventoryIndex == player.getInventory().getSelectedSlot())
                label += EditorI18n.tr("cadeditor.ui.worldplayer.main_hand");
            var snapshot = StackCodec.snapshot(stack, player.registryAccess(), slot, label);
            snapshot.addProperty("baseline", EditorSessions.fingerprint(stack, player.registryAccess()));
            return snapshot;
        }
    }
}
