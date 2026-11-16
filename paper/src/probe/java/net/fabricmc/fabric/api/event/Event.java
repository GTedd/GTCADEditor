package net.fabricmc.fabric.api.event;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** Probe-only stand-in for Fabric's Event: listeners in registration order, fired by ProbeRunner. */
public final class Event<T> {
    private final List<T> listeners = new CopyOnWriteArrayList<>();

    public void register(T listener) {
        listeners.add(listener);
    }

    public List<T> listeners() {
        return listeners;
    }
}
