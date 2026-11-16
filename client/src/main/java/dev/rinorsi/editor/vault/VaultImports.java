package dev.rinorsi.editor.vault;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.serialization.JsonOps;
import dev.rinorsi.editor.EditorI18n;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import net.minecraft.core.RegistryAccess;
import net.minecraft.nbt.*;
import net.minecraft.util.datafix.DataFixTypes;
import net.minecraft.util.datafix.DataFixers;

/**
 * Item sources for the vault: one file the player picked in the native dialog, NBT Editor's client chest
 * ({@code <gameDir>/nbteditor/client_chest/page<N>.nbt}), Librarian hotbars ({@code <gameDir>/hotbars/hotbar.<N>.nbt})
 * and the vanilla creative hotbar ({@code <gameDir>/hotbar.nbt}). Only those fixed paths, or the picked file, are read;
 * nothing there is ever written. Every read is bounded: file size on disk, decompressed bytes, and the NBT heap/depth
 * quota of {@link NbtAccounter}. Reading and DataFixer run off the client thread; {@link #prepare} decodes against
 * the current registries and belongs on the client thread.
 */
public final class VaultImports {
    private VaultImports() {}

    /** fileBytes: on disk per file; nbtBytes: decompressed stream and NBT heap quota per file; totalBytes: one source. */
    public record Limits(long fileBytes, long nbtBytes, long totalBytes, int items, int files) {
        public static final Limits DEFAULT = new Limits(16L << 20, 64L << 20, 64L << 20, 2000, 256);
    }

    /**
     * One row before decoding. {@code tag}: item NBT, already in the current format when {@code fixError} is null,
     * else the untouched source tag of {@code dataVersion}. {@code entry}: a whole entry from a vault export.
     * {@code wire}: an editor wire stack (current format).
     */
    public record Candidate(
            int group, CompoundTag tag, int dataVersion, String fixError, JsonObject entry, JsonObject wire) {}

    public record Source(String kind, List<String> groups, List<Candidate> items, List<String> warnings) {}

    /** One preview row. {@code prepared == null} means it cannot be imported at all; {@code error} says why. */
    public record Row(
            int group,
            String kind,
            String id,
            int count,
            String name,
            int bytes,
            VaultStore.Prepared prepared,
            String error,
            String hash) {}

    /** Item format before components (1.20.4); used when a legacy-shaped item carries no DataVersion. */
    public static final int LEGACY_ITEM_VERSION = 3700;
    /** Vanilla's own fallback for a hotbar.nbt without DataVersion. */
    public static final int HOTBAR_DEFAULT_VERSION = 1343;

    private static final Pattern NBT_EDITOR_PAGE = Pattern.compile("page(-?\\d{1,6})\\.nbt");
    private static final Pattern LIBRARIAN_HOTBAR = Pattern.compile("hotbar\\.(-?\\d{1,6})\\.nbt");

    public static Path nbtEditorDir(Path gameDir) {
        return gameDir.resolve("nbteditor").resolve("client_chest");
    }

    public static Path librarianDir(Path gameDir) {
        return gameDir.resolve("hotbars");
    }

    public static Path vanillaHotbar(Path gameDir) {
        return gameDir.resolve("hotbar.nbt");
    }

    private static VaultStore.Failure fail(String code, String reason) {
        return new VaultStore.Failure(code, VaultStore.clip(reason, 512));
    }

    /** Which other-mod sources exist; only counts files at the fixed paths. */
    public static JsonArray scan(Path gameDir) {
        JsonArray out = new JsonArray();
        out.add(sourceInfo(
                "nbteditor",
                numbered(nbtEditorDir(gameDir), NBT_EDITOR_PAGE, Integer.MAX_VALUE)
                        .size()));
        out.add(sourceInfo(
                "librarian",
                numbered(librarianDir(gameDir), LIBRARIAN_HOTBAR, Integer.MAX_VALUE)
                        .size()));
        out.add(sourceInfo("hotbar", Files.isRegularFile(vanillaHotbar(gameDir)) ? 1 : 0));
        return out;
    }

