package dev.rinorsi.editor.vault;

import dev.rinorsi.editor.EditorI18n;
import java.nio.ByteBuffer;
import java.nio.file.Path;
import java.util.Optional;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import org.lwjgl.sdl.SDLDialog;
import org.lwjgl.sdl.SDLError;
import org.lwjgl.sdl.SDL_DialogFileCallback;
import org.lwjgl.sdl.SDL_DialogFileFilter;
import org.lwjgl.system.MemoryUtil;

/**
 * Native "open file" dialog through SDL3, which the 26.3 client already ships and runs its window on (LWJGL
 * {@code lwjgl-sdl}; there is no tinyfd on the classpath). No Mixin: the dialog is a public SDL call on the client
 * thread, parented to the game window. SDL may answer on another thread, so the callback only records the result and
 * {@link #poll} (client tick) frees the native buffers and delivers it, after the callback has returned.
 */
public final class VaultFileDialog {
    private VaultFileDialog() {}

    private static SDL_DialogFileCallback callback;
    private static SDL_DialogFileFilter.Buffer filters;
    private static ByteBuffer filterName, filterPattern, location;
    private static Consumer<Result> pending;
    private static volatile Result result;

    /** {@code path} empty: cancelled; {@code error} set: SDL could not show the dialog. */
    public record Result(Optional<Path> path, String error) {}

    public static boolean open() {
        return pending != null;
    }

    /** Client thread. One dialog at a time; {@code done} runs later on the client thread. */
    public static void pick(Path startDir, Consumer<Result> done) {
        pick(startDir, EditorI18n.tr("cadeditor.message.vaultfiledialog.filter"), "nbt;snbt;json", done);
    }

    /** The same dialog with another filter: a label for the player and an SDL pattern such as {@code png;jpg}. */
    public static void pick(Path startDir, String filterLabel, String pattern, Consumer<Result> done) {
        if (pending != null)
            throw new VaultStore.Failure("BUSY", EditorI18n.tr("cadeditor.message.vaultfiledialog.already_open"));
        try {
            filterName = MemoryUtil.memUTF8(filterLabel);
            filterPattern = MemoryUtil.memUTF8(pattern);
            location = startDir == null ? null : MemoryUtil.memUTF8(startDir.toAbsolutePath() + java.io.File.separator);
            filters = SDL_DialogFileFilter.calloc(1);
            filters.get(0).name(filterName).pattern(filterPattern);
            result = null;
            callback = SDL_DialogFileCallback.create((userdata, filelist, filter) -> {
                if (filelist == MemoryUtil.NULL) result = new Result(Optional.empty(), SDLError.SDL_GetError());
                else {
                    long first = MemoryUtil.memGetAddress(filelist);
                    result = new Result(
                            first == MemoryUtil.NULL
                                    ? Optional.empty()
                                    : Optional.of(Path.of(MemoryUtil.memUTF8(first))),
                            null);
                }
            });
            pending = done;
            SDLDialog.SDL_ShowOpenFileDialog(
                    callback,
                    MemoryUtil.NULL,
                    Minecraft.getInstance().getWindow().handle(),
                    filters,
                    location,
                    false);
        } catch (Throwable unavailable) {
            release();
            throw new VaultStore.Failure(
                    "UNAVAILABLE",
                    EditorI18n.tr(
                            "cadeditor.message.vaultfiledialog.unavailable", VaultStore.clip(unavailable + "", 200)));
        }
    }

    /** Client tick: deliver a finished dialog and free its native memory. */
    public static void poll() {
        Result done = result;
        if (done == null || pending == null) return;
        Consumer<Result> target = pending;
        release();
        target.accept(done);
    }

    private static void release() {
        if (callback != null) callback.free();
        if (filters != null) filters.free();
        for (ByteBuffer b : new ByteBuffer[] {filterName, filterPattern, location})
            if (b != null) MemoryUtil.memFree(b);
        callback = null;
        filters = null;
        filterName = filterPattern = location = null;
        pending = null;
        result = null;
    }
}
