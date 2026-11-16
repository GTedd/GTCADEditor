package dev.rinorsi.editor.registry;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.serialization.JsonOps;
import java.util.Random;
import net.minecraft.SharedConstants;
import net.minecraft.network.chat.ComponentSerialization;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.item.component.ItemLore;

/** Picture to lore: parameters, glyph grid, colors, limits, and the game's own lore codec on the output. */
public final class ImageArtTest {
    private static int checks;

    private static void check(boolean ok, String name) {
        if (!ok) throw new AssertionError(name);
        checks++;
    }

    public static void main(String[] args) {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        params();
        mono();
        color();
        limits();
        octant();
        signatures();
        System.out.println("PASS ImageArtTest: " + checks
                + " checks (params, half-block grid, octant grid, colors, limits, codecs)");
    }

    private static JsonObject json(String text) {
        return JsonParser.parseString(text).getAsJsonObject();
    }

    private static boolean rejects(String text) {
        try {
            ImageArt.Params.parse(json(text));
            return false;
        } catch (IllegalArgumentException expected) {
            return true;
        }
    }

    private static void params() {
        var p = ImageArt.Params.parse(null);
        check(p.width() == 48 && p.color() && p.dither() && p.levels() == 32, "defaults");
        var mono = ImageArt.Params.parse(
                json("{\"width\":4,\"mode\":\"mono\",\"threshold\":30,\"invert\":true,\"foreground\":\"#ff5555\"}"));
        check(!mono.color() && mono.width() == 4 && mono.invert() && mono.foreground() == 0xFF5555, "mono parse");
        check(rejects("{\"width\":3}"), "width below 4");
        check(rejects("{\"width\":129}"), "width above 128");
        check(rejects("{\"width\":4.5}"), "fractional width");
        check(rejects("{\"mode\":\"sepia\"}"), "unknown mode");
        check(rejects("{\"background\":\"red\"}"), "named background");
        check(rejects("{\"levels\":1}"), "one level");
        check(rejects("{\"threshold\":100}"), "threshold above 99");
        check(rejects("{\"tolerance\":-1}"), "negative tolerance");
        check(rejects("{\"dither\":\"yes\"}"), "string flag");
        check(rejects("{\"url\":\"http://example\"}"), "unknown key");
        check(ImageArt.rowsFor(100, 50, 48) == 24 && ImageArt.linesFor(24) == 12, "aspect rows");
        check(ImageArt.rowsFor(1000, 1, 4) == 1 && ImageArt.linesFor(1) == 1, "at least one row");
        check(ImageArt.quantize(130f, 2) == 255 && ImageArt.quantize(120f, 2) == 0, "two levels");
        check(ImageArt.quantize(77.4f, 256) == 77, "full levels keep the value");
        check(
                ImageArt.colorName(0xFFAA00).equals("gold")
                        && ImageArt.colorName(0x123456).equals("#123456"),
                "names");
    }

