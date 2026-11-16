package dev.rinorsi.editor.registry;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.ParseResults;
import com.mojang.brigadier.StringReader;
import com.mojang.brigadier.context.CommandContextBuilder;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.suggestion.Suggestion;
import com.mojang.brigadier.suggestion.Suggestions;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;

/**
 * Syntax checking and completion of one command against a Brigadier tree, independent of the game client so it can
 * be tested on a plain dispatcher. Never executes anything: only {@code parse} and {@code getCompletionSuggestions}.
 * An optional leading {@code /} is accepted and kept; reported offsets are into the original text.
 */
final class CommandAssistLogic {
    /** Longest command a command block stores. */
    static final int MAX_LENGTH = 32767;

    static final int MAX_SUGGESTIONS = 80;

    enum Status {
        OK,
        ERROR,
        INCOMPLETE,
        EMPTY,
        UNCHECKED
    }

    /**
     * {@code start} is where the problem is (or -1), into the original text. {@code reason} explains UNCHECKED:
     * {@code too_long}, {@code unknown_root} (no such root node: missing, or not sent because of permissions).
     */
    record Check(Status status, String message, int start, String reason, String root) {}

    record Hint(String text, int from, int to, String tooltip) {}

    private CommandAssistLogic() {}

    /** Characters skipped before parsing: one optional slash, as the chat and command blocks accept. */
    static int offset(String text) {
        return text.startsWith("/") ? 1 : 0;
    }

    static <S> Check check(
            CommandDispatcher<S> dispatcher,
            S source,
            String text,
            Function<CommandSyntaxException, String> messages,
            String incompleteMessage) {
        if (text.length() > MAX_LENGTH) return new Check(Status.UNCHECKED, "", -1, "too_long", null);
        int offset = offset(text);
        String command = text.substring(offset);
        if (command.isBlank()) return new Check(Status.EMPTY, "", -1, null, null);
        String root = rootLiteral(command);
        if (dispatcher.getRoot().getChild(root) == null)
            return new Check(Status.UNCHECKED, "", offset, "unknown_root", root);
        ParseResults<S> parse = dispatcher.parse(new StringReader(command), source);
        CommandSyntaxException error = parseException(parse);
        if (error != null) {
            int cursor = error.getCursor() < 0 ? -1 : offset + Math.min(error.getCursor(), command.length());
            return new Check(Status.ERROR, messages.apply(error), cursor, null, root);
        }
        CommandContextBuilder<S> last = parse.getContext().getLastChild();
        if (last.getCommand() == null)
            return new Check(Status.INCOMPLETE, incompleteMessage, text.length(), null, root);
        return new Check(Status.OK, "", -1, null, root);
    }

    /**
     * The parse error as the game's own command screens see it: an argument's own failure when exactly one is known,
     * otherwise unknown command/argument at the unread position. Mirrors {@code Commands.getParseException} without
     * needing the game's command classes.
     */
    static <S> CommandSyntaxException parseException(ParseResults<S> parse) {
        if (!parse.getReader().canRead()) return null;
        if (parse.getExceptions().size() == 1)
            return parse.getExceptions().values().iterator().next();
        return parse.getContext().getRange().isEmpty()
                ? CommandSyntaxException.BUILT_IN_EXCEPTIONS
                        .dispatcherUnknownCommand()
                        .createWithContext(parse.getReader())
                : CommandSyntaxException.BUILT_IN_EXCEPTIONS
                        .dispatcherUnknownArgument()
                        .createWithContext(parse.getReader());
    }

    static String rootLiteral(String command) {
        int space = command.indexOf(' ');
        return space < 0 ? command : command.substring(0, space);
    }

    /**
     * Completions at {@code cursor} (an index into the original text). Brigadier may complete asynchronously when a
     * suggestion provider does; ranges in the result are into the original text.
     */
    static <S> CompletableFuture<List<Hint>> suggest(
            CommandDispatcher<S> dispatcher,
            S source,
            String text,
            int cursor,
            Function<com.mojang.brigadier.Message, String> tooltips) {
        if (text.length() > MAX_LENGTH) return CompletableFuture.completedFuture(List.of());
        int offset = offset(text);
        String command = text.substring(offset);
        int at = Math.max(0, Math.min(command.length(), cursor - offset));
        ParseResults<S> parse = dispatcher.parse(new StringReader(command), source);
        return dispatcher.getCompletionSuggestions(parse, at).thenApply(s -> hints(s, offset, tooltips));
    }

    static List<Hint> hints(
            Suggestions suggestions, int offset, Function<com.mojang.brigadier.Message, String> tooltips) {
        List<Hint> out = new ArrayList<>();
        for (Suggestion s : suggestions.getList()) {
            if (out.size() >= MAX_SUGGESTIONS) break;
            String tooltip = s.getTooltip() == null ? null : tooltips.apply(s.getTooltip());
            out.add(new Hint(
                    s.getText(),
                    offset + s.getRange().getStart(),
                    offset + s.getRange().getEnd(),
                    tooltip));
        }
        return out;
    }
}
