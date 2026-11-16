package dev.rinorsi.editor.vault;

import com.google.gson.*;
import dev.rinorsi.editor.StackCodec;
import dev.rinorsi.editor.registry.search.Pinyin;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import net.minecraft.SharedConstants;
import net.minecraft.core.*;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.*;
import net.minecraft.network.chat.Component;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.item.*;
import net.minecraft.world.item.component.*;

/**
 * Vault organisation on real vanilla registries: pages (file schema 4, old files still read), search syntax, sorting,
 * DataFixer upgrade (success replaces, failure keeps, originals backed up first) and rotating backups with restore.
 */
public final class VaultOrganizeTest {
    private static int checks;
    private static RegistryAccess access;
    private static VaultStore.Validator validator;
    private static VaultStore.Upgrader upgrader;
    private static Pinyin pinyin;
    private static int current;
    private static final AtomicLong time = new AtomicLong(1794050000000L);
    private static final long DAY = 24L * 60 * 60 * 1000;

    private static void check(boolean pass, String name) {
        if (!pass) throw new AssertionError(name);
        checks++;
        System.out.println("PASS " + name);
    }

    private static void rejects(String code, Runnable action) {
        try {
            action.run();
            throw new AssertionError("Expected " + code);
        } catch (VaultStore.Failure e) {
            check(e.code.equals(code), "reject " + code + " got " + e.code + " (" + e.getMessage() + ")");
        }
    }

    private static JsonObject req(String op) {
        JsonObject r = new JsonObject();
        r.addProperty("op", op);
        r.addProperty("requestId", "organize-" + op);
        return r;
    }

    private static JsonObject run(VaultStore s, JsonObject r) {
        JsonObject out = s.execute(r, validator, upgrader);
        check(out.toString().length() <= 24000, "response cap " + r.get("op"));
        return out;
    }

    private static VaultStore open(Path p) {
        return new VaultStore(p, current, "0.99.8", pinyin, time::get);
    }

    private static String save(VaultStore s, ItemStack stack, String name, String note, String page, String... tags) {
        JsonObject r = req("save");
        r.add("stack", StackCodec.snapshot(stack, access, new JsonObject(), ""));
        r.addProperty("force", true);
        if (name != null) r.addProperty("name", name);
        if (note != null) r.addProperty("note", note);
        if (page != null) r.addProperty("page", page);
        JsonArray t = new JsonArray();
        for (String tag : tags) t.add(tag);
        r.add("tags", t);
        return run(s, r).getAsJsonObject("entry").get("id").getAsString();
    }

    private static JsonObject list(VaultStore s, String query, String sort, boolean reverse, String page) {
        JsonObject r = req("list");
        r.addProperty("kind", "all");
        r.addProperty("limit", 100);
        if (query != null) r.addProperty("query", query);
        if (sort != null) r.addProperty("sort", sort);
        if (reverse) r.addProperty("reverse", true);
        if (page != null) r.addProperty("page", page);
        return run(s, r);
    }

    private static int total(VaultStore s, String query) {
        return list(s, query, null, false, null).get("total").getAsInt();
    }

    private static List<String> names(JsonObject list) {
        List<String> out = new ArrayList<>();
        list.getAsJsonArray("entries")
                .forEach(e -> out.add(e.getAsJsonObject().get("name").getAsString()));
        return out;
    }

    private static String pageId(JsonObject reply) {
        return reply.getAsJsonObject("page").get("id").getAsString();
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
        validator = stack -> VaultStacks.validate(stack, access);
        upgrader = VaultUpgrade.upgrader(access, current);
        pinyin = new Pinyin(
                Files.newInputStream(Path.of("client/src/main/resources/assets/cadeditor/ui/js/pinyin-data.js")));
        Path dir = Files.createTempDirectory("cadeditor-vault-organize-");
        pages(dir);
        search(dir);
        upgrade(dir);
        backups(dir);
        legacy(dir);
        System.out.println("PASS VaultOrganizeTest " + checks + " checks; real registries; temp files " + dir);
    }

    private static ItemStack sword() {
        ItemStack sword = new ItemStack(Items.DIAMOND_SWORD);
        sword.set(DataComponents.CUSTOM_NAME, Component.literal("钻石剑"));
        sword.set(DataComponents.LORE, new ItemLore(List.of(Component.literal("传说中的利刃"))));
        return sword;
    }

