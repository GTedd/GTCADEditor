package net.fabricmc.fabric.api.event.lifecycle.v1;

import net.fabricmc.fabric.api.event.Event;
import net.minecraft.server.MinecraftServer;

/** Probe-only stand-in: ProbeRunner fires SERVER_STARTED once the Paper server has finished starting. */
public final class ServerLifecycleEvents {
    public static final Event<ServerStarted> SERVER_STARTED = new Event<>();

    private ServerLifecycleEvents() {}

    @FunctionalInterface
    public interface ServerStarted {
        void onServerStarted(MinecraftServer server);
    }
}
