package dev.rinorsi.editor.client;

import dev.oriel.mod.client.OrielScreen;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** A screen showing an editor page: the world behind it is the theme's ({@link EditorBackdrop}), not vanilla's. */
public class EditorScreen extends OrielScreen {
    EditorScreen(String page) {
        super(page, null, -1);
    }

    @Override
    public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float a) {
        if (!EditorBackdrop.extract(g)) super.extractBackground(g, mouseX, mouseY, a);
    }
}
