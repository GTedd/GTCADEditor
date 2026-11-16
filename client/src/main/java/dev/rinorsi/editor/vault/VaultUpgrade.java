package dev.rinorsi.editor.vault;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.serialization.Dynamic;
import com.mojang.serialization.JsonOps;
import dev.rinorsi.editor.ComponentValidation;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorWire;
import dev.rinorsi.editor.StackCodec;
import net.minecraft.core.RegistryAccess;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtOps;
import net.minecraft.nbt.Tag;
import net.minecraft.util.datafix.DataFixers;
import net.minecraft.util.datafix.fixes.References;
import net.minecraft.world.item.ItemStack;

/**
 * Cross-version upgrade of stored items: the stack's raw item NBT goes through the game's DataFixer
 * ({@code References.ITEM_STACK}) from the version it was written with, then the same strict decoder as save/apply
 * checks it against the current registries. Pure functions; the caller decides what to keep on failure.
 */
public final class VaultUpgrade {
    private VaultUpgrade() {}

    public static VaultStore.Upgrader upgrader(RegistryAccess access, int current) {
        return (stack, from) -> validate(fix(wireToNbt(stack), from, current), access);
    }

    /** Editor wire stack to the item NBT its version wrote. A typed sidecar wins over the JSON projection. */
    public static CompoundTag wireToNbt(JsonObject wire) {
        CompoundTag tag = new CompoundTag();
        if (!wire.has("id") || !wire.get("id").isJsonPrimitive())
            throw new VaultStore.Failure("INVALID_STACK", EditorI18n.tr("cadeditor.message.vaultupgrade.not_item"));
        tag.putString("id", wire.get("id").getAsString());
        tag.putInt("count", wire.has("count") ? wire.get("count").getAsInt() : 1);
        JsonObject comps = object(wire, "comps"),
                removed = object(wire, "removed"),
                snbt = object(wire, "component_snbt"),
                formats = object(wire, "component_formats");
        CompoundTag components = new CompoundTag();
        for (var entry : comps.entrySet()) {
            String key = entry.getKey();
            JsonElement value = entry.getValue();
            Tag nbt;
            if (formats.has(key) && value.isJsonPrimitive())
                nbt = ComponentValidation.parseSnbt(value.getAsString(), EditorWire.MAX_NBT_CHARS);
            else if (snbt.has(key) && snbt.get(key).isJsonPrimitive())
                nbt = ComponentValidation.parseSnbt(snbt.get(key).getAsString(), EditorWire.MAX_NBT_CHARS);
            else nbt = JsonOps.INSTANCE.convertTo(NbtOps.INSTANCE, value);
            components.put(full(key), nbt);
        }
        for (String key : removed.keySet()) components.put("!" + full(key), new CompoundTag());
        if (!components.isEmpty()) tag.put("components", components);
        return tag;
    }

    /** DataFixer from {@code from} to {@code to}; the same version is returned as a copy, never "downgraded". */
    public static CompoundTag fix(CompoundTag item, int from, int to) {
        if (from >= to) return item.copy();
        Dynamic<Tag> out = DataFixers.getDataFixer()
                .update(References.ITEM_STACK, new Dynamic<>(NbtOps.INSTANCE, item.copy()), from, to);
        if (!(out.getValue() instanceof CompoundTag fixed))
            throw new VaultStore.Failure("INVALID_STACK", EditorI18n.tr("cadeditor.message.vaultupgrade.not_item"));
        return fixed;
    }

    /** Current-format item NBT to a canonical stack, through the strict save/apply decoder. */
    public static VaultStore.Validated validate(CompoundTag item, RegistryAccess access) {
        ItemStack stack = ItemStack.CODEC
                .parse(access.createSerializationContext(NbtOps.INSTANCE), item)
                .getOrThrow(message -> new VaultStore.Failure("INVALID_STACK", VaultStore.clip(message, 512)));
        ItemStack.validateStrict(stack)
                .getOrThrow(message -> new VaultStore.Failure("INVALID_STACK", VaultStore.clip(message, 512)));
        JsonObject wire = StackCodec.snapshot(stack, access, new JsonObject(), "");
        wire.remove("slot");
        wire.remove("label");
        try {
            return VaultStacks.validate(wire, access);
        } catch (VaultStore.Failure failure) {
            throw failure;
        } catch (RuntimeException invalid) {
            throw new VaultStore.Failure("INVALID_STACK", VaultStore.reason(invalid));
        }
    }

    /**
     * Raw current-shaped item NBT to a wire stack that keeps every component as typed SNBT, for rows that failed
     * validation but are kept. Null when the tag has no usable item ID or a count the vault cannot hold.
     */
    public static JsonObject nbtToWire(CompoundTag item) {
        String id = item.getStringOr("id", "");
        if (id.isEmpty()) return null;
        if (id.indexOf(':') < 0) id = "minecraft:" + id;
        if (!id.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")) return null;
        int count = item.contains("count") ? item.getIntOr("count", 1) : item.getByteOr("Count", (byte) 1);
        if (count < 1 || count > 99) return null;
        JsonObject wire = new JsonObject(),
                comps = new JsonObject(),
                removed = new JsonObject(),
                snbt = new JsonObject();
        wire.addProperty("id", id);
        wire.addProperty("count", count);
        CompoundTag components = item.getCompoundOrEmpty("components");
        for (String key : components.keySet()) {
            Tag value = components.get(key);
            if (key.startsWith("!")) {
                removed.addProperty(shortId(key.substring(1)), 1);
                continue;
            }
            String shortKey = shortId(key);
            JsonElement json;
            try {
                json = NbtOps.INSTANCE.convertTo(JsonOps.INSTANCE, value);
            } catch (RuntimeException unrepresentable) {
                json = new JsonObject();
            }
            comps.add(shortKey, json);
            snbt.addProperty(shortKey, value.toString());
        }
        wire.add("comps", comps);
        if (!snbt.isEmpty()) wire.add("component_snbt", snbt);
        wire.add("removed", removed);
        return wire;
    }

    private static JsonObject object(JsonObject o, String key) {
        return o.has(key) && o.get(key).isJsonObject() ? o.getAsJsonObject(key) : new JsonObject();
    }

    private static String full(String key) {
        return key.indexOf(':') >= 0 ? key : "minecraft:" + key;
    }

    private static String shortId(String key) {
        return key.startsWith("minecraft:") ? key.substring("minecraft:".length()) : key;
    }
}