    private static void pages(Path dir) throws Exception {
        Path file = dir.resolve("pages.json");
        try (VaultStore s = open(file)) {
            JsonObject pages = run(s, req("pages"));
            check(pages.get("total").getAsInt() == 1, "new vault has only the default page");
            check(
                    pages.getAsJsonArray("pages")
                            .get(0)
                            .getAsJsonObject()
                            .get("default")
                            .getAsBoolean(),
                    "default flag");
            JsonObject create = req("page_create");
            create.addProperty("name", "收藏");
            String favorites = pageId(run(s, create));
            JsonObject again = req("page_create");
            again.addProperty("name", "收藏");
            check(
                    run(s, again)
                            .getAsJsonObject("page")
                            .get("name")
                            .getAsString()
                            .equals("收藏 (2)"),
                    "duplicate page name gets a suffix");
            JsonObject empty = req("page_create");
            empty.addProperty("name", "   ");
            rejects("BAD_REQUEST", () -> run(s, empty));
            JsonObject tooLong = req("page_create");
            tooLong.addProperty("name", "x".repeat(VaultStore.PAGE_NAME_CHARS + 1));
            rejects("BAD_REQUEST", () -> run(s, tooLong));
            String a = save(s, new ItemStack(Items.STONE), "石头", null, null);
            String b = save(s, sword(), "剑", null, favorites);
            check(list(s, null, null, false, favorites).get("total").getAsInt() == 1, "list filtered by page");
            check(
                    list(s, null, null, false, VaultStore.DEFAULT_PAGE)
                                    .get("total")
                                    .getAsInt()
                            == 1,
                    "default page lists entries without a page");
            JsonObject row = list(s, null, null, false, favorites)
                    .getAsJsonArray("entries")
                    .get(0)
                    .getAsJsonObject();
            check(
                    row.get("page").getAsString().equals(favorites)
                            && row.get("bytes").getAsInt() > 100,
                    "row carries page and stored size");
            check(!row.has("lore"), "lore index is not sent in list rows");
            JsonObject missingPage = req("list");
            missingPage.addProperty("page", UUID.randomUUID().toString());
            rejects("PAGE_NOT_FOUND", () -> run(s, missingPage));
            JsonObject move = req("move");
            JsonArray ids = new JsonArray();
            ids.add(a);
            move.add("ids", ids);
            move.addProperty("page", favorites);
            check(run(s, move).get("moved").getAsInt() == 1, "move entry to a page");
            check(list(s, null, null, false, favorites).get("total").getAsInt() == 2, "moved entry shows on page");
            JsonObject rename = req("page_rename");
            rename.addProperty("page", favorites);
            rename.addProperty("name", "常用");
            run(s, rename);
            JsonObject order = req("page_move");
            order.addProperty("page", favorites);
            order.addProperty("to", 0);
            check(
                    run(s, order).getAsJsonArray("order").get(0).getAsString().equals(favorites),
                    "page reordered to the front");
            JsonObject del = req("page_delete");
            del.addProperty("page", favorites);
            rejects("PAGE_NOT_EMPTY", () -> run(s, del));
            JsonObject delDefault = req("page_delete");
            delDefault.addProperty("page", VaultStore.DEFAULT_PAGE);
            rejects("BAD_REQUEST", () -> run(s, delDefault));
            del.addProperty("entries", "delete");
            JsonObject deleted = run(s, del);
            check(deleted.get("deleted").getAsInt() == 2, "non-empty page delete removes its entries on request");
            check(run(s, req("stats")).get("entries").getAsInt() == 0, "entries gone after page delete");
            JsonObject restore = req("restore");
            restore.add("token", deleted.get("token"));
            check(run(s, restore).get("restored").getAsInt() == 2, "undo restores entries");
            check(
                    list(s, null, null, false, favorites).get("total").getAsInt() == 2,
                    "undo brings the page back with its entries");
            check(
                    run(s, req("pages"))
                            .getAsJsonArray("pages")
                            .get(0)
                            .getAsJsonObject()
                            .get("id")
                            .getAsString()
                            .equals(favorites),
                    "restored page keeps its position");
            JsonObject delMove = req("page_delete");
            delMove.addProperty("page", favorites);
            delMove.addProperty("entries", "move");
            check(run(s, delMove).get("moved").getAsInt() == 2, "page delete can move entries to the default page");
            check(
                    list(s, null, null, false, VaultStore.DEFAULT_PAGE)
                                    .get("total")
                                    .getAsInt()
                            == 2,
                    "moved entries land on the default page");
            // Export and import keep page names.
            JsonObject keep = req("page_create");
            keep.addProperty("name", "导出页");
            String exported = pageId(run(s, keep));
            JsonObject toExported = req("move");
            JsonArray both = new JsonArray();
            both.add(a);
            toExported.add("ids", both);
            toExported.addProperty("page", exported);
            run(s, toExported);
            JsonObject export = req("export");
            export.addProperty("all", true);
            String text = run(s, export).get("text").getAsString();
            JsonObject parsed = VaultStore.parse(text);
            check(parsed.get("version").getAsInt() == VaultStore.SCHEMA, "export writes schema 4");
            check(parsed.getAsJsonArray("pages").size() == 3, "full export carries the pages");
            try (VaultStore other = open(dir.resolve("pages-import.json"))) {
                JsonObject imp = req("import");
                imp.addProperty("text", text);
                run(other, imp);
                JsonArray otherPages = run(other, req("pages")).getAsJsonArray("pages");
                boolean named = false;
                for (var p : otherPages)
                    named |= p.getAsJsonObject().get("name").getAsString().equals("导出页")
                            && p.getAsJsonObject().get("count").getAsInt() == 1;
                check(named, "import recreates the exported page with its entry");
            }
            s.flush();
            JsonObject disk = VaultStore.parse(Files.readString(file));
            check(disk.get("version").getAsInt() == 4 && disk.has("pages"), "file written as schema 4 with pages");
        }
        try (VaultStore reopened = open(file)) {
            check(run(reopened, req("pages")).get("total").getAsInt() == 3, "pages survive reopen");
        }
    }

