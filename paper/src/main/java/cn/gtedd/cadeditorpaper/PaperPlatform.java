package cn.gtedd.cadeditorpaper;

import com.mojang.authlib.GameProfile;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.tree.CommandNode;
import com.mojang.brigadier.tree.LiteralCommandNode;
import dev.rinorsi.editor.EditorPackets;
import dev.rinorsi.editor.EditorWire;
import dev.rinorsi.editor.platform.Platform;
import io.netty.handler.codec.DecoderException;
import io.papermc.paper.command.brigadier.Commands;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.PlayerAdvancements;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.stats.ServerStatsCounter;
import net.minecraft.tags.TagKey;
import net.minecraft.world.level.GameType;
import org.bukkit.Bukkit;
import org.jspecify.annotations.Nullable;

/** The editor's platform services on Paper; {@link CadEditorPaperPlugin} fires the callbacks from Bukkit events. */
public final class PaperPlatform implements Platform {
    private final List<Consumer<MinecraftServer>> starting = new CopyOnWriteArrayList<>();
    private final List<Consumer<MinecraftServer>> stopped = new CopyOnWriteArrayList<>();
    private final List<Runnable> dataReload = new CopyOnWriteArrayList<>();
    private final List<Consumer<ServerPlayer>> disconnect = new CopyOnWriteArrayList<>();
    private final List<Consumer<CommandDispatcher<CommandSourceStack>>> commands = new CopyOnWriteArrayList<>();
    private final List<BiConsumer<ServerPlayer, EditorPackets.Request>> receivers = new CopyOnWriteArrayList<>();
    private volatile @Nullable CadEditorPaperPlugin plugin;

    /** For ServiceLoader; the plugin binds itself before the editor initialises. */
    public PaperPlatform() {}