    private static JsonObject sourceInfo(String source, int files) {
        JsonObject o = new JsonObject();
        o.addProperty("source", source);
        o.addProperty("files", files);
        return o;
    }

    /** {@code page3.nbt} style files sorted by their number; at most {@code max}. Missing directory: empty. */
    private static List<Map.Entry<Integer, Path>> numbered(Path dir, Pattern pattern, int max) {
        List<Map.Entry<Integer, Path>> out = new ArrayList<>();
        if (!Files.isDirectory(dir)) return out;
        try (var files = Files.list(dir)) {
            files.forEach(p -> {
                Matcher m = pattern.matcher(p.getFileName().toString());
                if (m.matches() && Files.isRegularFile(p)) out.add(Map.entry(Integer.parseInt(m.group(1)), p));
            });
        } catch (IOException | UncheckedIOException ignored) {
            return out;
        }
        out.sort(Map.Entry.comparingByKey());
        return out.size() > max ? new ArrayList<>(out.subList(0, max)) : out;
    }

    // ---------------------------------------------------------------- reading

    /** Bounded stream: refuses to deliver more than {@code max} bytes (zip bombs, endless streams). */
    private static final class Capped extends FilterInputStream {
        private long left;

        Capped(InputStream in, long max) {
            super(in);
            left = max;
        }

        private void take(long n) throws IOException {
            left -= n;
            if (left < 0) throw new IOException(EditorI18n.tr("cadeditor.message.vaultimports.too_large_unpacked"));
        }

        @Override
        public int read() throws IOException {
            int b = super.read();
            if (b >= 0) take(1);
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            int n = super.read(b, off, len);
            if (n > 0) take(n);
            return n;
        }
    }

    private static long checkSize(Path file, Limits limits) throws IOException {
        long size = Files.size(file);
        if (size > limits.fileBytes())
            throw fail(
                    "FILE_LIMIT",
                    EditorI18n.tr(
                            "cadeditor.message.vaultimports.file_too_large",
                            file.getFileName().toString(),
                            limits.fileBytes() / (1024 * 1024)));
        return size;
    }

    private static boolean binaryNbt(Path file) throws IOException {
        try (InputStream in = Files.newInputStream(file)) {
            int a = in.read(), b = in.read();
            return (a == 0x1f && b == 0x8b) || a == 0x0a;
        }
    }

    /** Gzip or plain binary NBT, bounded by the decompressed-byte cap and the NBT heap/depth quota. */
    public static CompoundTag readNbt(Path file, Limits limits) throws IOException {
        checkSize(file, limits);
        boolean gzip;
        try (InputStream in = Files.newInputStream(file)) {
            gzip = in.read() == 0x1f && in.read() == 0x8b;
        }
        try (InputStream raw = new BufferedInputStream(Files.newInputStream(file))) {
            InputStream body = gzip ? new GZIPInputStream(raw) : raw;
            DataInputStream data = new DataInputStream(new BufferedInputStream(new Capped(body, limits.nbtBytes())));
            return NbtIo.read(data, new NbtAccounter(limits.nbtBytes(), 512));
        } catch (NbtAccounterException quota) {
            throw fail(
                    "FILE_LIMIT",
                    EditorI18n.tr(
                            "cadeditor.message.vaultimports.nbt_quota",
                            file.getFileName().toString(),
                            limits.nbtBytes() / (1024 * 1024)));
        } catch (RuntimeException | IOException bad) {
            if (bad instanceof VaultStore.Failure f) throw f;
            throw fail(
                    "BAD_FILE",
                    EditorI18n.tr(
                            "cadeditor.message.vaultimports.unreadable",
                            file.getFileName().toString(),
                            VaultStore.reason(bad)));
        }
    }

    public static String readText(Path file, Limits limits) throws IOException {
        checkSize(file, limits);
        String text = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
        return text.startsWith("﻿") ? text.substring(1) : text;
    }

