package dev.rinorsi.editor.registry;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import java.util.HashMap;
import java.util.Map;

/**
 * Picture to lore lines. Pure: ARGB pixels in, text components out; no game, file or thread access.
 *
 * <p>Half mode: each character is one column and two rows of square pixels, drawn with the half blocks U+2580 / U+2584, the
 * full block U+2588 and the en space U+2002 in {@code minecraft:uniform}. In the 26.3 unifont (17.0.01) all four
 * are 8 columns wide, so every cell advances the same 5 GUI pixels. Glyphs that light only one column (quadrants,
 * sextants, octants) are trimmed by the unihex provider to a narrower advance and would break the grid.
 *
 * <p>Octant mode: each character is two columns and four rows ({@link #OCTANT_CP}, one exact unifont glyph per 2x4
 * pattern). 226 of the 256 patterns light both columns (or none) and keep the full 8-column advance; the 30 that light
 * one column only would be trimmed, so the generator lights the closest pixel of the empty column instead. A cell
 * still has one color.
 */
public final class ImageArt {
    public static final int MIN_WIDTH = 4, MAX_WIDTH = 128, DEFAULT_WIDTH = 48;
    /** ItemLore.MAX_LINES in 26.3. */
    public static final int MAX_LINES = 256;

    public static final int MAX_ROWS = MAX_LINES * 2;
    /** Generated lore JSON budget: half of the editor's item NBT cap (EditorWire.MAX_NBT_CHARS). */
    public static final int MAX_JSON_CHARS = 512 * 1024;
    /** Decoded sources are reduced to this long side before they are kept. */
    public static final int WORK_SIDE = 1024;

    public static final String FONT = "minecraft:uniform";
    static final char UPPER = '▀', LOWER = '▄', FULL = '█', BLANK = ' ';
    /** Cell codes keep a glyph index in the top byte and the RGB below; 0 is a blank cell. */
    private static final int G_UPPER = 1, G_LOWER = 2, G_FULL = 3;

    /** Half mode code points by glyph index (blank, upper, lower, full). */
    private static final int[] HALF_CP = {BLANK, UPPER, LOWER, FULL};

