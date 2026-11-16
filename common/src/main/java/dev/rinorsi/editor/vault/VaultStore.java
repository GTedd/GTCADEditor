package dev.rinorsi.editor.vault;

import com.google.gson.*;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.registry.search.Pinyin;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;

/** Local storage. No Minecraft objects or page-selected filesystem paths cross this boundary. */
public final class VaultStore implements AutoCloseable {
    public static final int MAX_ENTRIES = 2000, MAX_ENTRY_BYTES = 8 * 1024 * 1024, MAX_FILE_BYTES = 64 * 1024 * 1024;
    public static final int RESPONSE_CHARS = 8 * 1024 * 1024;
    public static final long WRITE_DELAY_MS = 300, FLUSH_TIMEOUT_MS = 5000;
    /** File/export schema. 4 added pages and the per-entry page/lore fields; 1..3 are still read. */
    public static final int SCHEMA = 4;

    public static final int MAX_PAGES = 100, PAGE_NAME_CHARS = 48, LORE_CHARS = 1024;
    public static final String DEFAULT_PAGE = "default";
    private static final Set<Integer> READABLE = Set.of(1, 2, 3, 4);

    /** {@code lore} is the plain-text lore index stored with the entry, so search never decodes an item. */
    public record Validated(JsonObject stack, String name, String translatedName, JsonObject summary, String lore) {
        public Validated(JsonObject stack, String name, String translatedName, JsonObject summary) {
            this(stack, name, translatedName, summary, "");
        }
    }

    @FunctionalInterface
    public interface Validator {
        Validated validate(JsonObject stack);
    }

    /** DataFixer upgrade of a stored item stack from its recorded data version, then strict current validation. */
    @FunctionalInterface
    public interface Upgrader {
        Validated upgrade(JsonObject stack, int fromDataVersion);
    }

    /**
     * One prepared import row. {@code reason == null}: {@code stack} is a validated canonical stack. Otherwise the raw
     * stack is kept as an incompatible entry with its source {@code dataVersion}. {@code entry} carries a whole entry
     * from a vault export (any kind) whose metadata is kept.
     */
    public record Prepared(
            JsonObject stack, String name, String lore, int dataVersion, String reason, JsonObject entry) {}

    /** Items that become one new page. */
    public record Batch(String pageName, List<Prepared> items) {}

    /** A parsed, fully validated vault file. */
    public record Loaded(LinkedHashMap<String, JsonObject> entries, LinkedHashMap<String, JsonObject> pages) {}

    private record PendingBackup(String reason, JsonObject envelope) {}

    public static final class Failure extends IllegalArgumentException {
        public final String code;

