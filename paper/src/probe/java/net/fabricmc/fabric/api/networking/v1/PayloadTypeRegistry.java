package net.fabricmc.fabric.api.networking.v1;

import io.netty.buffer.ByteBuf;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/**
 * Probe-only stand-in with Fabric API's binary shape (an interface, a static factory, register returning TypeAndCodec),
 * so the same compiled probe also links on a real Fabric server for control runs. On Paper the editor's payloads are
 * plugin messages, so registering a type does nothing.
 */
public interface PayloadTypeRegistry<B extends ByteBuf> {
    <T extends CustomPacketPayload> CustomPacketPayload.TypeAndCodec<? super B, T> register(
            CustomPacketPayload.Type<T> id, StreamCodec<? super B, T> codec);

    static PayloadTypeRegistry<RegistryFriendlyByteBuf> clientboundPlay() {
        return new PayloadTypeRegistry<>() {
            @Override
            public <T extends CustomPacketPayload>
                    CustomPacketPayload.TypeAndCodec<? super RegistryFriendlyByteBuf, T> register(
                            CustomPacketPayload.Type<T> id, StreamCodec<? super RegistryFriendlyByteBuf, T> codec) {
                return null; // Nothing to register on Paper; the probes ignore the result.
            }
        };
    }
}