    /** Collects candidates, enforcing the item cap; DataFixer runs here, off the client thread. */
    private static final class Builder {
        final String kind;
        final Limits limits;
        final int current;
        final List<String> groups = new ArrayList<>();
        final List<Candidate> items = new ArrayList<>();
        final List<String> warnings = new ArrayList<>();
        boolean full;

        Builder(String kind, Limits limits, int current) {
            this.kind = kind;
            this.limits = limits;
            this.current = current;
        }

        int group(String label) {
            groups.add(VaultStore.clip(label, VaultStore.PAGE_NAME_CHARS));
            return groups.size() - 1;
        }

        boolean room() {
            if (items.size() < limits.items()) return true;
            if (!full) warn(EditorI18n.tr("cadeditor.message.vaultimports.item_cap", limits.items()));
            full = true;
            return false;
        }

        void warn(String text) {
            if (warnings.size() < 20) warnings.add(VaultStore.clip(text, 300));
        }

        /** An item tag of {@code version}; empty slots and air are skipped. */
        void item(int group, CompoundTag tag, int version) {
            if (tag.isEmpty() || isAir(tag) || !room()) return;
            if (version >= current) {
                items.add(new Candidate(group, tag, current, null, null, null));
                return;
            }
            try {
                items.add(new Candidate(group, VaultUpgrade.fix(tag, version, current), current, null, null, null));
            } catch (RuntimeException failed) {
                items.add(new Candidate(group, tag, version, VaultStore.reason(failed), null, null));
            }
        }

        /** A tag whose items are already current (a fixed hotbar). */
        void fixed(int group, CompoundTag tag) {
            if (tag.isEmpty() || isAir(tag) || !room()) return;
            items.add(new Candidate(group, tag, current, null, null, null));
        }

        Source build() {
            return new Source(kind, List.copyOf(groups), List.copyOf(items), List.copyOf(warnings));
        }
    }

    private static boolean isAir(CompoundTag tag) {
        String id = tag.getStringOr("id", "");
        return id.equals("minecraft:air") || id.equals("air");
    }

    private static int itemVersion(int declared, CompoundTag tag, int current) {
        if (declared >= 0) return declared;
        return tag.contains("Count") || tag.contains("tag") ? LEGACY_ITEM_VERSION : current;
    }

    private static boolean isHotbar(CompoundTag root) {
        if (root.contains("Items") || root.contains("items") || root.contains("id")) return false;
        for (int row = 0; row < 9; row++) if (root.get(String.valueOf(row)) instanceof ListTag) return true;
        return false;
    }

    private static List<CompoundTag> compounds(ListTag list) {
        List<CompoundTag> out = new ArrayList<>();
        for (Tag t : list) if (t instanceof CompoundTag c) out.add(c);
        return out;
    }

    /** The whole hotbar file goes through the HOTBAR fixer (rows "0".."8", nine stacks each). */
    private static void hotbar(Builder b, int group, CompoundTag root, int declared) {
        int from = declared >= 0 ? declared : HOTBAR_DEFAULT_VERSION;
        CompoundTag fixed = null;
        if (from < b.current)
            try {
                fixed = DataFixTypes.HOTBAR.update(DataFixers.getDataFixer(), root.copy(), from, b.current);
            } catch (RuntimeException failed) {
                b.warn(EditorI18n.tr("cadeditor.message.vaultimports.hotbar_fix_failed", VaultStore.reason(failed)));
            }
        else fixed = root;
        for (int row = 0; row < 9; row++) {
            String key = String.valueOf(row);
            if (fixed != null) for (CompoundTag item : compounds(fixed.getListOrEmpty(key))) b.fixed(group, item);
            else for (CompoundTag item : compounds(root.getListOrEmpty(key))) b.item(group, item, from);
        }
    }

