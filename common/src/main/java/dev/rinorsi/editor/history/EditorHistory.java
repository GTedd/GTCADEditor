package dev.rinorsi.editor.history;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.rinorsi.editor.EditorPermission;
import dev.rinorsi.editor.EditorPolicy;
import dev.rinorsi.editor.platform.Platform;
import java.io.IOException;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.Permissions;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The server's edit history: one record per request plus the history's own changes. A request's record is built at
 * the single entry point (EditorMod) from the request, the reply and {@link HistoryContext}.
 */
public final class EditorHistory {
    private static final Logger LOG = LoggerFactory.getLogger("cadeditor.history");
    /** Rejection codes that mean "not permitted" (outcome denied) rather than "invalid" (outcome rejected). */
    public static final Set<String> DENIAL_CODES =
            Set.of("permission_denied", "not_allowed", "player_forbidden", "forged_privilege", "item_restricted");

    private static final ThreadLocal<Scope> SCOPE = new ThreadLocal<>();
    private static final FloodGuard FLOOD = new FloodGuard(30, 60_000L, EditorHistory::add);
    private static volatile @Nullable HistoryStore store;
    private static volatile HistorySettings settings = HistorySettings.DEFAULT;

    private EditorHistory() {}

    /** Who acts: a player, or the console/RCON (and other non-player command sources at owner level). */
    public record Actor(String id, String name, @Nullable ServerPlayer player, boolean console) {
        public static Actor of(ServerPlayer player) {
            return new Actor(player.getStringUUID(), player.getGameProfile().name(), player, false);
        }

        public static Actor of(CommandSourceStack source) {
            if (source.getEntity() instanceof ServerPlayer player) return of(player);
            return new Actor(
                    "console",
                    source.getTextName(),
                    null,
                    source.permissions().hasPermission(Permissions.COMMANDS_OWNER));
        }

        public boolean can(EditorPermission permission) {
            return player != null ? EditorPolicy.current().allowed(player, permission) : console;
        }
    }

    // ---- Lifecycle ----

    public static void start(MinecraftServer server, HistorySettings newSettings) {
        stop();
        settings = newSettings;
        if (!newSettings.enabled()) {
            LOG.info("[CAD-Editor-History] disabled in cadeditor.json");
            return;
        }
        var directory = Platform.get().historyDir(server);
        try {
            store = HistoryStore.open(directory, newSettings, System::currentTimeMillis);
        } catch (IOException | RuntimeException e) {
            // The editor keeps working; the console shows why nothing is recorded.
            LOG.error("[CAD-Editor-History] cannot open {}; history is off until the next start", directory, e);
        }
    }

    public static void stop() {
        if (store != null) FLOOD.flush();
        var current = store;
        store = null;
        if (current != null) current.close();
    }

    public static boolean enabled() {
        return store != null;
    }

    /** The number of records kept, or -1 when the history is off. */
    public static int size() {
        var current = store;
        return current == null ? -1 : current.size();
    }

    /** For tests: use this store (or none). */
    public static void useStore(@Nullable HistoryStore newStore, HistorySettings newSettings) {
        store = newStore;
        settings = newSettings;
    }

    // ---- Request records ----

    /** The record scope of one request; {@link Scope#close()} writes its record. */
    public static Scope begin(ServerPlayer player, int payloadChars) {
        var scope = new Scope(player, payloadChars, HistoryContext.begin());
        SCOPE.set(scope);
        return scope;
    }

    /** Called with every reply the server sends while a request scope is open (the last one decides the outcome). */
    public static void observe(JsonObject reply) {
        var scope = SCOPE.get();
        if (scope != null) scope.reply = reply.deepCopy();
    }

    public static final class Scope implements AutoCloseable {
        private final ServerPlayer player;
        private int payloadChars;
        private final HistoryContext context;
        private @Nullable JsonObject request;
        private @Nullable JsonObject reply;
        private boolean forged;

        private Scope(ServerPlayer player, int payloadChars, HistoryContext context) {
            this.player = player;
            this.payloadChars = payloadChars;
            this.context = context;
        }

        public void request(JsonObject decoded) {
            request = decoded;
        }

        /** The size of the complete request (after a multi-part transfer was assembled). */
        public void payload(int chars) {
            payloadChars = chars;
        }

        /** The request claimed privileges a client cannot have; recorded with the tag "forged". */
        public void forged() {
            forged = true;
        }

        @Override
        public void close() {
            SCOPE.remove();
            HistoryContext.end();
            try {
                var actor = Actor.of(player);
                var draft = RequestRecords.draft(actor, request, reply, context, payloadChars, forged, settings);
                if (draft != null && FLOOD.admit(actor, draft, System.currentTimeMillis())) add(draft);
            } catch (RuntimeException e) {
                LOG.warn("[CAD-Editor-History] could not record a request of {}", player.getScoreboardName(), e);
            }
        }
    }

    // ---- Management (each checks the actor's nodes) ----

    public static HistoryStore.Page list(Actor actor, HistoryQuery query, int page, int size) {
        var history = require();
        if (actor.can(EditorPermission.HISTORY_VIEW)) return history.query(query, page, size);
        if (actor.can(EditorPermission.HISTORY_OWN)) return history.query(query.withActor(actor.id()), page, size);
        throw denied(EditorPermission.HISTORY_VIEW);
    }

