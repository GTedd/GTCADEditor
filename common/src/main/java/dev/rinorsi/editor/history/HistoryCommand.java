package dev.rinorsi.editor.history;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.LongArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorPermission;
import dev.rinorsi.editor.EditorPolicy;
import dev.rinorsi.editor.platform.Platform;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.EntityArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.level.ServerPlayer;

/**
 * {@code /cadeditor history} and {@code /cadeditor permissions}. Every subcommand checks the source's node.
 *
 * <pre>
 * /cadeditor history list [page] [query]     query terms: player: action: outcome: target: tag: since: until: words
 * /cadeditor history view &lt;id&gt;
 * /cadeditor history add &lt;note&gt;
 * /cadeditor history note &lt;id&gt; &lt;note | -&gt;      ("-" clears the note)
 * /cadeditor history tag &lt;id&gt; add|remove &lt;tag&gt;
 * /cadeditor history delete &lt;id&gt;
 * /cadeditor history purge &lt;query&gt;
 * /cadeditor permissions [player]
 * </pre>
 */
public final class HistoryCommand {
    private static final int PAGE = 10;
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private HistoryCommand() {}

    public static void register() {
        Platform.get().onCommands(dispatcher -> dispatcher.register(tree()));
    }

    static LiteralArgumentBuilder<CommandSourceStack> tree() {
        var history = Commands.literal("history")
                .requires(source ->
                        can(source, EditorPermission.HISTORY_OWN) || can(source, EditorPermission.HISTORY_VIEW))
                .executes(c -> list(c, 1, ""))
                .then(Commands.literal("list")
                        .executes(c -> list(c, 1, ""))
                        .then(Commands.argument("page", IntegerArgumentType.integer(1))
                                .executes(c -> list(c, IntegerArgumentType.getInteger(c, "page"), ""))
                                .then(Commands.argument("query", StringArgumentType.greedyString())
                                        .executes(c -> list(
                                                c,
                                                IntegerArgumentType.getInteger(c, "page"),
                                                StringArgumentType.getString(c, "query"))))))
                .then(Commands.literal("search")
                        .then(Commands.argument("query", StringArgumentType.greedyString())
                                .executes(c -> list(c, 1, StringArgumentType.getString(c, "query")))))
                .then(Commands.literal("view")
                        .then(Commands.argument("id", LongArgumentType.longArg(1))
                                .executes(HistoryCommand::view)))
                .then(Commands.literal("add")
                        .requires(source -> can(source, EditorPermission.HISTORY_EDIT))
                        .then(Commands.argument("note", StringArgumentType.greedyString())
                                .executes(c -> run(c, actor -> {
                                    var record = EditorHistory.addNote(
                                            actor, "", StringArgumentType.getString(c, "note"), List.of());
                                    return tr("cadeditor.message.history.added", record.id);
                                }))))
                .then(Commands.literal("note")
                        .requires(source -> can(source, EditorPermission.HISTORY_EDIT))
                        .then(Commands.argument("id", LongArgumentType.longArg(1))
                                .then(Commands.argument("note", StringArgumentType.greedyString())
                                        .executes(c -> run(c, actor -> {
                                            String note = StringArgumentType.getString(c, "note");
                                            var record = EditorHistory.edit(
                                                    actor,
                                                    LongArgumentType.getLong(c, "id"),
                                                    note.equals("-") ? "" : note,
                                                    null);
                                            return tr("cadeditor.message.history.edited", record.id);
                                        })))))
                .then(Commands.literal("tag")
                        .requires(source -> can(source, EditorPermission.HISTORY_EDIT))
                        .then(Commands.argument("id", LongArgumentType.longArg(1))
                                .then(Commands.literal("add")
                                        .then(Commands.argument("tag", StringArgumentType.word())
                                                .executes(c -> tag(c, true))))
                                .then(Commands.literal("remove")
                                        .then(Commands.argument("tag", StringArgumentType.word())
                                                .executes(c -> tag(c, false))))))
                .then(Commands.literal("delete")
                        .requires(source -> can(source, EditorPermission.HISTORY_DELETE))
                        .then(Commands.argument("id", LongArgumentType.longArg(1))
                                .executes(c -> run(c, actor -> {
                                    var removed =
                                            EditorHistory.delete(actor, List.of(LongArgumentType.getLong(c, "id")));
                                    if (removed.isEmpty())
                                        return tr(
                                                        "cadeditor.message.history.notfound",
                                                        LongArgumentType.getLong(c, "id"))
                                                .withStyle(ChatFormatting.RED);
                                    return tr(
                                            "cadeditor.message.history.deleted",
                                            removed.size(),
                                            "#" + removed.getFirst());
                                }))))
                .then(Commands.literal("purge")
                        .requires(source -> can(source, EditorPermission.HISTORY_DELETE))
                        .then(Commands.argument("query", StringArgumentType.greedyString())
                                .executes(c -> run(c, actor -> {
                                    var query = HistoryQuery.parse(
                                            StringArgumentType.getString(c, "query"),
                                            System.currentTimeMillis(),
                                            ZoneId.systemDefault());
                                    return tr(
                                            "cadeditor.message.history.purged",
                                            EditorHistory.purge(actor, query).size());
                                }))));
        var permissions = Commands.literal("permissions")
                .requires(source -> source.getEntity() instanceof ServerPlayer
                        || source.permissions()
                                .hasPermission(net.minecraft.server.permissions.Permissions.COMMANDS_OWNER))
                .executes(c -> permissions(c, null))
                .then(Commands.argument("player", EntityArgument.player())
                        .requires(source -> !(source.getEntity() instanceof ServerPlayer)
                                || can(source, EditorPermission.HISTORY_VIEW))
                        .executes(c -> permissions(c, EntityArgument.getPlayer(c, "player"))));
        return Commands.literal("cadeditor").then(history).then(permissions);
    }

