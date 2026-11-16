package dev.rinorsi.editor.platform;

import com.mojang.authlib.GameProfile;
import com.mojang.brigadier.CommandDispatcher;
import dev.rinorsi.editor.EditorPackets;
import java.nio.file.Path;
import java.util.List;
import java.util.ServiceLoader;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.PlayerAdvancements;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.stats.ServerStatsCounter;
import net.minecraft.tags.TagKey;
import net.minecraft.world.level.GameType;

/**
 * Loader services only; editing, validation, history and permission rules remain in common. No client types on this
 * boundary. Implemented by the Fabric mod (FabricPlatform) and the Paper plugin (PaperPlatform).
 */
public interface Platform {
    static Platform get() {
        return Holder.INSTANCE;
    }

    final class Holder {
        private static final Platform INSTANCE =
                ServiceLoader.load(Platform.class).findFirst().orElseThrow();

        private Holder() {}
    }

    Path configDir();

    List<String> modIds();

    String modVersion(String id);

    default boolean isModLoaded(String id) {
        return modIds().contains(id);
    }

    String tagTranslationKey(TagKey<?> tag);

    void onServerStarting(Consumer<MinecraftServer> callback);

    void onServerStopped(Consumer<MinecraftServer> callback);

    void onDataReload(Runnable callback);

    void onDisconnect(Consumer<ServerPlayer> callback);

    void onCommands(Consumer<CommandDispatcher<CommandSourceStack>> callback);

    void receive(BiConsumer<ServerPlayer, EditorPackets.Request> callback);

    void send(ServerPlayer player, EditorPackets.Reply reply);

    /**
     * A permission node from a permission plugin, when one decides it: an explicit grant or denial wins, otherwise
     * {@code fallback} (the editor's own default from operator level, game mode and cadeditor.json). Never consults
     * anything the client sent.
     */
    boolean hasPermission(ServerPlayer player, String node, boolean fallback);

    /** Where the server keeps the editor history (history.jsonl). */
    default Path historyDir(MinecraftServer server) {
        return configDir().resolve("cadeditor-history");
    }

    // Vanilla internals that the loaders change or hide.

    /** The ender chest's slot count (Paper adds an owner parameter to PlayerEnderChestContainer). */
    int enderChestSize();

    /** Sets a detached player's game mode without packets, events or broadcasts (protected in vanilla). */
    void setGameModeQuietly(ServerPlayer player, GameType mode);

    /**
     * A player object for reading a saved player file, never added to the world, that uses these stats and
     * advancements instead of loading (and migrating) the real ones.
     */
    ServerPlayer detachedPlayer(
            MinecraftServer server,
            ServerLevel level,
            GameProfile profile,
            ServerStatsCounter stats,
            PlayerAdvancements advancements);

    /** Called once the detached player is no longer needed, also after a failed read. */
    default void releaseDetachedPlayer(ServerPlayer player) {}
}