    private static void search(Path dir) throws Exception {
        try (VaultStore s = open(dir.resolve("search.json"))) {
            long start = time.get();
            time.set(start - 40 * DAY);
            String old = save(s, new ItemStack(Items.PAPER, 1), "旧纸", "很久以前", null, "杂物");
            time.set(start - 2 * DAY);
            save(s, sword(), "收藏钻石剑", "测试武器", null, "武器", "稀有");
            time.set(start);
            ItemStack stack = new ItemStack(Items.DIAMOND, 32);
            save(s, stack, "一组钻石", null, null, "材料");
            ItemStack big = new ItemStack(Items.PAPER);
            var data = new net.minecraft.nbt.CompoundTag();
            data.putString("payload", "x".repeat(3000));
            big.set(DataComponents.CUSTOM_DATA, CustomData.of(data));
            save(s, big, "大纸 with spaces", null, null);
            JsonObject create = req("page_create");
            create.addProperty("name", "收藏");
            String fav = pageId(run(s, create));
            JsonObject move = req("move");
            JsonArray ids = new JsonArray();
            ids.add(old);
            move.add("ids", ids);
            move.addProperty("page", fav);
            run(s, move);

            check(total(s, "zuanshi") == 2, "bare pinyin search still works");
            check(total(s, "钻石") == 2, "bare Chinese substring search still works");
            check(total(s, "item:diamond") == 2, "item: prefix match on path");
            check(total(s, "item:*sword") == 1, "item: wildcard");
            check(total(s, "item:minecraft:paper") == 2, "item: full id");
            check(total(s, "name:\"大纸 with\"") == 1, "quoted value with spaces");
            check(total(s, "name:剑") == 1, "name: field");
            check(total(s, "lore:利刃") == 1, "lore: uses the stored plain-text index");
            check(total(s, "tag:武器") == 1 && total(s, "-tag:武器") == 3, "tag: and negation");
            check(total(s, "note:测试") == 1, "note: field");
            check(total(s, "count:>=16") == 1, "count: comparison");
            check(total(s, "amount:1-5") == 3, "amount: alias and range");
            check(total(s, "count:32") == 1, "count: exact");
            check(total(s, "size:>3k") == 1, "size: with k suffix");
            check(total(s, "size:<100") == 0, "size: below any stored entry");
            check(total(s, "saved:<7d") == 3, "saved:<7d means within the last 7 days");
            check(total(s, "saved:>30d") == 1, "saved:>30d means older than 30 days");
            check(total(s, "updated:1d-7d") == 1, "updated: age range");
            check(total(s, "page:收藏") == 1, "page: by name");
            check(total(s, "kind:item") == 4 && total(s, "kind:entity") == 0, "kind: field");
            check(total(s, "item:paper -page:收藏") == 1, "AND of two conditions with negation");
            check(total(s, "item:") == 4, "empty field value is ignored while typing");
            check(
                    total(s, "minecraft:stone") == 0 && total(s, "minecraft:diamond") >= 1,
                    "unknown prefix stays a word");
            rejects("BAD_REQUEST", () -> total(s, "count:lots"));
            rejects("BAD_REQUEST", () -> total(s, "saved:7"));
            rejects("BAD_REQUEST", () -> total(s, "size:3q"));
            rejects("BAD_REQUEST", () -> total(s, "name:\"open"));
            rejects("BAD_REQUEST", () -> total(s, "kind:spaceship"));

            check(names(list(s, null, "count", false, null)).get(0).equals("一组钻石"), "sort by count, largest first");
            List<String> bySize = names(list(s, null, "size", false, null));
            check(bySize.get(0).equals("大纸 with spaces"), "sort by size, largest first");
            List<String> bySizeReversed = names(list(s, null, "size", true, null));
            check(bySizeReversed.get(bySizeReversed.size() - 1).equals("大纸 with spaces"), "reverse flips the sort");
            check(names(list(s, null, "saved", false, null)).get(3).equals("旧纸"), "sort by saved time");
            check(names(list(s, null, "updated", true, null)).get(0).equals("旧纸"), "updated reversed: oldest first");
            JsonObject badSort = req("list");
            badSort.addProperty("sort", "colour");
            rejects("BAD_REQUEST", () -> run(s, badSort));
            JsonObject stats = run(s, req("stats"));
            check(
                    stats.get("bytes").getAsInt() > 3000 && stats.get("pages").getAsInt() == 2,
                    "stats total size and pages");
        }
    }

