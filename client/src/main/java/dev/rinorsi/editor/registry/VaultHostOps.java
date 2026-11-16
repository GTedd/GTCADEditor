package dev.rinorsi.editor.registry;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.oriel.mod.client.DocumentDriver;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.vault.*;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import net.minecraft.client.Minecraft;

/**
 * Vault operations that need the host rather than the store alone: imports (native file dialog, other mods' fixed
 * files, the vanilla hotbar) and the rotating backups. File IO and DataFixer run on one background thread; registry
 * decoding happens on the client tick with a per-tick budget; the page only receives result windows and never names a
 * path (backups are named by file name only, and checked against the backup directory).
 */
final class VaultHostOps {
    private VaultHostOps() {}

    static final Set<String> OPS = Set.of(
            "import_scan",
            "import_open",
            "import_preview",
            "import_commit",
            "import_cancel",
            "backups",
            "backup_now",
            "backup_restore");

    private static final ExecutorService IO = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "cadeditor-vault-io");
        t.setDaemon(true);
        return t;
    });
    private static final int DECODE_PER_TICK = 48, PREVIEW_CHARS = 20000;
    private static final long SESSION_MS = 10 * 60 * 1000;

    /** A parsed source waiting to be decoded on the client thread, or still being read. */
    private static final class Job {
        DocumentDriver driver;
        Object document, level;
        String requestId, source;
        VaultImports.Source read;
        final List<VaultImports.Row> rows = new ArrayList<>();
    }

    private static final class Session {
        String token, source;
        Object document;
        List<String> groups;
        List<VaultImports.Row> rows;
        boolean[] duplicate;
        long until;
    }

    private static final Map<DocumentDriver, Job> JOBS = new WeakHashMap<>();
    private static final Map<DocumentDriver, Session> SESSIONS = new WeakHashMap<>();

    static boolean handles(String op) {
        return OPS.contains(op);
    }

    static VaultStore.Upgrader upgrader() {
        var level = Minecraft.getInstance().level;
        return level == null ? null : VaultUpgrade.upgrader(level.registryAccess(), currentVersion());
    }

    private static int currentVersion() {
        return net.minecraft.SharedConstants.getCurrentVersion().dataVersion().version();
    }

    private static Path gameDir() {
        return Minecraft.getInstance().gameDirectory.toPath();
    }

    /** A reply now, or null when it is delivered later through {@link #deliver}. */
    static JsonObject reply(DocumentDriver driver, JsonObject r, VaultStore store) {
        String op = VaultStore.text(r, "op", "", 32);
        String requestId = VaultStore.text(r, "requestId", "", 128);
        Object document = driver.document();
        switch (op) {
            case "import_scan" -> {
                Path dir = gameDir();
                boolean world = Minecraft.getInstance().level != null;
                async(driver, document, requestId, op, store, () -> {
                    JsonObject out = new JsonObject();
                    out.add("sources", VaultImports.scan(dir));
                    out.addProperty("world", world);
                    return out;
                });
                return null;
            }
            case "import_open" -> {
                open(driver, document, requestId, VaultStore.text(r, "source", "", 16), store);
                return null;
            }
            case "import_preview" -> {
                return store.decorate(preview(session(driver, r), r), op, requestId);
            }
            case "import_commit" -> {
                return store.decorate(commit(driver, session(driver, r), r, store), op, requestId);
            }
            case "import_cancel" -> {
                Session s = SESSIONS.get(driver);
                if (s != null && s.token.equals(VaultStore.text(r, "token", "", 36))) SESSIONS.remove(driver);
                return store.decorate(new JsonObject(), op, requestId);
            }
            case "backups" -> {
                async(driver, document, requestId, op, store, () -> {
                    JsonObject out = new JsonObject();
                    out.add("backups", store.listBackups());
                    out.addProperty("maxBackups", VaultBackups.MAX_FILES);
                    return out;
                });
                return null;
            }
            case "backup_now" -> {
                store.backupNow()
                        .whenComplete((name, failure) -> Minecraft.getInstance().execute(() -> {
                            if (failure != null) {
                                deliverError(driver, document, requestId, op, failure);
                                return;
                            }
                            JsonObject out = new JsonObject();
                            out.addProperty("name", name);
                            deliver(driver, document, store.decorate(out, op, requestId));
                        }));
                return null;
            }
            case "backup_restore" -> {
                if (!r.has("confirm")
                        || !r.get("confirm").isJsonPrimitive()
                        || !r.get("confirm").getAsBoolean())
                    throw new VaultStore.Failure(
                            "BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaulthostops.restore_needs_confirm"));
                String name = VaultStore.text(r, "name", "", 128);
                IO.execute(() -> {
                    try {
                        var loaded = store.readBackup(name);
                        Minecraft.getInstance().execute(() -> {
                            try {
                                deliver(driver, document, store.decorate(store.restoreBackup(loaded), op, requestId));
                            } catch (RuntimeException failure) {
                                deliverError(driver, document, requestId, op, failure);
                            }
                        });
                    } catch (Exception failure) {
                        Minecraft.getInstance().execute(() -> deliverError(driver, document, requestId, op, failure));
                    }
                });
                return null;
            }
            default ->
                throw new VaultStore.Failure(
                        "UNKNOWN_OP", EditorI18n.tr("cadeditor.message.vaultstore.unknown_vault_operation"));
        }
    }

    @FunctionalInterface
    private interface Work {
        JsonObject run() throws Exception;
    }

    private static void async(
            DocumentDriver driver, Object document, String requestId, String op, VaultStore store, Work work) {
        IO.execute(() -> {
            try {
                JsonObject out = work.run();
                Minecraft.getInstance().execute(() -> deliver(driver, document, store.decorate(out, op, requestId)));
            } catch (Exception failure) {
                Minecraft.getInstance().execute(() -> deliverError(driver, document, requestId, op, failure));
            }
        });
    }

    /** Late replies only reach the page that asked, while it still shows the same document. */
    private static void deliver(DocumentDriver driver, Object document, JsonObject out) {
        if (!VaultChannel.live(driver) || driver.document() != document) return;
        driver.patchJson("vault.result", out.toString());
    }

    private static void deliverError(
            DocumentDriver driver, Object document, String requestId, String op, Throwable failure) {
        Throwable cause =
                failure instanceof CompletionException && failure.getCause() != null ? failure.getCause() : failure;
        JsonObject out = new JsonObject();
        out.addProperty("version", 1);
        out.addProperty("requestId", requestId);
        out.addProperty("op", op);
        out.addProperty("ok", false);
        out.addProperty("error", cause instanceof VaultStore.Failure f ? f.code : "STORAGE_FAILED");
        String reason = cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage();
        out.addProperty("reason", VaultStore.clip(reason, 512));
        deliver(driver, document, out);
    }

    // ---------------------------------------------------------------- import

    private static void open(
            DocumentDriver driver, Object document, String requestId, String source, VaultStore store) {
        var mc = Minecraft.getInstance();
        if (mc.level == null)
            throw new VaultStore.Failure(
                    "UNAVAILABLE", EditorI18n.tr("cadeditor.message.vaulthostops.import_needs_world"));
        if (!Set.of("file", "nbteditor", "librarian", "hotbar").contains(source))
            throw new VaultStore.Failure("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaulthostops.unknown_source"));
        if (JOBS.containsKey(driver) || VaultFileDialog.open())
            throw new VaultStore.Failure("BUSY", EditorI18n.tr("cadeditor.message.vaulthostops.import_busy"));
        Job job = new Job();
        job.driver = driver;
        job.document = document;
        job.level = mc.level;
        job.requestId = requestId;
        job.source = source;
        JOBS.put(driver, job);
        Path dir = gameDir();
        int current = currentVersion();
        if (source.equals("file")) {
            try {
                VaultFileDialog.pick(dir, picked -> {
                    if (picked.error() != null || picked.path().isEmpty()) {
                        JOBS.remove(driver);
                        deliverError(
                                driver,
                                document,
                                requestId,
                                "import_open",
                                picked.error() != null
                                        ? new VaultStore.Failure(
                                                "UNAVAILABLE",
                                                EditorI18n.tr(
                                                        "cadeditor.message.vaultfiledialog.unavailable",
                                                        VaultStore.clip(picked.error(), 200)))
                                        : new VaultStore.Failure(
                                                "CANCELLED",
                                                EditorI18n.tr("cadeditor.message.vaulthostops.cancelled")));
                        return;
                    }
                    Path file = picked.path().get();
                    read(job, () -> VaultImports.readFile(file, VaultImports.Limits.DEFAULT, current));
                });
            } catch (RuntimeException failure) {
                JOBS.remove(driver);
                throw failure;
            }
            return;
        }
        read(job, () -> switch (source) {
            case "nbteditor" -> VaultImports.readNbtEditor(dir, VaultImports.Limits.DEFAULT, current);
            case "librarian" -> VaultImports.readLibrarian(dir, VaultImports.Limits.DEFAULT, current);
            default -> VaultImports.readHotbar(dir, VaultImports.Limits.DEFAULT, current);
        });
    }

    @FunctionalInterface
    private interface Reader {
        VaultImports.Source read() throws Exception;
    }

    private static void read(Job job, Reader reader) {
        IO.execute(() -> {
            try {
                var source = reader.read();
                Minecraft.getInstance().execute(() -> job.read = source);
            } catch (Exception failure) {
                Minecraft.getInstance().execute(() -> {
                    JOBS.remove(job.driver, job);
                    deliverError(job.driver, job.document, job.requestId, "import_open", failure);
                });
            }
        });
    }

    /** Client tick: native dialog results, then a bounded slice of registry decoding per job. */
    static void tick(VaultStore store) {
        VaultFileDialog.poll();
        long now = System.currentTimeMillis();
        SESSIONS.values().removeIf(s -> now > s.until);
        if (store == null) return;
        var mc = Minecraft.getInstance();
        for (Job job : List.copyOf(JOBS.values())) {
            if (job.read == null) continue;
            if (!VaultChannel.live(job.driver) || job.driver.document() != job.document) {
                JOBS.remove(job.driver, job);
                continue;
            }
            if (mc.level == null || mc.level != job.level) {
                JOBS.remove(job.driver, job);
                deliverError(
                        job.driver,
                        job.document,
                        job.requestId,
                        "import_open",
                        new VaultStore.Failure(
                                "UNAVAILABLE", EditorI18n.tr("cadeditor.message.vaulthostops.world_changed")));
                continue;
            }
            var access = mc.level.registryAccess();
            int current = currentVersion();
            var items = job.read.items();
            for (int n = 0; n < DECODE_PER_TICK && job.rows.size() < items.size(); n++)
                job.rows.add(VaultImports.prepare(items.get(job.rows.size()), access, current));
            if (job.rows.size() < items.size()) continue;
            JOBS.remove(job.driver, job);
            deliver(job.driver, job.document, store.decorate(finish(job, store), "import_open", job.requestId));
        }
    }

    private static JsonObject finish(Job job, VaultStore store) {
        Session s = new Session();
        s.token = UUID.randomUUID().toString();
        s.source = job.source;
        s.document = job.document;
        s.groups = job.read.groups();
        s.rows = List.copyOf(job.rows);
        s.duplicate = new boolean[s.rows.size()];
        s.until = System.currentTimeMillis() + SESSION_MS;
        Set<String> seen = store.itemHashes();
        int valid = 0, kept = 0, invalid = 0, duplicates = 0;
        int[] perGroup = new int[s.groups.size()];
        for (int i = 0; i < s.rows.size(); i++) {
            var row = s.rows.get(i);
            if (row.group() >= 0 && row.group() < perGroup.length) perGroup[row.group()]++;
            if (row.prepared() == null) invalid++;
            else if (row.prepared().reason() != null) kept++;
            else valid++;
            if (row.hash() != null && !seen.add(row.hash())) {
                s.duplicate[i] = true;
                duplicates++;
            }
        }
        SESSIONS.put(job.driver, s);
        JsonObject out = new JsonObject();
        out.addProperty("token", s.token);
        out.addProperty("source", s.source);
        out.addProperty("total", s.rows.size());
        out.addProperty("valid", valid);
        out.addProperty("kept", kept);
        out.addProperty("invalid", invalid);
        out.addProperty("duplicates", duplicates);
        JsonArray groups = new JsonArray();
        for (int g = 0; g < s.groups.size() && groups.size() < 100; g++) {
            if (perGroup[g] == 0) continue;
            JsonObject o = new JsonObject();
            o.addProperty("index", g);
            o.addProperty("label", s.groups.get(g));
            o.addProperty("count", perGroup[g]);
            groups.add(o);
        }
        out.add("groups", groups);
        JsonArray warnings = new JsonArray();
        job.read.warnings().forEach(warnings::add);
        out.add("warnings", warnings);
        return out;
    }

    private static Session session(DocumentDriver driver, JsonObject r) {
        Session s = SESSIONS.get(driver);
        if (s == null || s.document != driver.document() || !s.token.equals(VaultStore.text(r, "token", "", 36)))
            throw new VaultStore.Failure(
                    "UPLOAD_EXPIRED", EditorI18n.tr("cadeditor.message.vaulthostops.preview_expired"));
        s.until = System.currentTimeMillis() + SESSION_MS;
        return s;
    }

    private static JsonObject preview(Session s, JsonObject r) {
        int offset = intField(r, "offset", 0, 0, s.rows.size()), limit = intField(r, "limit", 60, 1, 100);
        JsonArray rows = new JsonArray();
        int chars = 0, i = offset;
        for (; i < s.rows.size() && rows.size() < limit; i++) {
            var row = s.rows.get(i);
            JsonObject o = new JsonObject();
            o.addProperty("i", i);
            o.addProperty("g", row.group());
            o.addProperty("kind", row.kind());
            o.addProperty("id", row.id());
            o.addProperty("count", row.count());
            o.addProperty("name", VaultStore.clip(row.name(), 120));
            o.addProperty("bytes", row.bytes());
            boolean ok = row.prepared() != null && row.prepared().reason() == null;
            o.addProperty("ok", ok);
            if (row.prepared() != null && row.prepared().reason() != null) {
                o.addProperty("kept", true);
                o.addProperty("reason", VaultStore.clip(row.prepared().reason(), 300));
            }
            if (row.prepared() == null) o.addProperty("reason", VaultStore.clip(row.error(), 300));
            if (s.duplicate[i]) o.addProperty("duplicate", true);
            int n = o.toString().length();
            if (chars + n > PREVIEW_CHARS) break;
            rows.add(o);
            chars += n;
        }
        JsonObject out = new JsonObject();
        out.addProperty("token", s.token);
        out.add("rows", rows);
        out.addProperty("total", s.rows.size());
        out.addProperty("offset", offset);
        out.addProperty("nextOffset", i);
        out.addProperty("done", i >= s.rows.size());
        return out;
    }

    /** {@code selected}: '1'/'0' per row (omitted: all); rows that cannot be imported are never sent. */
    private static JsonObject commit(DocumentDriver driver, Session s, JsonObject r, VaultStore store) {
        String selected = r.has("selected") ? VaultStore.text(r, "selected", "", s.rows.size()) : null;
        if (selected != null && (selected.length() != s.rows.size() || !selected.matches("[01]*")))
            throw new VaultStore.Failure(
                    "BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaulthostops.selection_invalid"));
        String dedupe = VaultStore.text(r, "dedupe", "skip", 8);
        if (!Set.of("skip", "keep").contains(dedupe))
            throw new VaultStore.Failure(
                    "BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaulthostops.selection_invalid"));
        List<List<VaultStore.Prepared>> perGroup = new ArrayList<>();
        List<List<Integer>> rowsOf = new ArrayList<>();
        for (int g = 0; g < s.groups.size(); g++) {
            perGroup.add(new ArrayList<>());
            rowsOf.add(new ArrayList<>());
        }
        int unselected = 0;
        for (int i = 0; i < s.rows.size(); i++) {
            var row = s.rows.get(i);
            if (row.prepared() == null || row.group() < 0 || row.group() >= perGroup.size()) continue;
            if (selected != null && selected.charAt(i) != '1') {
                unselected++;
                continue;
            }
            perGroup.get(row.group()).add(row.prepared());
            rowsOf.get(row.group()).add(i);
        }
        List<VaultStore.Batch> batches = new ArrayList<>();
        for (int g = 0; g < s.groups.size(); g++) batches.add(new VaultStore.Batch(s.groups.get(g), perGroup.get(g)));
        JsonObject out = store.importBatches(batches, dedupe.equals("skip"));
        // Map batch-relative errors back to the preview rows the page shows.
        for (var e : out.getAsJsonArray("errors")) {
            JsonObject err = e.getAsJsonObject();
            if (!err.has("index")) continue;
            int g = err.get("group").getAsInt(), index = err.get("index").getAsInt();
            if (g < rowsOf.size() && index < rowsOf.get(g).size()) {
                int row = rowsOf.get(g).get(index);
                err.addProperty("i", row);
                err.addProperty("name", VaultStore.clip(s.rows.get(row).name(), 120));
            }
        }
        out.addProperty("unselected", unselected);
        SESSIONS.remove(driver);
        return out;
    }

    private static int intField(JsonObject r, String key, int fallback, int min, int max) {
        if (!r.has(key) || r.get(key).isJsonNull()) return fallback;
        try {
            int n = r.get(key).getAsBigDecimal().intValueExact();
            if (n < min || n > max) throw new ArithmeticException();
            return n;
        } catch (RuntimeException bad) {
            throw new VaultStore.Failure(
                    "BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.must_integer", key, min, max));
        }
    }
}
