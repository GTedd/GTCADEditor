package dev.rinorsi.editor.world;

import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import dev.rinorsi.editor.*;
import dev.rinorsi.editor.EditorI18n;
import java.util.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.*;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.*;
import net.minecraft.world.entity.*;
import net.minecraft.world.entity.player.Player;

/** Relationship operations are exclusive apply requests, never raw Passengers NBT writes. */
public final class EntityRiding {
    private EntityRiding() {}

    public static void apply(
            ServerPlayer player, Entity vehicle, JsonObject edit, java.util.function.Consumer<Entity> preflight) {
        guard(player, vehicle);
        String action = StackCodec.string(edit, "action");
        Set<String> keys = switch (action) {
            case "add" -> Set.of("action", "type", "entity_data");
            case "remove" -> Set.of("action", "uuid");
            default -> Set.of("action");
        };
        if (!keys.containsAll(edit.keySet()))
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.entityriding.riding_operation_contains_unknown_field"));
        switch (action) {
            case "add" -> add(player, vehicle, edit, preflight);
            case "remove" -> {
                var id = UUID.fromString(StackCodec.string(edit, "uuid"));
                var passenger = descendants(vehicle)
                        .filter(p -> p.getUUID().equals(id))
                        .findFirst()
                        .orElseThrow(() -> new IllegalArgumentException(
                                EditorI18n.tr("cadeditor.message.entityriding.passenger_left_passenger_tree")));
                guardTree(player, passenger);
                passenger.stopRiding();
            }
            case "eject" -> {
                for (var p : vehicle.getPassengers()) guardTree(player, p);
                vehicle.ejectPassengers();
            }
            case "dismount" -> {
                if (vehicle.getVehicle() == null)
                    throw new IllegalArgumentException(
                            EditorI18n.tr("cadeditor.message.entityriding.target_currently_board"));
                guardTree(player, vehicle);
                guard(player, vehicle.getVehicle());
                vehicle.stopRiding();
            }
            default ->
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.entityriding.unknown_riding_operation", (action)));
        }
    }

    public static void guard(ServerPlayer player, Entity entity) {
        WorldAccess.nonPlayer(entity instanceof Player);
        var slot = new JsonObject();
        slot.addProperty("kind", "entity");
        slot.addProperty("dim", entity.level().dimension().identifier().toString());
        slot.addProperty("uuid", entity.getStringUUID());
        WorldTarget.resolve(player, slot);
    }

    private static void guardTree(ServerPlayer player, Entity e) {
        guard(player, e);
        e.getPassengers().forEach(p -> guardTree(player, p));
    }

