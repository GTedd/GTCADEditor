package dev.rinorsi.editor.client;

import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.concurrent.atomic.AtomicLong;

/** Pure Java filesystem and fake-clock checks: no Minecraft/Fabric initialization or sleeps. */
public final class EditorPrefsTest {
    private static int checks;

    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory(Path.of("."), "editor-prefs-test-");
        try {
            Path path = root.resolve("cadeditor-ui.json");
            AtomicLong now = new AtomicLong();
            var store = new EditorPrefs.Store(path, now::get);
            check(store.read().isEmpty(), "missing file");
            for (String[] item : new String[][] {
                {"heroView", "\"2d\"", "\"3d\""},
                {"windowMax", "true", "false"},
                {"windowMode", "\"remember\"", "\"maximized\"", "\"windowed\""},
                {"uiSound", "true", "false"},
                {"stageOpen", "true", "false"},
                {"statsOpen", "true", "false"},
                {"debug", "true", "false"},
                {"heroWidth", "0", "100", "320"},
                {"winW", "0", "320", "1600"},
                {"winH", "0", "200", "1000"},
                {"uiScale", "0", "1", "2", "3", "4"},
                {"codeFontSize", "8", "12", "20"},
                {"pageOpacity", "30", "60", "100"},
                {"backdropDim", "0", "40", "100"},
                {"themeBlur", "0", "5", "20"},
                {"themeMaterial", "\"clear\"", "\"frosted\"", "\"acrylic\"", "\"matte\""},
                {"winX", "-1", "0", "32768"},
                {"winY", "-1", "0", "32768"}
            }) {
                for (int i = 1; i < item.length; i++) {
                    send(store, item[0], item[i]);
                    check(
                            store.read().get(item[0]).equals(JsonParser.parseString(item[i])),
                            "valid boundary " + item[0]);
                }
            }
            JsonObject valid = store.read();
            store.accept(null);
            store.accept(JsonNull.INSTANCE);
            store.accept(JsonParser.parseString("[]"));
            store.accept(JsonParser.parseString("{\"key\":true,\"value\":1}"));
            store.accept(JsonParser.parseString("{\"key\":\"winW\"}"));
            for (String key : new String[] {
                "heroView",
                "windowMode",
                "windowMax",
                "uiSound",
                "stageOpen",
                "statsOpen",
                "debug",
                "uiScaleAuto",
                "heroWidth",
                "winW",
                "winH",
                "uiScale",
                "unknown"
            })
                for (String bad : new String[] {
                    "null", "{}", "[]", "\"true\"", "\"320\"", "\"4d\"", "-1", "320.5", "999999999999999999999999"
                }) send(store, key, bad);
            send(store, "heroView", "true");
            send(store, "heroView", "0");
            send(store, "windowMax", "1");
            for (String key : new String[] {"uiSound", "stageOpen", "statsOpen", "debug", "uiScaleAuto"}) {
                send(store, key, "1");
                send(store, key, "0");
            }
            for (String key : new String[] {"heroWidth", "winW", "winH", "uiScale"}) send(store, key, "true");
            send(store, "heroWidth", "99");
            send(store, "heroWidth", "321");
            send(store, "winW", "319");
            send(store, "winW", "1601");
            send(store, "winH", "199");
            send(store, "winH", "1001");
            send(store, "uiScale", "-1");
            send(store, "uiScale", "5");
            send(store, "uiScale", "100");
            send(store, "uiScale", "2.5");
            send(store, "uiScaleAuto", "true");
            for (String bad : new String[] {"0", "7", "21", "12.5", "\"12\"", "true", "null", "{}", "[]", "1e100"})
                send(store, "codeFontSize", bad);
            for (String bad : new String[] {"0", "29", "101", "60.5", "\"60\"", "true"})
                send(store, "pageOpacity", bad);
            for (String key : new String[] {"winX", "winY"})
                for (String bad : new String[] {"-2", "32769", "10.5", "\"10\""}) send(store, key, bad);
            for (String bad : new String[] {"-1", "101", "4.5", "\"10\""}) send(store, "backdropDim", bad);
            for (String bad : new String[] {"-1", "21", "8.5", "\"8\""}) send(store, "themeBlur", bad);
            for (String bad : new String[] {"\"glass\"", "1", "true"}) send(store, "themeMaterial", bad);
            send(store, "uiTheme", "\"dark\"");
            check(store.read().equals(valid), "invalid messages ignored without coercion");
            check(store.peek("themeBlur").equals(valid.get("themeBlur")), "peek sees a pending value");
            check(store.peek("unknown") == null, "peek of an unset key");
            check(!Files.exists(path), "accept never writes immediately");
            now.set(499_999_999L);
            store.tick();
            check(!Files.exists(path), "500ms debounce not elapsed");
            now.set(500_000_000L);
            store.tick();
            check(new EditorPrefs.Store(path, now::get).read().equals(valid), "merged values persisted and read back");
            check(
                    new EditorPrefs.Store(path, now::get)
                                    .read()
                                    .get("codeFontSize")
                                    .getAsInt()
                            == 20,
                    "code font persists independently of uiScale");

            send(store, "heroWidth", "101");
            now.set(800_000_000L);
            send(store, "heroWidth", "102");
            send(store, "winH", "201");
            now.set(1_100_000_000L);
            store.tick();
            check(
                    JsonParser.parseString(Files.readString(path))
                                    .getAsJsonObject()
                                    .get("heroWidth")
                                    .getAsInt()
                            == 320,
                    "last value resets debounce");
            now.set(1_300_000_000L);
            store.tick();
            check(new EditorPrefs.Store(path, now::get).read().get("heroWidth").getAsInt() == 102, "last value wins");
            send(store, "winW", "640");
            store.flush();
            check(
                    new EditorPrefs.Store(path, now::get).read().get("winW").getAsInt() == 640,
                    "close flush bypasses deadline");
            try (var files = Files.list(root)) {
                check(files.count() == 1, "atomic writes leave no temp files");
            }

            Files.writeString(
                    path,
                    "{\"heroView\":\"3d\",\"windowMax\":\"true\",\"heroWidth\":99,\"winW\":640.5,\"winH\":1000,\"unknown\":true}");
            check(
                    new EditorPrefs.Store(path, now::get)
                            .read()
                            .equals(JsonParser.parseString("{\"heroView\":\"3d\",\"winH\":1000}")),
                    "disk uses same strict whitelist");
            Files.writeString(path, "{\"uiSound\":true,\"stageOpen\":false,\"statsOpen\":true}");
            check(
                    new EditorPrefs.Store(path, now::get).read().equals(JsonParser.parseString(Files.readString(path))),
                    "new boolean keys read without coercion");
            Files.writeString(path, "{\"uiSound\":\"true\",\"stageOpen\":0,\"statsOpen\":null}");
            check(
                    new EditorPrefs.Store(path, now::get).read().isEmpty(),
                    "invalid new boolean keys excluded from disk data");
            Files.writeString(path, "{\"debug\":true}");
            check(new EditorPrefs.Store(path, now::get).read().get("debug").getAsBoolean(), "restart reads debug true");
            Files.writeString(path, "{\"debug\":\"true\"}");
            check(new EditorPrefs.Store(path, now::get).read().isEmpty(), "restart rejects nonboolean debug");
            Files.writeString(path, "{\"uiScale\":3,\"winW\":0,\"winH\":0,\"heroWidth\":0}");
            check(
                    new EditorPrefs.Store(path, now::get).read().equals(JsonParser.parseString(Files.readString(path))),
                    "scale and explicit responsive-default markers survive restart");
            for (String mode : new String[] {"remember", "maximized", "windowed"}) {
                store = new EditorPrefs.Store(path, now::get);
                send(store, "windowMode", "\"" + mode + "\"");
                store.flush();
                check(
                        new EditorPrefs.Store(path, now::get)
                                .read()
                                .get("windowMode")
                                .getAsString()
                                .equals(mode),
                        "restart reads window mode " + mode);
            }
            for (String badSize : new String[] {"0", "7", "21", "12.5", "\"12\"", "true"}) {
                Files.writeString(path, "{\"codeFontSize\":" + badSize + ",\"uiScale\":3}");
                var reloaded = new EditorPrefs.Store(path, now::get).read();
                check(
                        !reloaded.has("codeFontSize") && reloaded.get("uiScale").getAsInt() == 3,
                        "invalid code font does not affect uiScale");
            }
            for (String badFile : new String[] {"[]", "null", "broken JSON"}) {
                Files.writeString(path, badFile);
                check(new EditorPrefs.Store(path, now::get).read().isEmpty(), "invalid disk JSON is harmless");
            }
            store = new EditorPrefs.Store(path, now::get);
            send(store, "windowMax", "true");
            store.flush();
            check(
                    new EditorPrefs.Store(path, now::get).read().equals(JsonParser.parseString("{\"windowMax\":true}")),
                    "repair invalid file atomically");

            Path blocked = root.resolve("blocked");
            Files.writeString(blocked, "file blocks directory");
            var retry = new EditorPrefs.Store(blocked.resolve("cadeditor-ui.json"), now::get);
            send(retry, "winW", "800");
            retry.flush();
            check(retry.read().get("winW").getAsInt() == 800, "failed write retains pending value");
            Files.delete(blocked);
            now.addAndGet(500_000_000L);
            retry.tick();
            check(Files.isRegularFile(blocked.resolve("cadeditor-ui.json")), "failed write retried after delay");
            draftTests(root);
            asyncTests(root);
            colorPresetTests(root);
            backdropTests();
            EditorScalePrefsTest.run();
            dev.rinorsi.editor.registry.DraftUtf8CounterTest.main(new String[0]);
            dev.rinorsi.editor.registry.DraftWriteOrderTest.main(new String[0]);
            EditorUiLogTest.run();
            EditorPageTraceTest.run();
            System.out.println("PASS EditorPrefs: " + checks
                    + " checks (whitelist, debounce, close flush, atomic read/write, retry)");
        } finally {
            try (var files = Files.walk(root)) {
                for (Path path : files.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
            }
        }
    }