    /** A 1.21.4 stack: hide_tooltip no longer exists and custom_name was a JSON string then. */
    private static JsonObject legacyStack() {
        JsonObject stack = new JsonObject(), comps = new JsonObject(), snbt = new JsonObject();
        stack.addProperty("id", "minecraft:stone");
        stack.addProperty("count", 3);
        comps.add("hide_tooltip", new JsonObject());
        snbt.addProperty("hide_tooltip", "{}");
        comps.addProperty("custom_name", "{\"text\":\"Old\"}");
        snbt.addProperty("custom_name", "'{\"text\":\"Old\"}'");
        stack.add("comps", comps);
        stack.add("component_snbt", snbt);
        stack.add("removed", new JsonObject());
        return stack;
    }

    private static JsonObject entry(JsonObject stack, int version, String name) {
        JsonObject e = new JsonObject();
        e.addProperty("id", UUID.randomUUID().toString());
        e.addProperty("name", name);
        e.add("tags", new JsonArray());
        e.addProperty("note", "");
        e.addProperty("created", time.get());
        e.addProperty("updated", time.get());
        e.addProperty("mcDataVersion", version);
        e.addProperty("modVersion", "0.99.1");
        e.add("stack", stack);
        return e;
    }

    private static void upgrade(Path dir) throws Exception {
        Path file = dir.resolve("upgrade.json");
        JsonObject legacy = entry(legacyStack(), 4189, "旧版石头");
        JsonObject unknownStack = legacyStack();
        unknownStack.addProperty("id", "absent:gone");
        JsonObject missing = entry(unknownStack, 4189, "未知物品");
        JsonObject newer = entry(legacyStack(), current + 1, "未来物品");
        JsonObject root = new JsonObject();
        root.addProperty("version", 3);
        JsonArray rows = new JsonArray();
        rows.add(legacy);
        rows.add(missing);
        rows.add(newer);
        root.add("entries", rows);
        Files.writeString(file, root.toString());
        try (VaultStore s = open(file)) {
            JsonObject before = list(s, null, "name", false, null);
            JsonObject legacyRow = null;
            for (var e : before.getAsJsonArray("entries"))
                if (e.getAsJsonObject().get("name").getAsString().equals("旧版石头")) legacyRow = e.getAsJsonObject();
            check(
                    legacyRow != null
                            && legacyRow.has("incompatible")
                            && legacyRow.get("upgradable").getAsBoolean(),
                    "old stack is incompatible today and marked upgradable");
            check(run(s, req("stats")).get("upgradable").getAsInt() == 2, "stats counts upgradable entries");
            JsonObject noWorld = req("upgrade");
            JsonArray one = new JsonArray();
            one.add(legacy.get("id").getAsString());
            noWorld.add("ids", one);
            rejects("UNAVAILABLE", () -> s.execute(noWorld, validator, null));
            JsonObject single = req("upgrade");
            single.add("ids", one);
            JsonObject result = run(s, single);
            JsonObject r0 = result.getAsJsonArray("results").get(0).getAsJsonObject();
            check(r0.get("ok").getAsBoolean() && r0.get("from").getAsInt() == 4189, "single upgrade succeeds");
            JsonObject get = req("get");
            get.add("ids", one);
            JsonObject upgraded = run(s, get).getAsJsonArray("entries").get(0).getAsJsonObject();
            check(upgraded.get("mcDataVersion").getAsInt() == current, "upgrade records the current data version");
            check(!upgraded.has("incompatible"), "upgraded entry is compatible");
            check(
                    upgraded.getAsJsonObject("stack").getAsJsonObject("comps").has("tooltip_display")
                            && !upgraded.getAsJsonObject("stack")
                                    .getAsJsonObject("comps")
                                    .has("hide_tooltip"),
                    "DataFixer replaced hide_tooltip with tooltip_display");
            ItemStack decoded = StackCodec.decode(upgraded.getAsJsonObject("stack"), access);
            check(decoded.getHoverName().getString().equals("Old"), "DataFixer turned the JSON name into text");
            check(decoded.getCount() == 3, "count kept");
            JsonObject batch = req("upgrade");
            batch.addProperty("all", true);
            batch.addProperty("limit", 1);
            JsonObject first = run(s, batch);
            check(
                    !first.get("done").getAsBoolean()
                            || first.getAsJsonArray("results").size() == 1,
                    "batch pages");
            int failures = first.get("failed").getAsInt();
            String after = first.get("nextAfter").getAsString();
            while (true) {
                JsonObject next = req("upgrade");
                next.addProperty("all", true);
                next.addProperty("limit", 1);
                next.addProperty("after", after);
                JsonObject out = run(s, next);
                failures += out.get("failed").getAsInt();
                after = out.get("nextAfter").getAsString();
                if (out.get("done").getAsBoolean()) break;
            }
            check(failures == 1, "batch upgrade reports the item that cannot be fixed");
            JsonObject kept = req("get");
            JsonArray two = new JsonArray();
            two.add(missing.get("id").getAsString());
            two.add(newer.get("id").getAsString());
            kept.add("ids", two);
            JsonArray keptRows = run(s, kept).getAsJsonArray("entries");
            check(keptRows.size() == 2, "failed upgrades never delete entries");
            check(
                    keptRows.get(0).getAsJsonObject().get("stack").equals(missing.get("stack"))
                            && keptRows.get(0)
                                            .getAsJsonObject()
                                            .get("mcDataVersion")
                                            .getAsInt()
                                    == 4189,
                    "failed upgrade keeps the original stack and version");
            JsonObject newerUpgrade = req("upgrade");
            JsonArray n = new JsonArray();
            n.add(newer.get("id").getAsString());
            newerUpgrade.add("ids", n);
            JsonObject newerResult =
                    run(s, newerUpgrade).getAsJsonArray("results").get(0).getAsJsonObject();
            check(
                    newerResult.get("error").getAsString().equals("NEWER_VERSION"),
                    "an entry from a newer version is never downgraded");
            check(s.flushNow(), "flush after upgrade");
            JsonArray backups = s.listBackups();
            boolean found = false;
            for (var b : backups)
                if (b.getAsJsonObject().get("reason").getAsString().equals("upgrade")) {
                    JsonObject saved = VaultStore.parse(Files.readString(new VaultBackups(file)
                            .directory()
                            .resolve(b.getAsJsonObject().get("name").getAsString())));
                    found = saved.getAsJsonArray("entries")
                            .get(0)
                            .getAsJsonObject()
                            .get("stack")
                            .equals(legacy.get("stack"));
                }
            check(found, "original entry written to an upgrade backup");
        }
    }

