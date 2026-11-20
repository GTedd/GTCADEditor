package dev.rinorsi.editor.client;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import dev.oriel.mod.client.DocumentDriver;
import dev.oriel.mod.client.OrielScreen;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorPackets;
import dev.rinorsi.editor.platform.ClientPlatform;
import dev.rinorsi.editor.world.WorldWire;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;

/** Forwards the history page's requests (whitelisted fields only) to the server and patches the replies back. */
public final class HistoryClient {
    private static final long TIMEOUT = 12_000_000_000L;
    private static final int MAX_PENDING = 4;
    private static final Set<String> FIELDS =
            Set.of("action", "filter", "page", "size", "id", "ids", "note", "target", "tags");

    private record Pending(DocumentDriver driver, String pageId, long deadline) {}

    private static final Map<String, Pending> pending = new HashMap<>();
    private static boolean queuedOpen;

    private HistoryClient() {}

    public static void initialize() {
        // /cade history: the history window on its own page (the server command /cadeditor history prints to chat).
        ClientPlatform.get()
                .onCommands(dispatcher -> dispatcher.register(LiteralArgumentBuilder.<Object>literal("cade")
                        .then(LiteralArgumentBuilder.<Object>literal("history").executes(c -> {
                            queuedOpen = true;
                            return 1;
                        }))));
        ClientPlatform.get().onTick(mc -> {
            if (queuedOpen) {
                queuedOpen = false;
                open();
            }
            tick();
        });
        ClientPlatform.get().onDisconnect(mc -> pending.clear());
    }

    /** Every editor page can talk to the history (the vault window has a button for it). */
    public static void attach(DocumentDriver driver) {
        driver.onMessage("history", value -> Minecraft.getInstance().schedule(() -> request(driver, value)));
        driver.onClose(() -> pending.values().removeIf(p -> p.driver == driver));
    }

    public static void open() {
        var mc = Minecraft.getInstance();
        if (mc.player == null || mc.gui.screen() instanceof OrielScreen) return;
        var data = new JsonObject();
        data.addProperty("mode", "history");
        data.add("world", JsonNull.INSTANCE);
        data.add("stack", JsonNull.INSTANCE);
        data.add("prefs", EditorPrefs.read());
        var screen = new HistoryScreen(mc.gui.screen());
        EditorPageHost.attachCommon(screen, data);
        screen.driver().onClose(EditorPrefs::flush);
        mc.gui.setScreen(screen);
    }

    private static void request(DocumentDriver driver, JsonElement raw) {
        String pageId = "";
        try {
            if (raw == null || !raw.isJsonObject())
                throw new IllegalArgumentException("history request must be an object");
            var page = raw.getAsJsonObject();
            pageId = page.has("requestId") && page.get("requestId").isJsonPrimitive()
                    ? page.get("requestId").getAsString()
                    : "";
            if (pageId.isEmpty() || pageId.length() > 80)
                throw new IllegalArgumentException("requestId must be 1-80 characters");
            if (Minecraft.getInstance().getConnection() == null || !ServerLink.connected()) {
                reject(driver, pageId, "UNAVAILABLE", EditorI18n.tr("cadeditor.ui.history.unavailable"));
                return;
            }
            if (pending.size() >= MAX_PENDING) {
                reject(driver, pageId, "rate_limited", EditorI18n.tr("cadeditor.message.history.ratelimited"));
                return;
            }
            var wire = new JsonObject();
            for (var entry : page.entrySet())
                if (FIELDS.contains(entry.getKey()))
                    wire.add(entry.getKey(), entry.getValue().deepCopy());
            String wireId = "history-" + UUID.randomUUID();
            wire.addProperty("op", "history");
            wire.addProperty("requestId", wireId);
            pending.put(wireId, new Pending(driver, pageId, System.nanoTime() + TIMEOUT));
            ClientPlatform.get().send(new EditorPackets.Request(WorldWire.encode(wire)));
        } catch (RuntimeException e) {
            reject(driver, pageId, "invalid_request", String.valueOf(e.getMessage()));
        }
    }

    /** A history reply from the server; false for every other reply. */
    public static boolean receive(JsonObject result) {
        if (!result.has("op") || !"history".equals(result.get("op").getAsString())) return false;
        String id = result.has("requestId") ? result.get("requestId").getAsString() : "";
        var request = pending.remove(id);
        if (request == null) return true; // timed out or the page closed
        var page = result.deepCopy();
        page.addProperty("requestId", request.pageId);
        request.driver.patch("history_result", page);
        return true;
    }

    private static void tick() {
        if (pending.isEmpty()) return;
        long now = System.nanoTime();
        var expired = pending.entrySet().stream()
                .filter(e -> now > e.getValue().deadline)
                .map(Map.Entry::getKey)
                .toList();
        for (String id : expired) {
            var request = pending.remove(id);
            reject(request.driver, request.pageId, "TIMEOUT", EditorI18n.tr("cadeditor.ui.history.timeout"));
        }
    }

    private static void reject(DocumentDriver driver, String pageId, String code, String reason) {
        var result = new JsonObject();
        result.addProperty("status", "rejected");
        result.addProperty("op", "history");
        result.addProperty("requestId", pageId);
        result.addProperty("code", code);
        result.addProperty("reason", reason);
        driver.patch("history_result", result);
    }

    private static final class HistoryScreen extends EditorScreen {
        private final Screen previous;

        HistoryScreen(Screen previous) {
            super(VaultClient.PAGE);
            this.previous = previous;
        }

        @Override
        public void onClose() {
            Minecraft.getInstance().gui.setScreen(previous);
        }
    }
}