    /** Hotbar rows, a block entity's {@code Items}, a chest page's {@code items}, {@code {item:…}} or one item. */
    private static void classify(Builder b, int group, CompoundTag root) {
        int declared = root.getIntOr("DataVersion", -1);
        if (isHotbar(root)) {
            hotbar(b, group, root, declared);
            return;
        }
        for (String key : List.of("Items", "items"))
            if (root.get(key) instanceof ListTag list) {
                List<CompoundTag> slots = compounds(list);
                if (slots.stream().anyMatch(c -> c.contains("Slot")))
                    slots.sort(Comparator.comparingInt(c -> c.getIntOr("Slot", 0)));
                for (CompoundTag item : slots) {
                    CompoundTag copy = item.copy();
                    copy.remove("Slot");
                    b.item(group, copy, itemVersion(declared, copy, b.current));
                }
                return;
            }
        if (root.get("item") instanceof CompoundTag wrapped) {
            b.item(group, wrapped.copy(), itemVersion(declared, wrapped, b.current));
            return;
        }
        if (root.get("id") instanceof StringTag) {
            CompoundTag copy = root.copy();
            copy.remove("DataVersion");
            b.item(group, copy, itemVersion(declared, copy, b.current));
            return;
        }
        throw fail("UNKNOWN_FORMAT", EditorI18n.tr("cadeditor.message.vaultimports.unknown_format"));
    }

    /** {@code .nbt} (gzip or not), {@code .snbt} or {@code .json}; anything else is refused before reading. */
    public static Source readFile(Path file, Limits limits, int current) throws IOException {
        String name = file.getFileName().toString();
        String lower = name.toLowerCase(Locale.ROOT);
        Builder b = new Builder("file", limits, current);
        String label = EditorI18n.tr("cadeditor.message.vaultimports.page_file", VaultStore.clip(name, 36));
        if (lower.endsWith(".nbt")) {
            checkSize(file, limits);
            if (binaryNbt(file)) classify(b, b.group(label), readNbt(file, limits));
            else classify(b, b.group(label), snbt(readText(file, limits)));
        } else if (lower.endsWith(".snbt")) classify(b, b.group(label), snbt(readText(file, limits)));
        else if (lower.endsWith(".json")) json(b, label, readText(file, limits));
        else throw fail("UNSUPPORTED_FILE", EditorI18n.tr("cadeditor.message.vaultimports.unsupported_file"));
        if (b.items.isEmpty() && b.warnings.isEmpty()) b.warn(EditorI18n.tr("cadeditor.message.vaultimports.no_items"));
        return b.build();
    }

    private static CompoundTag snbt(String text) {
        try {
            return TagParser.parseCompoundFully(text.strip());
        } catch (com.mojang.brigadier.exceptions.CommandSyntaxException | RuntimeException bad) {
            throw fail(
                    "BAD_FILE",
                    EditorI18n.tr(
                            "cadeditor.message.vaultimports.bad_snbt", VaultStore.clip(bad.getMessage() + "", 200)));
        }
    }

    /** This vault's export (any version it reads), an editor wire stack, or vanilla JSON item data. */
    private static void json(Builder b, String label, String text) {
        JsonObject root = VaultStore.parse(text);
        if (root.has("entries") && root.get("entries").isJsonArray()) {
            vaultExport(b, label, root);
            return;
        }
        if (root.has("comps")) {
            if (b.room()) b.items.add(new Candidate(b.group(label), null, b.current, null, null, root));
            return;
        }
        Tag nbt;
        try {
            nbt = JsonOps.INSTANCE.convertTo(NbtOps.INSTANCE, root);
        } catch (RuntimeException bad) {
            throw fail("UNKNOWN_FORMAT", EditorI18n.tr("cadeditor.message.vaultimports.unknown_format"));
        }
        if (!(nbt instanceof CompoundTag tag))
            throw fail("UNKNOWN_FORMAT", EditorI18n.tr("cadeditor.message.vaultimports.unknown_format"));
        classify(b, b.group(label), tag);
    }

