package dev.rinorsi.editor.client;

import com.google.gson.JsonObject;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorWriteLog;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;

/**
 * The read-only world page for a server without CAD Editor: what this client already has (block state, entity type,
 * name, position, health). It is a client snapshot, never a reconstructed server NBT document or a writable session.
 */
final class ClientWorldView {
    private ClientWorldView() {}

    static JsonObject snapshot(Minecraft mc, JsonObject target) {
        var world = new JsonObject();
        world.add("slot", target.deepCopy());
        world.addProperty("revision", "client-view-" + UUID.randomUUID());
        world.addProperty("readOnly", true);
        world.addProperty("partial", true);
        world.addProperty("canUndo", false);
        world.addProperty("snbt", "{}");
        world.add("nbt", new JsonObject());
        String kind = target.get("kind").getAsString();
        world.addProperty("kind", kind);
        var values = new JsonObject();
        world.add("client_values", values);
        values.addProperty("cadeditor.ui.world.dimension", target.get("dim").getAsString());
        if (kind.equals("block")) {
            var pos = new BlockPos(
                    target.get("x").getAsInt(),
                    target.get("y").getAsInt(),
                    target.get("z").getAsInt());
            if (!mc.level.hasChunkAt(pos) || !mc.player.isWithinBlockInteractionRange(pos, 0))
                throw new IllegalArgumentException(EditorI18n.tr("cadeditor.ui.worldedit.too_far_away_move_closer"));
            var state = mc.level.getBlockState(pos);
            String id = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
            world.addProperty("type", id);
            world.addProperty("block", id);
            world.addProperty("has_block_entity", state.hasBlockEntity());
            values.addProperty("cadeditor.ui.world.type_id", id);
            values.addProperty("cadeditor.ui.world.position", pos.getX() + " / " + pos.getY() + " / " + pos.getZ());
            var properties = new JsonObject();
            for (var property : state.getProperties())
                properties.addProperty(property.getName(), value(state, property));
            world.add("client_properties", properties);
        } else {
            var entity = mc.level.getEntity(target.get("id").getAsInt());
            if (entity == null
                    || !entity.getStringUUID().equals(target.get("uuid").getAsString())
                    || !mc.player.isWithinEntityInteractionRange(entity, 0))
                throw new IllegalArgumentException(EditorI18n.tr("cadeditor.ui.worldedit.too_far_away_move_closer"));
            String id = BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
            String name = entity.getDisplayName().getString();
            world.addProperty("type", id);
            world.addProperty("client_name", name);
            values.addProperty("cadeditor.ui.world.type_id", id);
            values.addProperty("cadeditor.ui.world.name", name);
            values.addProperty("cadeditor.ui.world.uuid", entity.getStringUUID());
            values.addProperty(
                    "cadeditor.ui.world.position", entity.getX() + " / " + entity.getY() + " / " + entity.getZ());
            if (entity instanceof LivingEntity living)
                values.addProperty("cadeditor.ui.world.health", living.getHealth());
        }
        EditorWriteLog.event(
                "client.world.readonly_open",
                null,
                "kind=" + kind + " type=" + world.get("type") + " source=client_synced snapshot=true writes=false");
        return world;
    }

    private static <T extends Comparable<T>> String value(BlockState state, Property<T> property) {
        return property.getName(state.getValue(property));
    }
}
