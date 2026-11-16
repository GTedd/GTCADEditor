package dev.rinorsi.editor;

import java.util.Locale;

/**
 * The editor's server-side capabilities as permission nodes, decided from the player's operator level, game mode,
 * cadeditor.json and an installed permission plugin. {@link #USE} gates all others.
 */
public enum EditorPermission {
    /** Any server-side editor feature (opening own items included). */
    USE("cadeditor.use", Default.EVERYONE),
    /** Server-side writes of own inventory and open-container slots in any game mode, without the creative round trip. */
    ITEM_EDIT("cadeditor.item.edit", Default.ADMIN),
    /** Creative-mode item writes of players without ITEM_EDIT (the vanilla creative capability, two-phase commit). */
    ITEM_CREATIVE("cadeditor.item.creative", Default.CREATIVE_ITEMS),
    /** Exempt from cadeditor.json itemRules: banned items, restricted components, command click events. */
    ITEM_BYPASS("cadeditor.item.bypass", Default.ADMIN),
    /** Reading block entity and entity data in reach (opening the world editor). */
    WORLD_READ("cadeditor.world.read", Default.CREATIVE_WORLD),
    /** Writing and undoing block entity and entity data, riding and block templates. */
    WORLD_EDIT("cadeditor.world.edit", Default.CREATIVE_WORLD),
    /** Reading and editing online players' data, one's own included. */
    PLAYER_EDIT("cadeditor.player.edit", Default.ADMIN),
    /** The player list, offline player files (read, edit, export). */
    PLAYER_OFFLINE("cadeditor.player.offline", Default.ADMIN),
    /** Server-side vault give into a survival/adventure inventory (creative uses the vanilla creative packet). */
    VAULT_GIVE("cadeditor.vault.give", Default.ADMIN),
    /** /cadeditor testkit: fills the own inventory with specimen items. */
    TESTKIT("cadeditor.testkit", Default.CREATIVE_ITEMS),
    /** Viewing one's own history records. */
    HISTORY_OWN("cadeditor.history.own", Default.EVERYONE),
    /** Viewing everybody's history records. */
    HISTORY_VIEW("cadeditor.history.view", Default.ADMIN),
    /** Adding manual records and changing a record's note and tags (the recorded facts never change). */
    HISTORY_EDIT("cadeditor.history.edit", Default.ADMIN),
    /** Deleting and purging records; every deletion is itself recorded. */
    HISTORY_DELETE("cadeditor.history.delete", Default.OWNER);

    /** How the editor decides a node that no permission plugin set. */
    public enum Default {
        EVERYONE,
        /** Operator level >= cadeditor.json permissionLevel (default 2, gamemaster). */
        ADMIN,
        /** Operator level 4 (server owner). Console and RCON always qualify. */
        OWNER,
        /** ADMIN, or a creative-mode player when creativeItemEdit is true (default). */
        CREATIVE_ITEMS,
        /** ADMIN, or a creative-mode player when creativeWorldEdit is true (default false). */
        CREATIVE_WORLD
    }

    public final String node;
    public final Default fallback;

    EditorPermission(String node, Default fallback) {
        this.node = node;
        this.fallback = fallback;
    }

    public static EditorPermission byNode(String node) {
        for (var permission : values()) if (permission.node.equals(node)) return permission;
        throw new IllegalArgumentException("Unknown permission node: " + node);
    }

    /** The short protocol name used in capability replies ("world.edit"). */
    public String key() {
        return node.substring("cadeditor.".length()).toLowerCase(Locale.ROOT);
    }
}