    /** One group per exported page; item stacks are fixed from the data version each entry recorded. */
    private static void vaultExport(Builder b, String label, JsonObject root) {
        Map<String, Integer> groups = new HashMap<>();
        Map<String, String> pageNames = new HashMap<>();
        if (root.has("pages") && root.get("pages").isJsonArray())
            for (JsonElement p : root.getAsJsonArray("pages"))
                if (p.isJsonObject()
                        && p.getAsJsonObject().has("id")
                        && p.getAsJsonObject().has("name"))
                    pageNames.put(
                            p.getAsJsonObject().get("id").getAsString(),
                            p.getAsJsonObject().get("name").getAsString());
        for (JsonElement raw : root.getAsJsonArray("entries")) {
            if (!b.room()) break;
            if (!raw.isJsonObject()) continue;
            JsonObject entry = raw.getAsJsonObject();
            String page = entry.has("page") && entry.get("page").isJsonPrimitive()
                    ? entry.get("page").getAsString()
                    : VaultStore.DEFAULT_PAGE;
            String pageName = pageNames.getOrDefault(page, "");
            int group = groups.computeIfAbsent(
                    pageName.isBlank() ? "" : page, k -> b.group(k.isEmpty() ? label : label + " · " + pageName));
            String kind = entry.has("kind") && entry.get("kind").isJsonPrimitive()
                    ? entry.get("kind").getAsString()
                    : "item";
            int version =
                    entry.has("mcDataVersion") && entry.get("mcDataVersion").isJsonPrimitive()
                            ? entry.get("mcDataVersion").getAsInt()
                            : b.current;
            if (!kind.equals("item")
                    || !entry.has("stack")
                    || !entry.get("stack").isJsonObject()) {
                b.items.add(new Candidate(group, null, version, null, entry, null));
                continue;
            }
            try {
                CompoundTag tag = VaultUpgrade.wireToNbt(entry.getAsJsonObject("stack"));
                b.items.add(
                        new Candidate(group, VaultUpgrade.fix(tag, version, b.current), b.current, null, entry, null));
            } catch (RuntimeException failed) {
                b.items.add(new Candidate(group, null, version, VaultStore.reason(failed), entry, null));
            }
        }
    }

    /** NBT Editor client chest pages; names come from its optional {@code page_names.json} ({"name": number}). */
    public static Source readNbtEditor(Path gameDir, Limits limits, int current) {
        Builder b = new Builder("nbteditor", limits, current);
        Path dir = nbtEditorDir(gameDir);
        Map<Integer, String> names = new HashMap<>();
        Path namesFile = dir.resolve("page_names.json");
        if (Files.isRegularFile(namesFile))
            try {
                JsonObject o = VaultStore.parse(readText(namesFile, new Limits(1 << 20, 1 << 20, 1 << 20, 0, 0)));
                for (var e : o.entrySet())
                    if (e.getValue().isJsonPrimitive()
                            && e.getValue().getAsJsonPrimitive().isNumber())
                        names.put(e.getValue().getAsInt(), e.getKey());
            } catch (IOException | RuntimeException bad) {
                b.warn(EditorI18n.tr(
                        "cadeditor.message.vaultimports.file_skipped", "page_names.json", VaultStore.reason(bad)));
            }
        readNumbered(b, numbered(dir, NBT_EDITOR_PAGE, limits.files()), limits, (number, root) -> {
            String label = names.containsKey(number)
                    ? names.get(number)
                    : EditorI18n.tr("cadeditor.message.vaultimports.page_number", number);
            return EditorI18n.tr("cadeditor.message.vaultimports.page_nbteditor", label);
        });
        return b.build();
    }

    /** Librarian hotbar files, each in the vanilla hotbar layout; a {@code librarian.name} becomes the page name. */
    public static Source readLibrarian(Path gameDir, Limits limits, int current) {
        Builder b = new Builder("librarian", limits, current);
        readNumbered(b, numbered(librarianDir(gameDir), LIBRARIAN_HOTBAR, limits.files()), limits, (number, root) -> {
            String label = librarianName(root);
            if (label.isEmpty()) label = "hotbar." + number;
            return EditorI18n.tr("cadeditor.message.vaultimports.page_librarian", label);
        });
        return b.build();
    }

