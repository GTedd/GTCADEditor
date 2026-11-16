package dev.rinorsi.editor.world;

import com.google.gson.*;
import com.mojang.serialization.*;
import dev.rinorsi.editor.*;
import dev.rinorsi.editor.EditorI18n;
import java.util.*;
import net.minecraft.core.*;
import net.minecraft.core.registries.*;
import net.minecraft.nbt.*;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.*;
import net.minecraft.util.ProblemReporter;
import net.minecraft.world.entity.*;
import net.minecraft.world.entity.decoration.*;
import net.minecraft.world.entity.decoration.painting.Painting;
import net.minecraft.world.entity.npc.villager.AbstractVillager;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.trading.*;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.storage.TagValueInput;

/** Normalized entity edits are applied to a detached real entity before the world write. */
public final class EntityWorldEdit {
    private EntityWorldEdit() {}

    static final List<String> POSES = List.of("Head", "Body", "LeftArm", "RightArm", "LeftLeg", "RightLeg");
    static final Set<String> STAND_FLAGS = Set.of("ShowArms", "Small", "Marker", "Invisible", "NoBasePlate");
    /** Armor stand slot lock bit mask (vanilla int, any value; bits are EquipmentSlot filter bits). */
    static final String DISABLED_SLOTS = "DisabledSlots";

    static final Set<String> FRAME_FIELDS = Set.of("ItemRotation", "Invisible", "Fixed", "ItemDropChance");
    /** Shown read-only: Facing moves the hanging position/bounding box and stays protected by WorldNbt.protect. */
    static final String FRAME_FACING = "Facing";

    static final Set<String> DISPLAY_FIELDS = Set.of(
            "transformation",
            "billboard",
            "brightness",
            "view_range",
            "shadow_radius",
            "shadow_strength",
            "glow_color_override",
            "interpolation_duration",
            "start_interpolation",
            "teleport_duration",
            "width",
            "height");
    static final Set<String> TEXT_FIELDS = Set.of(
            "text",
            "line_width",
            "background",
            "alignment",
            "text_opacity",
            "shadow",
            "see_through",
            "default_background");

    public static JsonObject stack(ItemStack stack, RegistryAccess access) {
        if (stack.isEmpty()) {
            var out = new JsonObject();
            out.addProperty("empty", true);
            return out;
        }
        return StackCodec.snapshot(stack, access, new JsonObject(), "");
    }

    private static ItemStack decode(JsonElement json, RegistryAccess access, ItemStack original) {
        var value = json.getAsJsonObject();
        return value.has("empty") && value.get("empty").getAsBoolean()
                ? ItemStack.EMPTY
                : StackCodec.decode(value, access, original);
    }

    public static JsonObject views(Entity entity, CompoundTag saved, RegistryAccess access) {
        var out = specializedViews(entity, saved, access);
        if (!GenericSchema.specialized(out))
            out.add(
                    "generic",
                    GenericSchema.view(
                            "entity",
                            BuiltInRegistries.ENTITY_TYPE
                                    .getKey(entity.getType())
                                    .toString(),
                            saved,
                            access));
        return out;
    }