    public static Optional<HistoryRecord> get(Actor actor, long id) {
        var record = require().get(id);
        if (actor.can(EditorPermission.HISTORY_VIEW)) return record;
        if (actor.can(EditorPermission.HISTORY_OWN)) return record.filter(r -> r.actorId.equals(actor.id()));
        throw denied(EditorPermission.HISTORY_VIEW);
    }

    /** A manual record (outcome "note"), e.g. why the server owner changed something by hand. */
    public static HistoryRecord addNote(Actor actor, String target, String note, List<String> tags) {
        requireNode(actor, EditorPermission.HISTORY_EDIT);
        if (HistoryRecord.note(note).isBlank()) throw new IllegalArgumentException("a manual record needs a note");
        return require()
                .add(HistoryRecord.draft(
                        actor.id(), actor.name(), "history.add", target, "note", "", "", "", null, note, tags));
    }

    /** Changes a record's note and/or tags; the change is itself recorded. */
    public static HistoryRecord edit(Actor actor, long id, @Nullable String note, @Nullable List<String> tags) {
        requireNode(actor, EditorPermission.HISTORY_EDIT);
        var history = require();
        var before = history.get(id).orElseThrow(() -> new IllegalArgumentException("no record #" + id));
        String oldNote = before.note();
        List<String> oldTags = before.tags();
        var record = history.edit(id, note, tags, actor.name() + " (" + actor.id() + ")");
        var detail = new JsonObject();
        detail.addProperty("record", id);
        if (note != null && !note.equals(oldNote)) detail.addProperty("note_before", oldNote);
        if (tags != null && !record.tags().equals(oldTags))
            detail.addProperty("tags_before", String.join(",", oldTags));
        history.add(HistoryRecord.draft(
                actor.id(), actor.name(), "history.edit", "#" + id, "ok", "", "", "", detail, "", List.of()));
        return record;
    }

    public static List<Long> delete(Actor actor, Collection<Long> ids) {
        requireNode(actor, EditorPermission.HISTORY_DELETE);
        if (ids.isEmpty() || ids.size() > 100) throw new IllegalArgumentException("delete 1-100 records at a time");
        var history = require();
        var removed = history.delete(ids, actor.name() + " (" + actor.id() + ")");
        if (!removed.isEmpty())
            history.add(HistoryRecord.draft(
                    actor.id(),
                    actor.name(),
                    "history.delete",
                    ids(removed),
                    "ok",
                    "",
                    "",
                    "",
                    count(removed.size(), null),
                    "",
                    List.of()));
        return removed;
    }

    public static List<Long> purge(Actor actor, HistoryQuery query) {
        requireNode(actor, EditorPermission.HISTORY_DELETE);
        var history = require();
        var removed = history.purge(query, actor.name() + " (" + actor.id() + ")");
        history.add(HistoryRecord.draft(
                actor.id(),
                actor.name(),
                "history.purge",
                ids(removed),
                "ok",
                "",
                "",
                "",
                count(removed.size(), query.toJson()),
                "",
                List.of()));
        return removed;
    }

    /** Records an event that did not come through the editor channel (commands such as /cadeditor testkit). */
    public static void record(
            Actor actor, String action, String target, String outcome, String code, @Nullable JsonObject detail) {
        if (store == null) return;
        try {
            add(HistoryRecord.draft(
                    actor.id(), actor.name(), action, target, outcome, code, "", "", detail, "", List.of()));
        } catch (RuntimeException e) {
            LOG.warn("[CAD-Editor-History] could not record {}", action, e);
        }
    }

    /** A refused history action (add/edit/delete/purge without the node): recorded, within the flood limit. */
    public static void recordDenied(Actor actor, String action, String target, String node) {
        if (store == null) return;
        try {
            var draft = HistoryRecord.draft(
                    actor.id(),
                    actor.name(),
                    action,
                    target,
                    "denied",
                    "permission_denied",
                    node,
                    "",
                    null,
                    "",
                    List.of());
            if (FLOOD.admit(actor, draft, System.currentTimeMillis())) add(draft);
        } catch (RuntimeException e) {
            LOG.warn("[CAD-Editor-History] could not record {}", action, e);
        }
    }

    private static void add(HistoryRecord draft) {
        var history = store;
        if (history != null) history.add(draft);
    }

    private static HistoryStore require() {
        var history = store;
        if (history == null) throw new HistoryUnavailable();
        return history;
    }

    private static void requireNode(Actor actor, EditorPermission permission) {
        if (!actor.can(permission)) throw denied(permission);
    }

    private static HistoryDenied denied(EditorPermission permission) {
        return new HistoryDenied(permission.node);
    }

    private static String ids(List<Long> ids) {
        var text = new StringBuilder();
        for (long id : ids) {
            if (text.length() > 150) return text.append(" …").toString();
            text.append(text.isEmpty() ? "#" : ", #").append(id);
        }
        return text.toString();
    }

    private static JsonObject count(int count, @Nullable JsonElement filter) {
        var detail = new JsonObject();
        detail.addProperty("count", count);
        if (filter != null) detail.add("filter", filter);
        return detail;
    }

    /** The actor lacks a history node. */
    public static final class HistoryDenied extends RuntimeException {
        public final String node;

        HistoryDenied(String node) {
            super(node);
            this.node = node;
        }
    }

    /** History is disabled or could not be opened. */
    public static final class HistoryUnavailable extends RuntimeException {
        HistoryUnavailable() {
            super("history is not available");
        }
    }

    static JsonArray array(List<String> values) {
        var array = new JsonArray();
        values.forEach(array::add);
        return array;
    }
}