    /** Color presets and recent colors: strict shape, bounded size, persisted with the other preferences. */
    private static void colorPresetTests(Path root) {
        AtomicLong now = new AtomicLong();
        Path path = root.resolve("presets").resolve("cadeditor-ui.json");
        var store = new EditorPrefs.Store(path, now::get);
        String presets = "{\"color\":[{\"id\":\"c1\",\"name\":\"Gold\",\"c\":\"#FFFFAA00\",\"n\":\"gold\"}],"
                + "\"gradient\":[{\"id\":\"g1\",\"name\":\"Sunset\",\"stops\":[{\"p\":0,\"c\":\"#FFFF5555\"},"
                + "{\"p\":1000,\"c\":\"#FF5555FF\"}]}],"
                + "\"shadow\":[{\"id\":\"s1\",\"name\":\"Soft\",\"c\":\"#80000000\"}],"
                + "\"style\":[{\"id\":\"t1\",\"name\":\"Title\",\"text\":{\"c\":\"#FFFFFF55\"},"
                + "\"shadow\":{\"c\":\"#FF3F3F15\"},\"flags\":{\"bold\":true}}]}";
        send(store, "colorPresets", presets);
        check(store.read().get("colorPresets").equals(JsonParser.parseString(presets)), "color presets accepted");
        send(store, "recentColors", "[\"#FFFF5555\",\"#80000000\"]");
        check(store.read().getAsJsonArray("recentColors").size() == 2, "recent colors accepted");
        JsonObject valid = store.read();
        String two = "[{\"p\":0,\"c\":\"#FFFFFFFF\"},{\"p\":1000,\"c\":\"#FF000000\"}]";
        for (String bad : new String[] {
            "[]",
            "{\"color\":{}}",
            "{\"other\":[]}",
            "{\"color\":[{\"id\":\"c\",\"name\":\"x\",\"c\":\"#FFAA00\"}]}",
            "{\"color\":[{\"id\":\"c\",\"name\":\"x\",\"c\":\"#ffffaa00\"}]}",
            "{\"color\":[{\"id\":\"c\",\"name\":\"x\",\"stops\":" + two + "}]}",
            "{\"color\":[{\"id\":\"c\",\"name\":\"x\",\"c\":\"#FFFFFFFF\",\"n\":\"Gold!\"}]}",
            "{\"gradient\":[{\"id\":\"g\",\"name\":\"x\",\"stops\":[{\"p\":0,\"c\":\"#FFFFFFFF\"}]}]}",
            "{\"gradient\":[{\"id\":\"g\",\"name\":\"x\",\"stops\":[{\"p\":0.5,\"c\":\"#FFFFFFFF\"},"
                    + "{\"p\":1000,\"c\":\"#FF000000\"}]}]}",
            "{\"gradient\":[{\"id\":\"g\",\"name\":\"x\",\"stops\":[{\"p\":0,\"c\":\"#FFFFFFFF\"},"
                    + "{\"p\":1001,\"c\":\"#FF000000\"}]}]}",
            "{\"gradient\":[{\"id\":\"g\",\"name\":\"x\",\"c\":\"#FFFFFFFF\",\"stops\":" + two + "}]}",
            "{\"shadow\":[{\"id\":\"s\",\"name\":\"x\",\"c\":\"#80000000\",\"extra\":1}]}",
            "{\"style\":[{\"id\":\"t\",\"name\":\"x\"}]}",
            "{\"style\":[{\"id\":\"t\",\"name\":\"x\",\"flags\":{\"shadow\":true}}]}",
            "{\"style\":[{\"id\":\"t\",\"name\":\"x\",\"flags\":{\"bold\":1}}]}",
            "{\"style\":[{\"id\":\"t\",\"name\":\"x\",\"text\":\"#FFFFFFFF\"}]}",
            "{\"color\":[{\"id\":\"bad id\",\"name\":\"x\",\"c\":\"#FFFFFFFF\"}]}",
            "{\"color\":[{\"name\":\"x\",\"c\":\"#FFFFFFFF\"}]}",
            "{\"color\":[{\"id\":\"c\",\"name\":\"" + "x".repeat(49) + "\",\"c\":\"#FFFFFFFF\"}]}"
        }) send(store, "colorPresets", bad);
        StringBuilder many = new StringBuilder("{\"color\":[");
        for (int i = 0; i <= EditorPrefs.MAX_COLOR_PRESETS; i++)
            many.append(i == 0 ? "" : ",")
                    .append("{\"id\":\"c")
                    .append(i)
                    .append("\",\"name\":\"n\",\"c\":\"#FFFFFFFF\"}");
        send(store, "colorPresets", many.append("]}").toString());
        StringBuilder recent = new StringBuilder("[");
        for (int i = 0; i <= EditorPrefs.MAX_RECENT_COLORS; i++)
            recent.append(i == 0 ? "" : ",").append("\"#FFFFFFFF\"");
        for (String bad : new String[] {
            "{}", "[\"#FFF\"]", "[1]", "[\"#ffffffff\"]", recent.append("]").toString()
        }) send(store, "recentColors", bad);
        check(store.read().equals(valid), "invalid presets and recent colors ignored");
        store.flush();
        var reread = new EditorPrefs.Store(path, now::get).read();
        check(
                reread.get("colorPresets").equals(valid.get("colorPresets"))
                        && reread.get("recentColors").equals(valid.get("recentColors")),
                "presets persisted and read back through the same validation");
    }

