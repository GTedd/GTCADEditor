package dev.rinorsi.editor.registry;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;

/**
 * The creative inventory categories that list each item ({@code minecraft:combat}, {@code
 * minecraft:tools_and_utilities}, mod tabs...), built the way the creative screen builds them, so the editor can sort
 * an item the way the game's own inventory does (a sword is a combat item even though 26.3 gives it a tool component).
 *
 * <p>Client thread only. Building the tab contents is the creative screen's own step; when it actually rebuilds, the
 * session search trees are updated afterwards exactly as the screen does, so the creative search never goes stale.
 */
final class CreativeTabIndex {
    private static Map<Item, List<String>> index = Map.of();
    private static Object builtFor;

    private CreativeTabIndex() {}

    /** The categories that list {@code item}, in tab order; empty when the item is in none or there is no world. */
    static List<String> of(Item item) {
        refresh();
        return index.getOrDefault(item, List.of());
    }

    private static void refresh() {
        var mc = Minecraft.getInstance();
        if (mc == null) return;
        var player = mc.player;
        var connection = mc.getConnection();
        if (player == null || connection == null || mc.level == null) {
            index = Map.of();
            builtFor = null;
            return;
        }
        var access = mc.level.registryAccess();
        var features = connection.enabledFeatures();
        boolean operatorTab =
                player.canUseGameMasterBlocks() && mc.options.operatorItemsTab().get();
        boolean rebuilt = CreativeModeTabs.tryRebuildTabContents(features, operatorTab, access);
        if (rebuilt) {
            // As CreativeModeInventoryScreen after a rebuild: its search tab follows the new contents.
            var search = List.copyOf(CreativeModeTabs.searchTab().getDisplayItems());
            connection.searchTrees().updateCreativeTooltips(access, search);
            connection.searchTrees().updateCreativeTags(search);
        }
        Object key = List.of(access, features, operatorTab);
        if (!rebuilt && key.equals(builtFor)) return;
        Map<Item, Set<String>> found = new HashMap<>();
        for (CreativeModeTab tab : CreativeModeTabs.allTabs()) {
            if (tab.getType() != CreativeModeTab.Type.CATEGORY) continue;
            var id = BuiltInRegistries.CREATIVE_MODE_TAB.getKey(tab);
            if (id == null) continue;
            for (var stack : tab.getDisplayItems())
                found.computeIfAbsent(stack.getItem(), i -> new LinkedHashSet<>())
                        .add(id.toString());
        }
        Map<Item, List<String>> out = new HashMap<>();
        found.forEach((item, tabs) -> out.put(item, List.copyOf(new ArrayList<>(tabs))));
        index = out;
        builtFor = key;
    }
}
