package cn.gtedd.cadeditorpaper.probe;

import com.destroystokyo.paper.event.server.ServerTickEndEvent;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.server.MinecraftServer;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Runs one of the editor's dedicated-server probes on Paper: {@code -Dcadeditor.paper.probe=<class>}, plus the
 * probe's own report property (for example {@code -Dcadeditor.revision.report=<file>}). The probe writes its report
 * and halts the server, as on Fabric.
 */
public final class ProbeRunner {
    private ProbeRunner() {}

    public static void start(JavaPlugin plugin, String className) throws ReflectiveOperationException {
        ModInitializer probe = (ModInitializer) Class.forName(className, true, ProbeRunner.class.getClassLoader())
                .getDeclaredConstructor()
                .newInstance();
        probe.onInitialize();
        plugin.getServer().getPluginManager().registerEvents(new Ticks(), plugin);
        plugin.getSLF4JLogger().info("CAD Editor server probe {} armed", className);
    }

    /** SERVER_STARTED at the end of the first tick (the server has finished starting), END_SERVER_TICK after it. */
    public static final class Ticks implements Listener {
        private boolean started;

        @EventHandler
        public void onTickEnd(ServerTickEndEvent event) {
            MinecraftServer server = MinecraftServer.getServer();
            if (!started) {
                started = true;
                for (ServerLifecycleEvents.ServerStarted l : ServerLifecycleEvents.SERVER_STARTED.listeners())
                    l.onServerStarted(server);
                return;
            }
            for (ServerTickEvents.EndTick l : ServerTickEvents.END_SERVER_TICK.listeners()) l.onEndTick(server);
        }
    }
}