    /** Which themes get vanilla's menu blur behind the editor, and how much (EditorBackdrop). */
    private static void backdropTests() {
        check(EditorBackdrop.blurRadius(null, null, null) == 0, "default theme is opaque: no blur");
        check(EditorBackdrop.blurRadius(json("100"), json("\"frosted\""), json("8")) == 0, "opaque panels: no blur");
        check(EditorBackdrop.blurRadius(json("60"), json("\"clear\""), json("8")) == 0, "clear material: no blur");
        check(
                EditorBackdrop.blurRadius(json("60"), null, null) == EditorBackdrop.DEFAULT_BLUR,
                "translucent default is frosted at the default radius");
        for (String material : new String[] {"\"frosted\"", "\"acrylic\"", "\"matte\""})
            check(
                    EditorBackdrop.blurRadius(json("99"), json(material), json("7")) == 7,
                    "blurred material " + material);
        check(EditorBackdrop.blurRadius(json("60"), json("\"frosted\""), json("0")) == 0, "radius 0: no blur");
        check(
                EditorBackdrop.blurRadius(json("60"), json("\"frosted\""), json("24")) == EditorBackdrop.MAX_BLUR,
                "older wider radius is capped");
        check(
                EditorBackdrop.blurRadius(json("60"), json("1"), json("\"9\"")) == EditorBackdrop.DEFAULT_BLUR,
                "invalid values fall back to the page defaults");
    }