    public static Source readHotbar(Path gameDir, Limits limits, int current) throws IOException {
        Builder b = new Builder("hotbar", limits, current);
        Path file = vanillaHotbar(gameDir);
        if (!Files.isRegularFile(file))
            throw fail("NOT_FOUND", EditorI18n.tr("cadeditor.message.vaultimports.hotbar_missing"));
        CompoundTag root = readNbt(file, limits);
        int group = b.group(EditorI18n.tr("cadeditor.message.vaultimports.page_hotbar"));
        hotbar(b, group, root, root.getIntOr("DataVersion", -1));
        return b.build();
    }

    @FunctionalInterface
    private interface Label {
        String of(int number, CompoundTag root);
    }

    /** One file per group; a file that fails is reported and skipped, the others still load. */
    private static void readNumbered(Builder b, List<Map.Entry<Integer, Path>> files, Limits limits, Label label) {
        long total = 0;
        for (var f : files) {
            if (b.full) break;
            Path file = f.getValue();
            try {
                total += Files.size(file);
                if (total > limits.totalBytes()) {
                    b.warn(EditorI18n.tr(
                            "cadeditor.message.vaultimports.source_too_large", limits.totalBytes() / (1024 * 1024)));
                    break;
                }
                CompoundTag root = readNbt(file, limits);
                // A page without items keeps its group label but creates no vault page on import.
                classify(b, b.group(label.of(f.getKey(), root)), root);
            } catch (IOException | RuntimeException bad) {
                b.warn(EditorI18n.tr(
                        "cadeditor.message.vaultimports.file_skipped",
                        file.getFileName().toString(),
                        VaultStore.reason(bad)));
            }
        }
    }

    private static String librarianName(CompoundTag root) {
        String raw = "";
        if (root.get("librarian") instanceof CompoundTag meta) raw = meta.getStringOr("name", "");
        if (raw.isEmpty()) return "";
        // Usually a JSON text component; keep only its plain text.
        try {
            JsonElement parsed = com.google.gson.JsonParser.parseString(raw);
            StringBuilder out = new StringBuilder();
            plain(parsed, out, 0);
            if (out.length() > 0) return VaultStore.clip(out.toString().strip(), 40);
        } catch (RuntimeException notJson) {
            // Plain string name.
        }
        return VaultStore.clip(raw.strip(), 40);
    }

    private static void plain(JsonElement e, StringBuilder out, int depth) {
        if (depth > 16 || out.length() > 64) return;
        if (e.isJsonPrimitive()) out.append(e.getAsString());
        else if (e.isJsonArray()) for (JsonElement x : e.getAsJsonArray()) plain(x, out, depth + 1);
        else if (e.isJsonObject()) {
            JsonObject o = e.getAsJsonObject();
            if (o.has("text")) plain(o.get("text"), out, depth + 1);
            if (o.has("extra")) plain(o.get("extra"), out, depth + 1);
        }
    }

    // ---------------------------------------------------------------- decoding (client thread)

    /** Strict decode against the current registries. Never throws: failures become rows with a reason. */
    public static Row prepare(Candidate c, RegistryAccess access, int current) {
        if (c.entry() != null) return prepareEntry(c, access, current);
        if (c.wire() != null) {
            String id = c.wire().has("id") ? c.wire().get("id").getAsString() : "?";
            int count = c.wire().has("count") ? c.wire().get("count").getAsInt() : 1;
            try {
                var v = VaultStacks.validate(c.wire(), access);
                return validRow(c.group(), v, count);
            } catch (RuntimeException bad) {
                return keptRow(c.group(), c.wire(), id, count, current, VaultStore.reason(bad));
            }
        }
        String id = c.tag().getStringOr("id", "?");
        int count = c.tag().contains("count")
                ? c.tag().getIntOr("count", 1)
                : c.tag().getByteOr("Count", (byte) 1);
        if (c.fixError() == null)
            try {
                var v = VaultUpgrade.validate(c.tag(), access);
                return validRow(c.group(), v, count);
            } catch (RuntimeException bad) {
                return keptRow(c.group(), VaultUpgrade.nbtToWire(c.tag()), id, count, current, VaultStore.reason(bad));
            }
        return keptRow(c.group(), VaultUpgrade.nbtToWire(c.tag()), id, count, c.dataVersion(), c.fixError());
    }