    private static boolean can(CommandSourceStack source, EditorPermission permission) {
        return EditorHistory.Actor.of(source).can(permission);
    }

    private static int list(CommandContext<CommandSourceStack> c, int page, String query) {
        return run(c, actor -> {
            var filter = HistoryQuery.parse(query, System.currentTimeMillis(), ZoneId.systemDefault());
            var result = EditorHistory.list(actor, filter, page - 1, PAGE);
            var source = c.getSource();
            int pages = Math.max(1, (result.total() + PAGE - 1) / PAGE);
            String scope = tr("cadeditor.message.history.scope."
                            + (actor.can(EditorPermission.HISTORY_VIEW) ? "all" : "own"))
                    .getString();
            source.sendSuccess(
                    () -> tr("cadeditor.message.history.header", result.total(), page, pages, scope)
                            .withStyle(ChatFormatting.GOLD),
                    false);
            if (result.records().isEmpty())
                return tr("cadeditor.message.history.empty").withStyle(ChatFormatting.GRAY);
            for (var record : result.records()) source.sendSuccess(() -> line(record), false);
            return null;
        });
    }

    private static int view(CommandContext<CommandSourceStack> c) {
        return run(c, actor -> {
            long id = LongArgumentType.getLong(c, "id");
            var record = EditorHistory.get(actor, id).orElse(null);
            if (record == null)
                return tr("cadeditor.message.history.notfound", id).withStyle(ChatFormatting.RED);
            var source = c.getSource();
            var lines = new ArrayList<Component>();
            lines.add(Component.literal("#" + record.id + " ")
                    .withStyle(ChatFormatting.GOLD)
                    .append(outcome(record.outcome)));
            lines.add(tr("cadeditor.message.history.field.time", time(record.time)));
            lines.add(tr("cadeditor.message.history.field.actor", record.actorName, record.actorId));
            lines.add(tr("cadeditor.message.history.field.action", record.action));
            if (!record.target.isEmpty()) lines.add(tr("cadeditor.message.history.field.target", record.target));
            if (!record.code.isEmpty()) lines.add(tr("cadeditor.message.history.field.code", record.code));
            if (!record.node.isEmpty()) lines.add(tr("cadeditor.message.history.field.node", record.node));
            if (!record.requestId.isEmpty()) lines.add(tr("cadeditor.message.history.field.request", record.requestId));
            if (record.detail.size() > 0)
                lines.add(tr("cadeditor.message.history.field.detail", record.detail.toString()));
            if (!record.note().isEmpty()) lines.add(tr("cadeditor.message.history.field.note", record.note()));
            if (!record.tags().isEmpty())
                lines.add(tr("cadeditor.message.history.field.tags", String.join(", ", record.tags())));
            if (record.editedAt() > 0)
                lines.add(tr("cadeditor.message.history.field.edited", record.editedBy(), time(record.editedAt())));
            for (var line : lines) source.sendSuccess(() -> line, false);
            return null;
        });
    }

