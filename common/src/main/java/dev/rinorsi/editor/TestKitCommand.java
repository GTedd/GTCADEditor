package dev.rinorsi.editor;

import dev.rinorsi.editor.platform.Platform;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;

/** Server command only, gated by the same creative/OP policy as Editor writes. */
final class TestKitCommand {
    private TestKitCommand() {}

    static boolean allowedMode(boolean creative, boolean operator) {
        return creative || operator;
    }

    static void register(Supplier<EditorPolicy> policy) {
        Platform.get().onCommands(dispatcher -> dispatcher.register(tree(policy)));
    }

    static com.mojang.brigadier.builder.LiteralArgumentBuilder<CommandSourceStack> tree(Supplier<EditorPolicy> policy) {
        return Commands.literal("cadeditor")
                .then(Commands.literal("testkit")
                        .requires(source -> allowed(source, policy))
                        .executes(context -> run(context.getSource(), policy, "all"))
                        .then(Commands.literal("all").executes(context -> run(context.getSource(), policy, "all")))
                        .then(Commands.literal("hotbar")
                                .executes(context -> run(context.getSource(), policy, "hotbar")))
                        .then(Commands.literal("inventory")
                                .executes(context -> run(context.getSource(), policy, "inventory")))
                        .then(Commands.literal("clear")
                                .executes(context -> run(context.getSource(), policy, "clear"))));
    }

    private static boolean allowed(CommandSourceStack source, Supplier<EditorPolicy> policy) {
        if (!(source.getEntity() instanceof ServerPlayer player) || policy.get() == null) return false;
        return policy.get().allowed(player, EditorPermission.TESTKIT);
    }

    private static int run(CommandSourceStack source, Supplier<EditorPolicy> policy, String mode) {
        String language = source.getEntity() instanceof ServerPlayer player
                ? player.clientInformation().language()
                : "en_us";
        try (var scope = EditorI18n.forLanguage(language)) {
            return runLocalized(source, policy, mode);
        }
    }

    private static int runLocalized(CommandSourceStack source, Supplier<EditorPolicy> policy, String mode) {
        try {
            if (!(source.getEntity() instanceof ServerPlayer player))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.testkitcommand.only_player_use_test_prop"));
            if (!allowed(source, policy))
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.testkitcommand.test_props_only_op_creative"));
            policy.get().require(player, EditorPermission.TESTKIT, "permission_denied");
            var indices = new ArrayList<Integer>();
            for (int i = 0; i < (mode.equals("hotbar") ? 9 : 36); i++) indices.add(i);
            if (mode.equals("all") || mode.equals("clear")) indices.add(40);
            List<ItemStack> before = indices.stream()
                    .map(i -> player.getInventory().getItem(i).copy())
                    .toList();
            int specimens = 0;
            List<ItemStack> after;
            if (mode.equals("clear")) after = TestKitInventory.clear(before);
            else {
                var kit = TestKit.create(player.registryAccess(), !mode.equals("hotbar"));
                if (mode.equals("hotbar")) kit = kit.subList(0, 9);
                // Without cadeditor.item.bypass the kit leaves out what itemRules forbid (operator items, plugin data).
                kit = kit.stream()
                        .filter(specimen -> ItemRules.violation(player, ItemStack.EMPTY, specimen.stack()) == null)
                        .toList();
                specimens = kit.size();
                after = TestKitInventory.give(before, kit, player.registryAccess());
            }
            // All generation/packing checks finish before touching any live inventory slot.
            for (int i = 0; i < indices.size(); i++)
                if (!ItemStack.matches(before.get(i), after.get(i)))
                    player.getInventory().setItem(indices.get(i), after.get(i));
            player.getInventory().setChanged();
            player.inventoryMenu.broadcastChanges();
            player.containerMenu.broadcastChanges();
            int count = specimens;
            var detail = new com.google.gson.JsonObject();
            detail.addProperty("specimens", count);
            dev.rinorsi.editor.history.EditorHistory.record(
                    dev.rinorsi.editor.history.EditorHistory.Actor.of(player),
                    "testkit." + mode,
                    "inventory",
                    "ok",
                    "",
                    detail);
            source.sendSuccess(
                    () -> Component.literal(
                            mode.equals("clear")
                                    ? EditorI18n.tr(
                                            "cadeditor.message.testkitcommand.clears_test_marked_props_inventory")
                                    : EditorI18n.tr(
                                            "cadeditor.message.testkitcommand.test_props_distributed_overflows_placed",
                                            (count),
                                            ((mode.equals("hotbar")
                                                    ? EditorI18n.tr("cadeditor.message.testkitcommand.first_9_slots")
                                                    : EditorI18n.tr(
                                                            "cadeditor.message.testkitcommand.overwrite_component",
                                                            (TestKit.expectedComponents()
                                                                    .size())))))),
                    false);
            return 1;
        } catch (RuntimeException error) {
            source.sendFailure(Component.literal(
                    error.getMessage() == null
                            ? EditorI18n.tr("cadeditor.message.testkitcommand.test_prop_operation_failed_issued")
                            : error.getMessage()));
            return 0;
        }
    }
}
