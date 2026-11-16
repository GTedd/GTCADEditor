package cn.gtedd.cadeditorpaper;

import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;
import net.minecraft.server.level.ServerPlayerGameMode;
import net.minecraft.world.level.GameType;
import org.jspecify.annotations.Nullable;

/** Members the Fabric mod opens with its access widener; a plugin reaches them here instead. */
public final class PaperAccess {
    private static final MethodHandle SET_GAME_MODE_FOR_PLAYER;

    static {
        try {
            SET_GAME_MODE_FOR_PLAYER = MethodHandles.privateLookupIn(ServerPlayerGameMode.class, MethodHandles.lookup())
                    .findVirtual(
                            ServerPlayerGameMode.class,
                            "setGameModeForPlayer",
                            MethodType.methodType(void.class, GameType.class, GameType.class));
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    private PaperAccess() {}

    /**
     * {@code ServerPlayerGameMode#setGameModeForPlayer} (protected): sets a detached player's game mode without the
     * packets, events and broadcasts of {@code ServerPlayer#setGameMode}.
     */
    public static void setGameModeForPlayer(ServerPlayerGameMode gameMode, GameType type, @Nullable GameType previous) {
        try {
            SET_GAME_MODE_FOR_PLAYER.invokeExact(gameMode, type, previous);
        } catch (RuntimeException | Error e) {
            throw e;
        } catch (Throwable e) {
            throw new IllegalStateException(e);
        }
    }
}
