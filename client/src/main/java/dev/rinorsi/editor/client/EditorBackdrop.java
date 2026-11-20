package dev.rinorsi.editor.client;

import com.google.gson.JsonElement;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/**
 * What editor screens draw behind the page in a world (Settings → Interface → Custom theme).
 *
 * <p>Vanilla darkens the world under every in-game screen with a fixed 75–82% gradient, so the page's "outside the
 * UI" setting could only darken it further. Editor screens leave that gradient out: the page darkens the world
 * itself ({@code .o-app}, {@code backdropDim}), and 0% shows it as it is.
 *
 * <p>Translucent panels with a material other than Clear get vanilla's menu blur over the world, the post effect
 * vanilla's own screens use, with the theme's radius for this frame only (the player's option is not touched). The
 * page uses no CSS {@code backdrop-filter}: Oriel 0.15 draws each backdrop as several window-sized offscreen
 * passes every frame and frees and recreates those targets every frame, which lost the Vulkan device
 * ({@code VK_ERROR_DEVICE_LOST}, the driver reset) while materials were being switched.
 */
final class EditorBackdrop {
    private EditorBackdrop() {}

    /** Vanilla's blur radius scale (device px); its own option goes to 10. */
    static final int MAX_BLUR = 20;

    static final int DEFAULT_BLUR = 5;

    /**
     * The blur radius for the theme, 0 for none: only translucent panels (opacity below 100%) with a material other
     * than Clear are blurred. Missing or invalid values are the page's defaults (opaque, Frosted, 5).
     */
    static int blurRadius(JsonElement opacity, JsonElement material, JsonElement blur) {
        if (integer(opacity, 100) >= 100) return 0;
        String kind = material != null
                        && material.isJsonPrimitive()
                        && material.getAsJsonPrimitive().isString()
                ? material.getAsString()
                : "frosted";
        if (kind.equals("clear")) return 0;
        return Math.clamp(integer(blur, DEFAULT_BLUR), 0, MAX_BLUR);
    }

    private static int integer(JsonElement value, int fallback) {
        if (value == null
                || !value.isJsonPrimitive()
                || !value.getAsJsonPrimitive().isNumber()) return fallback;
        double number = value.getAsDouble();
        return Double.isFinite(number) ? (int) Math.round(number) : fallback;
    }

    /**
     * {@code Screen.extractBackground} for editor screens. Returns false outside a world (the title screen draws its
     * panorama and menu background there; the caller keeps vanilla's).
     */
    static boolean extract(GuiGraphicsExtractor g) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) return false;
        int radius = blurRadius(
                EditorPrefs.peek("pageOpacity"), EditorPrefs.peek("themeMaterial"), EditorPrefs.peek("themeBlur"));
        if (radius > 0) {
            try {
                g.blurBeforeThisStratum();
                // Options are extracted before the GUI each frame and fill the blur's uniform when the frame renders.
                mc.gameRenderer.gameRenderState().optionsRenderState.menuBackgroundBlurriness = radius;
            } catch (IllegalStateException alreadyBlurred) {
                // Vanilla allows one blur a frame; something before the screen took it, keep that one.
            }
        }
        mc.gui.hud.extractDeferredSubtitles();
        return true;
    }
}
