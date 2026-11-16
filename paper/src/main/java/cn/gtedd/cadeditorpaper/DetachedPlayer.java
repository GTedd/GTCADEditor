package cn.gtedd.cadeditorpaper;

import com.mojang.authlib.GameProfile;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.PlayerAdvancements;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.stats.ServerStatsCounter;

/**
 * The player an offline player's data is loaded into. Its getters return the prepared stats and advancements while the
 * constructor runs, which Paper's PlayerList reads instead of the maps Fabric fills.
 */
public final class DetachedPlayer extends ServerPlayer {
    private final ServerStatsCounter detachedStats;
    private final PlayerAdvancements detachedAdvancements;

    private DetachedPlayer(
            MinecraftServer server,
            ServerLevel level,
            GameProfile profile,
            ServerStatsCounter stats,
            PlayerAdvancements advancements) {
        // Assigned before super(...) (flexible constructor bodies, Java 25): the super constructor calls the getters.
        this.detachedStats = stats;
        this.detachedAdvancements = advancements;
        super(server, level, profile, ClientInformation.createDefault());
    }

    public static ServerPlayer create(
            MinecraftServer server,
            ServerLevel level,
            GameProfile profile,
            ServerStatsCounter stats,
            PlayerAdvancements advancements) {
        return new DetachedPlayer(server, level, profile, stats, advancements);
    }

    @Override
    public ServerStatsCounter getStats() {
        return detachedStats;
    }

    @Override
    public PlayerAdvancements getAdvancements() {
        return detachedAdvancements;
    }
}