    /**
     * Octant mode: the unifont 17.0.01 glyph whose 8x16 bitmap is exactly each 2x4 pattern. Bit k is cell k+1 in reading
     * order (1 2 / 3 4 / 5 6 / 7 8), so bits 0, 2, 4, 6 are the left column. Index 0 is the en space (blank, full
     * advance). Derived by scanning the game's unifont hex for glyphs made of whole 4x4 blocks; no private use area.
     */
    static final int[] OCTANT_CP = {
        0x2002, 0x1CEA8, 0x1CEAB, 0x1FB82, 0x1CD00, 0x2598, 0x1CD01, 0x1CD02,
        0x1CD03, 0x1CD04, 0x259D, 0x1CD05, 0x1CD06, 0x1CD07, 0x1CD08, 0x2580,
        0x1CD09, 0x1CD0A, 0x1CD0B, 0x1CD0C, 0x1FBE6, 0x1CD0D, 0x1CD0E, 0x1CD0F,
        0x1CD10, 0x1CD11, 0x1CD12, 0x1CD13, 0x1CD14, 0x1CD15, 0x1CD16, 0x1CD17,
        0x1CD18, 0x1CD19, 0x1CD1A, 0x1CD1B, 0x1CD1C, 0x1CD1D, 0x1CD1E, 0x1CD1F,
        0x1FBE7, 0x1CD20, 0x1CD21, 0x1CD22, 0x1CD23, 0x1CD24, 0x1CD25, 0x1CD26,
        0x1CD27, 0x1CD28, 0x1CD29, 0x1CD2A, 0x1CD2B, 0x1CD2C, 0x1CD2D, 0x1CD2E,
        0x1CD2F, 0x1CD30, 0x1CD31, 0x1CD32, 0x1CD33, 0x1CD34, 0x1CD35, 0x1FB85,
        0x1CEA3, 0x1CD36, 0x1CD37, 0x1CD38, 0x1CD39, 0x1CD3A, 0x1CD3B, 0x1CD3C,
        0x1CD3D, 0x1CD3E, 0x1CD3F, 0x1CD40, 0x1CD41, 0x1CD42, 0x1CD43, 0x1CD44,
        0x2596, 0x1CD45, 0x1CD46, 0x1CD47, 0x1CD48, 0x258C, 0x1CD49, 0x1CD4A,
        0x1CD4B, 0x1CD4C, 0x259E, 0x1CD4D, 0x1CD4E, 0x1CD4F, 0x1CD50, 0x259B,
        0x1CD51, 0x1CD52, 0x1CD53, 0x1CD54, 0x1CD55, 0x1CD56, 0x1CD57, 0x1CD58,
        0x1CD59, 0x1CD5A, 0x1CD5B, 0x1CD5C, 0x1CD5D, 0x1CD5E, 0x1CD5F, 0x1CD60,
        0x1CD61, 0x1CD62, 0x1CD63, 0x1CD64, 0x1CD65, 0x1CD66, 0x1CD67, 0x1CD68,
        0x1CD69, 0x1CD6A, 0x1CD6B, 0x1CD6C, 0x1CD6D, 0x1CD6E, 0x1CD6F, 0x1CD70,
        0x1CEA0, 0x1CD71, 0x1CD72, 0x1CD73, 0x1CD74, 0x1CD75, 0x1CD76, 0x1CD77,
        0x1CD78, 0x1CD79, 0x1CD7A, 0x1CD7B, 0x1CD7C, 0x1CD7D, 0x1CD7E, 0x1CD7F,
        0x1CD80, 0x1CD81, 0x1CD82, 0x1CD83, 0x1CD84, 0x1CD85, 0x1CD86, 0x1CD87,
        0x1CD88, 0x1CD89, 0x1CD8A, 0x1CD8B, 0x1CD8C, 0x1CD8D, 0x1CD8E, 0x1CD8F,
        0x2597, 0x1CD90, 0x1CD91, 0x1CD92, 0x1CD93, 0x259A, 0x1CD94, 0x1CD95,
        0x1CD96, 0x1CD97, 0x2590, 0x1CD98, 0x1CD99, 0x1CD9A, 0x1CD9B, 0x259C,
        0x1CD9C, 0x1CD9D, 0x1CD9E, 0x1CD9F, 0x1CDA0, 0x1CDA1, 0x1CDA2, 0x1CDA3,
        0x1CDA4, 0x1CDA5, 0x1CDA6, 0x1CDA7, 0x1CDA8, 0x1CDA9, 0x1CDAA, 0x1CDAB,
        0x2582, 0x1CDAC, 0x1CDAD, 0x1CDAE, 0x1CDAF, 0x1CDB0, 0x1CDB1, 0x1CDB2,
        0x1CDB3, 0x1CDB4, 0x1CDB5, 0x1CDB6, 0x1CDB7, 0x1CDB8, 0x1CDB9, 0x1CDBA,
        0x1CDBB, 0x1CDBC, 0x1CDBD, 0x1CDBE, 0x1CDBF, 0x1CDC0, 0x1CDC1, 0x1CDC2,
        0x1CDC3, 0x1CDC4, 0x1CDC5, 0x1CDC6, 0x1CDC7, 0x1CDC8, 0x1CDC9, 0x1CDCA,
        0x1CDCB, 0x1CDCC, 0x1CDCD, 0x1CDCE, 0x1CDCF, 0x1CDD0, 0x1CDD1, 0x1CDD2,
        0x1CDD3, 0x1CDD4, 0x1CDD5, 0x1CDD6, 0x1CDD7, 0x1CDD8, 0x1CDD9, 0x1CDDA,
        0x2584, 0x1CDDB, 0x1CDDC, 0x1CDDD, 0x1CDDE, 0x2599, 0x1CDDF, 0x1CDE0,
        0x1CDE1, 0x1CDE2, 0x259F, 0x1CDE3, 0x2586, 0x1CDE4, 0x1CDE5, 0x2588
    };
    /** Octant bits of the left and right column. */
    static final int LEFT_CELLS = 0b01010101, RIGHT_CELLS = 0b10101010;