    private static com.google.gson.JsonElement json(String text) {
        return JsonParser.parseString(text);
    }

    private static void send(EditorPrefs.Store store, String key, String json) {
        var message = new JsonObject();
        message.addProperty("key", key);
        message.add("value", JsonParser.parseString(json));
        store.accept(message);
    }

    private static void check(boolean value, String label) {
        if (!value) throw new AssertionError(label);
        checks++;
    }

    private static void draftTests(Path root) throws Exception {
        var now = new AtomicLong();
        Path path = root.resolve("drafts.json");
        var store = new EditorPrefs.Store(path, now::get);
        String first = "inventory:0|minecraft:stone";
        check(store.putDraft(first, "{\"custom_name\":\"草稿😀\"}"), "draft unicode JSON accepted");
        check(!Files.exists(path), "draft writes debounced");
        now.set(499_999_999);
        store.tick();
        check(!Files.exists(path), "draft debounce before deadline");
        now.set(500_000_000);
        store.tick();
        check(
                new EditorPrefs.Store(path, now::get)
                        .getDraft(first)
                        .getAsString()
                        .contains("草稿😀"),
                "draft restart round trip");
        JsonObject before = store.read();
        for (String bad : new String[] {
            "",
            " ",
            "not-json",
            "{} {}",
            "{'x':1}",
            "[".repeat(129) + "0" + "]".repeat(129),
            "\"" + "x".repeat(EditorPrefs.MAX_DRAFT_BYTES) + "\"",
            "\"" + "汉".repeat(EditorPrefs.MAX_DRAFT_BYTES / 3 + 10) + "\""
        }) check(!store.putDraft(first, bad), "bad/oversized/deep draft rejected");
        check(
                !store.putDraft("", "{}")
                        && !store.putDraft("control\n", "{}")
                        && !store.putDraft("x".repeat(1025), "{}"),
                "bad draft keys rejected");
        check(store.read().equals(before), "rejected draft leaves original intact");
        String malformedKey = "slot:" + (char) 0xd800;
        check(!store.putDraft(malformedKey, "{}"), "unpaired surrogate draft key rejected");
        JsonObject malformedMap = new JsonObject();
        malformedMap.addProperty(malformedKey, "{}");
        send(store, "drafts", malformedMap.toString());
        check(store.read().equals(before), "unpaired surrogate whole map rejected");
        send(store, "winW", "640");
        store.flush();
        check(
                new EditorPrefs.Store(path, now::get).read().get("winW").getAsInt() == 640,
                "rejected malformed draft cannot block normal prefs persistence");
        before = store.read();
        send(store, "drafts", "{\"bad\":{}}");
        check(store.read().equals(before), "non-string draft map rejected");
        JsonObject nine = new JsonObject();
        for (int i = 0; i < 9; i++) nine.addProperty("slot:" + i, "{}");
        send(store, "drafts", nine.toString());
        check(store.read().equals(before), "replacement map over eight rejected");
        /* 单份草稿上限 8 MiB、总上限 64 MiB：每份取单份上限，8 份加起来必然超过总上限 */
        String big = "\"" + "x".repeat(EditorPrefs.MAX_DRAFT_BYTES - 2) + "\"";
        JsonObject hugeMap = new JsonObject();
        for (int i = 0; i < 8; i++) hugeMap.addProperty("slot:" + i, big);
        send(store, "drafts", hugeMap.toString());
        check(store.read().equals(before), "replacement map over one MiB rejected");
        check(store.clearDraft(first), "single clear accepted");
        for (int i = 0; i < 8; i++) check(store.putDraft("slot:" + i, "{\"i\":" + i + "}"), "LRU insert");
        store.getDraft("slot:0");
        store.putDraft("slot:8", "{}");
        var map = store.read().getAsJsonObject("drafts");
        check(map.size() == 8 && map.has("slot:0") && !map.has("slot:1"), "read touches LRU and ninth evicts oldest");
        store.putDraft("slot:2", "{\"updated\":true}");
        store.putDraft("slot:9", "{}");
        check(!store.read().getAsJsonObject("drafts").has("slot:3"), "update touches LRU");
        store.flush();
        var restarted = new EditorPrefs.Store(path, now::get);
        check(restarted.read().equals(store.read()), "restart preserves eight drafts and LRU order");
        restarted.putDraft("slot:10", "{}");
        check(!restarted.read().getAsJsonObject("drafts").has("slot:4"), "LRU eviction order survives restart");
        restarted.clearDraft("slot:0");
        restarted.flush();
        check(
                !new EditorPrefs.Store(path, now::get)
                        .read()
                        .getAsJsonObject("drafts")
                        .has("slot:0"),
                "single clear survives restart");
        check(restarted.getDraft("missing").isJsonNull(), "missing draft returns null");
        var bytes = new EditorPrefs.Store(root.resolve("draft-byte-budget.json"), now::get);
        for (int i = 0; i < 8; i++) bytes.putDraft("slot:" + i, big);
        var budget = bytes.read().getAsJsonObject("drafts");
        check(
                budget.size() == 7
                        && !budget.has("slot:0")
                        && budget.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length
                                <= EditorPrefs.MAX_DRAFTS_BYTES,
                "total byte cap evicts LRU");
        check(
                bytes.putDraft("boundary", "\"" + "x".repeat(EditorPrefs.MAX_DRAFT_BYTES - 2) + "\""),
                "exact single-draft limit accepted");
        bytes.flush();
        check(
                new EditorPrefs.Store(root.resolve("draft-byte-budget.json"), now::get)
                        .read()
                        .equals(bytes.read()),
                "near one MiB restart round trip");
        Files.writeString(path, "{\"heroView\":\"3d\",\"drafts\":{\"invalid\":0}}");
        check(
                new EditorPrefs.Store(path, now::get).read().equals(JsonParser.parseString("{\"heroView\":\"3d\"}")),
                "disk draft whitelist preserves scalar prefs");
    }