        public Failure(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    private final Path path;
    private final ScheduledExecutorService writer;
    private final LongSupplier clock;
    private final Pinyin pinyin;
    private final LinkedHashMap<String, JsonObject> entries = new LinkedHashMap<>();
    /** Display order; always contains {@link #DEFAULT_PAGE}. Entries without a known page belong to it. */
    private final LinkedHashMap<String, JsonObject> pages = new LinkedHashMap<>();

    private record Cached(JsonObject source, Validator validator, JsonObject fields, String lore) {}

    private final Map<String, Cached> cachedRows = new HashMap<>();

    private record Sized(JsonObject source, int bytes) {}

    private final Map<String, Sized> sizes = new HashMap<>();
    private final VaultBackups backups;
    private final List<PendingBackup> requiredBackups = new ArrayList<>();
    // Writer-thread only: rotating backups before the first write of a session and once a day.
    private boolean sessionBackup;
    private long lastBackupAt = Long.MIN_VALUE;
    private String backupError = "";
    private JsonObject deletedPage;
    private int deletedPageIndex;

    private record PresetHashes(JsonObject source, Validator validator, Map<String, String> sections) {}

    private final Map<String, PresetHashes> presetHashes = new HashMap<>();
    private String exportKey, exportText;
    private long exportRevision = -1;
    private List<JsonObject> deleted = List.of();
    private String undoToken;
    private long undoUntil, revision, persisted;
    private ScheduledFuture<?> pending;
    private String warning = "", writeError = "";
    private String migration = "";
    private boolean readOnly;
    private java.nio.channels.FileChannel lockChannel;
    private java.nio.channels.FileLock fileLock;
    private boolean lockUnavailable;
    private final int dataVersion;
    private final String modVersion;

    public VaultStore(Path path, int dataVersion, String modVersion, Pinyin pinyin, LongSupplier clock) {
        this.path = path;
        this.dataVersion = dataVersion;
        this.modVersion = modVersion;
        this.pinyin = pinyin;
        this.clock = clock;
        this.backups = new VaultBackups(path);
        pages.put(DEFAULT_PAGE, defaultPage(0));
        writer = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "cadeditor-vault-writer");
            t.setDaemon(true);
            return t;
        });
        acquireLock();
        load();
        if (lockUnavailable && readOnly) warning = "STORAGE_LOCKED";
    }

    private void acquireLock() {
        try {
            Files.createDirectories(path.toAbsolutePath().getParent());
            lockChannel = java.nio.channels.FileChannel.open(
                    path.resolveSibling(path.getFileName() + ".lock"),
                    StandardOpenOption.CREATE,
                    StandardOpenOption.WRITE);
            fileLock = lockChannel.tryLock();
            if (fileLock == null)
                throw new IOException(
                        EditorI18n.tr("cadeditor.message.vaultstore.another_minecraft_instance_takes_vault"));
            lockUnavailable = false;
        } catch (IOException | java.nio.channels.OverlappingFileLockException failure) {
            lockUnavailable = true;
            // Missing/unwritable directories still retain editable memory and WRITE_FAILED semantics.
            if (Files.isDirectory(path.toAbsolutePath().getParent())) {
                readOnly = true;
                warning = "STORAGE_LOCKED";
            }
            if (lockChannel != null)
                try {
                    lockChannel.close();
                } catch (IOException ignored) {
                }
            lockChannel = null;
        }
    }

    /** Only migrate a fully validated source; never delete or rewrite legacy files. */
    public synchronized void migrateFrom(Path legacy) {
        if (path.toAbsolutePath().normalize().equals(legacy.toAbsolutePath().normalize())
                || !Files.isRegularFile(legacy)) return;
        if (Files.exists(path) || !entries.isEmpty()) {
            try {
                if (Files.size(path) != Files.size(legacy) || Files.mismatch(path, legacy) != -1)
                    System.getLogger(VaultStore.class.getName())
                            .log(
                                    System.Logger.Level.INFO,
                                    EditorI18n.tr(
                                            "cadeditor.message.vaultstore.global_vault_automatically_merged_unlike"));
            } catch (IOException ignored) {
            }
            return;
        }
        if (readOnly || lockUnavailable) return;
        try {
            readFile(legacy);
            migration = "legacy";
            System.getLogger(VaultStore.class.getName())
                    .log(
                            System.Logger.Level.INFO,
                            EditorI18n.tr("cadeditor.message.vaultstore.current_old_vault_global_directory"));
            changed();
        } catch (IOException | RuntimeException invalid) {
            entries.clear();
            pages.clear();
            pages.put(DEFAULT_PAGE, defaultPage(0));
            warning = "MIGRATION_FAILED";
            System.getLogger(VaultStore.class.getName())
                    .log(
                            System.Logger.Level.WARNING,
                            EditorI18n.tr(
                                    "cadeditor.message.vaultstore.old_vault_migration_failed_original", (invalid)));
        }
    }

    public String storageLabel() {
        Path absolute = path.toAbsolutePath().normalize();
        int n = absolute.getNameCount();
        String parent = n >= 2 ? absolute.getName(n - 2).toString() : "";
        String account = System.getProperty("user.name", "");
        Path home = Path.of(System.getProperty("user.home", "."));
        if (parent.equalsIgnoreCase(account)
                || (home.getFileName() != null
                        && parent.equalsIgnoreCase(home.getFileName().toString())))
            return "…/" + absolute.getFileName();
        return absolute.subpath(Math.max(0, n - 2), n).toString();
    }

    private Path backup() {
        return path.resolveSibling(path.getFileName() + ".bak");
    }

    private static int bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8).length;
    }

    private static Failure fail(String code, String reason) {
        return new Failure(code, reason);
    }

    public static String text(JsonObject o, String key, String fallback, int max) {
        if (!o.has(key)) {
            if (fallback.length() > max)
                throw fail(
                        "BAD_REQUEST",
                        EditorI18n.tr("cadeditor.message.vaultstore.default_value_exceeds_length_limit", (key)));
            return fallback;
        }
        JsonElement v = o.get(key);
        if (!v.isJsonPrimitive() || !v.getAsJsonPrimitive().isString())
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.must_text", (key)));
        String s = v.getAsString();
        if (s.length() > max || s.chars().anyMatch(c -> c == 0))
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.exceeds_length_limit", (key)));
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (++i >= s.length() || !Character.isLowSurrogate(s.charAt(i)))
                    throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.invalid_unicode"));
            } else if (Character.isLowSurrogate(c))
                throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.invalid_unicode"));
        }
        return s;
    }

    private static int integer(JsonObject o, String key, int fallback, int min, int max) {
        if (!o.has(key) || (key.equals("offset") && o.get(key).isJsonNull())) return fallback;
        try {
            var v = o.get(key);
            if (!v.isJsonPrimitive() || !v.getAsJsonPrimitive().isNumber()) throw new ArithmeticException();
            int n = v.getAsBigDecimal().intValueExact();
            if (n < min || n > max) throw new ArithmeticException();
            return n;
        } catch (RuntimeException e) {
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.must_integer", (key), (min), (max)));
        }
    }

    private static boolean bool(JsonObject o, String key) {
        if (!o.has(key)) return false;
        var v = o.get(key);
        if (!v.isJsonPrimitive() || !v.getAsJsonPrimitive().isBoolean())
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.must_boolean", (key)));
        return v.getAsBoolean();
    }

    private static String uuid(String id) {
        try {
            if (!UUID.fromString(id).toString().equals(id)) throw new IllegalArgumentException();
            return id;
        } catch (RuntimeException e) {
            throw fail("BAD_ID", EditorI18n.tr("cadeditor.message.vaultstore.invalid_vault_entry_id"));
        }
    }

    private static JsonArray tags(JsonObject o) {
        JsonArray out = new JsonArray();
        if (!o.has("tags")) return out;
        var v = o.get("tags");
        if (!v.isJsonArray() || v.getAsJsonArray().size() > 8)
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.up_8_tabs"));
        Set<String> seen = new HashSet<>();
        for (var t : v.getAsJsonArray()) {
            if (!t.isJsonPrimitive() || !t.getAsJsonPrimitive().isString())
                throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.label_must_text"));
            String s = t.getAsString().strip();
            if (s.isEmpty() || s.length() > 24)
                throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.label_length_1_24"));
            if (seen.add(s)) out.add(s);
        }
        return out;
    }

    private static List<String> ids(JsonObject o, int max) {
        if (!o.has("ids")
                || !o.get("ids").isJsonArray()
                || o.getAsJsonArray("ids").size() > max)
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.ids_count_valid"));
        List<String> out = new ArrayList<>();
        for (var id : o.getAsJsonArray("ids")) {
            if (!id.isJsonPrimitive() || !id.getAsJsonPrimitive().isString())
                throw fail("BAD_ID", EditorI18n.tr("cadeditor.message.vaultstore.id_must_text"));
            String s = uuid(id.getAsString());
            if (!out.contains(s)) out.add(s);
        }
        return out;
    }

    private static JsonObject object(JsonObject o, String key) {
        if (!o.has(key) || !o.get(key).isJsonObject())
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.must_object", (key)));
        return o.getAsJsonObject(key);
    }

    private JsonObject require(String id) {
        JsonObject e = entries.get(uuid(id));
        if (e == null) throw fail("NOT_FOUND", EditorI18n.tr("cadeditor.message.vaultstore.vault_entry_exist"));
        return e;
    }

    public synchronized JsonObject stack(String id) {
        JsonObject e = require(id);
        if (!kind(e).equals("item"))
            throw fail("wrong_kind", EditorI18n.tr("cadeditor.message.vaultstore.entry_cannot_item_retrieve"));
        return object(e, "stack").deepCopy();
    }

    /** Native host only: no page transport size cap, still bounded by the entry quota. */
    public synchronized JsonObject playerPreset(String id) {
        var e = require(id);
        if (!kind(e).equals("player_preset"))
            throw fail("wrong_kind", EditorI18n.tr("cadeditor.message.vaultstore.entry_player_preset"));
        var out = e.deepCopy();
        out.addProperty("templateRevision", PlayerPresetHash.template(object(e, "template")));
        return out;
    }

    /** Stored entries are immutable once published, so the envelope only holds references. */
    private static JsonObject envelope(Collection<JsonObject> values, Collection<JsonObject> pageValues) {
        JsonObject out = new JsonObject();
        out.addProperty("version", SCHEMA);
        JsonArray p = new JsonArray();
        pageValues.forEach(p::add);
        out.add("pages", p);
        JsonArray a = new JsonArray();
        values.forEach(a::add);
        out.add("entries", a);
        return out;
    }

    private JsonObject envelope(Collection<JsonObject> values) {
        return envelope(values, pages.values());
    }

    private static void checkQuota(Collection<JsonObject> values, Collection<JsonObject> pageValues) {
        if (values.size() > MAX_ENTRIES)
            throw fail("ENTRY_LIMIT", EditorI18n.tr("cadeditor.message.vaultstore.vault_up_2000_entries"));
        for (var e : values)
            if (bytes(e.toString()) > MAX_ENTRY_BYTES)
                throw fail("ENTRY_TOO_LARGE", EditorI18n.tr("cadeditor.message.vaultstore.n8_mib"));
        if (bytes(envelope(values, pageValues).toString()) > MAX_FILE_BYTES)
            throw fail("FILE_LIMIT", EditorI18n.tr("cadeditor.message.vaultstore.vault_file_maximum_64_mib"));
    }

    private void checkQuota(Collection<JsonObject> values) {
        checkQuota(values, pages.values());
    }

    private void guardWritable() {
        if (readOnly)
            throw fail(
                    lockUnavailable ? "STORAGE_LOCKED" : "STORAGE_READ_ONLY",
                    EditorI18n.tr("cadeditor.message.vaultstore.vault_read_only_other_examples"));
    }

    private void put(JsonObject e) {
        guardWritable();
        LinkedHashMap<String, JsonObject> candidate = new LinkedHashMap<>(entries);
        candidate.put(e.get("id").getAsString(), e);
        checkQuota(candidate.values());
        entries.clear();
        entries.putAll(candidate);
        changed();
    }

    /** One quota check and one revision for a whole batch of entry and page changes. */
    private void publish(LinkedHashMap<String, JsonObject> nextEntries, LinkedHashMap<String, JsonObject> nextPages) {
        guardWritable();
        checkQuota(nextEntries.values(), nextPages.values());
        entries.clear();
        entries.putAll(nextEntries);
        pages.clear();
        pages.putAll(nextPages);
        changed();
    }

    private void changed() {
        cachedRows.keySet().retainAll(entries.keySet());
        sizes.keySet().retainAll(entries.keySet());
        exportText = null;
        revision++;
        // First-dirty deadline, not trailing debounce: continuous saves cannot postpone disk forever.
        if (pending == null || pending.isDone())
            pending = writer.schedule(this::write, WRITE_DELAY_MS, TimeUnit.MILLISECONDS);
    }

    private void load() {
        if (!Files.exists(path) && !Files.exists(backup())) return;
        try {
            readFile(path);
            return;
        } catch (Exception e) {
            warning = "CORRUPT_PRIMARY";
            if (e instanceof Failure f && f.code.equals("SCHEMA_VERSION")) {
                readOnly = true;
                warning = "SCHEMA_VERSION";
                return;
            }
            quarantine(path);
        }
        try {
            readFile(backup());
            if (!readOnly) warning = "RECOVERED_BACKUP";
            changed();
        } catch (Exception e) {
            if (e instanceof Failure f && f.code.equals("SCHEMA_VERSION")) {
                readOnly = true;
                warning = "SCHEMA_VERSION";
                return;
            }
            quarantine(backup());
            if (!readOnly) warning = "RECOVERY_EMPTY";
            if (!readOnly) changed();
        }
    }

    private void quarantine(Path bad) {
        if (lockUnavailable) return;
        try {
            if (Files.exists(bad))
                Files.move(
                        bad,
                        bad.resolveSibling(bad.getFileName()
                                + ".corrupt-"
                                + System.currentTimeMillis()
                                + "-"
                                + UUID.randomUUID()));
        } catch (IOException e) {
            readOnly = true;
            warning = "QUARANTINE_FAILED";
        }
    }

    private void readFile(Path source) throws IOException {
        Loaded loaded = parseFile(source);
        entries.clear();
        entries.putAll(loaded.entries());
        pages.clear();
        pages.putAll(loaded.pages());
    }

    /** Pure: parse and fully validate a vault file without touching this store. */
    static Loaded parseFile(Path source) throws IOException {
        if (Files.size(source) > MAX_FILE_BYTES)
            throw fail("FILE_LIMIT", EditorI18n.tr("cadeditor.message.vaultstore.file_too_large"));
        JsonObject root = parse(Files.readString(source));
        if (!READABLE.contains(integer(root, "version", 0, 0, Integer.MAX_VALUE)))
            throw fail("SCHEMA_VERSION", EditorI18n.tr("cadeditor.message.vaultstore.unsupported_vault_version"));
        if (!root.has("entries") || !root.get("entries").isJsonArray())
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.entries_missing"));
        LinkedHashMap<String, JsonObject> pageMap = new LinkedHashMap<>();
        pageMap.put(DEFAULT_PAGE, defaultPage(0));
        if (root.has("pages")) {
            if (!root.get("pages").isJsonArray() || root.getAsJsonArray("pages").size() > MAX_PAGES)
                throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.pages_invalid"));
            boolean defaultSeen = false;
            LinkedHashMap<String, JsonObject> ordered = new LinkedHashMap<>();
            for (var raw : root.getAsJsonArray("pages")) {
                if (!raw.isJsonObject())
                    throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.pages_invalid"));
                JsonObject p = validatePage(raw.getAsJsonObject());
                defaultSeen |= p.get("id").getAsString().equals(DEFAULT_PAGE);
                if (ordered.put(p.get("id").getAsString(), p) != null)
                    throw fail("BAD_ID", EditorI18n.tr("cadeditor.message.vaultstore.repeat_id"));
            }
            // The file keeps the user's order, including where the default page sits; a missing one goes first.
            pageMap = new LinkedHashMap<>();
            if (!defaultSeen) pageMap.put(DEFAULT_PAGE, defaultPage(0));
            pageMap.putAll(ordered);
        }
        LinkedHashMap<String, JsonObject> read = new LinkedHashMap<>();
        for (var raw : root.getAsJsonArray("entries")) {
            JsonObject e = raw.getAsJsonObject().deepCopy();
            validateStored(e);
            // A reference to a page this file does not define is shown on the default page.
            if (e.has("page") && !pageMap.containsKey(e.get("page").getAsString())) e.remove("page");
            String id = e.get("id").getAsString();
            if (read.put(id, e) != null) throw fail("BAD_ID", EditorI18n.tr("cadeditor.message.vaultstore.repeat_id"));
        }
        checkQuota(read.values(), pageMap.values());
        return new Loaded(read, pageMap);
    }

    private static JsonObject defaultPage(long now) {
        JsonObject p = new JsonObject();
        p.addProperty("id", DEFAULT_PAGE);
        p.addProperty("name", "");
        p.addProperty("created", now);
        p.addProperty("updated", now);
        return p;
    }

    /** {id, name, created, updated}; only the default page may have an empty name (shown localized). */
    private static JsonObject validatePage(JsonObject raw) {
        String id = text(raw, "id", "", 36);
        if (!id.equals(DEFAULT_PAGE)) uuid(id);
        String name = text(raw, "name", "", PAGE_NAME_CHARS).strip();
        if (name.isEmpty() && !id.equals(DEFAULT_PAGE))
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.page_name_empty"));
        JsonObject p = new JsonObject();
        p.addProperty("id", id);
        p.addProperty("name", name);
        for (String k : List.of("created", "updated")) {
            long value = 0;
            if (raw.has(k))
                try {
                    value = raw.get(k).getAsBigDecimal().longValueExact();
                    if (value < 0) throw new ArithmeticException();
                } catch (RuntimeException bad) {
                    throw fail(
                            "BAD_REQUEST",
                            EditorI18n.tr("cadeditor.message.vaultstore.time_stamp_must_negative_integer"));
                }
            p.addProperty(k, value);
        }
        return p;
    }

    private static void validateStored(JsonObject e) {
        for (String key : List.of("id", "name", "tags", "note", "created", "updated", "mcDataVersion", "modVersion"))
            if (!e.has(key))
                throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.missing_entry_field", (key)));
        uuid(text(e, "id", "", 36));
        text(e, "name", "", 256);
        text(e, "note", "", 200);
        e.add("tags", tags(e));
        for (String k : List.of("created", "updated"))
            try {
                if (!e.get(k).isJsonPrimitive()
                        || !e.getAsJsonPrimitive(k).isNumber()
                        || e.get(k).getAsBigDecimal().longValueExact() < 0) throw new ArithmeticException();
            } catch (RuntimeException bad) {
                throw fail(
                        "BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.time_stamp_must_negative_integer"));
            }
        e.addProperty("kind", kind(e));
        text(e, "modVersion", "", 128);
        integer(e, "mcDataVersion", 0, 0, Integer.MAX_VALUE);
        if (e.has("page")) {
            String page = text(e, "page", "", 36);
            if (page.equals(DEFAULT_PAGE)) e.remove("page");
            else uuid(page);
        }
        if (e.has("lore")) text(e, "lore", "", LORE_CHARS);
        if (VaultTemplates.supported(kind(e))) {
            e.add("template", VaultTemplates.validate(kind(e), object(e, "template")));
            e.remove("stack");
            e.remove("snbt");
            e.remove("hash");
            return;
        }
        if (kind(e).equals("entity")) {
            var valid = VaultEntities.validate(text(e, "snbt", "", MAX_FILE_BYTES));
            e.addProperty("snbt", valid.snbt());
            e.addProperty("hash", entityHash(valid.snbt()));
            e.remove("stack");
            return;
        }
        JsonObject stack = object(e, "stack");
        if (!stack.has("count"))
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.stack_count_missing"));
        if (!text(stack, "id", "", 256).matches("[a-z0-9_.-]+:[a-z0-9_./-]+"))
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.invalid_item_id"));
        integer(stack, "count", 1, 1, 99);
        object(stack, "comps");
        object(stack, "removed");
        for (String key : List.of("component_snbt", "component_formats"))
            if (stack.has(key))
                for (var entry : object(stack, key).entrySet())
                    if (!entry.getValue().isJsonPrimitive()
                            || !entry.getValue().getAsJsonPrimitive().isString())
                        throw fail(
                                "BAD_REQUEST",
                                EditorI18n.tr("cadeditor.message.vaultstore.component_format_snbt_must_text"));
        text(e, "modVersion", "", 128);
        integer(e, "mcDataVersion", 0, 0, Integer.MAX_VALUE);
    }

    public static JsonObject parse(String text) {
        if (bytes(text) > MAX_FILE_BYTES)
            throw fail("FILE_LIMIT", EditorI18n.tr("cadeditor.message.vaultstore.import_up_64_mib"));
        int depth = 0;
        boolean quote = false, escape = false;
        for (char c : text.toCharArray()) {
            if (quote) {
                if (escape) escape = false;
                else if (c == '\\') escape = true;
                else if (c == '"') quote = false;
            } else if (c == '"') quote = true;
            else if (c == '{' || c == '[') {
                if (++depth > 96) throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.json_overset"));
            } else if (c == '}' || c == ']') depth--;
        }
        try (var reader = new com.google.gson.stream.JsonReader(new StringReader(text))) {
            reader.setStrictness(Strictness.STRICT);
            var root = JsonParser.parseReader(reader);
            if (reader.peek() != com.google.gson.stream.JsonToken.END_DOCUMENT || !root.isJsonObject())
                throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.json_must_object"));
            return root.getAsJsonObject();
        } catch (IOException | JsonParseException e) {
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.json_invalid"));
        }
    }

    private void write() {
        JsonObject snapshot;
        long captured, now;
        List<PendingBackup> required;
        synchronized (this) {
            pending = null;
            if ((revision == persisted && requiredBackups.isEmpty()) || readOnly) return;
            // Stored entries are immutable after publication: updates always replace a copy.
            // Only the small envelope/list is copied under the lock, never the entire file.
            snapshot = envelope(entries.values());
            captured = revision;
            required = List.copyOf(requiredBackups);
            now = clock.getAsLong();
        }
        Path temp = null;
        try {
            if (lockUnavailable && !readOnly) acquireLock();
            if (lockUnavailable)
                throw new IOException(EditorI18n.tr("cadeditor.message.vaultstore.unable_get_vault_monopoly_lock"));
            Files.createDirectories(path.getParent());
            // Entries replaced by an upgrade or a restore reach disk only after their originals did.
            for (PendingBackup b : required) {
                backups.write(b.envelope().toString().getBytes(StandardCharsets.UTF_8), now, b.reason());
                synchronized (this) {
                    requiredBackups.removeIf(x -> x == b);
                }
            }
            rotate(now);
            temp = Files.createTempFile(path.getParent(), "vault-", ".tmp");
            byte[] encoded = snapshot.toString().getBytes(StandardCharsets.UTF_8);
            try (var file = java.nio.channels.FileChannel.open(temp, StandardOpenOption.WRITE)) {
                java.nio.ByteBuffer buffer = java.nio.ByteBuffer.wrap(encoded);
                while (buffer.hasRemaining()) file.write(buffer);
                file.force(true);
            }
            // The backup is also replaced atomically. A crash never exposes a half-copied backup.
            if (Files.exists(path)) {
                Path bakTemp = Files.createTempFile(path.getParent(), "vault-bak-", ".tmp");
                try {
                    Files.copy(path, bakTemp, StandardCopyOption.REPLACE_EXISTING);
                    Files.move(bakTemp, backup(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                } finally {
                    Files.deleteIfExists(bakTemp);
                }
            }
            Files.move(temp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            synchronized (this) {
                persisted = captured;
                writeError = "";
            }
        } catch (IOException | RuntimeException e) {
            synchronized (this) {
                if (writeError.isEmpty())
                    System.getLogger(VaultStore.class.getName())
                            .log(
                                    System.Logger.Level.WARNING,
                                    EditorI18n.tr("cadeditor.message.vaultstore.write_failed_vault_dropped_save", (e)));
                writeError = "WRITE_FAILED";
                if (!writer.isShutdown()) pending = writer.schedule(this::write, 2, TimeUnit.SECONDS);
            }
        } finally {
            if (temp != null)
                try {
                    Files.deleteIfExists(temp);
                } catch (IOException ignored) {
                }
        }
    }

    /** Writer thread: copy the current file aside before the first write of a session and then once a day. */
    private void rotate(long now) {
        if (!Files.exists(path)) return;
        if (lastBackupAt == Long.MIN_VALUE) lastBackupAt = backups.newest();
        if (sessionBackup && now - lastBackupAt < VaultBackups.DAY_MS) return;
        String reason = sessionBackup ? "daily" : "startup";
        sessionBackup = true;
        lastBackupAt = now;
        try {
            backups.write(Files.readAllBytes(path), now, reason);
            synchronized (this) {
                backupError = "";
            }
        } catch (IOException | RuntimeException e) {
            // A missing dated copy never blocks saving: .bak is still written below.
            synchronized (this) {
                backupError = "BACKUP_FAILED";
            }
            System.getLogger(VaultStore.class.getName())
                    .log(System.Logger.Level.WARNING, EditorI18n.tr("cadeditor.message.vaultstore.backup_failed", (e)));
        }
    }

    /** Off the client thread: file names and times of the rotating backups, newest first. */
    public JsonArray listBackups() throws IOException {
        return backups.json();
    }

    /** "Back up now": the in-memory state, written on the writer thread so it orders with saves. */
    public CompletableFuture<String> backupNow() {
        JsonObject snapshot;
        long now;
        synchronized (this) {
            guardWritable();
            snapshot = envelope(entries.values());
            now = clock.getAsLong();
        }
        CompletableFuture<String> done = new CompletableFuture<>();
        try {
            writer.execute(() -> {
                try {
                    done.complete(backups.write(snapshot.toString().getBytes(StandardCharsets.UTF_8), now, "manual"));
                } catch (IOException | RuntimeException e) {
                    done.completeExceptionally(e);
                }
            });
        } catch (RejectedExecutionException e) {
            done.completeExceptionally(e);
        }
        return done;
    }

    /** Off the client thread: read and fully validate one backup; nothing changes yet. */
    public Loaded readBackup(String name) throws IOException {
        return parseFile(backups.resolve(name));
    }

    /** Replace the vault with a backup. The current state is itself backed up first and reaches disk before it. */
    public synchronized JsonObject restoreBackup(Loaded loaded) {
        guardWritable();
        requiredBackups.add(new PendingBackup("restore", envelope(entries.values())));
        entries.clear();
        entries.putAll(loaded.entries());
        pages.clear();
        pages.putAll(loaded.pages());
        deleted = List.of();
        undoToken = null;
        deletedPage = null;
        cachedRows.clear();
        presetHashes.clear();
        sizes.clear();
        changed();
        JsonObject out = new JsonObject();
        out.addProperty("restored", entries.size());
        out.addProperty("pages", pages.size());
        return out;
    }

    public void flush() {
        flushNow();
    }

    /** Bounded synchronous barrier; false is an observable failure, never a false durable result. */
    public boolean flushNow() {
        Future<?> barrier;
        synchronized (this) {
            if (pending != null) pending.cancel(false);
            pending = null;
            if (writer.isShutdown()) return persisted == revision;
            barrier = writer.submit(this::write);
        }
        try {
            barrier.get(FLUSH_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        } catch (ExecutionException | TimeoutException e) {
            synchronized (this) {
                writeError = e instanceof TimeoutException ? "FLUSH_TIMEOUT" : "WRITE_FAILED";
            }
            System.getLogger(VaultStore.class.getName())
                    .log(
                            System.Logger.Level.WARNING,
                            EditorI18n.tr("cadeditor.message.vaultstore.vault_exit_failed", (e)));
            return false;
        }
        synchronized (this) {
            return persisted == revision;
        }
    }

    public void close() {
        synchronized (this) {
            if (pending != null) pending.cancel(false);
        }
        flush();
        writer.shutdown();
        try {
            if (writer.awaitTermination(FLUSH_TIMEOUT_MS, TimeUnit.MILLISECONDS)) releaseLock();
            else {
                Thread release = new Thread(
                        () -> {
                            try {
                                while (!writer.awaitTermination(1, TimeUnit.DAYS)) {}
                                releaseLock();
                            } catch (InterruptedException e) {
                                Thread.currentThread().interrupt();
                            }
                        },
                        "vault-lock-release");
                release.setDaemon(true);
                release.start();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void releaseLock() {
        try {
            if (fileLock != null) fileLock.release();
            if (lockChannel != null) lockChannel.close();
        } catch (IOException e) {
            System.getLogger(VaultStore.class.getName())
                    .log(
                            System.Logger.Level.WARNING,
                            EditorI18n.tr("cadeditor.message.vaultstore.vault_file_lock_closed_failed", (e)));
        }
    }

    public static <T> T awaitReady(CompletableFuture<T> future, long timeoutMs) {
        try {
            return future.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            throw fail("NOT_READY", EditorI18n.tr("cadeditor.message.vaultstore.vault_still_loaded_try_again"));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw fail(
                    "NOT_READY", EditorI18n.tr("cadeditor.message.vaultstore.vault_loading_pending_interruption_try"));
        } catch (ExecutionException e) {
            throw fail(
                    "STORAGE_FAILED", EditorI18n.tr("cadeditor.message.vaultstore.vault_loading_failed", (reason(e))));
        }
    }

    private static JsonElement sorted(JsonElement e) {
        if (e.isJsonObject()) {
            JsonObject o = new JsonObject();
            e.getAsJsonObject().keySet().stream()
                    .sorted()
                    .forEach(k -> o.add(k, sorted(e.getAsJsonObject().get(k))));
            return o;
        }
        if (e.isJsonArray()) {
            JsonArray a = new JsonArray();
            e.getAsJsonArray().forEach(v -> a.add(sorted(v)));
            return a;
        }
        return e;
    }

    private static String hash(JsonObject stack) {
        JsonObject typed = new JsonObject();
        for (String k : List.of("id", "count", "comps", "component_snbt", "removed"))
            if (stack.has(k)) typed.add(k, stack.get(k));
        try {
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256")
                            .digest(sorted(typed).toString().getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new AssertionError(e);
        }
    }

    private Validated validate(Validator validator, JsonObject stack) {
        try {
            return validator.validate(stack.deepCopy());
        } catch (Failure e) {
            throw e;
        } catch (RuntimeException e) {
            throw fail("INVALID_STACK", reason(e));
        }
    }

    public static String reason(Exception e) {
        String s = e.getMessage();
        if (s == null) s = e.getClass().getSimpleName();
        return s.substring(0, Math.min(512, s.length()));
    }

    private static String kind(JsonObject e) {
        String k = text(e, "kind", "item", 16);
        if (!Set.of("item", "entity", "block", "player_preset").contains(k))
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.unknown_vault_category"));
        return k;
    }

    private static String entityHash(String snbt) {
        JsonObject o = new JsonObject();
        o.addProperty("id", "entity");
        o.addProperty("comps", snbt);
        return hash(o);
    }

    private JsonObject row(JsonObject stored, Validator validator, boolean full) {
        JsonObject out = new JsonObject();
        stored.entrySet().forEach(e -> {
            if (!e.getKey().equals("hash")
                    && !e.getKey().equals("lore")
                    && (full
                            || (!e.getKey().equals("stack")
                                    && !e.getKey().equals("snbt")
                                    && !e.getKey().equals("template"))))
                out.add(e.getKey(), e.getValue().deepCopy());
        });
        out.addProperty("kind", kind(stored));
        // Organisation fields every row carries: effective page and stored size (same measure as the quota).
        out.addProperty("page", pageOf(stored));
        out.addProperty("bytes", size(stored));
        if (VaultTemplates.supported(kind(stored))) {
            String entryId = stored.get("id").getAsString();
            Cached cached = cachedRows.get(entryId);
            if (cached == null || cached.source() != stored || cached.validator() != validator) {
                var fields = new JsonObject();
                fields.add("summary", VaultTemplates.describe(kind(stored), object(stored, "template")));
                fields.addProperty("compatibilityUnknown", true); // Target codecs validate on apply.
                cached = new Cached(stored, validator, fields, "");
                cachedRows.put(entryId, cached);
            }
            cached.fields()
                    .entrySet()
                    .forEach(e -> out.add(e.getKey(), e.getValue().deepCopy()));
            return out;
        }
        if (kind(stored).equals("entity")) {
            String entryId = stored.get("id").getAsString();
            Cached cached = cachedRows.get(entryId);
            if (cached == null || cached.source() != stored || cached.validator() != validator) {
                var valid = VaultEntities.validate(stored.get("snbt").getAsString());
                JsonObject fields = new JsonObject(), entity = new JsonObject();
                entity.addProperty("id", valid.id());
                fields.add("entity", entity);
                fields.add("summary", valid.summary());
                fields.addProperty("translatedName", valid.name());
                boolean known = VaultEntities.registered(valid.id());
                fields.addProperty("compatibility", known);
                if (!known) fields.addProperty("compatibilityUnknown", true);
                cached = new Cached(stored, validator, fields, "");
                cachedRows.put(entryId, cached);
            }
            cached.fields()
                    .entrySet()
                    .forEach(e -> out.add(e.getKey(), e.getValue().deepCopy()));
            return out;
        }
        JsonObject stack = object(stored, "stack");
        JsonObject item = new JsonObject();
        item.add("id", stack.get("id"));
        item.add("count", stack.get("count"));
        out.add("item", item);
        if (stored.get("mcDataVersion").getAsInt() < dataVersion) out.addProperty("upgradable", true);
        String id = stored.get("id").getAsString();
        Cached cached = cachedRows.get(id);
        if (cached == null || cached.source() != stored || cached.validator() != validator) {
            JsonObject fields = new JsonObject();
            String lore = "";
            try {
                var valid = validate(validator, stack);
                fields.add("summary", valid.summary());
                fields.addProperty("translatedName", valid.translatedName());
                lore = clip(valid.lore(), LORE_CHARS);
            } catch (Failure e) {
                fields.addProperty(e.code.equals("UNAVAILABLE") ? "compatibilityUnknown" : "incompatible", true);
                fields.addProperty("reason", e.getMessage());
            }
            cached = new Cached(stored, validator, fields, lore);
            cachedRows.put(id, cached);
        }
        cached.fields().entrySet().forEach(e -> out.add(e.getKey(), e.getValue().deepCopy()));
        if (!full) out.remove("stack");
        return out;
    }

    /** Stored JSON size in UTF-8 bytes, the measure the per-entry and file quotas use. */
    private int size(JsonObject stored) {
        String id = stored.get("id").getAsString();
        Sized s = sizes.get(id);
        if (s == null || s.source() != stored) {
            s = new Sized(stored, bytes(stored.toString()));
            sizes.put(id, s);
        }
        return s.bytes();
    }

    /** Lore index: written at save time; older entries fall back to the cached validation of this session. */
    private String loreOf(JsonObject stored) {
        if (stored.has("lore")) return stored.get("lore").getAsString();
        Cached c = cachedRows.get(stored.get("id").getAsString());
        return c != null && c.source() == stored ? c.lore() : "";
    }

    public static String clip(String text, int max) {
        if (text == null) return "";
        if (text.length() <= max) return text;
        int end = max;
        if (end > 0 && Character.isHighSurrogate(text.charAt(end - 1))) end--;
        return text.substring(0, end);
    }

    private String pageOf(JsonObject e) {
        String page = e.has("page") ? e.get("page").getAsString() : DEFAULT_PAGE;
        return pages.containsKey(page) ? page : DEFAULT_PAGE;
    }

    /** Name for search and generated labels; the default page has no stored name and uses the current language. */
    private String pageLabel(String id) {
        JsonObject p = pages.get(id);
        String name = p == null ? "" : p.get("name").getAsString();
        return name.isEmpty() ? EditorI18n.tr("cadeditor.message.vaultstore.default_page") : name;
    }

    private JsonObject requirePage(String id) {
        JsonObject p = pages.get(id);
        if (p == null) throw fail("PAGE_NOT_FOUND", EditorI18n.tr("cadeditor.message.vaultstore.page_not_found"));
        return p;
    }

    private static void setPage(JsonObject e, String page) {
        if (page.equals(DEFAULT_PAGE)) e.remove("page");
        else e.addProperty("page", page);
    }

    /** Target page of a save: optional "page" field, which must name an existing page. */
    private String targetPage(JsonObject request) {
        String page = text(request, "page", DEFAULT_PAGE, 36);
        if (page.isEmpty()) return DEFAULT_PAGE;
        requirePage(page);
        return page;
    }

    private static String uniquePageName(String wanted, String exceptId, Map<String, JsonObject> within) {
        String base = clip(wanted.strip(), PAGE_NAME_CHARS);
        String candidate = base;
        for (int number = 2; ; number++) {
            boolean taken = false;
            for (var p : within.values())
                if (!p.get("id").getAsString().equals(exceptId)
                        && p.get("name").getAsString().equalsIgnoreCase(candidate)) {
                    taken = true;
                    break;
                }
            if (!taken) return candidate;
            String suffix = " (" + number + ")";
            candidate = clip(base, PAGE_NAME_CHARS - suffix.length()) + suffix;
        }
    }

    private static JsonObject pageRow(JsonObject p, int count, long bytes, Map<String, Integer> kinds) {
        JsonObject o = new JsonObject();
        o.add("id", p.get("id"));
        o.add("name", p.get("name"));
        if (p.get("id").getAsString().equals(DEFAULT_PAGE)) o.addProperty("default", true);
        o.addProperty("count", count);
        o.addProperty("bytes", bytes);
        if (kinds != null && !kinds.isEmpty()) {
            JsonObject k = new JsonObject();
            kinds.forEach(k::addProperty);
            o.add("kinds", k);
        }
        return o;
    }

    private VaultQuery.Subject subject(JsonObject e, JsonObject r) {
        return new VaultQuery.Subject() {
            public String kind() {
                return VaultStore.kind(e);
            }

            public String itemId() {
                return searchableId(r);
            }

            public String name() {
                return e.get("name").getAsString();
            }

            public String translated() {
                return r.has("translatedName") ? r.get("translatedName").getAsString() : "";
            }

            public String lore() {
                return loreOf(e);
            }

            public List<String> tags() {
                List<String> out = new ArrayList<>();
                e.getAsJsonArray("tags").forEach(t -> out.add(t.getAsString()));
                return out;
            }

            public String note() {
                return e.get("note").getAsString();
            }

            public long count() {
                return countOf(r);
            }

            public long bytes() {
                return r.get("bytes").getAsLong();
            }

            public long created() {
                return e.get("created").getAsLong();
            }

            public long updated() {
                return e.get("updated").getAsLong();
            }

            public String pageId() {
                return pageOf(e);
            }

            public String pageName() {
                return pageLabel(pageOf(e));
            }

            public String haystack() {
                return (text(e, "name", "", 256)
                                + " "
                                + text(e, "note", "", 200)
                                + " "
                                + e.get("tags")
                                + " "
                                + searchableId(r)
                                + " "
                                + text(r, "translatedName", "", 256))
                        .toLowerCase(Locale.ROOT);
            }
        };
    }

    private static long countOf(JsonObject row) {
        return row.has("item") ? row.getAsJsonObject("item").get("count").getAsLong() : 1;
    }

    /** Client tick preflight: bound first-open/version/language compatibility work per tick. */
    public synchronized boolean warm(Validator validator, int budget) {
        for (var e : entries.values()) {
            Cached c = cachedRows.get(e.get("id").getAsString());
            if (c == null || c.source() != e || c.validator() != validator) {
                if (budget-- <= 0) return false;
                row(e, validator, false);
            }
        }
        return true;
    }

    public synchronized void invalidateRows() {
        cachedRows.clear();
        presetHashes.clear();
    }

    private JsonObject saveEntity(JsonObject request, Validator validator) {
        String page = targetPage(request);
        var valid = VaultEntities.validate(text(request, "snbt", "", MAX_FILE_BYTES));
        String digest = entityHash(valid.snbt());
        JsonObject e = null;
        if (!bool(request, "force"))
            for (var candidate : entries.values())
                if (kind(candidate).equals("entity")
                        && digest.equals(candidate.get("hash").getAsString())) {
                    e = candidate;
                    break;
                }
        boolean duplicate = e != null;
        if (!duplicate) {
            e = new JsonObject();
            e.addProperty("id", UUID.randomUUID().toString());
            e.addProperty("kind", "entity");
            e.addProperty("snbt", valid.snbt());
            e.addProperty("hash", digest);
            String name = text(request, "name", valid.name(), 256).strip();
            e.addProperty("name", name.isEmpty() ? valid.name() : name);
            e.add("tags", tags(request));
            e.addProperty("note", text(request, "note", "", 200));
            e.addProperty("created", clock.getAsLong());
            e.addProperty("updated", clock.getAsLong());
            e.addProperty("mcDataVersion", dataVersion);
            e.addProperty("modVersion", modVersion);
            setPage(e, page);
            put(e);
        }
        JsonObject out = new JsonObject();
        out.add("entry", row(e, validator, false));
        out.addProperty("duplicate", duplicate);
        out.add("stripped", valid.stripped());
        out.add("warnings", valid.warnings());
        return out;
    }

    private String uniqueName(String wanted, String exceptId) {
        String candidate = wanted;
        for (int number = 2; ; number++) {
            boolean taken = false;
            for (var e : entries.values())
                if (!e.get("id").getAsString().equals(exceptId)
                        && e.get("name").getAsString().equals(candidate)) {
                    taken = true;
                    break;
                }
            if (!taken) return candidate;
            String suffix = " (" + number + ")";
            int end = Math.min(wanted.length(), 256 - suffix.length());
            if (end > 0 && Character.isHighSurrogate(wanted.charAt(end - 1))) end--;
            candidate = wanted.substring(0, end) + suffix;
        }
    }

    private JsonObject saveTemplate(JsonObject request, Validator validator) {
        String kind = kind(request);
        String page = targetPage(request);
        JsonObject template = VaultTemplates.capture(kind, request);
        var e = new JsonObject();
        e.addProperty("id", UUID.randomUUID().toString());
        e.addProperty("kind", kind);
        e.add("template", template);
        String fallback = kind.equals("block")
                ? template.get("block").getAsString()
                : EditorI18n.tr("cadeditor.ui.vault.player_presets");
        String name = text(request, "name", fallback, 256).strip();
        e.addProperty("name", uniqueName(name.isEmpty() ? fallback : name, ""));
        e.add("tags", tags(request));
        e.addProperty("note", text(request, "note", "", 200));
        e.addProperty("created", clock.getAsLong());
        e.addProperty("updated", clock.getAsLong());
        e.addProperty("mcDataVersion", dataVersion);
        e.addProperty("modVersion", modVersion);
        setPage(e, page);
        put(e);
        var out = new JsonObject();
        out.add("entry", row(e, validator, false));
        out.addProperty("duplicate", false);
        return out;
    }

    private JsonObject hasBackup(JsonObject request, Validator validator) {
        if (!kind(request).equals("player_preset"))
            throw fail("wrong_kind", EditorI18n.tr("cadeditor.message.vaultstore.backup_check_only_supports_player"));
        var requested = VaultTemplates.backupTemplate(request).getAsJsonObject("sections");
        var wanted = new TreeMap<String, String>();
        for (var section : requested.entrySet())
            wanted.put(section.getKey(), PlayerPresetHash.section(section.getKey(), section.getValue(), validator));
        presetHashes.keySet().retainAll(entries.keySet());
        var out = new JsonObject();
        out.addProperty("backed_up", false);
        for (var entry : entries.entrySet()) {
            var e = entry.getValue();
            if (!kind(e).equals("player_preset")) continue;
            var saved = e.getAsJsonObject("template").getAsJsonObject("sections");
            if (!saved.keySet().containsAll(wanted.keySet())) continue;
            var cached = presetHashes.get(entry.getKey());
            if (cached == null || cached.source != e || cached.validator != validator) {
                cached = new PresetHashes(e, validator, new HashMap<>());
                presetHashes.put(entry.getKey(), cached);
            }
            boolean matches = true;
            for (var section : wanted.entrySet()) {
                String digest = cached.sections.get(section.getKey());
                if (digest == null) {
                    try {
                        digest = PlayerPresetHash.section(section.getKey(), saved.get(section.getKey()), validator);
                    } catch (RuntimeException invalid) {
                        matches = false;
                        break;
                    } // Old incompatible entries are not backups of validated data.
                    cached.sections.put(section.getKey(), digest);
                }
                if (!digest.equals(section.getValue())) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                out.addProperty("backed_up", true);
                out.add("id", e.get("id"));
                out.add("name", e.get("name"));
                break;
            }
        }
        return out;
    }

    private static String searchableId(JsonObject e) {
        return switch (kind(e)) {
            case "block" -> object(e, "summary").get("block").getAsString();
            case "player_preset" -> "minecraft:player";
            case "entity" -> object(e, "entity").get("id").getAsString();
            default -> object(e, "item").get("id").getAsString();
        };
    }

    private JsonObject save(JsonObject request, Validator validator) {
        if (VaultTemplates.supported(kind(request))) return saveTemplate(request, validator);
        if (kind(request).equals("entity")) return saveEntity(request, validator);
        String page = targetPage(request);
        if (bytes(object(request, "stack").toString()) > MAX_ENTRY_BYTES)
            throw fail("ENTRY_TOO_LARGE", EditorI18n.tr("cadeditor.message.vaultstore.n8_mib"));
        Validated valid = validate(validator, object(request, "stack"));
        String digest = hash(valid.stack());
        if (!bool(request, "force"))
            for (var e : entries.values())
                if (kind(e).equals("item") && digest.equals(hash(object(e, "stack")))) {
                    JsonObject out = new JsonObject();
                    out.add("entry", row(e, validator, false));
                    out.addProperty("duplicate", true);
                    return out;
                }
        JsonObject e = new JsonObject();
        e.addProperty("id", UUID.randomUUID().toString());
        String name = text(request, "name", valid.name(), 256).strip();
        e.addProperty("name", name.isEmpty() ? valid.name() : name);
        e.add("tags", tags(request));
        e.addProperty("note", text(request, "note", "", 200));
        long now = clock.getAsLong();
        e.addProperty("created", now);
        e.addProperty("updated", now);
        e.addProperty("mcDataVersion", dataVersion);
        e.addProperty("modVersion", modVersion);
        e.addProperty("kind", "item");
        e.add("stack", valid.stack().deepCopy());
        e.addProperty("hash", digest);
        if (!valid.lore().isEmpty()) e.addProperty("lore", clip(valid.lore(), LORE_CHARS));
        setPage(e, page);
        put(e);
        JsonObject out = new JsonObject();
        out.add("entry", row(e, validator, false));
        out.addProperty("duplicate", false);
        return out;
    }

    /** Detached replies; synchronization serializes two quick saves and writer snapshots. */
    public synchronized JsonObject execute(JsonObject request, Validator validator) {
        return execute(request, validator, null);
    }

    private static final Set<String> MUTATIONS = Set.of(
            "save",
            "update",
            "delete",
            "restore",
            "duplicate",
            "import",
            "move",
            "upgrade",
            "page_create",
            "page_rename",
            "page_move",
            "page_delete");

    /** {@code upgrader} is null without a world: "upgrade" then answers UNAVAILABLE and changes nothing. */
    public synchronized JsonObject execute(JsonObject request, Validator validator, Upgrader upgrader) {
        checkDepth(request);
        String op = text(request, "op", "", 32);
        JsonObject out = new JsonObject();
        if (readOnly && MUTATIONS.contains(op)) guardWritable();
        switch (op) {
            case "save" -> out = save(request, validator);
            case "has_backup" -> out = hasBackup(request, validator);
            case "preview" -> out = VaultTemplates.preview(require(text(request, "id", "", 36)), request);
            case "list" -> out = list(request, validator);
            case "get" -> {
                JsonArray found = new JsonArray(), missing = new JsonArray();
                for (String id : ids(request, 32)) {
                    var e = entries.get(id);
                    if (e == null) missing.add(id);
                    else found.add(row(e, validator, true));
                }
                out.add("entries", found);
                out.add("missing", missing);
                if (out.toString().length() > 22000)
                    throw fail("RESPONSE_LIMIT", EditorI18n.tr("cadeditor.message.vaultstore.full_entry_too_big_read"));
            }
            case "update" -> {
                JsonObject e = require(text(request, "id", "", 36)).deepCopy();
                if (request.has("template")) {
                    if (!kind(e).equals("player_preset"))
                        throw fail(
                                "wrong_kind",
                                EditorI18n.tr("cadeditor.message.vaultstore.only_player_preset_support_template"));
                    if (!PlayerPresetHash.template(object(e, "template"))
                            .equals(text(request, "expectedTemplateRevision", "", 64)))
                        throw fail(
                                "target_changed",
                                EditorI18n.tr("cadeditor.message.vaultstore.preset_content_changed_restart_compare"));
                    e.add("template", PlayerPresetValidation.validate(object(request, "template"), validator));
                    out.addProperty("templateRevision", PlayerPresetHash.template(object(e, "template")));
                }
                if (request.has("name")) {
                    String n = text(request, "name", "", 256).strip();
                    if (n.isEmpty())
                        throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.name_cannot_empty"));
                    e.addProperty(
                            "name",
                            VaultTemplates.supported(kind(e))
                                    ? uniqueName(n, e.get("id").getAsString())
                                    : n);
                }
                if (request.has("tags")) e.add("tags", tags(request));
                if (request.has("note")) e.addProperty("note", text(request, "note", "", 200));
                e.addProperty("updated", clock.getAsLong());
                put(e);
                out.add("entry", row(e, validator, false));
            }
            case "delete" -> {
                List<String> ids = ids(request, 50);
                List<JsonObject> removed = new ArrayList<>();
                for (String id : ids) removed.add(require(id));
                for (String id : ids) entries.remove(id);
                deleted = List.copyOf(removed);
                deletedPage = null;
                undoToken = UUID.randomUUID().toString();
                undoUntil = clock.getAsLong() + 30000;
                changed();
                out.addProperty("deleted", removed.size());
                out.addProperty("token", undoToken);
                out.addProperty("expires", undoUntil);
            }
            case "restore" -> {
                if (undoToken == null
                        || !undoToken.equals(text(request, "token", "", 36))
                        || clock.getAsLong() >= undoUntil)
                    throw fail("UNDO_EXPIRED", EditorI18n.tr("cadeditor.message.vaultstore.undo_expired"));
                var candidate = new LinkedHashMap<>(entries);
                for (var e : deleted) {
                    String id = e.get("id").getAsString();
                    if (candidate.containsKey(id))
                        throw fail("ID_CONFLICT", EditorI18n.tr("cadeditor.message.vaultstore.undo_entry_id_occupied"));
                    candidate.put(id, e);
                }
                // A page deleted together with its entries comes back at its old position.
                var nextPages = new LinkedHashMap<>(pages);
                if (deletedPage != null
                        && !pages.containsKey(deletedPage.get("id").getAsString())
                        && pages.size() < MAX_PAGES) {
                    nextPages = new LinkedHashMap<>();
                    int index = 0;
                    for (var p : pages.entrySet()) {
                        if (index++ == deletedPageIndex)
                            nextPages.put(deletedPage.get("id").getAsString(), deletedPage);
                        nextPages.put(p.getKey(), p.getValue());
                    }
                    nextPages.putIfAbsent(deletedPage.get("id").getAsString(), deletedPage);
                }
                checkQuota(candidate.values(), nextPages.values());
                entries.clear();
                entries.putAll(candidate);
                pages.clear();
                pages.putAll(nextPages);
                out.addProperty("restored", deleted.size());
                deleted = List.of();
                deletedPage = null;
                undoToken = null;
                changed();
            }
            case "duplicate" -> {
                JsonObject e = require(text(request, "id", "", 36)).deepCopy();
                e.addProperty("id", UUID.randomUUID().toString());
                if (VaultTemplates.supported(kind(e)))
                    e.addProperty("name", uniqueName(e.get("name").getAsString(), ""));
                long now = clock.getAsLong();
                e.addProperty("created", now);
                e.addProperty("updated", now);
                put(e);
                out.add("entry", row(e, validator, false));
            }
            case "import" -> out = importEntries(request, validator);
            case "export" -> {
                boolean allEntries = bool(request, "all");
                List<String> selectedIds = allEntries ? List.of() : ids(request, MAX_ENTRIES);
                String key = allEntries ? "*" : String.join(",", selectedIds);
                if (exportText == null || exportRevision != revision || !key.equals(exportKey)) {
                    List<JsonObject> selected = new ArrayList<>();
                    if (allEntries) selected.addAll(entries.values());
                    else for (String id : selectedIds) selected.add(require(id));
                    // Pages travel with their entries: all pages for a full export, referenced ones otherwise.
                    List<JsonObject> exportedPages = new ArrayList<>();
                    for (var p : pages.values()) {
                        String pid = p.get("id").getAsString();
                        if (allEntries
                                || selected.stream().anyMatch(e -> pageOf(e).equals(pid))) exportedPages.add(p);
                    }
                    exportText = envelope(
                                    selected.stream()
                                            .map(e -> {
                                                JsonObject copy = e.deepCopy();
                                                copy.remove("hash");
                                                return copy;
                                            })
                                            .toList(),
                                    exportedPages)
                            .toString();
                    exportKey = key;
                    exportRevision = revision;
                }
                String all = exportText;
                int offset = integer(request, "offset", 0, 0, all.length()),
                        limit = integer(request, "limit", 6000, 1, 6000);
                if (offset > 0
                        && offset < all.length()
                        && Character.isLowSurrogate(all.charAt(offset))
                        && Character.isHighSurrogate(all.charAt(offset - 1)))
                    throw fail(
                            "BAD_REQUEST",
                            EditorI18n.tr("cadeditor.message.vaultstore.offset_cannot_cut_unicode_character"));
                int end = Math.min(all.length(), offset + limit);
                if (end < all.length()
                        && end > 0
                        && Character.isHighSurrogate(all.charAt(end - 1))
                        && Character.isLowSurrogate(all.charAt(end))) end++;
                out.addProperty("text", all.substring(offset, end));
                out.addProperty("offset", offset);
                out.addProperty("nextOffset", end);
                out.addProperty("total", all.length());
                out.addProperty("done", end == all.length());
                out.addProperty("revision", revision);
            }
            case "tags" -> {
                Map<String, Integer> counts = new TreeMap<>();
                entries.values()
                        .forEach(e ->
                                e.getAsJsonArray("tags").forEach(t -> counts.merge(t.getAsString(), 1, Integer::sum)));
                JsonArray a = new JsonArray();
                int offset = integer(request, "offset", 0, 0, MAX_ENTRIES * 8),
                        limit = integer(request, "limit", 100, 1, 100);
                counts.entrySet().stream().skip(offset).limit(limit).forEach(t -> {
                    JsonObject r = new JsonObject();
                    r.addProperty("name", t.getKey());
                    r.addProperty("count", t.getValue());
                    a.add(r);
                });
                out.add("tags", a);
                out.addProperty("total", counts.size());
                out.addProperty("nextOffset", offset + a.size());
                out.addProperty("done", offset + a.size() >= counts.size());
            }
            case "stats" -> {
                out.addProperty("storage", storageLabel());
                if (!migration.isEmpty()) out.addProperty("migration", migration);
                out.addProperty("entries", entries.size());
                long entities = entries.values().stream()
                        .filter(e -> kind(e).equals("entity"))
                        .count();
                out.addProperty("entities", entities);
                out.addProperty(
                        "items",
                        entries.values().stream()
                                .filter(e -> kind(e).equals("item"))
                                .count());
                out.addProperty(
                        "blocks",
                        entries.values().stream()
                                .filter(e -> kind(e).equals("block"))
                                .count());
                out.addProperty(
                        "playerPresets",
                        entries.values().stream()
                                .filter(e -> kind(e).equals("player_preset"))
                                .count());
                out.addProperty("bytes", bytes(envelope(entries.values()).toString()));
                out.addProperty("maxEntries", MAX_ENTRIES);
                out.addProperty("maxEntryBytes", MAX_ENTRY_BYTES);
                out.addProperty("maxFileBytes", MAX_FILE_BYTES);
                out.addProperty("pages", pages.size());
                out.addProperty("maxPages", MAX_PAGES);
                out.addProperty(
                        "upgradable",
                        entries.values().stream().filter(this::upgradable).count());
                out.addProperty("dataVersion", dataVersion);
                if (!backupError.isEmpty()) out.addProperty("backupError", backupError);
            }
            case "pages" -> {
                Map<String, int[]> counts = new HashMap<>();
                Map<String, long[]> sums = new HashMap<>();
                Map<String, Map<String, Integer>> kinds = new HashMap<>();
                for (var e : entries.values()) {
                    String p = pageOf(e);
                    counts.computeIfAbsent(p, k -> new int[1])[0]++;
                    sums.computeIfAbsent(p, k -> new long[1])[0] += size(e);
                    kinds.computeIfAbsent(p, k -> new TreeMap<>()).merge(kind(e), 1, Integer::sum);
                }
                int offset = integer(request, "offset", 0, 0, MAX_PAGES),
                        limit = integer(request, "limit", MAX_PAGES, 1, MAX_PAGES);
                JsonArray a = new JsonArray();
                pages.values().stream().skip(offset).limit(limit).forEach(p -> {
                    String id = p.get("id").getAsString();
                    a.add(pageRow(
                            p,
                            counts.getOrDefault(id, new int[1])[0],
                            sums.getOrDefault(id, new long[1])[0],
                            kinds.get(id)));
                });
                out.add("pages", a);
                out.addProperty("total", pages.size());
                out.addProperty("nextOffset", offset + a.size());
                out.addProperty("done", offset + a.size() >= pages.size());
            }
            case "page_create" -> {
                String name = text(request, "name", "", PAGE_NAME_CHARS).strip();
                if (name.isEmpty())
                    throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.page_name_empty"));
                if (pages.size() >= MAX_PAGES)
                    throw fail("PAGE_LIMIT", EditorI18n.tr("cadeditor.message.vaultstore.page_limit", MAX_PAGES));
                long now = clock.getAsLong();
                JsonObject p = new JsonObject();
                p.addProperty("id", UUID.randomUUID().toString());
                p.addProperty("name", uniquePageName(name, "", pages));
                p.addProperty("created", now);
                p.addProperty("updated", now);
                var nextPages = new LinkedHashMap<>(pages);
                nextPages.put(p.get("id").getAsString(), p);
                publish(new LinkedHashMap<>(entries), nextPages);
                out.add("page", pageRow(p, 0, 0, null));
            }
            case "page_rename" -> {
                String id = text(request, "page", "", 36);
                JsonObject p = requirePage(id).deepCopy();
                String name = text(request, "name", "", PAGE_NAME_CHARS).strip();
                if (name.isEmpty() && !id.equals(DEFAULT_PAGE))
                    throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.page_name_empty"));
                p.addProperty("name", name.isEmpty() ? "" : uniquePageName(name, id, pages));
                p.addProperty("updated", clock.getAsLong());
                var nextPages = new LinkedHashMap<>(pages);
                nextPages.put(id, p);
                publish(new LinkedHashMap<>(entries), nextPages);
                out.add("page", pageRow(p, 0, 0, null));
            }
            case "page_move" -> {
                String id = text(request, "page", "", 36);
                JsonObject p = requirePage(id);
                int to = integer(request, "to", 0, 0, pages.size() - 1);
                List<JsonObject> order = new ArrayList<>(pages.values());
                order.remove(p);
                order.add(to, p);
                var nextPages = new LinkedHashMap<String, JsonObject>();
                order.forEach(x -> nextPages.put(x.get("id").getAsString(), x));
                publish(new LinkedHashMap<>(entries), nextPages);
                JsonArray ids = new JsonArray();
                nextPages.keySet().forEach(ids::add);
                out.add("order", ids);
            }
            case "page_delete" -> out = deletePage(request);
            case "move" -> {
                List<String> ids = ids(request, 100);
                String page = text(request, "page", "", 36);
                requirePage(page);
                var candidate = new LinkedHashMap<>(entries);
                for (String id : ids) {
                    JsonObject e = require(id).deepCopy();
                    setPage(e, page);
                    candidate.put(id, e);
                }
                publish(candidate, new LinkedHashMap<>(pages));
                out.addProperty("moved", ids.size());
                out.addProperty("page", page);
            }
            case "upgrade" -> out = upgrade(request, upgrader);
            default -> throw fail("UNKNOWN_OP", EditorI18n.tr("cadeditor.message.vaultstore.unknown_vault_operation"));
        }
        return decorate(out, op, text(request, "requestId", "", 128));
    }

    /** Common reply fields; also used by host-side operations that do not go through {@link #execute}. */
    public synchronized JsonObject decorate(JsonObject out, String op, String requestId) {
        out.addProperty("ok", true);
        out.addProperty("version", 1);
        out.addProperty("op", op);
        out.addProperty("requestId", requestId);
        out.addProperty("revision", revision);
        out.addProperty("persisted", persisted == revision);
        out.addProperty("readOnly", readOnly);
        if (!warning.isEmpty()) out.addProperty("warning", warning);
        if (!writeError.isEmpty()) out.addProperty("storageError", writeError);
        if (out.toString().length() > RESPONSE_CHARS)
            throw fail("RESPONSE_LIMIT", EditorI18n.tr("cadeditor.message.vaultstore.respond_8_mi_characters"));
        return out;
    }

    private static final Set<String> SORTS = Set.of("recent", "name", "item", "count", "size", "saved", "updated");

    private JsonObject list(JsonObject request, Validator validator) {
        JsonObject out = new JsonObject();
        String filter = text(request, "kind", "item", 16);
        if (!Set.of("item", "entity", "block", "player_preset", "all").contains(filter))
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.unknown_vault_category"));
        VaultQuery query = VaultQuery.parse(text(request, "query", "", 256), clock.getAsLong());
        JsonArray wanted = tags(request);
        String page = text(request, "page", "", 36);
        if (!page.isEmpty()) requirePage(page);
        int offset = integer(request, "offset", 0, 0, MAX_ENTRIES), limit = integer(request, "limit", 40, 1, 100);
        String sort = text(request, "sort", "recent", 16);
        if (!SORTS.contains(sort))
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.sort_invalid"));
        boolean reverse = bool(request, "reverse");
        List<JsonObject> rows = new ArrayList<>();
        for (var e : entries.values()) {
            if (!filter.equals("all") && !filter.equals(kind(e))) continue;
            if (!page.isEmpty() && !pageOf(e).equals(page)) continue;
            boolean matches = true;
            for (var t : wanted)
                if (!e.getAsJsonArray("tags").contains(t)) {
                    matches = false;
                    break;
                }
            if (!matches) continue;
            JsonObject r = row(e, validator, false);
            if (query.isEmpty() || query.matches(subject(e, r), pinyin)) rows.add(r);
        }
        // Natural direction: newest, largest and A-Z first; "reverse" flips only the chosen key.
        Comparator<JsonObject> cmp = switch (sort) {
            case "name" -> Comparator.comparing(e -> e.get("name").getAsString(), String.CASE_INSENSITIVE_ORDER);
            case "item" -> Comparator.comparing(e -> searchableId(e));
            case "count" ->
                Comparator.<JsonObject>comparingLong(VaultStore::countOf).reversed();
            case "size" ->
                Comparator.<JsonObject>comparingLong(e -> e.get("bytes").getAsLong())
                        .reversed();
            case "saved" ->
                Comparator.<JsonObject>comparingLong(e -> e.get("created").getAsLong())
                        .reversed();
            default ->
                Comparator.<JsonObject>comparingLong(e -> e.get("updated").getAsLong())
                        .reversed();
        };
        if (reverse) cmp = cmp.reversed();
        rows.sort(cmp.thenComparing(e -> e.get("id").getAsString()));
        JsonArray pageRows = new JsonArray();
        int size = 0;
        for (int i = offset; i < rows.size() && pageRows.size() < limit; i++) {
            int n = rows.get(i).toString().length();
            if (size + n > 20000) break;
            pageRows.add(rows.get(i));
            size += n;
        }
        out.add("entries", pageRows);
        out.addProperty("total", rows.size());
        out.addProperty("offset", offset);
        out.addProperty("nextOffset", offset + pageRows.size());
        out.addProperty("done", offset + pageRows.size() >= rows.size());
        return out;
    }

    private JsonObject importEntries(JsonObject request, Validator validator) {
        JsonObject out = new JsonObject();
        JsonObject root = request.has("text") ? parse(text(request, "text", "", MAX_FILE_BYTES)) : request;
        if (!READABLE.contains(integer(root, "version", 1, 1, Integer.MAX_VALUE)))
            throw fail("SCHEMA_VERSION", EditorI18n.tr("cadeditor.message.vaultstore.import_version_supported"));
        if (!root.has("entries") || !root.get("entries").isJsonArray())
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.entries_missing"));
        JsonArray input = root.getAsJsonArray("entries");
        if (input.size() > MAX_ENTRIES)
            throw fail("ENTRY_LIMIT", EditorI18n.tr("cadeditor.message.vaultstore.import_up_2000"));
        // Version 4 exports name their pages; unknown or invalid page records fall back to the default page.
        Map<String, JsonObject> sourcePages = new HashMap<>();
        if (root.has("pages") && root.get("pages").isJsonArray())
            for (var raw : root.getAsJsonArray("pages"))
                try {
                    if (raw.isJsonObject()) {
                        JsonObject p = validatePage(raw.getAsJsonObject());
                        sourcePages.put(p.get("id").getAsString(), p);
                    }
                } catch (RuntimeException ignored) {
                    // A bad page record never rejects the entries; they land on the default page.
                }
        int offset = integer(request, "offset", 0, 0, MAX_ENTRIES), limit = integer(request, "limit", 32, 1, 32);
        JsonArray results = new JsonArray();
        for (int i = offset; i < input.size() && results.size() < limit; i++) {
            // Reserve enough space for a maximally escaped 512-character Codec reason.
            if (results.toString().length() > 18000) break;
            JsonObject result = new JsonObject();
            result.addProperty("index", i);
            try {
                JsonObject e = input.get(i).getAsJsonObject().deepCopy();
                String wantedPage = e.has("page") && e.get("page").isJsonPrimitive()
                        ? e.get("page").getAsString()
                        : DEFAULT_PAGE;
                if (kind(e).equals("entity")) {
                    var valid = VaultEntities.validate(text(e, "snbt", "", MAX_FILE_BYTES));
                    result.add("stripped", valid.stripped());
                    result.add("warnings", valid.warnings());
                    if (!VaultEntities.registered(valid.id())) result.addProperty("compatibilityUnknown", true);
                }
                validateStored(e);
                String id = e.get("id").getAsString();
                if (entries.containsKey(id))
                    throw fail("ID_CONFLICT", EditorI18n.tr("cadeditor.message.vaultstore.id_already_exists"));
                // Preserve incompatible stacks verbatim; importing never silently migrates them.
                try {
                    if (kind(e).equals("item")) {
                        var v = validate(validator, object(e, "stack"));
                        e.add("stack", v.stack());
                        e.addProperty("hash", hash(v.stack()));
                        if (!v.lore().isEmpty()) e.addProperty("lore", clip(v.lore(), LORE_CHARS));
                    }
                } catch (Failure bad) {
                    result.addProperty(bad.code.equals("UNAVAILABLE") ? "compatibilityUnknown" : "incompatible", true);
                    result.addProperty("reason", bad.getMessage());
                    e.remove("hash");
                }
                if (VaultTemplates.supported(kind(e)))
                    e.addProperty("name", uniqueName(e.get("name").getAsString(), ""));
                setPage(e, importPage(wantedPage, sourcePages));
                put(e);
                result.addProperty("ok", true);
                result.addProperty("id", id);
            } catch (RuntimeException bad) {
                result.addProperty("ok", false);
                result.addProperty("error", bad instanceof Failure f ? f.code : "BAD_REQUEST");
                result.addProperty("reason", reason(bad));
            }
            results.add(result);
        }
        out.add("results", results);
        out.addProperty("nextOffset", offset + results.size());
        out.addProperty("done", offset + results.size() >= input.size());
        return out;
    }

    /** Local page for an imported entry: same page ID if known, else a copy of the exported page record. */
    private String importPage(String wanted, Map<String, JsonObject> sourcePages) {
        if (pages.containsKey(wanted)) return wanted;
        if (wanted.equals(DEFAULT_PAGE)) return DEFAULT_PAGE;
        JsonObject source = sourcePages.get(wanted);
        if (source == null || pages.size() >= MAX_PAGES) return DEFAULT_PAGE;
        JsonObject p = source.deepCopy();
        p.addProperty("name", uniquePageName(source.get("name").getAsString(), wanted, pages));
        p.addProperty("updated", clock.getAsLong());
        pages.put(wanted, p); // Published with the entry by put(); an unused empty page is harmless.
        return wanted;
    }

    private JsonObject deletePage(JsonObject request) {
        JsonObject out = new JsonObject();
        String id = text(request, "page", "", 36);
        JsonObject page = requirePage(id);
        if (id.equals(DEFAULT_PAGE))
            throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.default_page_cannot_delete"));
        List<JsonObject> inside = new ArrayList<>();
        for (var e : entries.values()) if (pageOf(e).equals(id)) inside.add(e);
        String mode = text(request, "entries", "", 8);
        if (!inside.isEmpty() && !Set.of("move", "delete").contains(mode))
            throw fail("PAGE_NOT_EMPTY", EditorI18n.tr("cadeditor.message.vaultstore.page_not_empty", inside.size()));
        var nextPages = new LinkedHashMap<>(pages);
        int index = new ArrayList<>(pages.keySet()).indexOf(id);
        nextPages.remove(id);
        var nextEntries = new LinkedHashMap<>(entries);
        if (!inside.isEmpty() && mode.equals("move")) {
            String target = text(request, "target", DEFAULT_PAGE, 36);
            if (target.equals(id) || !nextPages.containsKey(target))
                throw fail("PAGE_NOT_FOUND", EditorI18n.tr("cadeditor.message.vaultstore.page_not_found"));
            for (var e : inside) {
                JsonObject copy = e.deepCopy();
                setPage(copy, target);
                nextEntries.put(copy.get("id").getAsString(), copy);
            }
            out.addProperty("moved", inside.size());
            out.addProperty("target", target);
        } else if (!inside.isEmpty()) {
            for (var e : inside) nextEntries.remove(e.get("id").getAsString());
        }
        publish(nextEntries, nextPages);
        if (!inside.isEmpty() && mode.equals("delete")) {
            // Same 30-second undo as deleting entries; restore also brings the page back.
            deleted = List.copyOf(inside);
            deletedPage = page;
            deletedPageIndex = index;
            undoToken = UUID.randomUUID().toString();
            undoUntil = clock.getAsLong() + 30000;
            out.addProperty("deleted", inside.size());
            out.addProperty("token", undoToken);
            out.addProperty("expires", undoUntil);
        }
        out.addProperty("page", id);
        return out;
    }

    private boolean upgradable(JsonObject e) {
        return kind(e).equals("item") && e.get("mcDataVersion").getAsInt() < dataVersion;
    }

    /**
     * Single ({@code ids}) or batched ({@code all:true} with an {@code after} cursor over entry IDs) DataFixer upgrade.
     * Success replaces the stack and records the current data version; failure keeps the entry untouched and reports
     * why. Originals are written to a dated backup before the replaced entries reach disk. Never deletes.
     */
    private JsonObject upgrade(JsonObject request, Upgrader upgrader) {
        if (upgrader == null)
            throw fail("UNAVAILABLE", EditorI18n.tr("cadeditor.message.vaultstore.upgrade_needs_world"));
        List<JsonObject> targets = new ArrayList<>();
        boolean batch = bool(request, "all");
        String after = "";
        boolean done = true;
        if (batch) {
            after = text(request, "after", "", 36);
            int limit = integer(request, "limit", 8, 1, 16);
            List<JsonObject> candidates = new ArrayList<>();
            for (var e : entries.values())
                if (upgradable(e) && e.get("id").getAsString().compareTo(after) > 0) candidates.add(e);
            candidates.sort(Comparator.comparing(e -> e.get("id").getAsString()));
            targets.addAll(candidates.subList(0, Math.min(limit, candidates.size())));
            done = candidates.size() <= limit;
        } else for (String id : ids(request, 16)) targets.add(require(id));
        JsonArray results = new JsonArray();
        var candidate = new LinkedHashMap<>(entries);
        List<JsonObject> originals = new ArrayList<>();
        long now = clock.getAsLong();
        int upgraded = 0;
        String last = after;
        for (JsonObject e : targets) {
            String id = e.get("id").getAsString();
            last = id;
            int from = e.get("mcDataVersion").getAsInt();
            JsonObject result = new JsonObject();
            result.addProperty("id", id);
            result.addProperty("name", e.get("name").getAsString());
            result.addProperty("from", from);
            try {
                if (!kind(e).equals("item"))
                    throw fail("wrong_kind", EditorI18n.tr("cadeditor.message.vaultstore.upgrade_items_only"));
                if (from > dataVersion)
                    throw fail(
                            "NEWER_VERSION",
                            EditorI18n.tr("cadeditor.message.vaultstore.upgrade_newer_version", from, dataVersion));
                Validated v;
                try {
                    v = upgrader.upgrade(object(e, "stack").deepCopy(), from);
                } catch (Failure f) {
                    throw f;
                } catch (RuntimeException f) {
                    throw fail("INVALID_STACK", reason(f));
                }
                JsonObject next = e.deepCopy();
                next.add("stack", v.stack().deepCopy());
                next.addProperty("hash", hash(v.stack()));
                if (v.lore().isEmpty()) next.remove("lore");
                else next.addProperty("lore", clip(v.lore(), LORE_CHARS));
                next.addProperty("mcDataVersion", dataVersion);
                next.addProperty("modVersion", modVersion);
                next.addProperty("updated", now);
                if (bytes(next.toString()) > MAX_ENTRY_BYTES)
                    throw fail("ENTRY_TOO_LARGE", EditorI18n.tr("cadeditor.message.vaultstore.n8_mib"));
                candidate.put(id, next);
                originals.add(e);
                upgraded++;
                result.addProperty("ok", true);
                result.addProperty("to", dataVersion);
            } catch (RuntimeException bad) {
                result.addProperty("ok", false);
                result.addProperty("error", bad instanceof Failure f ? f.code : "INVALID_STACK");
                result.addProperty("reason", reason(bad));
            }
            results.add(result);
        }
        if (!originals.isEmpty()) {
            checkQuota(candidate.values());
            List<JsonObject> originalPages = new ArrayList<>();
            for (var p : pages.values())
                if (originals.stream()
                        .anyMatch(o -> pageOf(o).equals(p.get("id").getAsString()))) originalPages.add(p);
            requiredBackups.add(new PendingBackup("upgrade", envelope(List.copyOf(originals), originalPages)));
            entries.clear();
            entries.putAll(candidate);
            changed();
        }
        JsonObject out = new JsonObject();
        out.add("results", results);
        out.addProperty("upgraded", upgraded);
        out.addProperty("failed", targets.size() - upgraded);
        if (batch) {
            out.addProperty("nextAfter", last);
            out.addProperty("done", done);
        }
        return out;
    }

    /** Hashes of the stored, validated item stacks: import previews mark duplicates with them. */
    public synchronized Set<String> itemHashes() {
        Set<String> out = new HashSet<>();
        for (var e : entries.values())
            if (kind(e).equals("item") && e.has("hash")) out.add(e.get("hash").getAsString());
        return out;
    }

    public static String stackHash(JsonObject stack) {
        return hash(stack);
    }

    /** Structure/metadata check of one exported entry (a copy), as import would run it. Throws {@link Failure}. */
    public static void checkEntry(JsonObject entry) {
        JsonObject copy = entry.deepCopy();
        if (!copy.has("id")) copy.addProperty("id", UUID.randomUUID().toString());
        validateStored(copy);
    }

    public int dataVersion() {
        return dataVersion;
    }

    /**
     * Import prepared rows as new pages, one per batch. One revision, one quota pass that counts sizes as it goes, and
     * a per-row result: a row over a limit fails alone. {@code skipDuplicates} skips validated items whose typed hash
     * is already stored or appeared earlier in this import.
     */
    public synchronized JsonObject importBatches(List<Batch> batches, boolean skipDuplicates) {
        guardWritable();
        Set<String> seen = itemHashes();
        var nextPages = new LinkedHashMap<>(pages);
        var nextEntries = new LinkedHashMap<>(entries);
        long total = bytes(envelope(entries.values()).toString());
        long now = clock.getAsLong();
        int imported = 0, skipped = 0, failed = 0;
        JsonArray created = new JsonArray(), errors = new JsonArray();
        for (int g = 0; g < batches.size(); g++) {
            Batch b = batches.get(g);
            if (b.items().isEmpty()) continue;
            if (nextPages.size() >= MAX_PAGES) {
                failed += b.items().size();
                if (errors.size() < 20) {
                    JsonObject err = new JsonObject();
                    err.addProperty("group", g);
                    err.addProperty("error", "PAGE_LIMIT");
                    err.addProperty("reason", EditorI18n.tr("cadeditor.message.vaultstore.page_limit", MAX_PAGES));
                    errors.add(err);
                }
                continue;
            }
            JsonObject page = new JsonObject();
            page.addProperty("id", UUID.randomUUID().toString());
            page.addProperty(
                    "name",
                    uniquePageName(
                            b.pageName().isBlank()
                                    ? EditorI18n.tr("cadeditor.message.vaultstore.imported_page")
                                    : b.pageName(),
                            "",
                            nextPages));
            page.addProperty("created", now);
            page.addProperty("updated", now);
            long pageBytes = bytes(page.toString()) + 1;
            total += pageBytes;
            int added = 0;
            for (int i = 0; i < b.items().size(); i++) {
                Prepared p = b.items().get(i);
                try {
                    JsonObject e = preparedEntry(p, now);
                    setPage(e, page.get("id").getAsString());
                    String digest = kind(e).equals("item") && e.has("hash")
                            ? e.get("hash").getAsString()
                            : null;
                    if (skipDuplicates && digest != null && seen.contains(digest)) {
                        skipped++;
                        continue;
                    }
                    int eb = bytes(e.toString());
                    if (eb > MAX_ENTRY_BYTES)
                        throw fail("ENTRY_TOO_LARGE", EditorI18n.tr("cadeditor.message.vaultstore.n8_mib"));
                    if (nextEntries.size() >= MAX_ENTRIES)
                        throw fail("ENTRY_LIMIT", EditorI18n.tr("cadeditor.message.vaultstore.vault_up_2000_entries"));
                    if (total + eb + 1 > MAX_FILE_BYTES)
                        throw fail(
                                "FILE_LIMIT", EditorI18n.tr("cadeditor.message.vaultstore.vault_file_maximum_64_mib"));
                    nextEntries.put(e.get("id").getAsString(), e);
                    total += eb + 1;
                    added++;
                    imported++;
                    if (digest != null) seen.add(digest);
                } catch (RuntimeException bad) {
                    failed++;
                    if (errors.size() < 20) {
                        JsonObject err = new JsonObject();
                        err.addProperty("group", g);
                        err.addProperty("index", i);
                        err.addProperty("error", bad instanceof Failure f ? f.code : "BAD_REQUEST");
                        err.addProperty("reason", reason(bad));
                        errors.add(err);
                    }
                }
            }
            if (added > 0) {
                nextPages.put(page.get("id").getAsString(), page);
                JsonObject made = new JsonObject();
                made.add("id", page.get("id"));
                made.add("name", page.get("name"));
                made.addProperty("count", added);
                created.add(made);
            } else total -= pageBytes;
        }
        if (imported > 0) {
            entries.clear();
            entries.putAll(nextEntries);
            pages.clear();
            pages.putAll(nextPages);
            changed();
        }
        JsonObject out = new JsonObject();
        out.addProperty("imported", imported);
        out.addProperty("skipped", skipped);
        out.addProperty("failed", failed);
        out.add("pages", created);
        out.add("errors", errors);
        return out;
    }

    private JsonObject preparedEntry(Prepared p, long now) {
        if (p.entry() != null) {
            JsonObject e = p.entry().deepCopy();
            e.addProperty("id", UUID.randomUUID().toString());
            validateStored(e);
            if (kind(e).equals("item")) {
                if (p.reason() == null && p.stack() != null) {
                    e.add("stack", p.stack().deepCopy());
                    e.addProperty("hash", hash(p.stack()));
                    e.addProperty("mcDataVersion", dataVersion);
                    if (p.lore() != null && !p.lore().isEmpty()) e.addProperty("lore", clip(p.lore(), LORE_CHARS));
                } else e.remove("hash"); // The original stack and its data version stay for a later upgrade.
            }
            if (VaultTemplates.supported(kind(e)))
                e.addProperty("name", uniqueName(e.get("name").getAsString(), ""));
            return e;
        }
        JsonObject e = new JsonObject();
        e.addProperty("id", UUID.randomUUID().toString());
        String name = p.name() == null ? "" : clip(p.name().strip(), 256);
        if (name.isEmpty()) name = p.stack().has("id") ? p.stack().get("id").getAsString() : "?";
        e.addProperty("name", name);
        e.add("tags", new JsonArray());
        e.addProperty("note", "");
        e.addProperty("created", now);
        e.addProperty("updated", now);
        e.addProperty("mcDataVersion", p.reason() == null ? dataVersion : p.dataVersion());
        e.addProperty("modVersion", modVersion);
        e.addProperty("kind", "item");
        e.add("stack", p.stack().deepCopy());
        if (p.reason() == null) {
            e.addProperty("hash", hash(p.stack()));
            if (p.lore() != null && !p.lore().isEmpty()) e.addProperty("lore", clip(p.lore(), LORE_CHARS));
        }
        validateStored(e);
        return e;
    }

    public static void checkDepth(JsonElement value) {
        record Node(JsonElement value, int depth) {}
        ArrayDeque<Node> todo = new ArrayDeque<>();
        todo.add(new Node(value, 0));
        while (!todo.isEmpty()) {
            Node n = todo.removeLast();
            if (n.depth() > 96) throw fail("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultstore.json_overset"));
            if (n.value().isJsonObject())
                n.value().getAsJsonObject().entrySet().forEach(e -> todo.add(new Node(e.getValue(), n.depth() + 1)));
            else if (n.value().isJsonArray())
                n.value().getAsJsonArray().forEach(e -> todo.add(new Node(e, n.depth() + 1)));
        }
    }
}
