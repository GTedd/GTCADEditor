package dev.rinorsi.editor.registry;

import com.google.gson.*;
import dev.oriel.mod.client.DocumentDriver;
import dev.rinorsi.editor.ComponentValidation;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.StackCodec;
import dev.rinorsi.editor.platform.ClientPlatform;
import java.util.*;
import java.util.function.BiConsumer;
import net.minecraft.client.Minecraft;

/** Incremental, local-only schema requests: a per-tick time budget, single components first, eight queued jobs. */
final class ComponentSchemaChannel {
    private ComponentSchemaChannel() {}

    private static final Map<String, ComponentSchema.Derived> CACHE = new LinkedHashMap<>();
    private static final ArrayDeque<Job> JOBS = new ArrayDeque<>();
    private static Object world;
    private static String generation;
    private static boolean initialized;

    private record Job(
            String name,
            String generation,
            JsonObject context,
            Iterator<String> ids,
            JsonArray entries,
            Object world,
            BiConsumer<List<String>, JsonObject> reply) {}

    static boolean supports(String name) {
        return name.equals("component_schema") || name.startsWith("component_schema:");
    }

    /** A schema this channel already derived for the current world (client thread), or null. Read-only reuse. */
    static ComponentSchema.Derived cached(String id) {
        return world != null && world == Minecraft.getInstance().level ? CACHE.get(id) : null;
    }

    static void attach(DocumentDriver driver) {
        if (!initialized) {
            initialized = true;
            ClientPlatform.get().onTick(ComponentSchemaChannel::tick);
        }
        long[] rate = {0, 0};
        driver.onMessage("component_validate", value -> {
            if (driver.serverSession() || value == null || !value.isJsonObject()) return;
            var request = value.getAsJsonObject().deepCopy();
            var mc = Minecraft.getInstance();
            mc.execute(() -> {
                long second = System.nanoTime() / 1_000_000_000L;
                if (rate[0] != second) {
                    rate[0] = second;
                    rate[1] = 0;
                }
                JsonObject result;
                if (request.toString().length() > 8192 || ++rate[1] > 20 || mc.level == null) {
                    result = new JsonObject();
                    result.addProperty("ok", false);
                    if (request.has("requestId") && request.get("requestId").isJsonPrimitive())
                        result.add("requestId", request.get("requestId"));
                    result.addProperty(
                            "error",
                            mc.level == null
                                    ? EditorI18n.tr("cadeditor.message.componentschemachannel.i_ve_left_world")
                                    : EditorI18n.tr(
                                            "cadeditor.message.componentschemachannel.validation_request_exceeds_size_rate"));
                    var errors = new JsonArray();
                    ComponentSchema.addError(
                            errors, "$", "request_limit", result.get("error").getAsString());
                    result.add("errors", errors);
                } else result = ComponentSchemaValidation.validate(request, mc.level.registryAccess());
                driver.patchJson("component_validate.result", result.toString());
            });
        });
    }

    static void request(
            JsonObject request, String name, String currentGeneration, BiConsumer<List<String>, JsonObject> reply) {
        var mc = Minecraft.getInstance();
        var context = new JsonObject();
        try {
            if (mc.level == null)
                throw new IllegalStateException(
                        EditorI18n.tr("cadeditor.message.componentschemachannel.i_ve_left_world"));
            if (world != mc.level || !Objects.equals(generation, currentGeneration)) {
                world = mc.level;
                generation = currentGeneration;
                CACHE.clear();
                JOBS.clear();
            }
            String id = name.startsWith("component_schema:")
                    ? name.substring("component_schema:".length())
                    : request.has("id") ? StackCodec.string(request, "id") : null;
            List<String> ids;
            if (id != null) {
                id = net.minecraft.resources.Identifier.parse(id).toString();
                context.addProperty("id", id);
                ComponentValidation.type(id);
                ids = List.of(id);
            } else ids = ComponentSchema.persistentIds();
            if (id != null
                    && request.has("rangesOnly")
                    && request.get("rangesOnly").isJsonPrimitive()
                    && request.getAsJsonPrimitive("rangesOnly").isBoolean()
                    && request.get("rangesOnly").getAsBoolean()) context.addProperty("rangesOnly", true);
            if (JOBS.size() >= 8)
                throw new IllegalArgumentException(
                        EditorI18n.tr("cadeditor.message.componentschemachannel.component_structure_index_busy_try"));
            JOBS.add(new Job(name, currentGeneration, context, ids.iterator(), new JsonArray(), world, reply));
        } catch (RuntimeException error) {
            error(name, currentGeneration, context, error, reply);
        }
    }

    /**
     * Client-thread time per tick. A cached component is only a copy, so a warm editor gets the whole index in a tick
     * or two; deriving uncached components is what this bounds. One component per tick made every open take 5 s+ of
     * index pages arriving (each a re-ingest and redraw) even with a warm cache.
     */
    static final long TICK_BUDGET_NS = 3_000_000L;

    private static void tick(Minecraft mc) {
        if (mc.level == null) {
            world = null;
            CACHE.clear();
            JOBS.clear();
            return;
        }
        long start = System.nanoTime();
        while (!JOBS.isEmpty() && System.nanoTime() - start < TICK_BUDGET_NS) {
            var job = next();
            if (job.world != mc.level) continue;
            if (!step(job, mc, start)) {
                JOBS.add(job);
                return;
            }
        }
    }

    /** A single-component request (a quick control the player is looking at) goes before the whole index. */
    private static Job next() {
        for (var it = JOBS.iterator(); it.hasNext(); ) {
            var job = it.next();
            if (!job.name.equals("component_schema")) {
                it.remove();
                return job;
            }
        }
        return JOBS.poll();
    }

    /** Advances {@code job} within the tick budget; true when it was answered (or failed). */
    private static boolean step(Job job, Minecraft mc, long start) {
        try {
            // JSON/codec reflection never crosses threads or touches world entities.
            while (job.ids.hasNext()) {
                String id = job.ids.next();
                var schema = CACHE.computeIfAbsent(id, key -> ComponentSchema.derive(key, mc.level.registryAccess()));
                if (job.context.has("rangesOnly")) {
                    // Quick controls need the actual numeric capabilities, not the
                    // potentially oversized recursive form of the entire component.
                    var numeric = new JsonObject();
                    numeric.addProperty("id", id);
                    numeric.add("ranges_for_ui", schema.numericRanges().deepCopy());
                    job.entries.add(numeric);
                } else job.entries.add(schema.entry().deepCopy());
                if (job.ids.hasNext() && System.nanoTime() - start >= TICK_BUDGET_NS) return false;
            }
            var context = job.context.deepCopy();
            context.addProperty("source", "runtime_codec_structural_adapter");
            context.addProperty("availability", "complete");
            var pages = RegistryPages.split(job.name, job.generation, job.entries, context).stream()
                    .map(Object::toString)
                    .toList();
            job.reply.accept(pages, job.context);
        } catch (RuntimeException error) {
            dev.rinorsi.editor.EditorDiagnostics.failure(
                    "schema.derive", job.name + " generation=" + job.generation, error);
            error(job.name, job.generation, job.context, error, job.reply);
        }
        return true;
    }

    private static void error(
            String name,
            String generation,
            JsonObject context,
            RuntimeException error,
            BiConsumer<List<String>, JsonObject> reply) {
        var page =
                RegistryPages.split(name, generation, new JsonArray(), context).getFirst();
        String message = String.valueOf(error.getMessage());
        page.addProperty("error", message.substring(0, Math.min(1000, message.length())));
        reply.accept(List.of(page.toString()), context);
    }
}