    private static void asyncTests(Path root) throws Exception {
        Path path = root.resolve("async.json");
        var now = new AtomicLong();
        var jobs = new java.util.ArrayDeque<Runnable>();
        var store = new EditorPrefs.Store(path, now::get, jobs::add);
        send(store, "winW", "640");
        now.set(500_000_000L);
        store.tick();
        check(jobs.size() == 1 && !Files.exists(path), "tick queues detached snapshot without disk write");
        send(store, "winW", "800");
        store.tick();
        check(
                jobs.size() == 1 && store.read().get("winW").getAsInt() == 800,
                "one in-flight write and newest edit visible");
        jobs.remove().run();
        store.tick();
        check(store.read().get("winW").getAsInt() == 800, "old completion preserves newer pending edit");
        check(
                JsonParser.parseString(Files.readString(path))
                                .getAsJsonObject()
                                .get("winW")
                                .getAsInt()
                        == 640,
                "worker wrote frozen old snapshot");
        now.set(1_000_000_000L);
        store.tick();
        check(jobs.size() == 1, "next write waits for debounce and global interval");
        jobs.remove().run();
        store.tick();
        check(
                new EditorPrefs.Store(path, now::get).read().get("winW").getAsInt() == 800,
                "newer edit eventually persists");
        Files.writeString(path, "{}");
        check(store.read().get("winW").getAsInt() == 800, "steady reads use memory rather than reopening disk");
    }
}
