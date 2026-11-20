package dev.rinorsi.editor.registry;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.rinorsi.editor.EditorI18n;
import net.minecraft.core.BlockPos;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.Container;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.BundleItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.SpawnEggItem;
import net.minecraft.world.item.component.BundleContents;
import net.minecraft.world.level.block.EntityBlock;

/** Physical item facts absent from the prototype component map. Never places blocks/entities. */
public final class ItemMetadata {
    private ItemMetadata() {}

    public static JsonArray entries(RegistryAccess access, Identifier only) {
        var registry = access.lookup(Registries.ITEM).orElse(BuiltInRegistries.ITEM);
        if (only != null && !registry.containsKey(only))
            throw new IllegalArgumentException(EditorI18n.tr("cadeditor.message.itemmetadata.unknown_item", (only)));
        JsonArray entries = new JsonArray();
        registry.listElements()
                .filter(h -> only == null || h.key().identifier().equals(only))
                .sorted(java.util.Comparator.comparing(h -> h.key().identifier().toString()))
                .forEach(h -> {
                    var entry = entry(h.value(), access);
                    // The creative inventory categories that list the item (kindFromFacts sorts combat items by them).
                    var tabs = new JsonArray();
                    CreativeTabIndex.of(h.value()).forEach(tabs::add);
                    entry.add("creative_tabs", tabs);
                    entries.add(entry);
                });
        return entries;
    }

    public static JsonObject entry(Item item) {
        return entry(item, null);
    }

