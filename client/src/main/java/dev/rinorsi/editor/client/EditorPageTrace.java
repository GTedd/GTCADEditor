package dev.rinorsi.editor.client;

import com.google.gson.JsonElement;
import dev.rinorsi.editor.EditorI18n;
import java.util.Locale;
import java.util.function.LongSupplier;

/** One local Document load, including reloads. Neither marker claims a GPU presentation. */
final class EditorPageTrace {
    private final EditorUiLog log;
    private final LongSupplier clock;
    private final long started;
    private boolean shell, boot, frame;
    private String workStage;
    private boolean working;

    EditorPageTrace(EditorUiLog log, LongSupplier clock) {
        this.log = log;
        this.clock = clock;
        started = clock.getAsLong();
    }

    void accept(JsonElement value) {
        if (value == null || !value.isJsonObject()) return;
        var object = value.getAsJsonObject();
        var phase = object.get("phase");
        if (phase == null
                || !phase.isJsonPrimitive()
                || !phase.getAsJsonPrimitive().isString()) return;
        String stage = phase.getAsString();
        if (stage.equals("work")) {
            work(object);
            return;
        }
        if (stage.equals("shell")) {
            // js/boot.js: the window shell and loading animation are on screen; the scripts load after it.
            if (shell) return;
            shell = true;
        } else if (stage.equals("boot")) {
            if (boot) return;
            boot = true;
        } else if (stage.equals("first_frame_callback")) {
            if (!boot || frame) return;
            frame = true;
        } else return;
        double elapsed = Math.max(0, clock.getAsLong() - started) / 1_000_000.0;
        log.log(
                elapsed >= 250 ? EditorUiLog.Level.WARN : EditorUiLog.Level.INFO,
                String.format(
                        Locale.ROOT,
                        "[CAD-Editor-Perf] page=cadeditor:ui/index.html stage=%s load_ms=%.2f slow=%s",
                        stage,
                        elapsed,
                        elapsed >= 250));
    }

    private void work(com.google.gson.JsonObject object) {
        var name = object.get("stage");
        var state = object.get("state");
        if (name == null
                || !name.isJsonPrimitive()
                || !name.getAsJsonPrimitive().isString()
                || state == null
                || !state.isJsonPrimitive()
                || !state.getAsJsonPrimitive().isString()) return;
        String site = name.getAsString();
        if (site.length() > 180 || !site.matches("[A-Za-z0-9_.:/-]+")) return;
        boolean start = state.getAsString().equals("begin");
        if (!start && !state.getAsString().equals("end")) return;
        if (start) {
            workStage = site;
            working = true;
        } else if (site.equals(workStage)) working = false;
        var elapsed = object.get("elapsedMs");
        long ms = elapsed != null
                        && elapsed.isJsonPrimitive()
                        && elapsed.getAsJsonPrimitive().isNumber()
                ? Math.max(0, elapsed.getAsLong())
                : 0;
        log.log(
                !start && ms >= 250 ? EditorUiLog.Level.WARN : EditorUiLog.Level.INFO,
                EditorI18n.tr(
                        "cadeditor.message.editorpagetrace.cad_editor_phase_stage",
                        ((start
                                ? EditorI18n.tr("cadeditor.message.editorpagetrace.started")
                                : EditorI18n.tr("cadeditor.message.editorpagetrace.finished"))),
                        (describe(site)),
                        (site),
                        ((!start ? EditorI18n.tr("cadeditor.message.editorpagetrace.time_ms", (ms)) : ""))));
    }

    String lastStage() {
        return workStage == null
                ? EditorI18n.tr("cadeditor.message.editorpagehost.page_load_yet_specified")
                : (working
                                ? EditorI18n.tr("cadeditor.message.editorpagetrace.progress")
                                : EditorI18n.tr("cadeditor.message.editorpagetrace.last_completed"))
                        + describe(workStage) + "（" + workStage + "）";
    }

    private static String describe(String site) {
        if (site.startsWith("registry.replay."))
            return EditorI18n.tr("cadeditor.message.editorpagetrace.restore_field_info");
        return switch (site) {
            case "boot.prefs" -> EditorI18n.tr("cadeditor.message.editorpagetrace.read_ui_settings");
            case "boot.registry" -> EditorI18n.tr("cadeditor.message.editorpagetrace.connect_game_registry");
            case "boot.world" -> EditorI18n.tr("cadeditor.message.editorpagetrace.open_block_entity_player_pages");
            case "boot.vault" -> EditorI18n.tr("cadeditor.message.editorpagetrace.open_vault");
            case "item.load" -> EditorI18n.tr("cadeditor.message.editorpagetrace.load_item_data");
            case "item.render" -> EditorI18n.tr("cadeditor.message.editorpagetrace.draw_item_edit_ui");
            case "item.drafts" -> EditorI18n.tr("cadeditor.message.editorpagetrace.check_restore_draft");
            default -> EditorI18n.tr("cadeditor.message.editorpagetrace.process_editor_page");
        };
    }
}
