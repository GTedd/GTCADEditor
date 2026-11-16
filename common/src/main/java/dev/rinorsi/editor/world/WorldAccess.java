package dev.rinorsi.editor.world;

import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorSessions;

/** Shared denial vocabulary. Inputs are server-computed, never supplied by the page. */
public final class WorldAccess {
    private WorldAccess() {}
    /** Same loaded-chunk query as LevelReader.hasChunkAt, without requesting or generating chunks. */
    public static boolean isLoaded(net.minecraft.world.level.Level level, net.minecraft.core.BlockPos pos) {
        return level.getChunkSource()
                .hasChunk(
                        net.minecraft.core.SectionPos.blockToSectionCoord(pos.getX()),
                        net.minecraft.core.SectionPos.blockToSectionCoord(pos.getZ()));
    }

    public static void loaded(boolean loaded) {
        if (!loaded)
            EditorSessions.fail(
                    "chunk_unloaded", EditorI18n.tr("cadeditor.message.worldaccess.target_block_loaded_blocks_loaded"));
    }

    public static void reach(boolean reachable) {
        if (!reachable)
            EditorSessions.fail(
                    "out_of_reach", EditorI18n.tr("cadeditor.message.worldaccess.target_exceeded_player_current"));
    }

    public static void area(boolean allowed) {
        if (!allowed)
            EditorSessions.fail(
                    "protected_area",
                    EditorI18n.tr("cadeditor.message.worldaccess.vanilla_minecraft_protected_area_world"));
    }

    public static void nonPlayer(boolean playerTarget) {
        if (playerTarget)
            EditorSessions.fail(
                    "player_target", EditorI18n.tr("cadeditor.message.worldaccess.ban_modifying_player_through_world"));
    }
}