    /** True when unifont would trim the glyph: one column lit and the other empty. */
    static boolean oneSided(int pattern) {
        return pattern != 0 && ((pattern & LEFT_CELLS) == 0) != ((pattern & RIGHT_CELLS) == 0);
    }

    private static final int[] LEGACY_RGB = {
        0x000000, 0x0000AA, 0x00AA00, 0x00AAAA, 0xAA0000, 0xAA00AA, 0xFFAA00, 0xAAAAAA,
        0x555555, 0x5555FF, 0x55FF55, 0x55FFFF, 0xFF5555, 0xFF55FF, 0xFFFF55, 0xFFFFFF
    };
    private static final String[] LEGACY_NAMES = {
        "black", "dark_blue", "dark_green", "dark_aqua", "dark_red", "dark_purple", "gold", "gray",
        "dark_gray", "blue", "green", "aqua", "red", "light_purple", "yellow", "white"
    };

    private ImageArt() {}

    /** Generation settings; {@link #parse} is the only way page input becomes one. */
    public record Params(
            int width,
            boolean color,
            boolean dither,
            int background,
            int tolerance,
            int levels,
            int threshold,
            boolean invert,
            int foreground,
            boolean octant) {
        public static final Params DEFAULT =
                new Params(DEFAULT_WIDTH, true, true, 0x100010, 8, 32, 50, false, 0xFFFFFF, false);

        public Params {
            if (width < MIN_WIDTH || width > MAX_WIDTH) throw new IllegalArgumentException("width");
            if (tolerance < 0 || tolerance > 100) throw new IllegalArgumentException("tolerance");
            if (levels < 2 || levels > 256) throw new IllegalArgumentException("levels");
            if (threshold < 1 || threshold > 99) throw new IllegalArgumentException("threshold");
            background &= 0xFFFFFF;
            foreground &= 0xFFFFFF;
        }

        /** Missing keys keep their defaults; a present key of the wrong type or range is rejected (field name). */
        public static Params parse(JsonObject json) {
            if (json == null) return DEFAULT;
            for (String key : json.keySet())
                switch (key) {
                    case "width",
                            "mode",
                            "dither",
                            "background",
                            "tolerance",
                            "levels",
                            "threshold",
                            "invert",
                            "foreground",
                            "cells" -> {}
                    default -> throw new IllegalArgumentException(key);
                }
            String mode = string(json, "mode", "color");
            if (!mode.equals("color") && !mode.equals("mono")) throw new IllegalArgumentException("mode");
            String cells = string(json, "cells", "half");
            if (!cells.equals("half") && !cells.equals("octant")) throw new IllegalArgumentException("cells");
            return new Params(
                    integer(json, "width", DEFAULT.width),
                    mode.equals("color"),
                    bool(json, "dither", DEFAULT.dither),
                    rgb(json, "background", DEFAULT.background),
                    integer(json, "tolerance", DEFAULT.tolerance),
                    integer(json, "levels", DEFAULT.levels),
                    integer(json, "threshold", DEFAULT.threshold),
                    bool(json, "invert", DEFAULT.invert),
                    rgb(json, "foreground", DEFAULT.foreground),
                    cells.equals("octant"));
        }

        private static String string(JsonObject json, String key, String fallback) {
            JsonElement value = json.get(key);
            if (value == null) return fallback;
            if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString())
                throw new IllegalArgumentException(key);
            return value.getAsString();
        }