    private static int[] fill(int width, int height, java.util.function.IntBinaryOperator pixel) {
        int[] out = new int[width * height];
        for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) out[y * width + x] = pixel.applyAsInt(x, y);
        return out;
    }

    private static String text(JsonElement line) {
        if (line.isJsonPrimitive()) return line.getAsString();
        var o = line.getAsJsonObject();
        StringBuilder out = new StringBuilder(o.get("text").getAsString());
        if (o.has("extra"))
            for (var child : o.getAsJsonArray("extra"))
                out.append(
                        child.isJsonPrimitive()
                                ? child.getAsString()
                                : child.getAsJsonObject().get("text").getAsString());
        return out.toString();
    }

    private static void mono() {
        // 4 wide, 4 tall: rows 0-1 white, row 2 white on the left half only, row 3 transparent.
        int[] px = fill(4, 4, (x, y) -> y < 2 || (y == 2 && x < 2) ? 0xFFFFFFFF : y == 3 ? 0 : 0xFF000000);
        var params = ImageArt.Params.parse(json("{\"width\":4,\"mode\":\"mono\",\"dither\":false}"));
        var result = ImageArt.render(px, 4, 4, params);
        check(result.lineCount() == 2 && result.rows() == 4, "mono line count");
        check(text(result.lines().get(0)).equals("████"), "full blocks for two lit rows");
        check(text(result.lines().get(1)).equals("▀▀"), "upper halves, trailing blanks trimmed");
        var first = result.lines().get(0).getAsJsonObject();
        check(first.get("font").getAsString().equals("minecraft:uniform"), "uniform font");
        check(
                !first.get("italic").getAsBoolean()
                        && first.get("color").getAsString().equals("white"),
                "upright");
        var inverted = ImageArt.render(
                px,
                4,
                4,
                ImageArt.Params.parse(json("{\"width\":4,\"mode\":\"mono\",\"dither\":false,\"invert\":true}")));
        check(text(inverted.lines().get(0)).isEmpty(), "inverted white is blank");
        check(text(inverted.lines().get(1)).equals("  ▀▀"), "inverted keeps leading blanks");
        // Dithering a 50% gray on a threshold of 50 lights about half of the cells, never all or none.
        int[] gray = fill(32, 32, (x, y) -> 0xFF808080);
        var dithered = ImageArt.render(
                gray, 32, 32, ImageArt.Params.parse(json("{\"width\":32,\"mode\":\"mono\",\"dither\":true}")));
        int lit = 0, total = 0;
        for (var line : dithered.lines())
            for (char c : text(line).toCharArray()) {
                lit += c == '█' ? 2 : c == '▀' || c == '▄' ? 1 : 0;
            }
        total = 32 * 32;
        check(lit > total / 4 && lit < total * 3 / 4, "error diffusion mixes gray: " + lit + "/" + total);
        validLore(result.lines());
        validLore(dithered.lines());
    }

    private static void color() {
        // 4x4: column 0 is red over transparent, column 1 is blue over blue, the rest is transparent.
        int[] px = fill(4, 4, (x, y) -> x == 0 ? (y % 2 == 0 ? 0xFFFF5555 : 0x00000000) : x == 1 ? 0xFF0000AA : 0);
        var params = ImageArt.Params.parse(json("{\"width\":4,\"levels\":256,\"dither\":false,\"tolerance\":0}"));
        var result = ImageArt.render(px, 4, 4, params);
        check(result.lineCount() == 2, "color lines");
        var line = result.lines().get(0).getAsJsonObject();
        check(text(line).equals("▀█"), "half block over transparency, full block for equal colors");
        var extra = line.getAsJsonArray("extra");
        check(extra.size() == 2, "two runs");
        String all = line.toString();
        check(all.contains("\"red\"") && all.contains("\"dark_blue\""), "legacy names for exact vanilla colors");
        // Background-colored pixels are not drawn.
        int[] onBg = fill(4, 4, (x, y) -> x == 0 ? 0xFF100010 : x == 1 ? 0xFFFFFFFF : 0);
        var bg = ImageArt.render(onBg, 4, 4, ImageArt.Params.parse(json("{\"width\":4,\"dither\":false}")));
        check(text(bg.lines().get(0)).equals(" █"), "background pixel stays blank");
        // Blank cells join the neighbouring run; the line's most used color moves to the root.
        int[] stripes = fill(6, 2, (x, y) -> x % 2 == 0 ? 0xFFFFFF55 : 0);
        var merged = ImageArt.render(
                stripes, 6, 2, ImageArt.Params.parse(json("{\"width\":6,\"levels\":256,\"dither\":false}")));
        var root = merged.lines().get(0).getAsJsonObject();
        check(root.get("color").getAsString().equals("yellow") && merged.runs() == 1, "one run with blanks inside");
        check(text(root).equals("█ █ █"), "inner blanks kept, trailing trimmed");
        for (var l : result.lines())
            for (char c : text(l).toCharArray())
                check(c == '▀' || c == '▄' || c == '█' || c == ' ', "only fixed-advance glyphs");
        validLore(result.lines());
        validLore(merged.lines());
        check(result.jsonChars() == result.lines().toString().length(), "measured size is the compact lore JSON");
    }

    private static void limits() {
        var tall = ImageArt.render(
                fill(1, 1000, (x, y) -> 0xFFFFFFFF), 1, 1000, ImageArt.Params.parse(json("{\"width\":4}")));
        check(tall.tooManyLines() && tall.lineCount() == 2000 && tall.lines().isEmpty(), "over 256 lines is refused");
        var random = new Random(7);
        int[] noise = fill(128, 512, (x, y) -> 0xFF000000 | random.nextInt(0x1000000));
        var big = ImageArt.render(
                noise, 128, 512, ImageArt.Params.parse(json("{\"width\":128,\"levels\":256,\"dither\":false}")));
        check(big.lineCount() == 256 && !big.tooManyLines(), "exactly 256 lines");
        check(big.tooLarge() && big.jsonChars() > ImageArt.MAX_JSON_CHARS, "noise exceeds the JSON budget");
        check(big.jsonChars() == big.lines().toString().length(), "large size measured exactly");
        var small = ImageArt.render(
                noise, 128, 512, ImageArt.Params.parse(json("{\"width\":32,\"levels\":4,\"dither\":true}")));
        check(!small.tooLarge() && small.lineCount() == 64, "fewer columns and colors fit");
        validLore(small.lines());
    }

    /** Pattern of an octant code point (reverse of OCTANT_CP), or -1. */
    private static int patternOf(int cp) {
        for (int p = 0; p < 256; p++) if (ImageArt.OCTANT_CP[p] == cp) return p;
        return -1;
    }

    private static void octant() {
        // The table: every 2x4 pattern has its own glyph; 30 light one column only.
        var seen = new java.util.HashSet<Integer>();
        int oneSided = 0;
        for (int p = 0; p < 256; p++) {
            seen.add(ImageArt.OCTANT_CP[p]);
            if (ImageArt.oneSided(p)) oneSided++;
        }
        check(seen.size() == 256 && ImageArt.OCTANT_CP[0] == 0x2002, "256 distinct octant glyphs, blank is en space");
        check(oneSided == 30, "30 one-sided patterns: " + oneSided);
        check(ImageArt.OCTANT_CP[255] == 0x2588 && ImageArt.OCTANT_CP[0b1111] == 0x2580, "full and upper half");
        // Widening: a left-column pattern gains the closest pixel of the right column.
        float[] close = {1.2f, 0.1f, 1.2f, 0.9f, 0f, 0.3f, 0f, 0.2f};
        int widened = ImageArt.widen(0b00000101, close);
        check(widened == 0b00001101 && !ImageArt.oneSided(widened), "widen picks the right pixel closest to lit");
        float[] cut = {1.2f, -1f, -1f, -1f, -1f, -1f, -1f, -1f};
        check(ImageArt.widen(0b1, cut) == 0b11, "only rows past the picture: neighbour of the lit cell");

        // Params and line math.
        check(ImageArt.Params.parse(json("{\"cells\":\"octant\"}")).octant(), "cells octant");
        check(
                !ImageArt.Params.parse(json("{\"cells\":\"half\"}")).octant() && !ImageArt.Params.DEFAULT.octant(),
                "half is the default");
        check(rejects("{\"cells\":\"sextant\"}") && rejects("{\"cells\":2}"), "unknown cells");
        check(ImageArt.octantRowsFor(100, 50, 48) == 48 && ImageArt.octantLinesFor(48) == 12, "octant aspect rows");
        check(ImageArt.octantLinesFor(1) == 1 && ImageArt.octantLinesFor(5) == 2, "partial last line");

        // Mono: 1-pixel vertical stripes would be one-sided everywhere; every output glyph must keep the full advance.
        int[] stripes = fill(16, 16, (x, y) -> (x & 1) == 0 ? 0xFFFFFFFF : 0xFF000000);
        var mono = ImageArt.render(
                stripes,
                16,
                16,
                ImageArt.Params.parse(json("{\"width\":8,\"mode\":\"mono\",\"dither\":false,\"cells\":\"octant\"}")));
        check(mono.lineCount() == 4 && mono.rows() == 16 && mono.columns() == 8, "octant mono size");
        int glyphs = 0;
        for (var line : mono.lines()) {
            String text = text(line);
            for (int i = 0; i < text.length(); ) {
                int cp = text.codePointAt(i);
                i += Character.charCount(cp);
                int p = patternOf(cp);
                check(p >= 0 && !ImageArt.oneSided(p), "only full-advance octant glyphs: U+" + Integer.toHexString(cp));
                glyphs++;
            }
        }
        check(glyphs > 0, "stripes produce glyphs");
        var first = mono.lines().get(0).getAsJsonObject();
        check(first.get("font").getAsString().equals("minecraft:uniform"), "octant uses the uniform font");

        // Solid block: full cells; a 2x4 image is one full block character.
        var solid = ImageArt.render(
                fill(2, 4, (x, y) -> 0xFFFF5555),
                2,
                4,
                ImageArt.Params.parse(json("{\"width\":4,\"levels\":256,\"dither\":false,\"cells\":\"octant\"}")));
        check(text(solid.lines().get(0)).equals("████"), "solid picture is full blocks");
        check(solid.lines().get(0).getAsJsonObject().get("color").getAsString().equals("red"), "cell color");

        // Color noise: valid lore for the game's codecs, size measured exactly, four times the pixels of half mode.
        var random = new Random(11);
        int[] noise = fill(64, 64, (x, y) -> 0xFF000000 | random.nextInt(0x1000000));
        var params = ImageArt.Params.parse(json("{\"width\":32,\"levels\":4,\"dither\":true,\"cells\":\"octant\"}"));
        var color = ImageArt.render(noise, 64, 64, params);
        check(color.lineCount() == 16 && color.rows() == 64, "octant color size");
        check(color.jsonChars() == color.lines().toString().length(), "octant size measured exactly");
        validLore(color.lines());
        var half = ImageArt.render(
                noise, 64, 64, ImageArt.Params.parse(json("{\"width\":32,\"levels\":4,\"dither\":true}")));
        check(half.lineCount() == 16 && half.rows() == 32, "same lines, half the rows in half mode");
        var tall = ImageArt.render(
                fill(1, 1000, (x, y) -> 0xFFFFFFFF),
                1,
                1000,
                ImageArt.Params.parse(json("{\"width\":4,\"cells\":\"octant\"}")));
        check(tall.tooManyLines() && tall.lines().isEmpty(), "octant over 256 lines is refused");
    }

    private static void signatures() {
        check(ImageArtChannel.png(new byte[] {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 0}), "PNG signature");
        check(ImageArtChannel.jpeg(new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0}), "JPEG signature");
        check(!ImageArtChannel.png("GIF89a".getBytes()) && !ImageArtChannel.jpeg("BM".getBytes()), "other formats");
    }

    private static void validLore(JsonArray lines) {
        for (var line : lines)
            check(ComponentSerialization.CODEC.parse(JsonOps.INSTANCE, line).isSuccess(), "component codec: " + line);
        check(ItemLore.CODEC.parse(JsonOps.INSTANCE, lines).isSuccess(), "lore codec");
    }
}