    void bind(CadEditorPaperPlugin owner) {
        this.plugin = owner;
        try {
            Files.createDirectories(owner.getDataFolder().toPath());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private CadEditorPaperPlugin plugin() {
        CadEditorPaperPlugin p = plugin;
        if (p == null) throw new IllegalStateException("The CAD Editor Paper platform is not bound to its plugin");
        return p;
    }

    // ---- Platform ----

    /** {@code cadeditor.json} (write policy) lives in the plugin's data folder. */
    @Override
    public Path configDir() {
        return plugin().getDataFolder().toPath();
    }

    /** A Paper server has no mods; the editor itself is this plugin. */
    @Override
    public List<String> modIds() {
        return List.of("minecraft", "cadeditor");
    }

    @Override
    public String modVersion(String id) {
        return switch (id) {
            case "cadeditor" -> plugin().getPluginMeta().getVersion();
            case "minecraft" -> Bukkit.getMinecraftVersion();
            default -> "unknown";
        };
    }

    /** Fabric's {@code FabricTagKey#getTranslationKey}, which the editor's Fabric side uses. */
    @Override
    public String tagTranslationKey(TagKey<?> tag) {
        Identifier registry = tag.registry().identifier();
        Identifier location = tag.location();
        StringBuilder key = new StringBuilder("tag.");
        if (!registry.getNamespace().equals(Identifier.DEFAULT_NAMESPACE))
            key.append(registry.getNamespace()).append('.');
        key.append(registry.getPath().replace('/', '.'))
                .append('.')
                .append(location.getNamespace())
                .append('.')
                .append(location.getPath().replace('/', '.'));
        return key.toString();
    }

    @Override
    public void onServerStarting(Consumer<MinecraftServer> callback) {
        starting.add(callback);
    }

    @Override
    public void onServerStopped(Consumer<MinecraftServer> callback) {
        stopped.add(callback);
    }

    @Override
    public void onDataReload(Runnable callback) {
        dataReload.add(callback);
    }

    @Override
    public void onDisconnect(Consumer<ServerPlayer> callback) {
        disconnect.add(callback);
    }

    @Override
    public void onCommands(Consumer<CommandDispatcher<CommandSourceStack>> callback) {
        commands.add(callback);
    }

    @Override
    public void receive(BiConsumer<ServerPlayer, EditorPackets.Request> callback) {
        receivers.add(callback);
    }

    /** Like the editor's FabricPlatform: its own bounded framing, one plugin message per frame. */
    @Override
    public void send(ServerPlayer player, EditorPackets.Reply reply) {
        CadEditorPaperPlugin owner = plugin();
        for (String frame : EditorWire.frames(reply.json())) {
            player.getBukkitEntity()
                    .sendPluginMessage(
                            owner,
                            EditorChannel.REPLY,
                            EditorChannel.encodeReply(new EditorPackets.Reply(frame), player.registryAccess()));
        }
    }

    /**
     * A permission plugin decides when it sets the node explicitly (grant or denial); otherwise the editor's default.
     * {@code isPermissionSet} is false for nodes nobody configured, including Bukkit's own op defaults, so vanilla
     * operator levels keep working on servers without a permission plugin.
     */
    @Override
    public boolean hasPermission(ServerPlayer player, String node, boolean fallback) {
        var bukkit = player.getBukkitEntity();
        return bukkit.isPermissionSet(node) ? bukkit.hasPermission(node) : fallback;
    }

    /** plugins/CADEditor/history/history.jsonl */
    @Override
    public Path historyDir(MinecraftServer server) {
        return configDir().resolve("history");
    }

    /** Paper's PlayerEnderChestContainer takes its owner; the size does not depend on it. */
    @Override
    public int enderChestSize() {
        return new net.minecraft.world.inventory.PlayerEnderChestContainer(null).getContainerSize();
    }

    @Override
    public void setGameModeQuietly(ServerPlayer player, GameType mode) {
        PaperAccess.setGameModeForPlayer(player.gameMode, mode, player.gameMode());
    }

    @Override
    public ServerPlayer detachedPlayer(
            MinecraftServer server,
            ServerLevel level,
            GameProfile profile,
            ServerStatsCounter stats,
            PlayerAdvancements advancements) {
        return DetachedPlayer.create(server, level, profile, stats, advancements);
    }

    // ---- Fired by the plugin ----

    void serverStarting(MinecraftServer server) {
        for (Consumer<MinecraftServer> c : starting) c.accept(server);
    }

    void serverStopped(MinecraftServer server) {
        for (Consumer<MinecraftServer> c : stopped) c.accept(server);
    }

    void dataReloaded() {
        for (Runnable r : dataReload) r.run();
    }

    void disconnected(ServerPlayer player) {
        for (Consumer<ServerPlayer> c : disconnect) c.accept(player);
    }

    /** A {@code cadeditor:request} body, on the server thread. A body that does not decode is dropped. */
    void received(ServerPlayer player, byte[] body) {
        EditorPackets.Request request;
        try {
            request = EditorChannel.decodeRequest(body, player.registryAccess());
        } catch (DecoderException | IndexOutOfBoundsException e) {
            plugin().getSLF4JLogger()
                    .warn(
                            "Dropped a malformed CAD Editor request from {}: {}",
                            player.getScoreboardName(),
                            e.getMessage());
            return;
        }
        for (BiConsumer<ServerPlayer, EditorPackets.Request> r : receivers) r.accept(player, request);
    }

    /**
     * The editor's server commands ({@code /cadeditor testkit}) through Paper's command registrar. They are written
     * against Minecraft's {@code CommandSourceStack}, which on Paper implements Paper's {@code CommandSourceStack}:
     * every command runs with it, so the nodes are registered as they are.
     */
    void registerCommands(Commands registrar) {
        CommandDispatcher<CommandSourceStack> scratch = new CommandDispatcher<>();
        for (Consumer<CommandDispatcher<CommandSourceStack>> c : commands) c.accept(scratch);
        for (CommandNode<CommandSourceStack> node : scratch.getRoot().getChildren()) {
            if (node instanceof LiteralCommandNode<CommandSourceStack> literal) {
                registrar.register(paperNode(literal), "CAD Editor server command");
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static LiteralCommandNode<io.papermc.paper.command.brigadier.CommandSourceStack> paperNode(
            LiteralCommandNode<CommandSourceStack> node) {
        return (LiteralCommandNode<io.papermc.paper.command.brigadier.CommandSourceStack>) (LiteralCommandNode<?>) node;
    }
}
