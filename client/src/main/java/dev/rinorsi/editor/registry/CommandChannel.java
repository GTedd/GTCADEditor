package dev.rinorsi.editor.registry;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.Suggestions;
import dev.oriel.mod.client.DocumentDriver;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.platform.ClientPlatform;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.WeakHashMap;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.ClientSuggestionProvider;
import net.minecraft.network.chat.ComponentUtils;

/**
 * Command syntax checks and completions for command text fields (message {@code command_assist}, reply
 * {@code command_assist.result}), against the command tree the server sent this player (so permissions apply).
 * Commands are never executed. By default nothing is sent to the server: argument suggestions that only the server
 * can answer ({@code ask_server}) are skipped and reported; only a request with {@code server:true}, which the page
 * sends on an explicit click, uses the connection's own provider and may send the command text for completion.
 */
public final class CommandChannel {
    private static final Map<DocumentDriver, State> STATES = new WeakHashMap<>();
    private static final long SUGGEST_TIMEOUT_NS = 4_000_000_000L;
    private static boolean initialized;
    private static LocalSuggestions local;

    private static final class State {
        Object document;
        long second;
        int requests;
        final LinkedHashMap<String, Pending> views = new LinkedHashMap<>();
        final LinkedHashMap<String, Waiting> waiting = new LinkedHashMap<>();
    }

    private record Pending(String id, String op, String text, int cursor, boolean server, Object level) {}

    private record Waiting(
            String id,
            CompletableFuture<List<CommandAssistLogic.Hint>> future,
            boolean server,
            boolean[] skipped,
            long started) {}

    /**
     * The connection's own provider, except that server-answered suggestions are skipped instead of sent. One per
     * connection; its permissions are the connection's.
     */
    private static final class LocalSuggestions extends ClientSuggestionProvider {
        final ClientPacketListener connection;
        boolean skipped;

        LocalSuggestions(ClientPacketListener connection, Minecraft minecraft) {
            super(connection, minecraft, connection.getSuggestionsProvider().permissions());
            this.connection = connection;
        }

        @Override
        public CompletableFuture<Suggestions> customSuggestion(CommandContext<?> context) {
            skipped = true;
            return Suggestions.empty();
        }
    }

    private CommandChannel() {}

    public static void attach(DocumentDriver driver) {
        if (driver.serverSession() || STATES.containsKey(driver)) return;
        STATES.put(driver, new State());
        driver.onMessage("command_assist", value -> accept(driver, value));
        driver.onClose(() -> STATES.remove(driver));
        if (!initialized) {
            initialized = true;
            ClientPlatform.get().onTick(mc -> tick());
        }
    }

    private static void accept(DocumentDriver driver, JsonElement value) {
        var mc = Minecraft.getInstance();
        if (!mc.isSameThread()) {
            mc.execute(() -> accept(driver, value));
            return;
        }
        State state = STATES.get(driver);
        if (state == null || driver.serverSession()) return;
        if (state.document != driver.document()) {
            state.document = driver.document();
            state.views.clear();
            state.waiting.clear();
            state.requests = 0;
        }
        String id = "";
        try {
            if (value == null || !value.isJsonObject() || value.toString().length() > 72_000)
                throw new IllegalArgumentException("BAD_REQUEST");
            JsonObject request = value.getAsJsonObject();
            id = text(request, "requestId", null, 128);
            String view = text(request, "view", "command", 128);
            String op = text(request, "op", "check", 16);
            if (id == null || id.isEmpty() || view.isEmpty() || !(op.equals("check") || op.equals("suggest")))
                throw new IllegalArgumentException("BAD_REQUEST");
            if (!state.views.containsKey(view) && state.views.size() >= 8) {
                error(driver, id, op, "BUSY", EditorI18n.tr("cadeditor.message.commandchannel.too_many_views"));
                return;
            }
            long second = System.nanoTime() / 1_000_000_000L;
            if (state.second != second) {
                state.second = second;
                state.requests = 0;
            }
            // The newest request of a view replaces its queued and in-flight predecessors.
            state.views.remove(view);
            state.waiting.remove(view);
            if (request.has("cancel")
                    && request.get("cancel").isJsonPrimitive()
                    && request.get("cancel").getAsBoolean()) return;
            if (++state.requests > 20) {
                error(driver, id, op, "BUSY", EditorI18n.tr("cadeditor.message.commandchannel.rate_limited"));
                return;
            }
            String text = text(request, "text", "", CommandAssistLogic.MAX_LENGTH + 1);
            int cursor = text.length();
            if (request.has("cursor")) {
                if (!request.get("cursor").isJsonPrimitive()
                        || !request.getAsJsonPrimitive("cursor").isNumber())
                    throw new IllegalArgumentException("BAD_REQUEST");
                cursor = Math.max(
                        0, Math.min(text.length(), request.get("cursor").getAsInt()));
            }
            boolean server = request.has("server")
                    && request.get("server").isJsonPrimitive()
                    && request.get("server").getAsBoolean();
            state.views.put(view, new Pending(id, op, text, cursor, server, mc.level));
        } catch (RuntimeException invalid) {
            error(driver, id, "check", "BAD_REQUEST", EditorI18n.tr("cadeditor.message.commandchannel.bad_request"));
        }
    }

