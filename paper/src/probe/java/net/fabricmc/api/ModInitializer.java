package net.fabricmc.api;

/** Probe-only stand-in for Fabric's entrypoint, so the editor's server probes compile unchanged. Never in the plugin jar. */
@FunctionalInterface
public interface ModInitializer {
    void onInitialize();
}
