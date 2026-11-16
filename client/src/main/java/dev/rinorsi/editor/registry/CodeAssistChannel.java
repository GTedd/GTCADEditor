package dev.rinorsi.editor.registry;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.oriel.mod.client.DocumentDriver;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.platform.ClientPlatform;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
import net.minecraft.client.Minecraft;

/**
 * SNBT completion for the page's code editor (message {@code code_assist}, reply {@code code_assist.result}). The page
 * sends only the cursor context (key path, key/value position, prefix, nearby keys), never the document. Requests are
 * coalesced per view and rate limited; answers for a replaced document or world are dropped. Read-only.
 */
public final class CodeAssistChannel {
    private static final Map<DocumentDriver, State> STATES = new WeakHashMap<>();
    /** Derived schemas are reused across requests of one world; they hold codec facts, not world state. */
    private static final Map<String, JsonObject> SCHEMAS = new LinkedHashMap<>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, JsonObject> eldest) {
            return size() > 48;
        }
    };

    private static Object schemaWorld;
    private static boolean initialized;

    private static final class State {
        Object document;
        long second;
        int requests;
        final LinkedHashMap<String, Pending> views = new LinkedHashMap<>();
    }

    private record Pending(String id, CodeAssistResolver.Request request, Object level, boolean cancel) {}

    private CodeAssistChannel() {}

    public static void attach(DocumentDriver driver) {
        if (driver.serverSession() || STATES.containsKey(driver)) return;
        STATES.put(driver, new State());
        driver.onMessage("code_assist", value -> accept(driver, value));
        driver.onClose(() -> STATES.remove(driver));
        if (!initialized) {
            initialized = true;
            ClientPlatform.get().onTick(mc -> tick());
        }
    }

    private static void accept(DocumentDriver driver, JsonElement value) {
        var mc = Minecraft.getInstance();
        if (!mc.isSameThread()) {
            mc.execute(() -> accept(driver, value));
            return;
        }
        State state = STATES.get(driver);
        if (state == null || driver.serverSession()) return;
        if (state.document != driver.document()) {
            state.document = driver.document();
            state.views.clear();
            state.requests = 0;
        }
        String id = "";
        try {
            if (value == null || !value.isJsonObject() || value.toString().length() > 8192)
                throw new IllegalArgumentException("BAD_REQUEST");
            JsonObject request = value.getAsJsonObject();
            id = text(request, "requestId", null, 128);
            String view = text(request, "view", "code", 128);
            if (id == null || id.isEmpty() || view.isEmpty()) throw new IllegalArgumentException("BAD_REQUEST");
            if (!state.views.containsKey(view) && state.views.size() >= 8) {
                error(driver, id, "BUSY", EditorI18n.tr("cadeditor.message.codeassistchannel.too_many_views"));
                return;
            }
            long second = System.nanoTime() / 1_000_000_000L;
            if (state.second != second) {
                state.second = second;
                state.requests = 0;
            }
            // A newer request replaces the view's previous one even when it is itself rejected below.
            state.views.remove(view);
            if (request.has("cancel")
                    && request.get("cancel").isJsonPrimitive()
                    && request.get("cancel").getAsBoolean()) {
                state.views.put(view, new Pending(id, null, mc.level, true));
                return;
            }
            if (++state.requests > 20) {
                error(driver, id, "BUSY", EditorI18n.tr("cadeditor.message.codeassistchannel.rate_limited"));
                return;
            }
            if (mc.level == null) {
                error(driver, id, "UNAVAILABLE", EditorI18n.tr("cadeditor.message.worldeditorclient.currently_world"));
                return;
            }
            state.views.put(view, new Pending(id, parse(request), mc.level, false));
        } catch (RuntimeException invalid) {
            error(driver, id, "BAD_REQUEST", EditorI18n.tr("cadeditor.message.codeassistchannel.bad_request"));
        }
    }

    static CodeAssistResolver.Request parse(JsonObject request) {
        String root = text(request, "root", "nbt", 16);
        if (!Set.of("stack", "component", "nbt").contains(root)) throw new IllegalArgumentException("BAD_REQUEST");
        String mode = text(request, "mode", "value", 8);
        if (!mode.equals("key") && !mode.equals("value")) throw new IllegalArgumentException("BAD_REQUEST");
        List<String> path = new ArrayList<>();
        if (request.has("path")) {
            if (!(request.get("path") instanceof JsonArray array) || array.size() > CodeAssistResolver.MAX_PATH)
                throw new IllegalArgumentException("BAD_REQUEST");
            for (JsonElement e : array) path.add(string(e, 256));
        }
        Set<String> siblings = new LinkedHashSet<>();
        if (request.has("siblings")) {
            if (!(request.get("siblings") instanceof JsonArray array) || array.size() > 64)
                throw new IllegalArgumentException("BAD_REQUEST");
            for (JsonElement e : array) siblings.add(string(e, 256));
        }
        Map<String, String> values = new LinkedHashMap<>();
        if (request.has("values")) {
            if (!(request.get("values") instanceof JsonObject object) || object.size() > 16)
                throw new IllegalArgumentException("BAD_REQUEST");
            for (var entry : object.entrySet()) {
                if (entry.getKey().length() > 256) throw new IllegalArgumentException("BAD_REQUEST");
                values.put(entry.getKey(), string(entry.getValue(), 256));
            }
        }
        int limit = 100;
        if (request.has("limit")) {
            if (!request.get("limit").isJsonPrimitive()
                    || !request.getAsJsonPrimitive("limit").isNumber())
                throw new IllegalArgumentException("BAD_REQUEST");
            limit = Math.max(
                    1,
                    Math.min(CodeAssistResolver.MAX_ITEMS, request.get("limit").getAsInt()));
        }
        return new CodeAssistResolver.Request(
                root,
                text(request, "component", null, 256),
                text(request, "item", null, 256),
                List.copyOf(path),
                mode.equals("key"),
                text(request, "prefix", "", 256),
                Set.copyOf(siblings),
                Map.copyOf(values),
                limit);
    }

    private static String string(JsonElement e, int max) {
        if (e == null
                || !e.isJsonPrimitive()
                || !e.getAsJsonPrimitive().isString()
                || e.getAsString().length() > max) throw new IllegalArgumentException("BAD_REQUEST");
        return e.getAsString();
    }

    private static String text(JsonObject request, String name, String fallback, int max) {
        if (!request.has(name) || request.get(name).isJsonNull()) return fallback;
        return string(request.get(name), max);
    }

    private static void tick() {
        var mc = Minecraft.getInstance();
        if (schemaWorld != mc.level) {
            schemaWorld = mc.level;
            SCHEMAS.clear();
        }
        int delivered = 0;
        for (var entry : List.copyOf(STATES.entrySet())) {
            var driver = entry.getKey();
            var state = entry.getValue();
            if (STATES.get(driver) != state) continue;
            if (state.document != driver.document()) {
                state.views.clear();
                state.document = driver.document();
                state.requests = 0;
                continue;
            }
            for (var view : new ArrayList<>(state.views.entrySet())) {
                Pending pending = view.getValue();
                if (pending == null) continue;
                if (delivered >= 2) return;
                delivered++;
                state.views.remove(view.getKey());
                if (pending.cancel()) {
                    JsonObject result = base(pending.id());
                    result.addProperty("ok", true);
                    result.addProperty("cancelled", true);
                    driver.patch("code_assist.result", result);
                    continue;
                }
                if (mc.level == null || mc.level != pending.level()) {
                    error(
                            driver,
                            pending.id(),
                            "UNAVAILABLE",
                            EditorI18n.tr("cadeditor.message.codeassistchannel.world_changed"));
                    continue;
                }
                try {
                    var access = mc.level.registryAccess();
                    var derive = CodeAssistResolver.derived(access);
                    var resolver = new CodeAssistResolver(access, component -> {
                        JsonObject cached = SCHEMAS.get(component);
                        if (cached == null) {
                            // The editor usually derived it already for its forms; derive only when it did not.
                            var known = ComponentSchemaChannel.cached(component);
                            cached = known != null ? known.root().toJson() : derive.root(component);
                            SCHEMAS.put(component, cached);
                        }
                        return cached;
                    });
                    JsonObject result = resolver.resolve(pending.request());
                    result.addProperty("version", 1);
                    result.addProperty("requestId", pending.id());
                    result.addProperty("ok", true);
                    driver.patchJson("code_assist.result", result.toString());
                } catch (RuntimeException failure) {
                    dev.rinorsi.editor.EditorDiagnostics.failure("code_assist", "resolve", failure);
                    String message = String.valueOf(failure.getMessage());
                    error(driver, pending.id(), "FAILED", message.substring(0, Math.min(512, message.length())));
                }
            }
        }
    }

    private static JsonObject base(String id) {
        JsonObject out = new JsonObject();
        out.addProperty("version", 1);
        out.addProperty("requestId", id);
        return out;
    }

    private static void error(DocumentDriver driver, String id, String code, String reason) {
        JsonObject out = base(id);
        out.addProperty("ok", false);
        out.addProperty("error", code);
        out.addProperty("reason", reason);
        driver.patch("code_assist.result", out);
    }
}
