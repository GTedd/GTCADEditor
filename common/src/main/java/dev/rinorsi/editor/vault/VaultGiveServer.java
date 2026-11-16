package dev.rinorsi.editor.vault;

import com.google.gson.JsonObject;
import dev.rinorsi.editor.*;
import dev.rinorsi.editor.EditorI18n;
import net.minecraft.network.protocol.game.ClientboundSetPlayerInventoryPacket;
import net.minecraft.server.level.ServerPlayer;

/** Only the detached stack is sent; local vault ids/files are never server capabilities. */
public final class VaultGiveServer {
    private static final java.util.Map<java.util.UUID, GiveRequests> REQUESTS = new java.util.HashMap<>();

    private VaultGiveServer() {}

    public static void remove(java.util.UUID player) {
        REQUESTS.remove(player);
    }

    public static void clear() {
        REQUESTS.clear();
    }

    public static JsonObject give(ServerPlayer player, JsonObject request) {
        InventoryWrites.rateLimit(player.getUUID());
        // Never trust client abilities or a previous acknowledgement as permission.
        if (!EditorPolicy.current().allowed(player, dev.rinorsi.editor.EditorPermission.VAULT_GIVE)) {
            dev.rinorsi.editor.history.HistoryContext.node(dev.rinorsi.editor.EditorPermission.VAULT_GIVE.node);
            EditorSessions.fail(
                    "permission_denied",
                    EditorI18n.tr("cadeditor.message.vaultgiveserver.permission_op_single_person_fraud"));
        }
        if (player.isCreative())
            EditorSessions.fail(
                    "creative_path_required",
                    EditorI18n.tr("cadeditor.message.vaultgiveserver.creative_mode_write_path_using"));
        if (player.connection == null || !player.isAlive())
            EditorSessions.fail(
                    "not_connected", EditorI18n.tr("cadeditor.message.vaultgiveserver.player_offline_current_state"));
        EditorWire.requirePayload(request.toString());
        VaultStore.checkDepth(request);
        JsonObject reply = REQUESTS.computeIfAbsent(player.getUUID(), ignored -> new GiveRequests())
                .execute(request, () -> write(player, request));
        // Record the mutation before network sends, so a send failure can never make a retry insert twice.
        player.inventoryMenu.sendAllDataToRemote();
        if (player.containerMenu != player.inventoryMenu) player.containerMenu.sendAllDataToRemote();
        int index = reply.get("inventoryIndex").getAsInt();
        player.connection.send(new ClientboundSetPlayerInventoryPacket(
                index, player.getInventory().getItem(index).copy()));
        return reply;
    }

    private static JsonObject write(ServerPlayer player, JsonObject request) {
        net.minecraft.world.item.ItemStack stack;
        try {
            stack = StackCodec.decode(StackCodec.object(request, "stack"), player.registryAccess());
        } catch (RuntimeException invalid) {
            throw new EditorSessions.Failure(
                    "invalid_stack",
                    EditorI18n.tr(
                            "cadeditor.message.vaultgiveserver.vault_item_component_invalid", (invalid.getMessage())));
        }
        dev.rinorsi.editor.registry.EntitySchemaValidation.validateStack(stack, player.level());
        dev.rinorsi.editor.ItemRules.check(player, net.minecraft.world.item.ItemStack.EMPTY, stack);
        int index = InventoryWrites.insert(player.getInventory(), stack, request);
        var reply = new JsonObject();
        reply.addProperty("op", "vault_give");
        reply.addProperty("requestId", StackCodec.string(request, "requestId"));
        reply.addProperty("status", "given");
        reply.addProperty("code", "ok");
        reply.addProperty("ok", true);
        reply.addProperty("confirmed", true);
        reply.addProperty("inventoryIndex", index);
        reply.addProperty("path", "server");
        var item = new JsonObject();
        item.addProperty(
                "id",
                net.minecraft.core.registries.BuiltInRegistries.ITEM
                        .getKey(stack.getItem())
                        .toString());
        item.addProperty("count", stack.getCount());
        reply.add("item", item);
        reply.addProperty(
                "reason",
                index < 9
                        ? EditorI18n.tr("cadeditor.message.vaultgiveserver.placed_hotbar_article_glut", ((index + 1)))
                        : EditorI18n.tr(
                                "cadeditor.message.vaultgiveserver.grid_slot_placed_inventory",
                                ((index - 8)),
                                (index)));
        return reply;
    }
}
