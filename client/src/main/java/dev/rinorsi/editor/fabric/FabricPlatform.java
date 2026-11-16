package dev.rinorsi.editor.fabric;

import com.mojang.authlib.GameProfile;
import com.mojang.brigadier.CommandDispatcher;
import dev.rinorsi.editor.EditorPackets;
import dev.rinorsi.editor.platform.Platform;
import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;
import java.nio.file.Path;
import java.util.List;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.PlayerAdvancements;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.stats.ServerStatsCounter;
import net.minecraft.tags.TagKey;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.inventory.PlayerEnderChestContainer;
import net.minecraft.world.level.GameType;
import org.jspecify.annotations.Nullable;
import org.slf4j.LoggerFactory;

public final class FabricPlatform implements Platform {
    /** fabric-permissions-api (LuckPerms and others on Fabric), when installed; looked up once, never required. */
    private static final @Nullable MethodHandle PERMISSIONS_CHECK = permissionsApi();

    public Path configDir() {
        return FabricLoader.getInstance().getConfigDir();
    }

    public List<String> modIds() {
        return FabricLoader.getInstance().getAllMods().stream()
                .map(m -> m.getMetadata().getId())
                .toList();
    }

    public String modVersion(String id) {
        return FabricLoader.getInstance()
                .getModContainer(id)
                .map(m -> m.getMetadata().getVersion().getFriendlyString())
                .orElse("unknown");
    }

    public String tagTranslationKey(TagKey<?> tag) {
        return ((net.fabricmc.fabric.api.tag.FabricTagKey) (Object) tag).getTranslationKey();
    }

    public void onServerStarting(Consumer<MinecraftServer> c) {
        ServerLifecycleEvents.SERVER_STARTING.register(c::accept);
    }

    public void onServerStopped(Consumer<MinecraftServer> c) {
        ServerLifecycleEvents.SERVER_STOPPED.register(c::accept);
    }

    public void onDataReload(Runnable c) {
        ServerLifecycleEvents.END_DATA_PACK_RELOAD.register((s, r, ok) -> c.run());
    }

    public void onDisconnect(Consumer<ServerPlayer> c) {
        ServerPlayConnectionEvents.DISCONNECT.register((h, s) -> c.accept(h.player));
    }

    public void onCommands(Consumer<CommandDispatcher<CommandSourceStack>> c) {
        CommandRegistrationCallback.EVENT.register((d, r, e) -> c.accept(d));
    }

    public void receive(BiConsumer<ServerPlayer, EditorPackets.Request> c) {
        ServerPlayNetworking.registerGlobalReceiver(
                EditorPackets.Request.TYPE, (p, ctx) -> ctx.server().execute(() -> c.accept(ctx.player(), p)));
    }

    public void send(ServerPlayer p, EditorPackets.Reply reply) {
        for (String frame : dev.rinorsi.editor.EditorWire.frames(reply.json()))
            ServerPlayNetworking.send(p, new EditorPackets.Reply(frame));
    }

    @Override
    public boolean hasPermission(ServerPlayer player, String node, boolean fallback) {
        if (PERMISSIONS_CHECK == null) return fallback;
        try {
            return (boolean) PERMISSIONS_CHECK.invokeExact((Entity) player, node, fallback);
        } catch (Throwable e) {
            // A broken permission provider must not open the editor up: fall back to the editor's own default.
            LoggerFactory.getLogger("cadeditor")
                    .warn("[CAD-Editor] permission provider failed for {}; using the default", node, e);
            return fallback;
        }
    }

    private static @Nullable MethodHandle permissionsApi() {
        if (!FabricLoader.getInstance().isModLoaded("fabric-permissions-api-v0")) return null;
        try {
            Class<?> api = Class.forName("me.lucko.fabric.api.permissions.v0.Permissions");
            return MethodHandles.publicLookup()
                    .findStatic(
                            api,
                            "check",
                            MethodType.methodType(boolean.class, Entity.class, String.class, boolean.class));
        } catch (ReflectiveOperationException | LinkageError e) {
            LoggerFactory.getLogger("cadeditor")
                    .warn("[CAD-Editor] fabric-permissions-api is installed but not usable; using operator levels", e);
            return null;
        }
    }

    /** Per world: singleplayer worlds and dedicated servers each keep their own history next to their level data. */
    @Override
    public Path historyDir(MinecraftServer server) {
        return server.getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT)
                .resolve("cadeditor-history");
    }

    @Override
    public int enderChestSize() {
        return new PlayerEnderChestContainer().getContainerSize();
    }

    @Override
    public void setGameModeQuietly(ServerPlayer player, GameType mode) {
        // Widened in cadeditor.accesswidener.
        player.gameMode.setGameModeForPlayer(mode, player.gameMode());
    }

    @Override
    public ServerPlayer detachedPlayer(
            MinecraftServer server,
            ServerLevel level,
            GameProfile profile,
            ServerStatsCounter stats,
            PlayerAdvancements advancements) {
        // The ServerPlayer constructor takes these from the PlayerList caches (widened in cadeditor.accesswidener);
        // with
        // entries present it neither reads nor migrates files. They stay until releaseDetachedPlayer.
        var list = server.getPlayerList();
        if (list.stats.putIfAbsent(profile.id(), stats) != null
                || list.advancements.putIfAbsent(profile.id(), advancements) != null) {
            list.stats.remove(profile.id(), stats);
            throw new IllegalStateException("Player cache already has " + profile.id());
        }
        try {
            return new ServerPlayer(server, level, profile, ClientInformation.createDefault());
        } catch (RuntimeException | Error e) {
            list.stats.remove(profile.id(), stats);
            list.advancements.remove(profile.id(), advancements);
            throw e;
        }
    }

    @Override
    public void releaseDetachedPlayer(ServerPlayer player) {
        var list = player.level().getServer().getPlayerList();
        list.stats.remove(player.getUUID());
        list.advancements.remove(player.getUUID());
    }
}
