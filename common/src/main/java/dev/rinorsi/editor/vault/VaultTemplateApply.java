package dev.rinorsi.editor.vault;

import com.google.gson.JsonObject;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorSessions;
import dev.rinorsi.editor.StackCodec;
import dev.rinorsi.editor.world.WorldEditSessions;
import dev.rinorsi.editor.world.WorldTarget;
import java.util.Set;

/** Called only after the world router has resolved permissions, target and session revision. */
public final class VaultTemplateApply {
    private VaultTemplateApply() {}

    public static JsonObject expand(WorldTarget target, WorldEditSessions.State state, JsonObject request) {
        if (!StackCodec.string(request, "op").equals("apply"))
            EditorSessions.fail(
                    "invalid_request",
                    EditorI18n.tr("cadeditor.message.vaulttemplateapply.preset_only_applied_through_apply"));
        for (String key : request.keySet())
            if (!Set.of("op", "requestId", "slot", "revision", "vault_template", "updateNeighbors")
                    .contains(key))
                EditorSessions.fail(
                        "invalid_request",
                        EditorI18n.tr("cadeditor.message.vaulttemplateapply.preset_cannot_submitted_combination"));
        // Use the opened baseline, not a fresh mutable value, so normal three-way conflicts remain intact.
        var snapshot = target.snapshot(state.slot, false, state.baseline);
        var edit = VaultTemplates.expand(StackCodec.object(request, "vault_template"), snapshot);
        for (String key : Set.of("op", "requestId", "slot", "revision", "updateNeighbors"))
            if (request.has(key)) edit.add(key, request.get(key).deepCopy());
        return edit;
    }
}
