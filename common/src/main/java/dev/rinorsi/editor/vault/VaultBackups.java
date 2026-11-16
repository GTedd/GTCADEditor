package dev.rinorsi.editor.vault;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.rinorsi.editor.EditorI18n;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Date-stamped, rotating copies of the vault file next to it in {@code <name>-backups/}. Separate from the single
 * {@code .bak} the writer keeps: these are taken before the first write of a session, once a day, by hand, and before
 * an upgrade or a restore replaces entries. The oldest files beyond {@link #MAX_FILES} or {@link #MAX_BYTES} are
 * removed; only names this class wrote are ever listed, read or deleted.
 */
public final class VaultBackups {
    public static final int MAX_FILES = 20;
    public static final long MAX_BYTES = 256L * 1024 * 1024;
    public static final long DAY_MS = 24L * 60 * 60 * 1000;
    public static final Set<String> REASONS = Set.of("startup", "daily", "manual", "upgrade", "restore");

    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS");
    private static final Pattern NAME =
            Pattern.compile("([a-z0-9_.]+)-(\\d{8}-\\d{6}-\\d{3})(?:-(\\d{1,4}))?-([a-z]+)\\.json");

    private final Path dir;
    private final String base;

    public VaultBackups(Path vaultFile) {
        String file = vaultFile.getFileName().toString().toLowerCase(Locale.ROOT);
        String stem = file.endsWith(".json") ? file.substring(0, file.length() - 5) : file;
        base = stem.replaceAll("[^a-z0-9_.]", "_");
        dir = vaultFile.toAbsolutePath().resolveSibling(base + "-backups");
    }

    public Path directory() {
        return dir;
    }

    public record Info(String name, long time, String reason, long bytes) {
        JsonObject json() {
            JsonObject o = new JsonObject();
            o.addProperty("name", name);
            o.addProperty("time", time);
            o.addProperty("reason", reason);
            o.addProperty("bytes", bytes);
            return o;
        }
    }

    /** Parsed name, or null for anything this class did not write. */
    private Info info(Path file) {
        String name = file.getFileName().toString();
        Matcher m = NAME.matcher(name);
        if (!m.matches() || !m.group(1).equals(base) || !REASONS.contains(m.group(4))) return null;
        long time;
        try {
            time = LocalDateTime.parse(m.group(2), STAMP)
                    .atZone(ZoneId.systemDefault())
                    .toInstant()
                    .toEpochMilli();
        } catch (RuntimeException e) {
            return null;
        }
        long bytes;
        try {
            bytes = Files.size(file);
        } catch (IOException e) {
            bytes = -1;
        }
        return new Info(name, time, m.group(4), bytes);
    }

    /** Newest first. Missing directory is an empty list. */
    public List<Info> list() throws IOException {
        if (!Files.isDirectory(dir)) return List.of();
        List<Info> out = new ArrayList<>();
        try (var files = Files.list(dir)) {
            files.filter(Files::isRegularFile).forEach(p -> {
                Info i = info(p);
                if (i != null) out.add(i);
            });
        }
        out.sort(Comparator.comparingLong(Info::time).reversed().thenComparing(Info::name, Comparator.reverseOrder()));
        return out;
    }

    public JsonArray json() throws IOException {
        JsonArray a = new JsonArray();
        for (Info i : list()) a.add(i.json());
        return a;
    }

    public long newest() {
        try {
            List<Info> all = list();
            return all.isEmpty() ? Long.MIN_VALUE : all.get(0).time();
        } catch (IOException e) {
            return Long.MIN_VALUE;
        }
    }

    /** The page only ever names a file; anything that is not one of ours, or escapes the directory, is refused. */
    public Path resolve(String name) {
        Path candidate = dir.resolve(name).normalize();
        Info i =
                candidate.getParent() != null && candidate.getParent().equals(dir.normalize()) ? info(candidate) : null;
        if (i == null || !Files.isRegularFile(candidate))
            throw new VaultStore.Failure("NOT_FOUND", EditorI18n.tr("cadeditor.message.vaultbackups.backup_not_found"));
        return candidate;
    }

    /** Writes {@code data} to a new dated file (temp file, force, atomic move), then rotates. Returns the name. */
    public String write(byte[] data, long now, String reason) throws IOException {
        if (!REASONS.contains(reason)) throw new IllegalArgumentException(reason);
        Files.createDirectories(dir);
        Path temp = Files.createTempFile(dir, "backup-", ".tmp");
        try {
            try (var file = FileChannel.open(temp, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(data);
                while (buffer.hasRemaining()) file.write(buffer);
                file.force(true);
            }
            String stamp = LocalDateTime.ofInstant(Instant.ofEpochMilli(now), ZoneId.systemDefault())
                    .format(STAMP);
            Path target = dir.resolve(base + "-" + stamp + "-" + reason + ".json");
            for (int n = 2; Files.exists(target) && n < 10000; n++)
                target = dir.resolve(base + "-" + stamp + "-" + n + "-" + reason + ".json");
            Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
            prune(target.getFileName().toString());
            return target.getFileName().toString();
        } finally {
            Files.deleteIfExists(temp);
        }
    }

    /** Oldest beyond the count or byte budget go first; the file just written is always kept. */
    void prune(String keep) throws IOException {
        List<Info> all = list();
        long total = 0;
        int kept = 0;
        for (Info i : all) {
            boolean mine = i.name().equals(keep);
            if (mine || (kept < MAX_FILES && total + Math.max(0, i.bytes()) <= MAX_BYTES)) {
                kept++;
                total += Math.max(0, i.bytes());
                continue;
            }
            Files.deleteIfExists(dir.resolve(i.name()));
        }
    }
}
