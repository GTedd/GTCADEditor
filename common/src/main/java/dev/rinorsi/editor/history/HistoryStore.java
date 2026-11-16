package dev.rinorsi.editor.history;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * History records in memory and in an append-only journal ({@code history.jsonl}: header, add, edit and delete lines),
 * written on a background thread and rewritten when it doubles. Damaged lines are skipped.
 */
public final class HistoryStore implements AutoCloseable {
    public static final String FILE = "history.jsonl";
    private static final Logger LOG = LoggerFactory.getLogger("cadeditor.history");
    private static final int MIN_COMPACT = 1024;

    public record Page(int total, int page, int size, List<HistoryRecord> records) {}

    private final Path file;
    private final HistorySettings settings;
    private final LongSupplier clock;
    private final LinkedHashMap<Long, HistoryRecord> records = new LinkedHashMap<>();
    private final ExecutorService io;
    private BufferedWriter writer;
    private long nextId = 1;
    private int journalLines;
    private int skippedLines;
    private boolean closed;

    private HistoryStore(Path directory, HistorySettings settings, LongSupplier clock) {
        this.file = directory.resolve(FILE);
        this.settings = settings;
        this.clock = clock;
        this.io = Executors.newSingleThreadExecutor(r -> {
            var thread = new Thread(r, "CAD-Editor-History");
            thread.setDaemon(true);
            return thread;
        });
    }

    /** Loads (or creates) the journal in {@code directory} and applies retention. */
    public static HistoryStore open(Path directory, HistorySettings settings, LongSupplier clock) throws IOException {
        Files.createDirectories(directory);
        var store = new HistoryStore(directory, settings, clock);
        store.load();
        return store;
    }