    private static int tag(CommandContext<CommandSourceStack> c, boolean add) {
        return run(c, actor -> {
            long id = LongArgumentType.getLong(c, "id");
            var record = EditorHistory.get(actor, id)
                    .orElseThrow(() -> new IllegalArgumentException(
                            tr("cadeditor.message.history.notfound", id).getString()));
            var tags = new ArrayList<>(record.tags());
            String tag = StringArgumentType.getString(c, "tag").toLowerCase(java.util.Locale.ROOT);
            if (add) {
                if (!tags.contains(tag)) tags.add(tag);
            } else tags.remove(tag);
            EditorHistory.edit(actor, id, null, tags);
            return tr("cadeditor.message.history.edited", id);
        });
    }

    private static int permissions(CommandContext<CommandSourceStack> c, ServerPlayer target) {
        return run(c, actor -> {
            var player = target != null ? target : c.getSource().getPlayerOrException();
            var source = c.getSource();
            source.sendSuccess(
                    () -> tr(
                                    "cadeditor.message.permission.header",
                                    player.getGameProfile().name())
                            .withStyle(ChatFormatting.GOLD),
                    false);
            var policy = EditorPolicy.current();
            for (var permission : EditorPermission.values()) {
                boolean allowed = policy.allowed(player, permission);
                source.sendSuccess(
                        () -> Component.literal(permission.node + "  ")
                                .append(
                                        allowed
                                                ? tr("cadeditor.message.permission.allowed")
                                                        .withStyle(ChatFormatting.GREEN)
                                                : tr("cadeditor.message.permission.refused")
                                                        .withStyle(ChatFormatting.RED)),
                        false);
            }
            return null;
        });
    }

    /** Runs in the source's language; failures become a red message, never an exception. */
    private static int run(CommandContext<CommandSourceStack> c, CommandAction action) {
        var source = c.getSource();
        String language = source.getEntity() instanceof ServerPlayer player
                ? player.clientInformation().language()
                : "en_us";
        try (var scope = EditorI18n.forLanguage(language)) {
            try {
                var message = action.run(EditorHistory.Actor.of(source));
                if (message != null) source.sendSuccess(() -> message, false);
                return 1;
            } catch (EditorHistory.HistoryDenied e) {
                if (!e.node.equals(EditorPermission.HISTORY_VIEW.node))
                    EditorHistory.recordDenied(EditorHistory.Actor.of(source), "history.command", c.getInput(), e.node);
                source.sendFailure(tr("cadeditor.message.permission.denied", e.node));
            } catch (EditorHistory.HistoryUnavailable e) {
                source.sendFailure(tr("cadeditor.message.history.unavailable"));
            } catch (com.mojang.brigadier.exceptions.CommandSyntaxException e) {
                source.sendFailure(Component.literal(e.getMessage()));
            } catch (RuntimeException e) {
                source.sendFailure(tr("cadeditor.message.history.invalid", String.valueOf(e.getMessage())));
            }
            return 0;
        }
    }

    @FunctionalInterface
    private interface CommandAction {
        MutableComponent run(EditorHistory.Actor actor) throws com.mojang.brigadier.exceptions.CommandSyntaxException;
    }

    private static Component line(HistoryRecord record) {
        var line = Component.literal("#" + record.id + " ")
                .withStyle(ChatFormatting.GOLD)
                .append(Component.literal(time(record.time) + " ").withStyle(ChatFormatting.GRAY))
                .append(Component.literal(record.actorName + " ").withStyle(ChatFormatting.AQUA))
                .append(Component.literal(record.action + " ").withStyle(ChatFormatting.WHITE))
                .append(outcome(record.outcome));
        if (!record.target.isEmpty())
            line.append(Component.literal(" " + record.target).withStyle(ChatFormatting.GRAY));
        if (!record.tags().isEmpty())
            line.append(Component.literal(" [" + String.join(",", record.tags()) + "]")
                    .withStyle(ChatFormatting.LIGHT_PURPLE));
        if (!record.note().isEmpty())
            line.append(Component.literal(" — " + record.note()).withStyle(ChatFormatting.ITALIC));
        return line;
    }

    private static MutableComponent outcome(String outcome) {
        var style = switch (outcome) {
            case "ok" -> ChatFormatting.GREEN;
            case "pending", "note" -> ChatFormatting.YELLOW;
            case "denied" -> ChatFormatting.RED;
            default -> ChatFormatting.GOLD;
        };
        return tr("cadeditor.message.history.outcome." + outcome).withStyle(style);
    }

    private static String time(long epochMillis) {
        return TIME.format(Instant.ofEpochMilli(epochMillis).atZone(ZoneId.systemDefault()));
    }

    private static MutableComponent tr(String key, Object... args) {
        return Component.literal(EditorI18n.tr(key, args));
    }
}
