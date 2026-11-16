package dev.rinorsi.editor.client;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.oriel.engine.dom.Document;
import dev.oriel.engine.dom.Element;
import dev.oriel.engine.input.TextSelection;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Page-requested text replacements in a code field, applied through the field's own text model: one undo step, the
 * same {@code beforeinput}/{@code input} events typing fires. Scripts can only assign {@code value}, which clears the
 * undo history; completion, replace-all and string write-back use this instead. The page sets
 * {@code data-code-edit='{"from":..,"to":..,"text":..,"selStart":..,"selEnd":..,"length":..}'} on the field and
 * dispatches {@code ed:code-edit}; a stale request (length differs) is ignored.
 */
final class CodeEdits {
    private static final Logger LOG = LoggerFactory.getLogger("CodeEdits");

    private CodeEdits() {}

    static void install(Document doc) {
        doc.documentElement().setAttribute("data-editor-code-edit", "ready");
        doc.addEventListener("ed:code-edit", event -> {
            try {
                if (!(event.target() instanceof Element field) || !field.hasAttribute("data-code-edit")) return;
                String spec = field.getAttribute("data-code-edit");
                field.removeAttribute("data-code-edit");
                if (spec == null || spec.length() > 64 * 1024 * 1024) return;
                JsonObject edit = JsonParser.parseString(spec).getAsJsonObject();
                int length = field.value().length();
                if (edit.has("length") && edit.get("length").getAsInt() != length) return;
                int from = Math.clamp(edit.get("from").getAsInt(), 0, length);
                int to = Math.clamp(edit.get("to").getAsInt(), from, length);
                String text = edit.get("text").getAsString();
                TextSelection.replace(field, from, to, text);
                if (edit.has("selStart") && edit.has("selEnd")) {
                    int end = field.value().length();
                    TextSelection.select(
                            field,
                            Math.clamp(edit.get("selStart").getAsInt(), 0, end),
                            Math.clamp(edit.get("selEnd").getAsInt(), 0, end));
                }
            } catch (RuntimeException invalid) {
                LOG.warn("Ignored invalid code edit request", invalid);
            }
        });
    }
}