    private static String text(JsonObject request, String name, String fallback, int max) {
        if (!request.has(name) || request.get(name).isJsonNull()) return fallback;
        JsonElement e = request.get(name);
        if (!e.isJsonPrimitive()
                || !e.getAsJsonPrimitive().isString()
                || e.getAsString().length() > max) throw new IllegalArgumentException("BAD_REQUEST");
        return e.getAsString();
    }

    private static LocalSuggestions local(Minecraft mc, ClientPacketListener connection) {
        if (local == null || local.connection != connection) local = new LocalSuggestions(connection, mc);
        return local;
    }

    private static void tick() {
        var mc = Minecraft.getInstance();
        if (mc.getConnection() == null) local = null;
        int handled = 0;
        for (var entry : List.copyOf(STATES.entrySet())) {
            var driver = entry.getKey();
            var state = entry.getValue();
            if (STATES.get(driver) != state) continue;
            if (state.document != driver.document()) {
                state.views.clear();
                state.waiting.clear();
                state.document = driver.document();
                state.requests = 0;
                continue;
            }
            finishWaiting(driver, state);
            for (var view : new ArrayList<>(state.views.entrySet())) {
                Pending pending = view.getValue();
                if (pending == null) continue;
                if (handled >= 2) return;
                handled++;
                state.views.remove(view.getKey());
                ClientPacketListener connection = mc.getConnection();
                if (connection == null || mc.level == null || mc.level != pending.level()) {
                    unchecked(driver, pending, "offline");
                    continue;
                }
                try {
                    if (pending.op().equals("check")) check(driver, mc, connection, pending);
                    else suggest(driver, state, view.getKey(), mc, connection, pending);
                } catch (RuntimeException | StackOverflowError failure) {
                    // A broken argument parser never takes the page down: report the text as not checkable.
                    unchecked(driver, pending, "failed");
                }
            }
        }
    }

    private static void check(DocumentDriver driver, Minecraft mc, ClientPacketListener connection, Pending pending) {
        var result = CommandAssistLogic.check(
                connection.getCommands(),
                local(mc, connection),
                pending.text(),
                error -> ComponentUtils.fromMessage(error.getRawMessage()).getString(),
                EditorI18n.tr("cadeditor.message.commandchannel.incomplete"));
        JsonObject out = base(pending.id(), "check");
        out.addProperty("ok", true);
        out.addProperty("status", result.status().name().toLowerCase(java.util.Locale.ROOT));
        out.addProperty("message", result.message());
        out.addProperty("start", result.start());
        if (result.reason() != null) out.addProperty("reason", result.reason());
        if (result.root() != null) out.addProperty("root", result.root());
        driver.patchJson("command_assist.result", out.toString());
    }