    private void load() throws IOException {
        if (Files.exists(file)) {
            try (var lines = Files.lines(file, StandardCharsets.UTF_8)) {
                lines.forEach(this::replay);
            }
        }
        if (skippedLines > 0) LOG.warn("[CAD-Editor-History] {}: skipped {} damaged line(s)", file, skippedLines);
        int dropped = applyRetention("system:retention").size();
        if (dropped > 0
                || skippedLines > 0
                || !Files.exists(file)
                || journalLines > Math.max(MIN_COMPACT, records.size() * 2)) rewrite();
        else
            writer = Files.newBufferedWriter(
                    file, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        LOG.debug("[CAD-Editor-History] {} record(s) in {}", records.size(), file);
    }

    private void replay(String line) {
        if (line.isBlank()) return;
        journalLines++;
        try {
            JsonObject json = JsonParser.parseString(line).getAsJsonObject();
            switch (json.get("op").getAsString()) {
                case "header" -> nextId = Math.max(nextId, json.get("nextId").getAsLong());
                case "add" -> {
                    var record = HistoryRecord.fromJson(json.getAsJsonObject("record"));
                    records.put(record.id, record);
                    nextId = Math.max(nextId, record.id + 1);
                }
                case "edit" -> {
                    var record = records.get(json.get("id").getAsLong());
                    if (record != null)
                        record.edit(
                                json.has("note") ? json.get("note").getAsString() : null,
                                json.has("tags") ? strings(json.getAsJsonArray("tags")) : null,
                                json.get("by").getAsString(),
                                json.get("at").getAsLong());
                }
                case "delete" -> json.getAsJsonArray("ids").forEach(id -> records.remove(id.getAsLong()));
                default -> skippedLines++;
            }
        } catch (RuntimeException e) {
            skippedLines++;
        }
    }

    // ---- Create ----

    /** Stores a draft with the next id and the current time. */
    public synchronized HistoryRecord add(HistoryRecord draft) {
        requireOpen();
        var record = draft.withIdentity(nextId++, clock.getAsLong());
        records.put(record.id, record);
        var line = new JsonObject();
        line.addProperty("op", "add");
        line.add("record", record.toJson());
        append(line);
        if (records.size() > settings.maxRecords()
                || expired(records.firstEntry().getValue())) applyRetention("system:retention");
        return record;
    }

    // ---- Read ----

    public synchronized Optional<HistoryRecord> get(long id) {
        return Optional.ofNullable(records.get(id));
    }

    /** Matching records, newest first; {@code page} counts from 0, {@code size} is 1-100. */
    public synchronized Page query(HistoryQuery query, int page, int size) {
        if (page < 0 || size < 1 || size > 100) throw new IllegalArgumentException("page >= 0 and size 1-100");
        var out = new ArrayList<HistoryRecord>();
        int total = 0;
        long from = (long) page * size;
        for (var record : records.sequencedValues().reversed()) {
            if (!query.matches(record)) continue;
            if (total >= from && out.size() < size) out.add(record);
            total++;
        }
        return new Page(total, page, size, List.copyOf(out));
    }

    public synchronized int size() {
        return records.size();
    }

    // ---- Update ----

    /** Changes a record's note and/or tags (null keeps them); the recorded facts are immutable. */
    public synchronized HistoryRecord edit(long id, String note, List<String> tags, String by) {
        requireOpen();
        var record = records.get(id);
        if (record == null) throw new IllegalArgumentException("no record #" + id);
        String validNote = note == null ? null : HistoryRecord.note(note);
        List<String> validTags = tags == null ? null : HistoryRecord.tags(tags);
        long at = clock.getAsLong();
        record.edit(validNote, validTags, by, at);
        var line = new JsonObject();
        line.addProperty("op", "edit");
        line.addProperty("id", id);
        if (validNote != null) line.addProperty("note", validNote);
        if (validTags != null) {
            var array = new JsonArray();
            validTags.forEach(array::add);
            line.add("tags", array);
        }
        line.addProperty("by", by);
        line.addProperty("at", at);
        append(line);
        return record;
    }

    // ---- Delete ----

    /** Deletes these records; returns the ids that existed. */
    public synchronized List<Long> delete(Collection<Long> ids, String by) {
        requireOpen();
        var removed = new ArrayList<Long>();
        for (long id : ids) if (records.remove(id) != null) removed.add(id);
        journalDelete(removed, by);
        return removed;
    }

    /** Deletes every record the (non-empty) query matches; returns their ids. */
    public synchronized List<Long> purge(HistoryQuery query, String by) {
        requireOpen();
        if (query.isEmpty()) throw new IllegalArgumentException("purge needs at least one filter");
        var removed = new ArrayList<Long>();
        records.values().removeIf(record -> {
            if (!query.matches(record)) return false;
            removed.add(record.id);
            return true;
        });
        journalDelete(removed, by);
        return removed;
    }

    private List<Long> applyRetention(String by) {
        var removed = new ArrayList<Long>();
        var iterator = records.values().iterator();
        while (iterator.hasNext()) {
            var record = iterator.next();
            if (records.size() <= settings.maxRecords() && !expired(record)) break;
            iterator.remove();
            removed.add(record.id);
        }
        if (writer != null) journalDelete(removed, by);
        return removed;
    }

    private boolean expired(HistoryRecord record) {
        return settings.retentionDays() > 0
                && record.time < clock.getAsLong() - TimeUnit.DAYS.toMillis(settings.retentionDays());
    }

    private void journalDelete(List<Long> ids, String by) {
        if (ids.isEmpty()) return;
        var line = new JsonObject();
        line.addProperty("op", "delete");
        var array = new JsonArray();
        ids.forEach(array::add);
        line.add("ids", array);
        line.addProperty("by", by);
        line.addProperty("at", clock.getAsLong());
        append(line);
    }

    // ---- Journal ----

    private void append(JsonObject line) {
        String text = line.toString();
        journalLines++;
        boolean compact = journalLines > Math.max(MIN_COMPACT, records.size() * 2);
        List<String> snapshot = compact ? snapshotLines() : null;
        if (compact) journalLines = snapshot.size();
        io.execute(() -> {
            try {
                if (snapshot != null) writeSnapshot(snapshot);
                else {
                    writer.write(text);
                    writer.newLine();
                    writer.flush();
                }
            } catch (IOException e) {
                LOG.error("[CAD-Editor-History] cannot write {}; the record stays in memory only", file, e);
            }
        });
    }

    private List<String> snapshotLines() {
        var lines = new ArrayList<String>(records.size() + 1);
        var header = new JsonObject();
        header.addProperty("op", "header");
        header.addProperty("version", 1);
        header.addProperty("nextId", nextId);
        lines.add(header.toString());
        for (var record : records.values()) {
            var line = new JsonObject();
            line.addProperty("op", "add");
            line.add("record", record.toJson());
            lines.add(line.toString());
        }
        return lines;
    }

    private void rewrite() throws IOException {
        var lines = snapshotLines();
        journalLines = lines.size();
        writeSnapshot(lines);
    }

    /** The live records in a new file that replaces the journal atomically. */
    private void writeSnapshot(List<String> lines) throws IOException {
        if (writer != null) writer.close();
        var temporary = file.resolveSibling(FILE + ".tmp");
        Files.write(temporary, lines, StandardCharsets.UTF_8);
        Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        writer = Files.newBufferedWriter(
                file, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    }

    private static List<String> strings(JsonArray array) {
        var out = new ArrayList<String>();
        array.forEach(element -> out.add(element.getAsString()));
        return out;
    }

    private void requireOpen() {
        if (closed) throw new IllegalStateException("history is closed");
    }

    /** Writes everything queued and closes the journal. */
    @Override
    public void close() {
        synchronized (this) {
            if (closed) return;
            closed = true;
        }
        io.shutdown();
        try {
            if (!io.awaitTermination(10, TimeUnit.SECONDS))
                LOG.warn("[CAD-Editor-History] journal writes did not finish in 10s");
            if (writer != null) writer.close();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
