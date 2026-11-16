package cn.gtedd.cadeditorpaper;

import dev.rinorsi.editor.EditorMod;
import dev.rinorsi.editor.platform.Platform;
import io.papermc.paper.event.server.ServerResourcesReloadedEvent;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.plugin.messaging.Messenger;
import org.jspecify.annotations.Nullable;

/** Paper entry point: runs the editor's server code on {@link PaperPlatform} and carries its packets as plugin messages. */
public final class CadEditorPaperPlugin extends JavaPlugin implements Listener {
    private @Nullable PaperPlatform platform;

    @Override
    public void onEnable() {
        PaperPlatform p = loadPlatform();
        p.bind(this);
        platform = p;
        new EditorMod().onInitialize();

        Messenger messenger = getServer().getMessenger();
        messenger.registerOutgoingPluginChannel(this, EditorChannel.REPLY);
        messenger.registerIncomingPluginChannel(this, EditorChannel.REQUEST, (channel, player, body) -> {
            // The editor handles requests on the server thread (FabricPlatform: server.execute).
            if (getServer().isPrimaryThread()) p.received(handle(player), body);
            else
                getServer().getScheduler().runTask(this, () -> {
                    if (player.isOnline()) p.received(handle(player), body);
                });
        });
        getServer().getPluginManager().registerEvents(this, this);
        getLifecycleManager()
                .registerEventHandler(LifecycleEvents.COMMANDS, event -> p.registerCommands(event.registrar()));

        // Fabric's SERVER_STARTING: the editor loads cadeditor.json and resets its session caches.
        p.serverStarting(MinecraftServer.getServer());
        startProbeIfRequested();
    }

    @Override
    public void onDisable() {
        PaperPlatform p = platform;
        if (p != null) p.serverStopped(MinecraftServer.getServer());
        platform = null;
        Messenger messenger = getServer().getMessenger();
        messenger.unregisterIncomingPluginChannel(this);
        messenger.unregisterOutgoingPluginChannel(this);
    }

    /** Fabric's DISCONNECT: the editor drops the player's sessions and in-flight transfers. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        PaperPlatform p = platform;
        if (p != null) p.disconnected(handle(event.getPlayer()));
    }

    /** Fabric's END_DATA_PACK_RELOAD: the editor invalidates its entity schema cache. */
    @EventHandler
    public void onResourcesReloaded(ServerResourcesReloadedEvent event) {
        PaperPlatform p = platform;
        if (p != null) p.dataReloaded();
    }

    private static ServerPlayer handle(Player player) {
        return ((CraftPlayer) player).getHandle();
    }

    /**
     * The editor finds its Platform with {@code ServiceLoader.load}, which searches the thread's context class loader;
     * on Paper's server thread that is not this plugin's, so the first lookup runs with the plugin's loader.
     */
    private PaperPlatform loadPlatform() {
        Thread thread = Thread.currentThread();
        ClassLoader previous = thread.getContextClassLoader();
        thread.setContextClassLoader(getClassLoader());
        try {
            if (Platform.get() instanceof PaperPlatform paper) return paper;
            throw new IllegalStateException(
                    "The editor loaded " + Platform.get().getClass().getName() + " instead of PaperPlatform");
        } finally {
            thread.setContextClassLoader(previous);
        }
    }

    /** {@code -Dcadeditor.paper.probe=<probe class>} runs one of the editor's server probes (the -probe jar only). */
    private void startProbeIfRequested() {
        String probe = System.getProperty("cadeditor.paper.probe");
        if (probe == null || probe.isBlank()) return;
        try {
            Class.forName("cn.gtedd.cadeditorpaper.probe.ProbeRunner", true, getClassLoader())
                    .getMethod("start", JavaPlugin.class, String.class)
                    .invoke(null, this, probe);
        } catch (ClassNotFoundException e) {
            getSLF4JLogger().error("cadeditor.paper.probe is set, but this jar has no probes: use the -probe jar");
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Cannot start probe " + probe, e);
        }
    }
}
