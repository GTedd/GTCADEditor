package dev.rinorsi.editor.registry;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.oriel.mod.client.DocumentDriver;
import dev.rinorsi.editor.EditorI18n;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.IntBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Map;
import java.util.WeakHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import net.minecraft.client.Minecraft;
import org.lwjgl.stb.STBImage;
import org.lwjgl.system.MemoryStack;
import org.lwjgl.system.MemoryUtil;

/**
 * Picture to lore for the page: the host shows the native open dialog (the vault's SDL3 {@code VaultFileDialog}; 26.3
 * ships lwjgl-sdl, not tinyfd), reads and decodes the file (STB) and builds the lines on a worker. The page never sees
 * a path or file bytes, only the result.
 */
public final class ImageArtChannel {
    public static final long MAX_FILE_BYTES = 16L * 1024 * 1024;
    public static final int MAX_SIDE = 8192;
    public static final long MAX_PIXELS = 16L * 1024 * 1024;

    private static final Map<DocumentDriver, State> STATES = new WeakHashMap<>();
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "editor-image-art");
        thread.setDaemon(true);
        return thread;
    });

    /** Decoded picture, reduced to {@link ImageArt#WORK_SIDE}; never mutated after creation. */
    private record Source(
            int[] pixels, int width, int height, String name, int originalWidth, int originalHeight, long bytes) {}

    private static final class State {
        Object document;
        Source source;
        boolean choosing;
        final AtomicLong ticket = new AtomicLong();
    }

    private ImageArtChannel() {}

    public static void attach(DocumentDriver driver) {
        if (driver.serverSession() || STATES.containsKey(driver)) return;
        STATES.put(driver, new State());
        driver.onMessage("image_art", value -> {
            var mc = Minecraft.getInstance();
            if (mc.isSameThread()) accept(driver, value);
            else mc.execute(() -> accept(driver, value));
        });
        driver.onClose(() -> {
            State state = STATES.remove(driver);
            if (state != null) {
                state.source = null;
                state.ticket.incrementAndGet();
            }
        });
    }

    private static State current(DocumentDriver driver) {
        State state = STATES.get(driver);
        if (state == null) return null;
        if (state.document != driver.document()) {
            state.document = driver.document();
            state.source = null;
            state.ticket.incrementAndGet();
        }
        return state;
    }

    private static void accept(DocumentDriver driver, JsonElement value) {
        State state = current(driver);
        if (state == null) return;
        String id = "";
        String op = "";
        try {
            if (value == null || !value.isJsonObject() || value.toString().length() > 4096)
                throw new IllegalArgumentException();
            JsonObject request = value.getAsJsonObject();
            id = text(request, "requestId");
            op = text(request, "op");
            if (id.isEmpty() || id.length() > 128) throw new IllegalArgumentException();
        } catch (RuntimeException invalid) {
            reply(driver, error(id, op, EditorI18n.tr("cadeditor.message.imageartchannel.bad_request")));
            return;
        }
        JsonObject request = value.getAsJsonObject();
        switch (op) {
            case "choose" -> choose(driver, state, id);
            case "generate" -> generate(driver, state, id, request);
            case "release" -> {
                state.source = null;
                state.ticket.incrementAndGet();
            }
            default -> reply(driver, error(id, op, EditorI18n.tr("cadeditor.message.imageartchannel.bad_request")));
        }
    }

    // ---- choose: the shared SDL3 open dialog (VaultFileDialog, client thread), decode on the worker ----

    private static void choose(DocumentDriver driver, State state, String id) {
        if (state.choosing || dev.rinorsi.editor.vault.VaultFileDialog.open()) {
            reply(driver, error(id, "choose", EditorI18n.tr("cadeditor.message.imageartchannel.dialog_open")));
            return;
        }
        Object document = driver.document();
        state.choosing = true;
        try {
            dev.rinorsi.editor.vault.VaultFileDialog.pick(
                    Minecraft.getInstance().gameDirectory.toPath(),
                    EditorI18n.tr("cadeditor.message.imageartchannel.filter_name"),
                    "png;jpg;jpeg",
                    picked -> {
                        state.choosing = false;
                        if (STATES.get(driver) != state || driver.document() != document) return;
                        if (picked.path().isPresent()) {
                            load(driver, state, document, id, picked.path().get());
                            return;
                        }
                        JsonObject out = base(id, "choose");
                        if (picked.error() == null || picked.error().isBlank()) out.addProperty("status", "cancelled");
                        else {
                            out.addProperty("status", "error");
                            out.addProperty(
                                    "reason",
                                    EditorI18n.tr(
                                            "cadeditor.message.imageartchannel.dialog_failed", clip(picked.error())));
                        }
                        reply(driver, out);
                    });
        } catch (RuntimeException | LinkageError unavailable) {
            state.choosing = false;
            dev.rinorsi.editor.EditorDiagnostics.warning("image_art.dialog", "open", unavailable);
            // The shared dialog already words its own failures (busy, SDL unavailable) for the player.
            String reason = unavailable instanceof dev.rinorsi.editor.vault.VaultStore.Failure
                    ? unavailable.getMessage()
                    : EditorI18n.tr("cadeditor.message.imageartchannel.dialog_failed", clip(unavailable.toString()));
            reply(driver, error(id, "choose", reason));
        }
    }

    private static void load(DocumentDriver driver, State state, Object document, String id, Path file) {
        long ticket = state.ticket.incrementAndGet();
        WORKER.execute(() -> {
            JsonObject out;
            Source source = null;
            try {
                source = decode(file);
                out = base(id, "choose");
                out.addProperty("status", "chosen");
                out.addProperty("name", source.name());
                out.addProperty("width", source.originalWidth());
                out.addProperty("height", source.originalHeight());
                out.addProperty("bytes", source.bytes());
            } catch (UserError failure) {
                out = error(id, "choose", failure.getMessage());
            } catch (IOException | RuntimeException | OutOfMemoryError failure) {
                dev.rinorsi.editor.EditorDiagnostics.warning(
                        "image_art.decode", file.getFileName().toString(), failure);
                out = error(id, "choose", EditorI18n.tr("cadeditor.message.imageartchannel.decode_failed"));
            }
            Source decoded = source;
            JsonObject reply = out;
            Minecraft.getInstance().execute(() -> {
                if (STATES.get(driver) != state || driver.document() != document || state.ticket.get() != ticket)
                    return;
                if (decoded != null) state.source = decoded;
                reply(driver, reply);
            });
        });
    }

    /** Checks name, size, signature and dimensions before decoding; keeps at most WORK_SIDE on the long side. */
    static Source decode(Path file) throws IOException {
        String name = file.getFileName() == null ? "" : file.getFileName().toString();
        String lower = name.toLowerCase(Locale.ROOT);
        if (!lower.endsWith(".png") && !lower.endsWith(".jpg") && !lower.endsWith(".jpeg"))
            throw new UserError(EditorI18n.tr("cadeditor.message.imageartchannel.only_png_jpg"));
        long size = Files.size(file);
        if (size > MAX_FILE_BYTES)
            throw new UserError(EditorI18n.tr(
                    "cadeditor.message.imageartchannel.file_too_large",
                    size / 1024 + " KiB",
                    MAX_FILE_BYTES / 1024 + " KiB"));
        byte[] data = Files.readAllBytes(file);
        if (!png(data) && !jpeg(data))
            throw new UserError(EditorI18n.tr("cadeditor.message.imageartchannel.only_png_jpg"));
        ByteBuffer buffer = MemoryUtil.memAlloc(data.length);
        try (MemoryStack stack = MemoryStack.stackPush()) {
            buffer.put(data).flip();
            IntBuffer w = stack.mallocInt(1), h = stack.mallocInt(1), channels = stack.mallocInt(1);
            if (!STBImage.stbi_info_from_memory(buffer, w, h, channels))
                throw new UserError(EditorI18n.tr("cadeditor.message.imageartchannel.decode_failed"));
            int width = w.get(0), height = h.get(0);
            if (width <= 0
                    || height <= 0
                    || width > MAX_SIDE
                    || height > MAX_SIDE
                    || (long) width * height > MAX_PIXELS)
                throw new UserError(EditorI18n.tr(
                        "cadeditor.message.imageartchannel.image_too_large",
                        width + "×" + height,
                        MAX_SIDE,
                        MAX_PIXELS));
            ByteBuffer rgba = STBImage.stbi_load_from_memory(buffer, w, h, channels, 4);
            if (rgba == null) throw new UserError(EditorI18n.tr("cadeditor.message.imageartchannel.decode_failed"));
            int[] argb = new int[width * height];
            try {
                for (int i = 0; i < argb.length; i++) {
                    int r = rgba.get(i * 4) & 255, g = rgba.get(i * 4 + 1) & 255, b = rgba.get(i * 4 + 2) & 255;
                    int a = rgba.get(i * 4 + 3) & 255;
                    argb[i] = (a << 24) | (r << 16) | (g << 8) | b;
                }
            } finally {
                STBImage.stbi_image_free(rgba);
            }
            int longSide = Math.max(width, height);
            int[] kept = argb;
            int keptW = width, keptH = height;
            if (longSide > ImageArt.WORK_SIDE) {
                keptW = Math.max(1, (int) Math.round((double) width * ImageArt.WORK_SIDE / longSide));
                keptH = Math.max(1, (int) Math.round((double) height * ImageArt.WORK_SIDE / longSide));
                kept = ImageArt.resample(argb, width, height, keptW, keptH);
            }
            return new Source(kept, keptW, keptH, name, width, height, size);
        } finally {
            MemoryUtil.memFree(buffer);
        }
    }

    static boolean png(byte[] data) {
        byte[] magic = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
        if (data.length < magic.length) return false;
        for (int i = 0; i < magic.length; i++) if (data[i] != magic[i]) return false;
        return true;
    }

    static boolean jpeg(byte[] data) {
        return data.length >= 3 && (data[0] & 255) == 0xFF && (data[1] & 255) == 0xD8 && (data[2] & 255) == 0xFF;
    }

    // ---- generate ----

    private static void generate(DocumentDriver driver, State state, String id, JsonObject request) {
        ImageArt.Params params;
        try {
            JsonElement raw = request.get("params");
            if (raw != null && !raw.isJsonObject()) throw new IllegalArgumentException("params");
            params = ImageArt.Params.parse(raw == null ? null : raw.getAsJsonObject());
        } catch (IllegalArgumentException invalid) {
            reply(
                    driver,
                    error(
                            id,
                            "generate",
                            EditorI18n.tr("cadeditor.message.imageartchannel.bad_param", clip(invalid.getMessage()))));
            return;
        }
        Source source = state.source;
        if (source == null) {
            reply(driver, error(id, "generate", EditorI18n.tr("cadeditor.message.imageartchannel.no_image")));
            return;
        }
        long ticket = state.ticket.incrementAndGet();
        Object document = driver.document();
        WORKER.execute(() -> {
            // A newer request already replaced this one: skip the work.
            if (state.ticket.get() != ticket) return;
            JsonObject out;
            try {
                var result = ImageArt.render(source.pixels(), source.width(), source.height(), params);
                out = base(id, "generate");
                out.addProperty("status", "result");
                out.addProperty("lineCount", result.lineCount());
                out.addProperty("columns", result.columns());
                out.addProperty("rows", result.rows());
                out.addProperty("jsonChars", result.jsonChars());
                out.addProperty("runs", result.runs());
                out.addProperty("maxLines", ImageArt.MAX_LINES);
                out.addProperty("maxJsonChars", ImageArt.MAX_JSON_CHARS);
                out.addProperty("tooManyLines", result.tooManyLines());
                out.addProperty("tooLarge", result.tooLarge());
                if (!result.tooManyLines() && !result.tooLarge()) out.add("lines", result.lines());
            } catch (RuntimeException | OutOfMemoryError failure) {
                dev.rinorsi.editor.EditorDiagnostics.warning("image_art.generate", source.name(), failure);
                out = error(id, "generate", EditorI18n.tr("cadeditor.message.imageartchannel.generate_failed"));
            }
            String json = out.toString();
            Minecraft.getInstance().execute(() -> {
                if (STATES.get(driver) != state || driver.document() != document || state.ticket.get() != ticket)
                    return;
                driver.patchJson("image_art", json);
            });
        });
    }

    // ---- replies ----

    private static final class UserError extends RuntimeException {
        UserError(String message) {
            super(message, null, false, false);
        }
    }

    private static String text(JsonObject request, String name) {
        JsonElement value = request.get(name);
        if (value == null
                || !value.isJsonPrimitive()
                || !value.getAsJsonPrimitive().isString()) throw new IllegalArgumentException(name);
        return value.getAsString();
    }

    private static String clip(String text) {
        if (text == null) return "";
        return text.length() > 300 ? text.substring(0, 300) : text;
    }

    private static JsonObject base(String id, String op) {
        JsonObject out = new JsonObject();
        out.addProperty("version", 1);
        out.addProperty("requestId", id);
        out.addProperty("op", op);
        return out;
    }

    private static JsonObject error(String id, String op, String reason) {
        JsonObject out = base(id, op);
        out.addProperty("status", "error");
        out.addProperty("reason", reason);
        return out;
    }

    private static void reply(DocumentDriver driver, JsonObject out) {
        driver.patch("image_art", out);
    }
}