    static JsonObject specializedViews(Entity entity, CompoundTag saved, RegistryAccess access) {
        var out = new JsonObject();
        if (entity instanceof ArmorStand stand) {
            var pose = new JsonObject();
            var rotations = List.of(
                    stand.getHeadPose(),
                    stand.getBodyPose(),
                    stand.getLeftArmPose(),
                    stand.getRightArmPose(),
                    stand.getLeftLegPose(),
                    stand.getRightLegPose());
            for (int i = 0; i < POSES.size(); i++) {
                var r = rotations.get(i);
                var a = new JsonArray();
                a.add(r.x());
                a.add(r.y());
                a.add(r.z());
                pose.add(POSES.get(i), a);
            }
            for (String key : STAND_FLAGS)
                pose.addProperty(key, saved.getBoolean(key).orElse(false));
            pose.addProperty(DISABLED_SLOTS, saved.getInt(DISABLED_SLOTS).orElse(0));
            out.add("pose", pose);
        }
        if (entity instanceof ItemFrame frame) {
            var view = fields(saved, FRAME_FIELDS);
            view.add("item", stack(frame.getItem(), access));
            if (saved.contains(FRAME_FACING)) view.add(FRAME_FACING, json(saved.get(FRAME_FACING)));
            out.add("item_frame", view);
        }
        if (entity instanceof Painting) {
            var view = fields(saved, Set.of("variant"));
            view.addProperty("facingLocked", true);
            out.add("painting", view);
        }
        if (entity instanceof Display) {
            var view = fields(saved, DISPLAY_FIELDS);
            view.add("brightness", saved.contains("brightness") ? json(saved.get("brightness")) : JsonNull.INSTANCE);
            // This is a live synchronized trigger; vanilla deliberately omits it from save data.
            view.addProperty("start_interpolation", interpolationDelay(entity));
            if (entity instanceof Display.TextDisplay) {
                view.asMap().putAll(fields(saved, TEXT_FIELDS).asMap());
                if (saved.contains("text")) view.add("text", component(saved.get("text"), access));
            }
            if (entity instanceof Display.ItemDisplay) {
                view.add("item", stack(entity.getSlot(0).get(), access));
                if (saved.contains("item_display")) view.add("item_display", json(saved.get("item_display")));
            }
            if (entity instanceof Display.BlockDisplay && saved.contains("block_state"))
                view.add("block_state", BlockStateWire.ui(json(saved.get("block_state"))));
            out.add("display", view);
        }
        if (entity instanceof AbstractVillager) {
            var view = new JsonObject();
            boolean available = entity.level() instanceof ServerLevel;
            view.addProperty("available", available);
            if (available) {
                var offers = saved.contains("Offers")
                        ? MerchantOffers.CODEC
                                .parse(access.createSerializationContext(NbtOps.INSTANCE), saved.get("Offers"))
                                .getOrThrow()
                        : new MerchantOffers();
                view.add("offers", offers(offers, access));
            } else
                view.addProperty(
                        "reason",
                        EditorI18n.tr("cadeditor.message.entityworldedit.transactions_only_read_serverlevel"));
            out.add("trades", view);
        }
        EntityViewsVehicle.views(out, entity, saved, access);
        EntityViewsVillager.views(out, entity, saved);
        EntityViewsSimple.views(out, entity, saved, access);
        EntityViewsHorse.views(out, entity, saved, access);
        var riding = new JsonObject();
        riding.add("passengers", passengers(entity, 0));
        riding.add("vehicle", entity.getVehicle() == null ? JsonNull.INSTANCE : summary(entity.getVehicle()));
        riding.add("rideCheck", rideCheck());
        out.add("riding", riding);
        return out;
    }

    public static JsonObject rideCheck() {
        var result = new JsonObject();
        result.addProperty("mode", "try-and-report");
        result.addProperty("staticCanRideList", false);
        result.addProperty(
                "reason", EditorI18n.tr("cadeditor.message.entityworldedit.canride_canaddpassenger_dynamic_check"));
        return result;
    }

    private static JsonObject summary(Entity e) {
        var out = new JsonObject();
        out.addProperty(
                "type", BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString());
        out.addProperty("uuid", e.getStringUUID());
        out.addProperty("summary", e.getName().getString());
        return out;
    }

    private static JsonArray passengers(Entity e, int depth) {
        var out = new JsonArray();
        if (depth >= 32)
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.entityworldedit.passenger_tree_over_32_layer"));
        for (var p : e.getPassengers()) {
            var row = summary(p);
            row.add("passengers", passengers(p, depth + 1));
            out.add(row);
        }
        return out;
    }

    static JsonObject fields(CompoundTag nbt, Set<String> keys) {
        var out = new JsonObject();
        for (String key : keys)
            if (nbt.contains(key)) {
                if (Set.of("Invisible", "Fixed", "shadow", "see_through", "default_background")
                        .contains(key)) out.addProperty(key, nbt.getBoolean(key).orElse(false));
                else out.add(key, json(nbt.get(key)));
            }
        return out;
    }

    static JsonElement json(Tag tag) {
        return NbtOps.INSTANCE.convertTo(JsonOps.INSTANCE, tag);
    }