    private static void backups(Path dir) throws Exception {
        Path file = dir.resolve("rotating.json");
        try (VaultStore s = open(file)) {
            save(s, new ItemStack(Items.APPLE), "苹果", null, null);
            check(s.flushNow(), "first write");
            check(s.listBackups().isEmpty(), "nothing to copy before the first file exists");
            save(s, new ItemStack(Items.BREAD), "面包", null, null);
            check(s.flushNow(), "second write");
            JsonArray list = s.listBackups();
            check(
                    list.size() == 1
                            && list.get(0)
                                    .getAsJsonObject()
                                    .get("reason")
                                    .getAsString()
                                    .equals("startup"),
                    "startup backup before the first write of a session");
            save(s, new ItemStack(Items.CARROT), "胡萝卜", null, null);
            check(s.flushNow(), "third write");
            check(s.listBackups().size() == 1, "no second backup the same day");
            time.addAndGet(DAY + 1);
            save(s, new ItemStack(Items.COOKIE), "曲奇", null, null);
            check(s.flushNow(), "next-day write");
            check(
                    s.listBackups()
                            .get(0)
                            .getAsJsonObject()
                            .get("reason")
                            .getAsString()
                            .equals("daily"),
                    "daily backup after 24 hours");
            String manual = s.backupNow().get(5, TimeUnit.SECONDS);
            check(manual.contains("-manual"), "manual backup named by reason");
            for (int i = 0; i < VaultBackups.MAX_FILES + 5; i++) {
                time.addAndGet(1000);
                s.backupNow().get(5, TimeUnit.SECONDS);
            }
            JsonArray all = s.listBackups();
            check(all.size() == VaultBackups.MAX_FILES, "rotation keeps at most " + VaultBackups.MAX_FILES);
            boolean startupGone = true;
            for (var b : all)
                startupGone &= !b.getAsJsonObject().get("reason").getAsString().equals("startup");
            check(startupGone, "oldest backups are removed first");
            String restoreFrom =
                    all.get(all.size() - 1).getAsJsonObject().get("name").getAsString();
            int entriesThen = VaultStore.parse(
                            Files.readString(new VaultBackups(file).directory().resolve(restoreFrom)))
                    .getAsJsonArray("entries")
                    .size();
            save(s, new ItemStack(Items.EGG), "鸡蛋", null, null);
            int now = run(s, req("stats")).get("entries").getAsInt();
            var loaded = s.readBackup(restoreFrom);
            check(run(s, req("stats")).get("entries").getAsInt() == now, "reading a backup changes nothing");
            JsonObject restored = s.restoreBackup(loaded);
            check(restored.get("restored").getAsInt() == entriesThen, "restore replaces the vault with the backup");
            check(s.flushNow(), "flush after restore");
            boolean pre = false;
            for (var b : s.listBackups())
                pre |= b.getAsJsonObject().get("reason").getAsString().equals("restore");
            check(pre, "state before restore is backed up first");
            rejects("NOT_FOUND", () -> {
                try {
                    s.readBackup("../rotating.json");
                } catch (java.io.IOException e) {
                    throw new AssertionError(e);
                }
            });
            rejects("NOT_FOUND", () -> {
                try {
                    s.readBackup("other-20260101-000000-000-manual.json");
                } catch (java.io.IOException e) {
                    throw new AssertionError(e);
                }
            });
        }
    }