    private static void add(
            ServerPlayer player, Entity vehicle, JsonObject edit, java.util.function.Consumer<Entity> preflight) {
        guardTree(player, vehicle);
        if (descendants(vehicle).count() >= 256)
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.entityriding.passenger_tree_reaches_editorial_limit"));
        var id = Identifier.parse(StackCodec.string(edit, "type"));
        if (!BuiltInRegistries.ENTITY_TYPE.containsKey(id))
            throw new IllegalArgumentException(EditorI18n.tr("cadeditor.message.entityriding.entity_type_exist", (id)));
        var type = BuiltInRegistries.ENTITY_TYPE.getValue(id);
        if (type == net.minecraft.world.entity.EntityTypes.PLAYER || !type.canSerialize())
            EditorSessions.fail(
                    "unsupported_target",
                    EditorI18n.tr("cadeditor.message.entityriding.unable_add_player_save_entity"));
        if (type.onlyOpCanSetNbt() && !EditorPolicy.gameMaster(player))
            EditorSessions.fail(
                    "not_allowed",
                    EditorI18n.tr("cadeditor.message.entityriding.passenger_type_requires_game_manager"));
        var level = (ServerLevel) vehicle.level();
        var passenger = type.create(level, EntitySpawnReason.COMMAND);
        if (passenger == null)
            EditorSessions.fail(
                    "unsupported_target",
                    EditorI18n.tr("cadeditor.message.entityriding.entity_plant_cannot_create_passenger"));
        var before = WorldTarget.saveEntity(passenger, level.registryAccess());
        var requested = before.copy();
        if (edit.has("entity_data")) {
            var data = edit.get("entity_data");
            var fields = data.isJsonPrimitive()
                    ? WorldNbt.parse(data.getAsString())
                    : (CompoundTag) JsonOps.INSTANCE.convertTo(NbtOps.INSTANCE, data);
            requested.merge(fields);
            WorldNbt.protect(before, requested, true);
            dev.rinorsi.editor.ItemRules.check(player, before, requested);
            for (String key : EntityVolatile.CURRENT)
                if (!Objects.equals(before.get(key), requested.get(key)))
                    EditorSessions.fail(
                            "protected_field",
                            EditorI18n.tr(
                                    "cadeditor.message.entityriding.field_identity_movement_running_time", (key)));
            dev.rinorsi.editor.registry.EntitySchemaValidation.validate(requested, level, 0);
            var prepared = WorldTarget.copyEntity(passenger, requested, level, level.registryAccess());
            WorldNbt.requireEditedFieldsRetained(before, requested, prepared);
            EntityWorldEdit.load(passenger, prepared, level.registryAccess());
        }
        passenger.setPos(vehicle.position());
        preflight.accept(passenger); // size/serialization checks must precede any real relationship
        try {
            tryRide(passenger, vehicle);
            if (!level.addFreshEntity(passenger))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.entityriding.server_refuses_add_new_passenger"));
        } catch (RuntimeException error) {
            passenger.stopRiding();
            passenger.discard();
            throw error;
        }
    }
    /** Public for real-factory tests; false means a vanilla rule, never use force=true. */
    public static void tryRide(Entity passenger, Entity vehicle) {
        WorldAccess.nonPlayer(passenger instanceof Player);
        WorldAccess.nonPlayer(vehicle instanceof Player);
        if (passenger == vehicle
                || vehicle.isRemoved()
                || passenger.isRemoved()
                || passenger.level() != vehicle.level())
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.entityriding.riding_target_invalid_removed_same"));
        if (!passenger.startRiding(vehicle, false, true))
            EditorSessions.fail(
                    "ride_rejected", EditorI18n.tr("cadeditor.message.entityriding.vanilla_minecraft_refuse_riding"));
    }

    private static java.util.stream.Stream<Entity> descendants(Entity root) {
        return root.getPassengers().stream()
                .flatMap(p -> java.util.stream.Stream.concat(java.util.stream.Stream.of(p), descendants(p)));
    }

    public static JsonObject previewAddition(
            JsonObject snapshot, Entity passenger, net.minecraft.core.RegistryAccess access) {
        var out = snapshot.deepCopy();
        var nbt = WorldNbt.parse(snapshot.get("snbt").getAsString());
        var list = nbt.getList("Passengers").map(ListTag::copy).orElseGet(ListTag::new);
        list.add(WorldTarget.saveEntity(passenger, access));
        nbt.put("Passengers", list);
        if (nbt.toString().length() > WorldNbt.MAX_SNBT)
            EditorSessions.fail(
                    "payload_too_large",
                    EditorI18n.tr("cadeditor.message.entityriding.add_passenger_after_nbt_exceeds"));
        out.addProperty("snbt", nbt.toString());
        out.add("nbt", NbtOps.INSTANCE.convertTo(JsonOps.INSTANCE, nbt));
        out.addProperty("canUndo", false);
        var row = new JsonObject();
        row.addProperty(
                "type",
                BuiltInRegistries.ENTITY_TYPE.getKey(passenger.getType()).toString());
        row.addProperty("uuid", passenger.getStringUUID());
        row.addProperty("summary", passenger.getName().getString());
        row.add("passengers", new JsonArray());
        out.getAsJsonObject("views")
                .getAsJsonObject("riding")
                .getAsJsonArray("passengers")
                .add(row);
        return out;
    }
}