    private static void suggest(
            DocumentDriver driver,
            State state,
            String view,
            Minecraft mc,
            ClientPacketListener connection,
            Pending pending) {
        if (pending.text().length() > CommandAssistLogic.MAX_LENGTH) {
            unchecked(driver, pending, "too_long");
            return;
        }
        boolean[] skipped = {false};
        CompletableFuture<List<CommandAssistLogic.Hint>> future;
        if (pending.server()) {
            // Explicit request only: the vanilla provider may send this command text to the server for completion.
            future = CommandAssistLogic.suggest(
                    connection.getCommands(),
                    connection.getSuggestionsProvider(),
                    pending.text(),
                    pending.cursor(),
                    message -> ComponentUtils.fromMessage(message).getString());
        } else {
            LocalSuggestions source = local(mc, connection);
            source.skipped = false;
            future = CommandAssistLogic.suggest(
                    connection.getCommands(),
                    source,
                    pending.text(),
                    pending.cursor(),
                    message -> ComponentUtils.fromMessage(message).getString());
            skipped[0] = source.skipped;
        }
        state.waiting.put(view, new Waiting(pending.id(), future, pending.server(), skipped, System.nanoTime()));
        finishWaiting(driver, state);
    }

    private static void finishWaiting(DocumentDriver driver, State state) {
        for (var entry : new ArrayList<>(state.waiting.entrySet())) {
            Waiting waiting = entry.getValue();
            boolean late = System.nanoTime() - waiting.started() > SUGGEST_TIMEOUT_NS;
            if (!waiting.future().isDone() && !late) continue;
            state.waiting.remove(entry.getKey());
            JsonObject out = base(waiting.id(), "suggest");
            List<CommandAssistLogic.Hint> hints;
            try {
                hints = waiting.future().isDone() && !waiting.future().isCompletedExceptionally()
                        ? waiting.future().getNow(List.of())
                        : null;
            } catch (RuntimeException failed) {
                hints = null;
            }
            if (hints == null) {
                waiting.future().cancel(false);
                out.addProperty("ok", false);
                out.addProperty("error", late ? "TIMEOUT" : "FAILED");
                out.addProperty("reason", EditorI18n.tr("cadeditor.message.commandchannel.suggest_failed"));
            } else {
                out.addProperty("ok", true);
                JsonArray rows = new JsonArray();
                for (var hint : hints) {
                    JsonObject row = new JsonObject();
                    row.addProperty("text", hint.text());
                    row.addProperty("from", hint.from());
                    row.addProperty("to", hint.to());
                    if (hint.tooltip() != null && !hint.tooltip().isEmpty())
                        row.addProperty(
                                "tooltip",
                                hint.tooltip()
                                        .substring(
                                                0, Math.min(256, hint.tooltip().length())));
                    rows.add(row);
                }
                out.add("suggestions", rows);
                out.addProperty("server", waiting.server());
                out.addProperty("askServer", waiting.skipped()[0]);
            }
            driver.patchJson("command_assist.result", out.toString());
        }
    }

    private static void unchecked(DocumentDriver driver, Pending pending, String reason) {
        JsonObject out = base(pending.id(), pending.op());
        out.addProperty("ok", true);
        out.addProperty("status", "unchecked");
        out.addProperty("reason", reason);
        out.addProperty("start", -1);
        if (pending.op().equals("suggest")) out.add("suggestions", new JsonArray());
        driver.patch("command_assist.result", out);
    }

    private static JsonObject base(String id, String op) {
        JsonObject out = new JsonObject();
        out.addProperty("version", 1);
        out.addProperty("requestId", id);
        out.addProperty("op", op);
        return out;
    }

    private static void error(DocumentDriver driver, String id, String op, String code, String reason) {
        JsonObject out = base(id, op);
        out.addProperty("ok", false);
        out.addProperty("error", code);
        out.addProperty("reason", reason);
        driver.patch("command_assist.result", out);
    }
}