    /** Schema 3 files load with every entry on the default page; unknown page references fall back to it. */
    private static void legacy(Path dir) throws Exception {
        Path file = dir.resolve("legacy.json");
        JsonObject root = new JsonObject();
        root.addProperty("version", 3);
        JsonArray rows = new JsonArray();
        JsonObject stone = entry(
                VaultStacks.validate(
                                StackCodec.snapshot(new ItemStack(Items.STONE), access, new JsonObject(), ""), access)
                        .stack(),
                current,
                "旧石头");
        stone.getAsJsonObject("stack").remove("slot");
        rows.add(stone);
        root.add("entries", rows);
        Files.writeString(file, root.toString());
        try (VaultStore s = open(file)) {
            check(
                    list(s, null, null, false, VaultStore.DEFAULT_PAGE)
                                    .get("total")
                                    .getAsInt()
                            == 1,
                    "schema 3 entries are on the default page");
            check(run(s, req("pages")).get("total").getAsInt() == 1, "schema 3 has just the default page");
        }
        JsonObject dangling = root.deepCopy();
        dangling.addProperty("version", 4);
        dangling.getAsJsonArray("entries")
                .get(0)
                .getAsJsonObject()
                .addProperty("page", UUID.randomUUID().toString());
        Files.writeString(file, dangling.toString());
        try (VaultStore s = open(file)) {
            check(
                    list(s, null, null, false, VaultStore.DEFAULT_PAGE)
                                    .get("total")
                                    .getAsInt()
                            == 1,
                    "unknown page reference shows on the default page");
        }
        JsonObject future = new JsonObject();
        future.addProperty("version", 5);
        future.add("entries", new JsonArray());
        Path futureFile = dir.resolve("future5.json");
        Files.writeString(futureFile, future.toString());
        try (VaultStore s = open(futureFile)) {
            check(run(s, req("stats")).get("readOnly").getAsBoolean(), "schema 5 stays read-only");
        }
    }
}
