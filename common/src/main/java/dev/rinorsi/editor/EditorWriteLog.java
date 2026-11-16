package dev.rinorsi.editor;

import org.slf4j.LoggerFactory;

/** Per-request trace; off unless {@code debugLog} or {@code -Dcadeditor.debug=true}. No NBT or request bodies. */
public final class EditorWriteLog {
    private static final org.slf4j.Logger LOG = LoggerFactory.getLogger("cadeditor.write");
    private static volatile boolean verbose = Boolean.getBoolean("cadeditor.debug");

    private EditorWriteLog() {}

    /** Whether the per-request trace is printed. */
    public static boolean verbose() {
        return verbose;
    }

    public static void verbose(boolean on) {
        verbose = on;
    }

    public static void event(String stage, String request, String context) {
        if (verbose)
            LOG.info(
                    "[CAD-Editor-Write] stage={} request={} {}",
                    clean(stage, 80),
                    clean(request, 80),
                    clean(context, 1000));
    }
    /** An expected refusal or an unconfirmed outcome: part of the trace, not a fault. */
    public static void warning(String stage, String request, String context) {
        if (verbose)
            LOG.warn(
                    "[CAD-Editor-Write] stage={} request={} {}",
                    clean(stage, 80),
                    clean(request, 80),
                    clean(context, 1000));
    }
    /** Invalid input is a refusal (trace only); anything else is a fault and always logged with its stack trace. */
    public static void failure(String stage, String request, String context, RuntimeException error) {
        if (error instanceof IllegalArgumentException)
            warning(stage, request, context + " reason=" + error.getMessage());
        else
            LOG.error(
                    "[CAD-Editor-Write] stage={} request={} {}",
                    clean(stage, 80),
                    clean(request, 80),
                    clean(context, 1000),
                    error);
    }

    static String clean(String text, int limit) {
        if (text == null) return "-";
        var out = new StringBuilder();
        text.codePoints().limit(limit).forEach(c -> {
            int type = Character.getType(c);
            if (Character.isISOControl(c)
                    || type == Character.FORMAT
                    || type == Character.SURROGATE
                    || type == Character.LINE_SEPARATOR
                    || type == Character.PARAGRAPH_SEPARATOR) out.append(' ');
            else out.appendCodePoint(c);
        });
        return out.toString();
    }
}