    static JsonElement component(Tag tag, RegistryAccess access) {
        var codec = net.minecraft.network.chat.ComponentSerialization.CODEC;
        return codec.encodeStart(
                        access.createSerializationContext(JsonOps.INSTANCE),
                        codec.parse(access.createSerializationContext(NbtOps.INSTANCE), tag)
                                .getOrThrow())
                .getOrThrow();
    }

    public static int interpolationDelay(Entity entity) {
        try {
            var m = Display.class.getDeclaredMethod("getTransformationInterpolationDelay");
            m.setAccessible(true);
            return (int) m.invoke(entity);
        } catch (ReflectiveOperationException ex) {
            throw new IllegalStateException(ex);
        }
    }

    /** The returned compound remains identity protected and contains current runtime state. */
    public static CompoundTag prepare(
            Entity source, CompoundTag input, JsonObject edit, Level level, RegistryAccess access) {
        if (edit.has("generic")) {
            require(
                    edit.size() == 1 && !GenericSchema.specialized(source, input, access),
                    EditorI18n.tr("cadeditor.message.blockviews.dedicated_view_already_exists_cannot"));
            var next = GenericSchema.apply(
                    "entity",
                    BuiltInRegistries.ENTITY_TYPE.getKey(source.getType()).toString(),
                    input,
                    edit.getAsJsonObject("generic"),
                    access);
            var detached = source.getType().create(level, EntitySpawnReason.LOAD);
            require(
                    detached != null,
                    EditorI18n.tr("cadeditor.message.entityworldedit.entity_factory_cannot_create_copy"));
            load(detached, next, access);
            GenericSchema.requireRetained(next, WorldTarget.saveEntity(detached, access));
            return next;
        }
        var nbt = input.copy();
        for (String key : edit.keySet())
            if (!Set.of("pose", "equipment", "item_frame", "painting", "display", "offers")
                            .contains(key)
                    && !EntityViewsSimple.supports(key)
                    && !EntityViewsVehicle.supports(key)
                    && !EntityViewsVillager.supports(key)
                    && !EntityViewsHorse.supports(key))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.entityworldedit.unknown_entity_editing_section", (key)));
        EntityViewsVehicle.apply(source, nbt, edit, access);
        EntityViewsVillager.apply(edit);
        EntityViewsSimple.apply(source, nbt, edit, level, access);
        EntityViewsHorse.apply(source, nbt, edit, level, access);
        if (edit.has("pose")) {
            require(
                    source instanceof ArmorStand,
                    EditorI18n.tr("cadeditor.message.entityworldedit.armor_stand_only_provides_gestures"));
            var data = edit.getAsJsonObject("pose");
            var pose = nbt.getCompound("Pose").map(CompoundTag::copy).orElseGet(CompoundTag::new);
            for (var field : data.entrySet()) {
                String key = field.getKey();
                if (POSES.contains(key)) {
                    Rotations rotation = Rotations.CODEC
                            .parse(JsonOps.INSTANCE, field.getValue())
                            .getOrThrow();
                    // The real Rotations constructor normalizes angles; report that canonical value.
                    pose.put(
                            key,
                            Rotations.CODEC
                                    .encodeStart(NbtOps.INSTANCE, rotation)
                                    .getOrThrow());
                } else if (STAND_FLAGS.contains(key)) nbt.putBoolean(key, bool(field.getValue()));
                else if (key.equals(DISABLED_SLOTS))
                    nbt.putInt(key, integer(field.getValue(), Integer.MIN_VALUE, Integer.MAX_VALUE));
                else
                    throw new IllegalArgumentException(
                            EditorI18n.tr("cadeditor.message.entityworldedit.unknown_armor_stand_field", (key)));
            }
            nbt.put("Pose", pose);
        }
        if (edit.has("item_frame")) {
            require(source instanceof ItemFrame, EditorI18n.tr("cadeditor.message.entityworldedit.target_item_frame"));
            var fields = edit.getAsJsonObject("item_frame");
            for (var field : fields.entrySet()) {
                String key = field.getKey();
                if (key.equals("item")) {
                    var item = decode(field.getValue(), access, ((ItemFrame) source).getItem());
                    nbt.put(
                            "Item",
                            ItemStack.OPTIONAL_CODEC
                                    .encodeStart(access.createSerializationContext(NbtOps.INSTANCE), item)
                                    .getOrThrow());
                } else if (FRAME_FIELDS.contains(key)) {
                    if (key.equals("Invisible") || key.equals("Fixed")) nbt.putBoolean(key, bool(field.getValue()));
                    else if (key.equals("ItemRotation"))
                        nbt.putByte(key, (byte) integer(field.getValue(), 0, ItemFrame.NUM_ROTATIONS - 1));
                    else nbt.putFloat(key, finite(field.getValue()));
                } else
                    throw new IllegalArgumentException(
                            EditorI18n.tr("cadeditor.message.entityworldedit.unknown_item_frame_field", (key)));
            }
        }
        if (edit.has("painting")) {
            require(source instanceof Painting, EditorI18n.tr("cadeditor.message.entityworldedit.target_painting"));
            var data = edit.getAsJsonObject("painting");
            require(
                    data.size() == 1 && data.has("variant"),
                    EditorI18n.tr("cadeditor.message.entityworldedit.paint_only_supports_variant_pointing"));
            var id = Identifier.parse(data.get("variant").getAsString());
            access.lookupOrThrow(Registries.PAINTING_VARIANT)
                    .getOrThrow(net.minecraft.resources.ResourceKey.create(Registries.PAINTING_VARIANT, id));
            nbt.putString("variant", id.toString());
        }
        if (edit.has("display")) {
            require(
                    source instanceof Display,
                    EditorI18n.tr("cadeditor.message.entityworldedit.target_display_entity"));
            for (var field : edit.getAsJsonObject("display").entrySet()) {
                String key = field.getKey();
                var value = field.getValue();
                if (key.equals("item") && source instanceof Display.ItemDisplay) {
                    nbt.put(
                            "item",
                            ItemStack.OPTIONAL_CODEC
                                    .encodeStart(
                                            access.createSerializationContext(NbtOps.INSTANCE),
                                            decode(
                                                    value,
                                                    access,
                                                    source.getSlot(0).get()))
                                    .getOrThrow());
                    continue;
                }
                if (key.equals("block_state") && source instanceof Display.BlockDisplay) {
                    var state = net.minecraft.world.level.block.state.BlockState.CODEC
                            .parse(access.createSerializationContext(JsonOps.INSTANCE), BlockStateWire.game(value))
                            .getOrThrow();
                    nbt.put(
                            key,
                            net.minecraft.world.level.block.state.BlockState.CODEC
                                    .encodeStart(access.createSerializationContext(NbtOps.INSTANCE), state)
                                    .getOrThrow());
                    continue;
                }
                if (key.equals("item_display") && source instanceof Display.ItemDisplay) {
                    var context = net.minecraft.world.item.ItemDisplayContext.CODEC
                            .parse(JsonOps.INSTANCE, value)
                            .getOrThrow();
                    nbt.putString(key, context.getSerializedName());
                    continue;
                }
                require(
                        DISPLAY_FIELDS.contains(key)
                                || (source instanceof Display.TextDisplay && TEXT_FIELDS.contains(key)),
                        EditorI18n.tr("cadeditor.message.entityworldedit.unsupported_display_field", (key)));
                if (key.equals("brightness") && value.isJsonNull()) {
                    nbt.remove(key);
                    continue;
                }
                Tag typed;
                if (key.equals("transformation")) {
                    var t = com.mojang.math.Transformation.EXTENDED_CODEC
                            .parse(JsonOps.INSTANCE, value)
                            .getOrThrow();
                    typed = com.mojang.math.Transformation.EXTENDED_CODEC
                            .encodeStart(NbtOps.INSTANCE, t)
                            .getOrThrow();
                } else if (key.equals("brightness")) {
                    var b = net.minecraft.util.Brightness.CODEC
                            .parse(JsonOps.INSTANCE, value)
                            .getOrThrow();
                    typed = net.minecraft.util.Brightness.CODEC
                            .encodeStart(NbtOps.INSTANCE, b)
                            .getOrThrow();
                } else if (key.equals("text")) {
                    var text = net.minecraft.network.chat.ComponentSerialization.CODEC
                            .parse(access.createSerializationContext(JsonOps.INSTANCE), value)
                            .getOrThrow();
                    typed = net.minecraft.network.chat.ComponentSerialization.CODEC
                            .encodeStart(access.createSerializationContext(NbtOps.INSTANCE), text)
                            .getOrThrow();
                } else if (Set.of("view_range", "shadow_radius", "shadow_strength", "width", "height")
                        .contains(key)) typed = FloatTag.valueOf(finite(value));
                else if (Set.of("shadow", "see_through", "default_background").contains(key))
                    typed = ByteTag.valueOf(bool(value));
                else if (key.equals("text_opacity")) typed = ByteTag.valueOf((byte) integer(value, -128, 127));
                else if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isString())
                    typed = StringTag.valueOf(value.getAsString());
                else typed = IntTag.valueOf(integer(value, Integer.MIN_VALUE, Integer.MAX_VALUE));
                nbt.put(key, typed);
            }
        }
        if (edit.has("offers")) {
            require(
                    source instanceof AbstractVillager && level instanceof ServerLevel,
                    EditorI18n.tr("cadeditor.message.entityworldedit.dealing_serverlevel_villagers_street"));
            require(
                    !((AbstractVillager) source).isTrading(),
                    EditorI18n.tr("cadeditor.message.entityworldedit.businessman_trading_close_deal_ui"));
            nbt.put(
                    "Offers",
                    MerchantOffers.CODEC
                            .encodeStart(
                                    access.createSerializationContext(NbtOps.INSTANCE),
                                    decodeOffers(edit.getAsJsonArray("offers"), access, nbt.get("Offers")))
                            .getOrThrow());
        }
        var copy = source.getType().create(level, EntitySpawnReason.COMMAND);
        require(copy != null, EditorI18n.tr("cadeditor.message.entityworldedit.entity_factory_cannot_create_copy"));
        load(copy, nbt, access);
        if (edit.has("equipment")) {
            require(
                    copy instanceof LivingEntity,
                    EditorI18n.tr("cadeditor.message.entityworldedit.equipment_column_target"));
            var living = (LivingEntity) copy;
            var seen = new HashSet<String>();
            for (var raw : edit.getAsJsonArray("equipment")) {
                var row = raw.getAsJsonObject();
                String slot = StackCodec.string(row, "slot");
                require(seen.add(slot), EditorI18n.tr("cadeditor.message.entityworldedit.equipment_slot_repeat"));
                var equip = Arrays.stream(EquipmentSlot.values())
                        .filter(s -> s.getSerializedName().equals(slot))
                        .findFirst()
                        .orElseThrow(() -> new IllegalArgumentException(
                                EditorI18n.tr("cadeditor.message.entityworldedit.unknown_equipment_slot", (slot))));
                require(
                        living.canUseSlot(equip),
                        EditorI18n.tr(
                                "cadeditor.message.entityworldedit.target_cannot_currently_use_equipment", (slot)));
                living.setItemSlot(
                        equip,
                        EntityViewsHorse.equipment(
                                living, equip, decode(row.get("stack"), access, living.getItemBySlot(equip))));
            }
        }
        var prepared = WorldTarget.saveEntity(copy, access);
        EntityViewsVehicle.verify(nbt, prepared, edit);
        EntityViewsHorse.verify(source, nbt, prepared, access);
        if (nbt.contains("Passengers"))
            prepared.put("Passengers", nbt.get("Passengers").copy());
        // Only explicitly changed fields are required to survive vanilla loading. Pose/default/
        // transformation canonicalization is intentional and handled by the real codecs above.
        for (String key : nbt.keySet())
            if (!Objects.equals(input.get(key), nbt.get(key))
                    && !Set.of("Pose", "start_interpolation").contains(key)
                    && !(key.equals("transformation") && sameTransformation(nbt.get(key), prepared.get(key)))
                    && !WorldNbt.editedFieldRetained(key, nbt.get(key), prepared.get(key)))
                EditorSessions.fail(
                        "invalid_nbt",
                        EditorI18n.tr("cadeditor.message.entityworldedit.vanilla_minecraft_loader_kept_entity", (key)));
        if (nbt.contains("start_interpolation")) {
            require(
                    interpolationDelay(copy)
                            == nbt.getInt("start_interpolation").orElseThrow(),
                    EditorI18n.tr("cadeditor.message.entityworldedit.plug_value_trigger_value_retained"));
            prepared.put("start_interpolation", nbt.get("start_interpolation").copy());
        }
        WorldNbt.protect(input, prepared, true);
        return prepared;
    }

    public static void load(Entity entity, CompoundTag nbt, RegistryAccess access) {
        var problems = new ProblemReporter.Collector();
        entity.load(TagValueInput.create(problems, access, nbt));
        if (!problems.isEmpty())
            EditorSessions.fail(
                    "invalid_nbt",
                    EditorI18n.tr("cadeditor.message.entityworldedit.entity_loading_failed", (problems.getReport())));
    }

    private static boolean sameTransformation(Tag a, Tag b) {
        if (a == null || b == null) return a == b;
        var codec = com.mojang.math.Transformation.EXTENDED_CODEC;
        return codec.parse(NbtOps.INSTANCE, a)
                .getOrThrow()
                .getMatrix()
                .equals(codec.parse(NbtOps.INSTANCE, b).getOrThrow().getMatrix(), 0.00001f);
    }

    private static boolean bool(JsonElement value) {
        require(
                value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean(),
                EditorI18n.tr("cadeditor.message.entityworldedit.field_must_boolean"));
        return value.getAsBoolean();
    }

    private static float finite(JsonElement value) {
        require(
                value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber(),
                EditorI18n.tr("cadeditor.message.entityworldedit.field_must_numerical"));
        float n = value.getAsFloat();
        require(
                Float.isFinite(n),
                EditorI18n.tr("cadeditor.message.entityworldedit.floating_point_number_must_limited"));
        return n;
    }

    private static int integer(JsonElement value, int min, int max) {
        require(
                value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber(),
                EditorI18n.tr("cadeditor.message.entityworldedit.field_must_integer"));
        try {
            int n = value.getAsBigDecimal().intValueExact();
            require(
                    n >= min && n <= max,
                    EditorI18n.tr("cadeditor.message.entityworldedit.integer_exceeded", (min), (max)));
            return n;
        } catch (ArithmeticException ex) {
            throw new IllegalArgumentException(
                    EditorI18n.tr("cadeditor.message.entityworldedit.field_within_range_integer"));
        }
    }

    private static void require(boolean ok, String reason) {
        if (!ok) throw new IllegalArgumentException(reason);
    }

    public static JsonArray offers(MerchantOffers offers, RegistryAccess access) {
        var result = new JsonArray();
        for (var offer : offers) {
            var out = new JsonObject();
            out.add("buy", costStack(offer.getItemCostA(), access));
            offer.getItemCostB().ifPresent(cost -> out.add("buyB", costStack(cost, access)));
            out.add("sell", stack(offer.getResult(), access));
            out.addProperty("uses", offer.getUses());
            out.addProperty("maxUses", offer.getMaxUses());
            out.addProperty("rewardExp", offer.shouldRewardExp());
            out.addProperty("xp", offer.getXp());
            out.addProperty("priceMultiplier", offer.getPriceMultiplier());
            out.addProperty("demand", offer.getDemand());
            out.addProperty("specialPrice", offer.getSpecialPriceDiff());
            result.add(out);
        }
        return result;
    }

    private static JsonObject costStack(ItemCost cost, RegistryAccess access) {
        var out = stack(cost.itemStack(), access);
        out.addProperty(
                "cost_predicate_snbt",
                net.minecraft.core.component.DataComponentExactPredicate.CODEC
                        .encodeStart(access.createSerializationContext(NbtOps.INSTANCE), cost.components())
                        .getOrThrow()
                        .toString());
        return out;
    }

    private static ItemCost cost(ItemStack item, JsonObject wire, RegistryAccess access) {
        if (wire.has("cost_predicate_snbt")) {
            var raw = WorldNbt.parse("{value:" + StackCodec.string(wire, "cost_predicate_snbt") + "}")
                    .get("value");
            var predicate = net.minecraft.core.component.DataComponentExactPredicate.CODEC
                    .parse(access.createSerializationContext(NbtOps.INSTANCE), raw)
                    .getOrThrow();
            var cost = new ItemCost(item.typeHolder(), item.getCount(), predicate);
            if (StackComparison.matches(cost.itemStack(), item, access)) return cost;
        }
        var builder = net.minecraft.core.component.DataComponentExactPredicate.builder();
        for (var entry : dev.rinorsi.editor.ComponentPatches.entries(item.getComponentsPatch())) {
            require(
                    entry.getValue().isPresent(),
                    EditorI18n.tr("cadeditor.message.entityworldedit.transaction_input_codec_support_removal"));
            expect(builder, entry.getKey(), entry.getValue().orElseThrow());
        }
        return new ItemCost(item.typeHolder(), item.getCount(), builder.build());
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static void expect(
            net.minecraft.core.component.DataComponentExactPredicate.Builder builder,
            net.minecraft.core.component.DataComponentType type,
            Object value) {
        builder.expect(type, value);
    }

    public static MerchantOffers decodeOffers(JsonArray rows, RegistryAccess access, Tag original) {
        require(rows.size() <= 256, EditorI18n.tr("cadeditor.message.entityworldedit.transaction_cannot_exceed_256"));
        var recipes = new ListTag();
        var previous = original == null
                ? new MerchantOffers()
                : MerchantOffers.CODEC
                        .parse(access.createSerializationContext(NbtOps.INSTANCE), original)
                        .getOrThrow();
        for (int i = 0; i < rows.size(); i++) {
            var row = rows.get(i).getAsJsonObject();
            var recipe = new CompoundTag();
            var prior = i < previous.size() ? previous.get(i) : null;
            require(
                    Set.of(
                                    "buy",
                                    "buyB",
                                    "sell",
                                    "uses",
                                    "maxUses",
                                    "rewardExp",
                                    "xp",
                                    "priceMultiplier",
                                    "demand",
                                    "specialPrice")
                            .containsAll(row.keySet()),
                    EditorI18n.tr("cadeditor.message.entityworldedit.transaction_contains_unknown_field"));
            for (String key : List.of("buy", "buyB", "sell")) {
                if (key.equals("buyB") && (!row.has(key) || row.get(key).isJsonNull())) continue;
                var old = prior == null
                        ? ItemStack.EMPTY
                        : key.equals("buy")
                                ? prior.getBaseCostA()
                                : key.equals("buyB") ? prior.getCostB() : prior.getResult();
                var item = decode(row.get(key), access, old);
                require(!item.isEmpty(), EditorI18n.tr("cadeditor.message.entityworldedit.item_cannot_empty"));
                if (key.equals("sell"))
                    recipe.put(
                            key,
                            ItemStack.CODEC
                                    .encodeStart(access.createSerializationContext(NbtOps.INSTANCE), item)
                                    .getOrThrow());
                else {
                    // Retain unchanged ingredient predicates exactly (their absent components mean
                    // 'not constrained', which is different from all default stack components).
                    ItemCost cost = cost(item, row.getAsJsonObject(key), access);
                    recipe.put(
                            key,
                            ItemCost.CODEC
                                    .encodeStart(access.createSerializationContext(NbtOps.INSTANCE), cost)
                                    .getOrThrow());
                }
            }
            for (String key : List.of("uses", "maxUses", "xp", "demand", "specialPrice"))
                recipe.putInt(key, integer(row.get(key), Integer.MIN_VALUE, Integer.MAX_VALUE));
            recipe.putBoolean("rewardExp", bool(row.get("rewardExp")));
            recipe.putFloat("priceMultiplier", finite(row.get("priceMultiplier")));
            recipes.add(recipe);
        }
        // The live Offers codec determines both format and bounds; no handwritten trade codec.
        var tag = new CompoundTag();
        tag.put("Recipes", recipes);
        return MerchantOffers.CODEC
                .parse(access.createSerializationContext(NbtOps.INSTANCE), tag)
                .getOrThrow();
    }
}
