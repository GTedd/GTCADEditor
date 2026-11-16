package dev.rinorsi.editor.vault;

import com.google.gson.*;
import dev.rinorsi.editor.StackCodec;
import dev.rinorsi.editor.registry.search.Pinyin;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.zip.GZIPOutputStream;
import net.minecraft.SharedConstants;
import net.minecraft.core.*;
import net.minecraft.core.registries.*;
import net.minecraft.nbt.*;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.item.*;

/**
 * Import channels on real registries without a game window: file formats (.nbt gzip/plain: single item, hotbar
 * layout, block entity Items; .snbt; .json vault export / single item), NBT Editor client chest pages with names,
 * Librarian hotbars, the vanilla hotbar.nbt, the read limits, failure rows kept with reasons, duplicate skipping and
 * the new pages created on import. Source files are compared byte for byte to prove they are never written.
 */
public final class VaultImportsTest {
    private static int checks;
    private static RegistryAccess access;
    private static int current;
    private static final AtomicLong time = new AtomicLong(1794060000000L);

    private static void check(boolean pass, String name) {
        if (!pass) throw new AssertionError(name);
        checks++;
        System.out.println("PASS " + name);
    }

    private static void rejects(String code, ThrowingRunnable action) {
        try {
            action.run();
            throw new AssertionError("Expected " + code);
        } catch (VaultStore.Failure e) {
            check(e.code.equals(code), "reject " + code + " got " + e.code + " (" + e.getMessage() + ")");
        } catch (Exception e) {
            throw new AssertionError("Expected " + code + " got " + e, e);
        }
    }

    @FunctionalInterface
    interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static CompoundTag item(String id, int count) {
        CompoundTag t = new CompoundTag();
        t.putString("id", id);
        t.putInt("count", count);
        return t;
    }

    private static void writeNbt(Path file, CompoundTag tag, boolean gzip) throws IOException {
        Files.createDirectories(file.getParent());
        if (gzip) NbtIo.writeCompressed(tag, file);
        else NbtIo.write(tag, file);
    }

    private static List<VaultImports.Row> prepare(VaultImports.Source source) {
        List<VaultImports.Row> rows = new ArrayList<>();
        for (var c : source.items()) rows.add(VaultImports.prepare(c, access, current));
        return rows;
    }

    private static VaultImports.Source file(Path p) throws IOException {
        return VaultImports.readFile(p, VaultImports.Limits.DEFAULT, current);
    }