    /** lookup (may be null) is only used to save the special block entity's factory defaults. */
    public static JsonObject entry(Item item, net.minecraft.core.HolderLookup.Provider lookup) {
        JsonObject out = new JsonObject();
        out.addProperty("id", BuiltInRegistries.ITEM.getKey(item).toString());
        var comps = item.components();
        out.addProperty("tool", comps.has(DataComponents.TOOL));
        out.addProperty(
                "weapon",
                comps.has(DataComponents.WEAPON)
                        || comps.has(DataComponents.KINETIC_WEAPON)
                        || comps.has(DataComponents.PIERCING_WEAPON));
        out.addProperty("food", comps.has(DataComponents.FOOD));
        out.addProperty("consumable", comps.has(DataComponents.CONSUMABLE));
        out.addProperty("jukebox_playable", comps.has(DataComponents.JUKEBOX_PLAYABLE));
        out.addProperty("ranged_weapon", item instanceof net.minecraft.world.item.ProjectileWeaponItem);
        var equip = comps.get(DataComponents.EQUIPPABLE);
        if (equip != null) out.addProperty("equipment_slot", equip.slot().getSerializedName());
        var attributes = comps.get(DataComponents.ATTRIBUTE_MODIFIERS);
        if (equip != null
                && attributes != null
                && attributes.modifiers().stream()
                        .anyMatch(e -> e.attribute().equals(net.minecraft.world.entity.ai.attributes.Attributes.ARMOR)))
            out.addProperty("armor_slot", equip.slot().getSerializedName());
        out.addProperty("block_item", item instanceof BlockItem);
        if (item instanceof SpawnEggItem) {
            var type = SpawnEggItem.getType(new ItemStack(item));
            if (type != null)
                out.addProperty(
                        "spawn_egg_entity",
                        BuiltInRegistries.ENTITY_TYPE.getKey(type).toString());
        }
        BucketItemMetadata.append(item, out);
        placedEntity(item, out);
        if (item instanceof BlockItem blockItem) {
            var block = blockItem.getBlock();
            out.addProperty("block", BuiltInRegistries.BLOCK.getKey(block).toString());
            if (block instanceof EntityBlock entityBlock) {
                try {
                    var entity = entityBlock.newBlockEntity(BlockPos.ZERO, block.defaultBlockState());
                    if (entity != null) {
                        out.addProperty(
                                "block_entity_type",
                                BuiltInRegistries.BLOCK_ENTITY_TYPE
                                        .getKey(entity.getType())
                                        .toString());
                        if (entity.getType().onlyOpCanSetNbt()) out.addProperty("block_entity_op_only", true);
                        if (entity instanceof net.minecraft.world.level.block.entity.SignBlockEntity) {
                            out.addProperty("block_entity_kind", "sign");
                            out.addProperty("sign_lines", net.minecraft.world.level.block.entity.SignText.LINES);
                        } else if (entity instanceof net.minecraft.world.level.block.entity.CommandBlockEntity) {
                            out.addProperty("block_entity_kind", "command_block");
                            out.add("command_block_items", commandBlockItems());
                        }
                        if (lookup != null && out.has("block_entity_kind"))
                            try {
                                out.addProperty(
                                        "block_entity_default_nbt",
                                        entity.saveWithoutMetadata(lookup).toString());
                            } catch (RuntimeException e) {
                                out.addProperty(
                                        "block_entity_default_error",
                                        e.getClass().getSimpleName());
                            }
                        if (entity instanceof Container container)
                            out.addProperty("container_size", container.getContainerSize());
                        else if (entity instanceof net.minecraft.world.level.block.entity.CampfireBlockEntity campfire)
                            out.addProperty(
                                    "container_size", campfire.getItems().size());
                    }
                } catch (RuntimeException e) {
                    out.addProperty(
                            "metadata_error",
                            EditorI18n.tr(
                                    "cadeditor.message.itemmetadata.could_read_block_entity_worldless",
                                    (e.getClass().getSimpleName())));
                }
            }
        }
        boolean bundle = item instanceof BundleItem || comps.has(DataComponents.BUNDLE_CONTENTS);
        out.addProperty("bundle", bundle);
        if (bundle) {
            // Saturate the vanilla Mutable through its public insertion rules. The result is a
            // normalized Fraction capacity, not a guessed count of arbitrary stack-size items.
            var candidate = BuiltInRegistries.ITEM.stream()
                    .map(ItemStack::new)
                    .filter(s -> !s.isEmpty()
                            && BundleContents.canItemBeInBundle(s)
                            && !s.has(DataComponents.BUNDLE_CONTENTS))
                    .max(java.util.Comparator.comparingInt(ItemStack::getMaxStackSize));
            if (candidate.isPresent()) {
                var mutable = new BundleContents.Mutable();
                var stack = candidate.get();
                stack.setCount(Integer.MAX_VALUE);
                int inserted = mutable.tryInsert(stack);
                var capacity = mutable.weight();
                JsonObject value = new JsonObject();
                value.addProperty("numerator", capacity.getNumerator());
                value.addProperty("denominator", capacity.getDenominator());
                out.add("bundle_capacity", value);
                out.addProperty("bundle_capacity_source", "minecraft:bundle_contents");
                out.addProperty(
                        "bundle_reference_item",
                        BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
                out.addProperty("bundle_reference_count", inserted);
            }
        }
        return out;
    }

    /** The entity the item's class places (armor stand, item frame, painting...), never guessed from the item id. */
    private static void placedEntity(Item item, JsonObject out) {
        net.minecraft.world.entity.EntityType<?> type = null;
        String kind = null;
        if (item instanceof net.minecraft.world.item.ArmorStandItem) {
            type = net.minecraft.world.entity.EntityTypes.ARMOR_STAND;
            kind = "armor_stand";
        } else if (item instanceof net.minecraft.world.item.HangingEntityItem) {
            try {
                var field = net.minecraft.world.item.HangingEntityItem.class.getDeclaredField("type");
                field.setAccessible(true);
                type = (net.minecraft.world.entity.EntityType<?>) field.get(item);
            } catch (ReflectiveOperationException | RuntimeException e) {
                out.addProperty("placed_entity_error", e.getClass().getSimpleName());
            }
            kind = item instanceof net.minecraft.world.item.ItemFrameItem ? "item_frame" : "hanging";
        }
        if (type == null) return;
        out.addProperty(
                "placed_entity", BuiltInRegistries.ENTITY_TYPE.getKey(type).toString());
        out.addProperty("placed_entity_kind", kind);
    }

    /** Items whose block is a command block: the impulse / chain / repeating choices of a command block item. */
    private static JsonArray commandBlockItems() {
        JsonArray out = new JsonArray();
        BuiltInRegistries.ITEM.stream()
                .filter(i -> i instanceof BlockItem b
                        && b.getBlock() instanceof net.minecraft.world.level.block.CommandBlock)
                .map(i -> BuiltInRegistries.ITEM.getKey(i).toString())
                .sorted()
                .forEach(out::add);
        return out;
    }
}