        private static boolean bool(JsonObject json, String key, boolean fallback) {
            JsonElement value = json.get(key);
            if (value == null) return fallback;
            if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean())
                throw new IllegalArgumentException(key);
            return value.getAsBoolean();
        }

        private static int integer(JsonObject json, String key, int fallback) {
            JsonElement value = json.get(key);
            if (value == null) return fallback;
            if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber())
                throw new IllegalArgumentException(key);
            double number = value.getAsDouble();
            if (number != Math.rint(number) || Math.abs(number) > 1_000_000) throw new IllegalArgumentException(key);
            return (int) number;
        }

        private static int rgb(JsonObject json, String key, int fallback) {
            String text = string(json, key, null);
            if (text == null) return fallback;
            if (!text.matches("#[0-9A-Fa-f]{6}")) throw new IllegalArgumentException(key);
            return Integer.parseInt(text.substring(1), 16);
        }
    }

    /**
     * Generated lines (empty when over a limit) and the measured size. {@code jsonChars} counts the compact JSON of
     * the lore list the lines form.
     */
    public record Result(JsonArray lines, int lineCount, int columns, int rows, long jsonChars, int runs) {
        public boolean tooManyLines() {
            return lineCount > MAX_LINES;
        }

        public boolean tooLarge() {
            return jsonChars > MAX_JSON_CHARS;
        }
    }

    /** Pixel rows the picture needs at {@code width} columns, keeping its aspect ratio (at least one). */
    public static int rowsFor(int imageWidth, int imageHeight, int width) {
        if (imageWidth <= 0 || imageHeight <= 0) throw new IllegalArgumentException("size");
        return (int) Math.max(1, Math.round((double) width * imageHeight / imageWidth));
    }

    public static int linesFor(int rows) {
        return (rows + 1) / 2;
    }

    /** Area-average resize with premultiplied alpha; output is plain ARGB. */
    public static int[] resample(int[] argb, int width, int height, int targetWidth, int targetHeight) {
        if (argb.length != width * height || targetWidth <= 0 || targetHeight <= 0)
            throw new IllegalArgumentException("size");
        int[] out = new int[targetWidth * targetHeight];
        double sx = (double) width / targetWidth, sy = (double) height / targetHeight;
        for (int ty = 0; ty < targetHeight; ty++) {
            double y0 = ty * sy, y1 = y0 + sy;
            for (int tx = 0; tx < targetWidth; tx++) {
                double x0 = tx * sx, x1 = x0 + sx;
                double a = 0, r = 0, g = 0, b = 0, area = 0;
                for (int y = (int) y0; y < Math.min(height, (int) Math.ceil(y1)); y++) {
                    double wy = Math.min(y1, y + 1) - Math.max(y0, y);
                    if (wy <= 0) continue;
                    for (int x = (int) x0; x < Math.min(width, (int) Math.ceil(x1)); x++) {
                        double wx = Math.min(x1, x + 1) - Math.max(x0, x);
                        if (wx <= 0) continue;
                        double weight = wx * wy;
                        int p = argb[y * width + x];
                        double pa = ((p >>> 24) & 255) / 255.0;
                        a += pa * weight;
                        r += ((p >> 16) & 255) * pa * weight;
                        g += ((p >> 8) & 255) * pa * weight;
                        b += (p & 255) * pa * weight;
                        area += weight;
                    }
                }
                if (area <= 0 || a <= 0) continue;
                int oa = clamp(a / area * 255), or = clamp(r / a), og = clamp(g / a), ob = clamp(b / a);
                out[ty * targetWidth + tx] = (oa << 24) | (or << 16) | (og << 8) | ob;
            }
        }
        return out;
    }

    /** Lines for {@code params}; no lines are built when the picture needs more than {@link #MAX_LINES}. */
    public static Result render(int[] argb, int width, int height, Params params) {
        if (params.octant()) return renderOctant(argb, width, height, params);
        int rows = rowsFor(width, height, params.width());
        int lineCount = linesFor(rows);
        if (lineCount > MAX_LINES) return new Result(new JsonArray(), lineCount, params.width(), rows, 0, 0);
        int[] pixels = resample(argb, width, height, params.width(), rows);
        int[] cells =
                params.color() ? colorCells(pixels, params.width(), rows, params) : monoCells(pixels, params, rows);
        JsonArray lines = new JsonArray();
        int runs = 0;
        long chars = 2; // the list brackets
        for (int line = 0; line < lineCount; line++) {
            Built built = params.color()
                    ? colorLine(cells, line, params.width(), HALF_CP)
                    : monoLine(cells, line, params.width(), params.foreground(), HALF_CP);
            lines.add(built.json);
            runs += built.runs;
            chars += built.json.toString().length() + (line > 0 ? 1 : 0);
        }
        return new Result(lines, lineCount, params.width(), rows, chars, runs);
    }

    // ---- color ----

    /** Per-pixel result shared by both cell layouts: lit, its quantized color, and how close it is to lit (0..1.5). */
    record Pixels(boolean[] lit, int[] color, float[] close) {}

    private static Pixels colorPixels(int[] pixels, int width, int rows, Params params) {
        int count = width * rows;
        boolean[] lit = new boolean[count];
        float[] close = new float[count];
        float[] r = new float[count], g = new float[count], b = new float[count];
        int bg = params.background();
        double tolerance = params.tolerance() / 100.0 * 441.673; // max RGB distance
        for (int i = 0; i < count; i++) {
            int p = pixels[i];
            int a = (p >>> 24) & 255;
            if (a < 128) continue;
            double alpha = a / 255.0;
            r[i] = (float) (((p >> 16) & 255) * alpha + ((bg >> 16) & 255) * (1 - alpha));
            g[i] = (float) (((p >> 8) & 255) * alpha + ((bg >> 8) & 255) * (1 - alpha));
            b[i] = (float) ((p & 255) * alpha + (bg & 255) * (1 - alpha));
            double distance = Math.sqrt(distance2(r[i], g[i], b[i], bg));
            lit[i] = distance > tolerance;
            close[i] = (float) Math.min(1.5, distance / Math.max(tolerance, 1));
        }
        int levels = params.levels();
        int[] color = new int[count];
        for (int y = 0; y < rows; y++) {
            boolean reverse = params.dither() && (y & 1) == 1; // serpentine
            for (int k = 0; k < width; k++) {
                int x = reverse ? width - 1 - k : k, i = y * width + x;
                if (!lit[i]) continue;
                int qr = quantize(r[i], levels), qg = quantize(g[i], levels), qb = quantize(b[i], levels);
                color[i] = (qr << 16) | (qg << 8) | qb;
                if (!params.dither() || levels >= 256) continue;
                float er = r[i] - qr, eg = g[i] - qg, eb = b[i] - qb;
                int dir = reverse ? -1 : 1;
                spread(lit, r, g, b, width, rows, x + dir, y, er, eg, eb, 7 / 16f);
                spread(lit, r, g, b, width, rows, x - dir, y + 1, er, eg, eb, 3 / 16f);
                spread(lit, r, g, b, width, rows, x, y + 1, er, eg, eb, 5 / 16f);
                spread(lit, r, g, b, width, rows, x + dir, y + 1, er, eg, eb, 1 / 16f);
            }
        }
        return new Pixels(lit, color, close);
    }

    private static int[] colorCells(int[] pixels, int width, int rows, Params params) {
        Pixels px = colorPixels(pixels, width, rows, params);
        boolean[] lit = px.lit;
        int[] color = px.color;
        int bg = params.background(), levels = params.levels();
        int lines = linesFor(rows);
        int[] cells = new int[lines * width];
        for (int line = 0; line < lines; line++)
            for (int x = 0; x < width; x++) {
                int top = line * 2 * width + x, bottom = top + width;
                boolean litTop = lit[top], litBottom = line * 2 + 1 < rows && lit[bottom];
                int cell;
                if (!litTop && !litBottom) cell = 0;
                else if (!litBottom) cell = (G_UPPER << 24) | color[top];
                else if (!litTop) cell = (G_LOWER << 24) | color[bottom];
                else cell = pair(color[top], color[bottom], bg, levels);
                cells[line * width + x] = cell;
            }
        return cells;
    }

    /** Two lit pixels, one color: whichever of the full block or a half block (other half left to the background) is
     * closest overall. */
    private static int pair(int top, int bottom, int bg, int levels) {
        if (top == bottom) return (G_FULL << 24) | top;
        int mixed = (quantize((((top >> 16) & 255) + ((bottom >> 16) & 255)) / 2f, levels) << 16)
                | (quantize((((top >> 8) & 255) + ((bottom >> 8) & 255)) / 2f, levels) << 8)
                | quantize(((top & 255) + (bottom & 255)) / 2f, levels);
        double full = distance2(top, mixed) + distance2(bottom, mixed);
        double upper = distance2(bottom, bg), lower = distance2(top, bg);
        if (full <= upper && full <= lower) return (G_FULL << 24) | mixed;
        return upper <= lower ? (G_UPPER << 24) | top : (G_LOWER << 24) | bottom;
    }

    /** One line of cells (glyph index in the top byte, RGB below; 0 blank) as a lore component. */
    private static Built colorLine(int[] cells, int line, int width, int[] glyphs) {
        // Runs: blanks join any run, a lit cell starts a new run when its color differs.
        java.util.List<StringBuilder> texts = new java.util.ArrayList<>();
        java.util.List<Integer> colors = new java.util.ArrayList<>();
        StringBuilder current = null;
        int currentColor = -1;
        int end = width;
        while (end > 0 && cells[line * width + end - 1] == 0) end--;
        for (int x = 0; x < end; x++) {
            int cell = cells[line * width + x];
            int glyph = glyphs[cell >>> 24];
            int rgb = cell & 0xFFFFFF;
            if (current == null) {
                current = new StringBuilder();
                currentColor = cell == 0 ? -1 : rgb;
                texts.add(current);
                colors.add(currentColor);
            } else if (cell != 0 && currentColor != rgb) {
                if (currentColor == -1) {
                    currentColor = rgb;
                    colors.set(colors.size() - 1, rgb);
                } else {
                    current = new StringBuilder();
                    currentColor = rgb;
                    texts.add(current);
                    colors.add(rgb);
                }
            }
            current.appendCodePoint(glyph);
        }
        if (texts.isEmpty()) return new Built(new JsonPrimitive(""), 0);
        // The most used run color moves to the line itself; those runs carry no color of their own.
        Map<Integer, Integer> uses = new HashMap<>();
        for (int c : colors) if (c >= 0) uses.merge(c, 1, Integer::sum);
        int base = -1, best = 0;
        for (var entry : uses.entrySet())
            if (entry.getValue() > best || (entry.getValue() == best && entry.getKey() < base)) {
                best = entry.getValue();
                base = entry.getKey();
            }
        JsonObject root = new JsonObject();
        root.addProperty("text", "");
        root.addProperty("font", FONT);
        root.addProperty("italic", false);
        if (base >= 0) root.addProperty("color", colorName(base));
        JsonArray extra = new JsonArray();
        for (int i = 0; i < texts.size(); i++) {
            int c = colors.get(i);
            if (c < 0 || c == base) extra.add(texts.get(i).toString());
            else {
                JsonObject run = new JsonObject();
                run.addProperty("text", texts.get(i).toString());
                run.addProperty("color", colorName(c));
                extra.add(run);
            }
        }
        root.add("extra", extra);
        return new Built(root, texts.size());
    }

    // ---- mono ----

    private static Pixels monoPixels(int[] pixels, int width, int rows, Params params) {
        int count = width * rows;
        boolean[] opaque = new boolean[count];
        float[] light = new float[count], close = new float[count];
        int bg = params.background();
        for (int i = 0; i < count; i++) {
            int p = pixels[i];
            int a = (p >>> 24) & 255;
            if (a < 128) continue;
            opaque[i] = true;
            double alpha = a / 255.0;
            double r = ((p >> 16) & 255) * alpha + ((bg >> 16) & 255) * (1 - alpha);
            double g = ((p >> 8) & 255) * alpha + ((bg >> 8) & 255) * (1 - alpha);
            double b = (p & 255) * alpha + (bg & 255) * (1 - alpha);
            light[i] = (float) (0.2126 * r + 0.7152 * g + 0.0722 * b);
            close[i] = (params.invert() ? 255f - light[i] : light[i]) / 255f;
        }
        float threshold = params.threshold() / 100f * 255f;
        boolean[] lit = new boolean[count];
        for (int y = 0; y < rows; y++) {
            boolean reverse = params.dither() && (y & 1) == 1;
            for (int k = 0; k < width; k++) {
                int x = reverse ? width - 1 - k : k, i = y * width + x;
                if (!opaque[i]) continue;
                boolean on = light[i] >= threshold;
                lit[i] = params.invert() != on;
                if (!params.dither()) continue;
                float error = light[i] - (on ? 255f : 0f);
                int dir = reverse ? -1 : 1;
                spread(opaque, light, width, rows, x + dir, y, error, 7 / 16f);
                spread(opaque, light, width, rows, x - dir, y + 1, error, 3 / 16f);
                spread(opaque, light, width, rows, x, y + 1, error, 5 / 16f);
                spread(opaque, light, width, rows, x + dir, y + 1, error, 1 / 16f);
            }
        }
        return new Pixels(lit, null, close);
    }

    private static int[] monoCells(int[] pixels, Params params, int rows) {
        int width = params.width();
        boolean[] lit = monoPixels(pixels, width, rows, params).lit;
        int lines = linesFor(rows);
        int[] cells = new int[lines * width];
        for (int line = 0; line < lines; line++)
            for (int x = 0; x < width; x++) {
                int top = line * 2 * width + x, bottom = top + width;
                boolean litTop = lit[top], litBottom = line * 2 + 1 < rows && lit[bottom];
                int glyph = litTop && litBottom ? G_FULL : litTop ? G_UPPER : litBottom ? G_LOWER : 0;
                cells[line * width + x] = glyph << 24; // glyph index in the top byte, like the color cells
            }
        return cells;
    }

    /** One line of glyph indexes (0 blank) in one color. */
    private static Built monoLine(int[] cells, int line, int width, int foreground, int[] glyphs) {
        int end = width;
        while (end > 0 && cells[line * width + end - 1] == 0) end--;
        if (end == 0) return new Built(new JsonPrimitive(""), 0);
        StringBuilder text = new StringBuilder(end);
        for (int x = 0; x < end; x++) text.appendCodePoint(glyphs[cells[line * width + x] >>> 24]);
        JsonObject root = new JsonObject();
        root.addProperty("text", text.toString());
        root.addProperty("font", FONT);
        root.addProperty("italic", false);
        root.addProperty("color", colorName(foreground));
        return new Built(root, 1);
    }

    // ---- octant ----

    /** Pixel rows of an octant picture: two pixel columns per character. */
    public static int octantRowsFor(int imageWidth, int imageHeight, int width) {
        return rowsFor(imageWidth, imageHeight, width * 2);
    }

    public static int octantLinesFor(int rows) {
        return (rows + 3) / 4;
    }

    private static Result renderOctant(int[] argb, int width, int height, Params params) {
        int columns = params.width(), pixelWidth = columns * 2;
        int rows = octantRowsFor(width, height, columns);
        int lineCount = octantLinesFor(rows);
        if (lineCount > MAX_LINES) return new Result(new JsonArray(), lineCount, columns, rows, 0, 0);
        int[] pixels = resample(argb, width, height, pixelWidth, rows);
        Pixels px = params.color()
                ? colorPixels(pixels, pixelWidth, rows, params)
                : monoPixels(pixels, pixelWidth, rows, params);
        int[] cells = octantCells(px, pixelWidth, rows, params);
        JsonArray lines = new JsonArray();
        int runs = 0;
        long chars = 2;
        for (int line = 0; line < lineCount; line++) {
            Built built = params.color()
                    ? colorLine(cells, line, columns, OCTANT_CP)
                    : monoLine(cells, line, columns, params.foreground(), OCTANT_CP);
            lines.add(built.json);
            runs += built.runs;
            chars += built.json.toString().length() + (line > 0 ? 1 : 0);
        }
        return new Result(lines, lineCount, columns, rows, chars, runs);
    }

    /**
     * Cells of 2x4 pixels: the pattern in the top byte and, in color mode, the mean color of its lit pixels. A pattern
     * lighting one column only gains the closest pixel of the other column, so every glyph keeps the full advance.
     */
    static int[] octantCells(Pixels px, int pixelWidth, int rows, Params params) {
        int columns = pixelWidth / 2, lines = octantLinesFor(rows);
        int[] cells = new int[lines * columns];
        float[] close = new float[8];
        for (int line = 0; line < lines; line++)
            for (int cx = 0; cx < columns; cx++) {
                int pattern = 0, count = 0;
                float r = 0, g = 0, b = 0;
                for (int k = 0; k < 8; k++) {
                    int sx = cx * 2 + (k & 1), sy = line * 4 + (k >> 1);
                    close[k] = -1;
                    if (sy >= rows) continue;
                    int i = sy * pixelWidth + sx;
                    close[k] = px.close[i];
                    if (!px.lit[i]) continue;
                    pattern |= 1 << k;
                    if (px.color != null) {
                        int c = px.color[i];
                        r += (c >> 16) & 255;
                        g += (c >> 8) & 255;
                        b += c & 255;
                        count++;
                    }
                }
                if (oneSided(pattern)) pattern = widen(pattern, close);
                int rgb = 0;
                if (count > 0) {
                    int levels = params.levels();
                    rgb = (quantize(r / count, levels) << 16)
                            | (quantize(g / count, levels) << 8)
                            | quantize(b / count, levels);
                }
                cells[line * columns + cx] = pattern == 0 ? 0 : (pattern << 24) | rgb;
            }
        return cells;
    }

    /** Lights the pixel of the empty column that is closest to lit (rows past the picture are never chosen). */
    static int widen(int pattern, float[] close) {
        int empty = (pattern & LEFT_CELLS) == 0 ? LEFT_CELLS : RIGHT_CELLS;
        int bestBit = -1;
        float best = Float.NEGATIVE_INFINITY;
        for (int k = 0; k < 8; k++)
            if ((empty & (1 << k)) != 0 && close[k] >= 0 && close[k] > best) {
                best = close[k];
                bestBit = k;
            }
        if (bestBit < 0) // only rows past the picture are empty: take the cell beside the first lit one
        for (int k = 0; k < 8; k++)
                if ((pattern & (1 << k)) != 0) {
                    bestBit = k ^ 1;
                    break;
                }
        return pattern | (1 << bestBit);
    }

    // ---- helpers ----

    private record Built(JsonElement json, int runs) {}

    /** A vanilla text color name when the color is exactly one of the 16, else #RRGGBB. */
    public static String colorName(int rgb) {
        rgb &= 0xFFFFFF;
        for (int i = 0; i < LEGACY_RGB.length; i++) if (LEGACY_RGB[i] == rgb) return LEGACY_NAMES[i];
        String hex = Integer.toHexString(rgb).toUpperCase(java.util.Locale.ROOT);
        return "#" + "000000".substring(hex.length()) + hex;
    }

    static int quantize(float value, int levels) {
        int v = clamp(value);
        if (levels >= 256) return v;
        int step = Math.round(v * (levels - 1) / 255f);
        return clamp(step * 255f / (levels - 1));
    }

    private static void spread(
            boolean[] lit,
            float[] r,
            float[] g,
            float[] b,
            int width,
            int rows,
            int x,
            int y,
            float er,
            float eg,
            float eb,
            float weight) {
        if (x < 0 || x >= width || y >= rows) return;
        int i = y * width + x;
        if (!lit[i]) return;
        r[i] += er * weight;
        g[i] += eg * weight;
        b[i] += eb * weight;
    }

    private static void spread(
            boolean[] opaque, float[] light, int width, int rows, int x, int y, float error, float weight) {
        if (x < 0 || x >= width || y >= rows) return;
        int i = y * width + x;
        if (opaque[i]) light[i] += error * weight;
    }

    private static double distance2(double r, double g, double b, int rgb) {
        double dr = r - ((rgb >> 16) & 255), dg = g - ((rgb >> 8) & 255), db = b - (rgb & 255);
        return dr * dr + dg * dg + db * db;
    }

    private static double distance2(int a, int b) {
        return distance2((a >> 16) & 255, (a >> 8) & 255, a & 255, b);
    }

    private static int clamp(double value) {
        return (int) Math.max(0, Math.min(255, Math.round(value)));
    }
}
