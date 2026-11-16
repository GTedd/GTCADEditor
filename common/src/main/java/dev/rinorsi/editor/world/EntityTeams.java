package dev.rinorsi.editor.world;

import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorSessions;
import java.util.Optional;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.scores.PlayerTeam;
import net.minecraft.world.scores.Scoreboard;
import net.minecraft.world.scores.TeamColor;

/**
 * An entity's glow outline takes the colour of its team, and {@code Team} is the vanilla key that joins one on load
 * (never saved). The editor shows the live direct team as {@code Team} in entity session data so the client sees it and
 * the three-way merge, undo and history cover it like any other field. It never reaches a loader: validation copies are
 * created in the live level with the live UUID, so a load would move the real entity before anything is accepted. The
 * merged value is applied once, after the world write. Accepted: keep the live team, no team, or an editor glow team
 * ({@code cadeditor_glow_<colour>}), which is created with that colour on first use.
 */
public final class EntityTeams {
    public static final String KEY = "Team";
    public static final String GLOW_PREFIX = "cadeditor_glow_";

    private EntityTeams() {}

    /** Players have their own editor and teams; everything else carries {@code Team}. */
    public static boolean applies(Entity entity) {
        return entity != null && !(entity instanceof Player);
    }

    /** The live direct team (not an owner's team inherited by tamed animals), or null. */
    public static PlayerTeam team(Entity entity) {
        Scoreboard scoreboard = entity.level().getScoreboard();
        return scoreboard == null ? null : scoreboard.getPlayersTeam(entity.getScoreboardName());
    }

    /** {@code nbt} (a fresh save of {@code entity}) with the live team as {@code Team}. */
    public static CompoundTag withTeam(CompoundTag nbt, Entity entity) {
        if (!applies(entity)) return nbt;
        var team = team(entity);
        if (team == null) nbt.remove(KEY);
        else nbt.putString(KEY, team.getName());
        return nbt;
    }

    /** Removes {@code Team} from {@code nbt}; returns it, "" for no team. */
    public static String take(CompoundTag nbt) {
        var value = nbt.get(KEY);
        nbt.remove(KEY);
        if (value == null) return "";
        if (value instanceof StringTag(String name)) return name;
        EditorSessions.fail("invalid_nbt", EditorI18n.tr("cadeditor.message.entityteams.team_must_be_name"));
        return "";
    }

    public static void put(CompoundTag nbt, String team) {
        if (team != null && !team.isEmpty()) nbt.putString(KEY, team);
    }

    /** The colour of an editor glow team name, empty for any other name. */
    public static Optional<TeamColor> glowColor(String team) {
        if (team == null || !team.startsWith(GLOW_PREFIX)) return Optional.empty();
        String id = team.substring(GLOW_PREFIX.length());
        return TeamColor.VALUES.stream()
                .filter(color -> color.getSerializedName().equals(id))
                .findFirst();
    }

    /**
     * Before any write: no team, an editor glow team, the live team, or one of {@code trusted} (teams in data the
     * server itself kept: the opened baseline and the undo preimage, so undo can return to a team the user left).
     */
    public static void validate(Entity entity, String next, String... trusted) {
        if (next == null
                || !applies(entity)
                || next.isEmpty()
                || glowColor(next).isPresent()) return;
        var live = team(entity);
        if (live != null && live.getName().equals(next)) return;
        for (String name : trusted) if (next.equals(name)) return;
        EditorSessions.fail("protected_field", EditorI18n.tr("cadeditor.message.entityteams.only_glow_teams", next));
    }

    /**
     * Puts the written entity into {@code next} ("" = no team; null = not an entity plan) and returns how to put the
     * previous membership back if the rest of the write fails. Glow teams it creates are kept: an empty glow team is
     * harmless and the next edit with that colour reuses it.
     */
    public static Runnable apply(Entity entity, String next) {
        if (next == null || !applies(entity)) return () -> {};
        Scoreboard scoreboard = entity.level().getScoreboard();
        if (scoreboard == null) {
            if (!next.isEmpty())
                EditorSessions.fail("unsupported", EditorI18n.tr("cadeditor.message.entityteams.no_scoreboard"));
            return () -> {};
        }
        String holder = entity.getScoreboardName();
        PlayerTeam previous = scoreboard.getPlayersTeam(holder);
        if ((previous == null ? "" : previous.getName()).equals(next)) return () -> {};
        Runnable restore = () -> {
            PlayerTeam now = scoreboard.getPlayersTeam(holder);
            if (now == previous) return;
            if (previous == null) scoreboard.removePlayerFromTeam(holder, now);
            else if (scoreboard.getPlayerTeam(previous.getName()) == previous)
                scoreboard.addPlayerToTeam(holder, previous);
            else if (now != null) scoreboard.removePlayerFromTeam(holder, now);
        };
        if (next.isEmpty()) {
            scoreboard.removePlayerFromTeam(holder, previous);
            return restore;
        }
        PlayerTeam target = scoreboard.getPlayerTeam(next);
        if (target == null && glowColor(next).isEmpty())
            // A trusted team (undo) that was removed meanwhile: only glow teams are ever created.
            EditorSessions.fail("target_changed", EditorI18n.tr("cadeditor.message.entityteams.team_missing", next));
        if (target == null) target = createGlowTeam(scoreboard, next);
        scoreboard.addPlayerToTeam(holder, target);
        // Paper's scoreboards.allow-non-player-entities-on-scoreboards=false hides the membership from getTeam(),
        // so the outline would stay white while the edit reports success.
        if (entity.getTeam() != target) {
            restore.run();
            EditorSessions.fail("unsupported", EditorI18n.tr("cadeditor.message.entityteams.team_not_effective"));
        }
        return restore;
    }

    private static PlayerTeam createGlowTeam(Scoreboard scoreboard, String name) {
        TeamColor color = glowColor(name)
                .orElseThrow(() -> new IllegalStateException("Only editor glow teams are created: " + name));
        PlayerTeam team = scoreboard.addPlayerTeam(name);
        team.setColor(Optional.of(color));
        team.setDisplayName(Component.literal("CAD Editor glow: " + color.getSerializedName()));
        return team;
    }
}