    private static CompoundTag hotbarRoot(int version, String... firstRow) {
        CompoundTag root = new CompoundTag();
        for (int row = 0; row < 9; row++) {
            ListTag list = new ListTag();
            for (int slot = 0; slot < 9; slot++)
                list.add(row == 0 && slot < firstRow.length ? item(firstRow[slot], 1) : new CompoundTag());
            root.put(String.valueOf(row), list);
        }
        root.putInt("DataVersion", version);
        return root;
    }

    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        current = SharedConstants.getCurrentVersion().dataVersion().version();
        var lookup = net.minecraft.data.registries.VanillaRegistries.createWorldLookup();
        BuiltInRegistries.DATA_COMPONENT_INITIALIZERS.build(lookup).forEach(p -> p.apply());
        var builtins = RegistryAccess.fromRegistryOfRegistries(BuiltInRegistries.REGISTRY);
        access = new RegistryAccess() {
            public <E> Optional<Registry<E>> lookup(
                    net.minecraft.resources.ResourceKey<? extends Registry<? extends E>> k) {
                return builtins.lookup(k);
            }

            public java.util.stream.Stream<RegistryAccess.RegistryEntry<?>> registries() {
                return builtins.registries();
            }

            public <V> net.minecraft.resources.RegistryOps<V> createSerializationContext(
                    com.mojang.serialization.DynamicOps<V> ops) {
                return lookup.createSerializationContext(ops);
            }
        };
        Path dir = Files.createTempDirectory("cadeditor-vault-imports-");
        Path game = dir.resolve("game");
        files(dir);
        otherMods(game);
        limits(dir);
        commit(dir, game);
        System.out.println("PASS VaultImportsTest " + checks + " checks; real registries; temp files " + dir);
    }

    private static void files(Path dir) throws Exception {
        Path single = dir.resolve("single.nbt");
        CompoundTag diamond = item("minecraft:diamond", 5);
        diamond.putInt("DataVersion", current);
        writeNbt(single, diamond, true);
        var rows = prepare(file(single));
        check(rows.size() == 1 && rows.get(0).count() == 5 && rows.get(0).hash() != null, "gzip single item");
        check(rows.get(0).name().length() > 0 && rows.get(0).bytes() > 0, "row has a name and size");

        Path plain = dir.resolve("plain.nbt");
        writeNbt(plain, item("minecraft:apple", 2), false);
        check(prepare(file(plain)).get(0).id().equals("minecraft:apple"), "uncompressed binary single item");

        Path legacy = dir.resolve("legacy.nbt");
        CompoundTag old = new CompoundTag();
        old.putString("id", "minecraft:stone");
        old.putByte("Count", (byte) 4);
        CompoundTag display = new CompoundTag();
        display.putString("Name", "{\"text\":\"旧名字\"}");
        CompoundTag tag = new CompoundTag();
        tag.put("display", display);
        old.put("tag", tag);
        writeNbt(legacy, old, true);
        var legacyRow = prepare(file(legacy)).get(0);
        check(
                legacyRow.prepared() != null
                        && legacyRow.prepared().reason() == null
                        && legacyRow.count() == 4
                        && legacyRow.name().equals("旧名字"),
                "pre-component item (no DataVersion) goes through DataFixer");

        Path chest = dir.resolve("chest.nbt");
        CompoundTag be = new CompoundTag();
        be.putString("id", "minecraft:chest");
        ListTag items = new ListTag();
        CompoundTag second = item("minecraft:gold_ingot", 7);
        second.putByte("Slot", (byte) 3);
        CompoundTag first = item("minecraft:iron_ingot", 9);
        first.putByte("Slot", (byte) 0);
        items.add(second);
        items.add(first);
        be.put("Items", items);
        be.putInt("DataVersion", current);
        writeNbt(chest, be, false);
        var chestRows = prepare(file(chest));
        check(
                chestRows.size() == 2
                        && chestRows.get(0).id().equals("minecraft:iron_ingot")
                        && chestRows.get(1).count() == 7,
                "block entity Items sorted by Slot");

        Path hotbar = dir.resolve("hotbar-copy.nbt");
        writeNbt(hotbar, hotbarRoot(current, "minecraft:bread", "minecraft:cookie"), false);
        check(prepare(file(hotbar)).size() == 2, "hotbar layout in a picked file; empty slots skipped");

        Path snbt = dir.resolve("sword.snbt");
        Files.writeString(
                snbt, "{id:\"minecraft:diamond_sword\",count:1,components:{\"minecraft:custom_name\":\"SNBT 剑\"}}");
        var snbtRow = prepare(file(snbt)).get(0);
        check(snbtRow.prepared().reason() == null && snbtRow.name().equals("SNBT 剑"), ".snbt single item");

        Path json = dir.resolve("apple.json");
        Files.writeString(json, "{\"id\":\"minecraft:apple\",\"count\":12}");
        check(prepare(file(json)).get(0).count() == 12, "vanilla JSON item");

        Path wire = dir.resolve("wire.json");
        JsonObject w = StackCodec.snapshot(new ItemStack(Items.EMERALD, 3), access, new JsonObject(), "");
        Files.writeString(wire, w.toString());
        check(prepare(file(wire)).get(0).id().equals("minecraft:emerald"), "editor wire stack JSON");

        Path unknown = dir.resolve("unknown.nbt");
        writeNbt(unknown, item("absent:thing", 1), false);
        var keptRow = prepare(file(unknown)).get(0);
        check(
                keptRow.prepared() != null
                        && keptRow.prepared().reason() != null
                        && keptRow.prepared().stack().get("id").getAsString().equals("absent:thing"),
                "unknown item kept as raw data with a reason");

        Path noId = dir.resolve("noid.snbt");
        Files.writeString(noId, "{Items:[{count:1}]}");
        var badRow = prepare(file(noId)).get(0);
        check(badRow.prepared() == null && badRow.error() != null, "unrepresentable row reported, not imported");

        Path unsupported = dir.resolve("notes.txt");
        Files.writeString(unsupported, "hello");
        rejects("UNSUPPORTED_FILE", () -> file(unsupported));
        Path shapeless = dir.resolve("shapeless.snbt");
        Files.writeString(shapeless, "{foo:1}");
        rejects("UNKNOWN_FORMAT", () -> file(shapeless));
        Path broken = dir.resolve("broken.snbt");
        Files.writeString(broken, "{id:");
        rejects("BAD_FILE", () -> file(broken));
    }

    private static void otherMods(Path game) throws Exception {
        Path chestDir = VaultImports.nbtEditorDir(game);
        CompoundTag page0 = new CompoundTag();
        ListTag items = new ListTag();
        items.add(item("minecraft:diamond", 3));
        items.add(new CompoundTag());
        items.add(item("minecraft:emerald", 1));
        page0.put("items", items);
        page0.putInt("DataVersion", current);
        writeNbt(chestDir.resolve("page0.nbt"), page0, true);
        CompoundTag page2 = new CompoundTag();
        ListTag oldItems = new ListTag();
        CompoundTag oldStone = new CompoundTag();
        oldStone.putString("id", "minecraft:stone");
        oldStone.putByte("Count", (byte) 2);
        oldItems.add(oldStone);
        page2.put("items", oldItems);
        page2.putInt("DataVersion", 3700);
        writeNbt(chestDir.resolve("page2.nbt"), page2, false);
        Files.writeString(chestDir.resolve("page_names.json"), "{\"矿物\":0}");
        Files.writeString(chestDir.resolve("notes.nbt"), "ignored: not a page file");

        Path librarian = VaultImports.librarianDir(game);
        CompoundTag kit = hotbarRoot(current, "minecraft:bow", "minecraft:arrow");
        CompoundTag meta = new CompoundTag();
        meta.putString("name", "{\"text\":\"PVP Kit\"}");
        kit.put("librarian", meta);
        writeNbt(librarian.resolve("hotbar.0.nbt"), kit, false);
        writeNbt(librarian.resolve("hotbar.-1.nbt"), hotbarRoot(current, "minecraft:torch"), true);
        Files.writeString(librarian.resolve("hotbar.2.nbt"), "not nbt at all");

        writeNbt(VaultImports.vanillaHotbar(game), hotbarRoot(current, "minecraft:cake"), false);

        Map<Path, byte[]> before = new HashMap<>();
        try (var walk = Files.walk(game)) {
            for (Path p : walk.filter(Files::isRegularFile).toList()) before.put(p, Files.readAllBytes(p));
        }

        JsonArray scan = VaultImports.scan(game);
        check(scan.get(0).getAsJsonObject().get("files").getAsInt() == 2, "scan counts NBT Editor pages only");
        check(scan.get(1).getAsJsonObject().get("files").getAsInt() == 3, "scan counts Librarian hotbar files");
        check(scan.get(2).getAsJsonObject().get("files").getAsInt() == 1, "scan finds vanilla hotbar.nbt");

        var nbtEditor = VaultImports.readNbtEditor(game, VaultImports.Limits.DEFAULT, current);
        check(nbtEditor.groups().size() == 2, "one group per NBT Editor page");
        check(nbtEditor.groups().get(0).contains("矿物"), "page name from page_names.json");
        var nbtRows = prepare(nbtEditor);
        check(nbtRows.size() == 3, "empty slots skipped");
        check(
                nbtRows.get(2).count() == 2 && nbtRows.get(2).prepared().reason() == null,
                "old NBT Editor page upgraded by DataFixer");

        var lib = VaultImports.readLibrarian(game, VaultImports.Limits.DEFAULT, current);
        check(lib.groups().get(0).contains("hotbar.-1"), "Librarian files sorted by number, negative first");
        check(lib.groups().get(1).contains("PVP Kit"), "Librarian name from its JSON text");
        check(prepare(lib).size() == 3, "Librarian rows");
        check(
                lib.warnings().size() == 1 && lib.warnings().get(0).contains("hotbar.2.nbt"),
                "bad file skipped, others read");

        var vanilla = VaultImports.readHotbar(game, VaultImports.Limits.DEFAULT, current);
        check(prepare(vanilla).get(0).id().equals("minecraft:cake"), "vanilla hotbar.nbt");

        try (var walk = Files.walk(game)) {
            for (Path p : walk.filter(Files::isRegularFile).toList())
                check(Arrays.equals(before.get(p), Files.readAllBytes(p)), "source untouched " + game.relativize(p));
        }
        Path empty = Files.createTempDirectory("cadeditor-empty-game-");
        rejects("NOT_FOUND", () -> VaultImports.readHotbar(empty, VaultImports.Limits.DEFAULT, current));
        check(
                VaultImports.readNbtEditor(empty, VaultImports.Limits.DEFAULT, current)
                        .items()
                        .isEmpty(),
                "missing dir");
    }

    private static void limits(Path dir) throws Exception {
        var tiny = new VaultImports.Limits(64 * 1024, 4096, 1 << 20, 3, 4);
        Path big = dir.resolve("big.snbt");
        Files.writeString(big, "{id:\"minecraft:paper\",count:1,x:\"" + "y".repeat(70 * 1024) + "\"}");
        rejects("FILE_LIMIT", () -> VaultImports.readFile(big, tiny, current));

        Path heavy = dir.resolve("heavy.nbt");
        CompoundTag t = item("minecraft:paper", 1);
        t.putString("payload", "z".repeat(20000));
        writeNbt(heavy, t, true);
        check(Files.size(heavy) < 64 * 1024, "compressed fixture is small on disk");
        rejects("BAD_FILE", () -> VaultImports.readFile(heavy, tiny, current));

        Path bomb = dir.resolve("bomb.nbt");
        try (var out = new GZIPOutputStream(Files.newOutputStream(bomb))) {
            out.write(new byte[] {10, 0, 0, 8, 0, 1, 'x'});
            byte[] zeros = new byte[64 * 1024];
            for (int i = 0; i < 64; i++) out.write(zeros);
        }
        check(Files.size(bomb) < 64 * 1024, "zip bomb is small on disk");
        rejects("BAD_FILE", () -> VaultImports.readFile(bomb, tiny, current));

        Path many = dir.resolve("many.nbt");
        CompoundTag be = new CompoundTag();
        ListTag list = new ListTag();
        for (int i = 0; i < 10; i++) list.add(item("minecraft:stick", 1));
        be.put("Items", list);
        writeNbt(many, be, false);
        var capped = VaultImports.readFile(many, tiny, current);
        check(capped.items().size() == 3 && !capped.warnings().isEmpty(), "item cap stops reading and says so");
    }

    private static void commit(Path dir, Path game) throws Exception {
        Pinyin pinyin = new Pinyin(
                Files.newInputStream(Path.of("client/src/main/resources/assets/cadeditor/ui/js/pinyin-data.js")));
        VaultStore.Validator validator = stack -> VaultStacks.validate(stack, access);
        try (VaultStore store = new VaultStore(dir.resolve("vault.json"), current, "0.99.8", pinyin, time::get)) {
            var source = VaultImports.readNbtEditor(game, VaultImports.Limits.DEFAULT, current);
            var rows = prepare(source);
            List<VaultStore.Batch> batches = batches(source, rows);
            JsonObject out = store.importBatches(batches, true);
            check(
                    out.get("imported").getAsInt() == 3
                            && out.getAsJsonArray("pages").size() == 2,
                    "import as new pages");
            check(
                    out.getAsJsonArray("pages")
                            .get(0)
                            .getAsJsonObject()
                            .get("name")
                            .getAsString()
                            .contains("NBT Editor"),
                    "page name carries the source");
            JsonObject again = store.importBatches(batches(source, prepare(source)), true);
            check(
                    again.get("imported").getAsInt() == 0
                            && again.get("skipped").getAsInt() == 3,
                    "re-import skips duplicates when asked");
            JsonObject copies = store.importBatches(batches(source, prepare(source)), false);
            check(copies.get("imported").getAsInt() == 3, "keep duplicates imports another copy");

            Path unknown = dir.resolve("unknown.nbt");
            var kept = store.importBatches(batches(file(unknown), prepare(file(unknown))), true);
            check(kept.get("imported").getAsInt() == 1, "row with an unknown item is still imported");
            JsonObject list = new JsonObject();
            list.addProperty("op", "list");
            list.addProperty("requestId", "l");
            list.addProperty("query", "item:absent:*");
            JsonObject row = store.execute(list, validator)
                    .getAsJsonArray("entries")
                    .get(0)
                    .getAsJsonObject();
            check(row.has("incompatible") && row.has("reason"), "kept row is an incompatible entry, not deleted");

            // A vault export file imports through the same preview with its pages.
            JsonObject export = new JsonObject();
            export.addProperty("op", "export");
            export.addProperty("requestId", "e");
            export.addProperty("all", true);
            StringBuilder text = new StringBuilder();
            while (true) {
                JsonObject part = store.execute(export, validator);
                text.append(part.get("text").getAsString());
                if (part.get("done").getAsBoolean()) break;
                export.addProperty("offset", part.get("nextOffset").getAsInt());
            }
            Path exported = dir.resolve("export.json");
            Files.writeString(exported, text.toString(), StandardCharsets.UTF_8);
            var exportSource = file(exported);
            check(exportSource.groups().size() >= 3, "vault export file grouped by its pages");
            var exportRows = prepare(exportSource);
            check(exportRows.size() == 7, "every exported entry is a row");
            try (VaultStore other = new VaultStore(dir.resolve("other.json"), current, "0.99.8", pinyin, time::get)) {
                JsonObject result = other.importBatches(batches(exportSource, exportRows), false);
                check(result.get("imported").getAsInt() == 7, "export file imports all entries into new pages");
            }
        }
    }

    private static List<VaultStore.Batch> batches(VaultImports.Source source, List<VaultImports.Row> rows) {
        List<List<VaultStore.Prepared>> groups = new ArrayList<>();
        for (int g = 0; g < source.groups().size(); g++) groups.add(new ArrayList<>());
        for (var r : rows) if (r.prepared() != null) groups.get(r.group()).add(r.prepared());
        List<VaultStore.Batch> out = new ArrayList<>();
        for (int g = 0; g < groups.size(); g++)
            out.add(new VaultStore.Batch(source.groups().get(g), groups.get(g)));
        return out;
    }
}
