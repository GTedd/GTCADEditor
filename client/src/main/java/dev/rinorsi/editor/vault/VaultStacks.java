package dev.rinorsi.editor.vault;

import com.google.gson.*;
import dev.rinorsi.editor.StackCodec;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.item.ItemStack;

/** The exact strict apply decoder, followed by a fresh typed sidecar snapshot. */
public final class VaultStacks {
    private VaultStacks() {}

    public static VaultStore.Validated validate(JsonObject wire, RegistryAccess registries) {
        ItemStack stack = StackCodec.decode(wire, registries);
        JsonObject canonical = StackCodec.snapshot(stack, registries, new JsonObject(), "");
        canonical.remove("slot");
        canonical.remove("label");
        JsonObject summary = new JsonObject();
        var enchantments = stack.get(DataComponents.ENCHANTMENTS);
        var stored = stack.get(DataComponents.STORED_ENCHANTMENTS);
        summary.addProperty(
                "enchantCount",
                (enchantments == null ? 0 : enchantments.size()) + (stored == null ? 0 : stored.size()));
        summary.addProperty("hasCustomName", stack.has(DataComponents.CUSTOM_NAME));
        var container = stack.get(DataComponents.CONTAINER);
        summary.addProperty(
                "containerSize",
                container == null ? 0 : container.nonEmptyItemCopyStream().count());
        String translated = net.minecraft.network.chat.Component.translatable(
                        stack.getItem().getDescriptionId())
                .getString();
        return new VaultStore.Validated(
                canonical, stack.getHoverName().getString(), translated, summary, loreText(stack));
    }

    /** Plain-text lore index stored with the entry, so search never has to decode the item again. */
    static String loreText(ItemStack stack) {
        var lore = stack.get(DataComponents.LORE);
        if (lore == null) return "";
        StringBuilder out = new StringBuilder();
        for (var line : lore.lines()) {
            if (out.length() >= VaultStore.LORE_CHARS) break;
            if (out.length() > 0) out.append(' ');
            out.append(line.getString());
        }
        return VaultStore.clip(out.toString(), VaultStore.LORE_CHARS);
    }
}