    private static Row validRow(int group, VaultStore.Validated v, int count) {
        JsonObject stack = v.stack();
        return new Row(
                group,
                "item",
                stack.get("id").getAsString(),
                stack.has("count") ? stack.get("count").getAsInt() : count,
                v.name(),
                bytes(stack),
                new VaultStore.Prepared(stack, v.name(), v.lore(), 0, null, null),
                null,
                VaultStore.stackHash(stack));
    }

    /** The raw stack is kept as an incompatible entry when it has a shape the vault can hold. */
    private static Row keptRow(int group, JsonObject raw, String id, int count, int version, String reason) {
        if (raw == null) return new Row(group, "item", id, count, id, 0, null, reason, null);
        return new Row(
                group,
                "item",
                raw.get("id").getAsString(),
                raw.has("count") ? raw.get("count").getAsInt() : count,
                raw.get("id").getAsString(),
                bytes(raw),
                new VaultStore.Prepared(raw, raw.get("id").getAsString(), "", version, reason, null),
                null,
                null);
    }

    private static Row prepareEntry(Candidate c, RegistryAccess access, int current) {
        JsonObject entry = c.entry();
        String kind = entry.has("kind") && entry.get("kind").isJsonPrimitive()
                ? entry.get("kind").getAsString()
                : "item";
        String name = entry.has("name") && entry.get("name").isJsonPrimitive()
                ? entry.get("name").getAsString()
                : "";
        String id = switch (kind) {
            case "entity" ->
                entry.has("entity") && entry.get("entity").isJsonObject()
                        ? entry.getAsJsonObject("entity").get("id").getAsString()
                        : "";
            case "block" ->
                entry.has("template")
                                && entry.get("template").isJsonObject()
                                && entry.getAsJsonObject("template").has("block")
                        ? entry.getAsJsonObject("template").get("block").getAsString()
                        : "minecraft:stone";
            case "player_preset" -> "minecraft:player";
            default ->
                entry.has("stack") && entry.get("stack").isJsonObject()
                        ? entry.getAsJsonObject("stack").get("id").getAsString()
                        : "";
        };
        try {
            VaultStore.checkEntry(entry);
        } catch (RuntimeException bad) {
            return new Row(c.group(), kind, id, 1, name, bytes(entry), null, VaultStore.reason(bad), null);
        }
        if (!kind.equals("item"))
            return new Row(
                    c.group(),
                    kind,
                    id,
                    1,
                    name,
                    bytes(entry),
                    new VaultStore.Prepared(null, name, "", c.dataVersion(), null, entry),
                    null,
                    null);
        int count = entry.getAsJsonObject("stack").get("count").getAsInt();
        if (c.fixError() == null && c.tag() != null)
            try {
                var v = VaultUpgrade.validate(c.tag(), access);
                return new Row(
                        c.group(),
                        kind,
                        v.stack().get("id").getAsString(),
                        count,
                        name,
                        bytes(entry),
                        new VaultStore.Prepared(v.stack(), name, v.lore(), current, null, entry),
                        null,
                        VaultStore.stackHash(v.stack()));
            } catch (RuntimeException bad) {
                return keptEntry(c, kind, id, count, name, VaultStore.reason(bad));
            }
        return keptEntry(c, kind, id, count, name, c.fixError());
    }

    private static Row keptEntry(Candidate c, String kind, String id, int count, String name, String reason) {
        return new Row(
                c.group(),
                kind,
                id,
                count,
                name,
                bytes(c.entry()),
                new VaultStore.Prepared(null, name, "", c.dataVersion(), reason, c.entry()),
                null,
                null);
    }

    private static int bytes(JsonObject o) {
        return o.toString().getBytes(StandardCharsets.UTF_8).length;
    }
}
