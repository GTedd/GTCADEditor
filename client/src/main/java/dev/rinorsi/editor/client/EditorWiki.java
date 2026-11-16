package dev.rinorsi.editor.client;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.oriel.mod.client.DocumentDriver;
import dev.rinorsi.editor.EditorI18n;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.language.ClientLanguage;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.locale.Language;
import net.minecraft.resources.Identifier;
import net.minecraft.util.Util;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import org.slf4j.LoggerFactory;

/**
 * Opens the Chinese Minecraft Wiki entry of a vanilla item, block or entity in the system browser. The page only names
 * the object (kind and ID); the address is always built here, on zh.minecraft.wiki, from the game's own Simplified
 * Chinese name, so a page cannot open anything else. The wiki's search goes straight to an exactly named entry and lists
 * results otherwise. Vanilla APIs only: {@link ClientLanguage#loadFrom} for zh_cn whatever the game language is, and
 * {@link com.mojang.blaze3d.Blaze3D#openUri} (the system default browser, off the render thread).
 */
final class EditorWiki {
    static final String SEARCH = "https://zh.minecraft.wiki/w/Special:Search?search=";
    private static final Pattern ID = Pattern.compile("minecraft:[a-z0-9_./-]{1,120}");
    /** A double click opens one tab, not two. */
    private static final long MIN_INTERVAL_MS = 800;

    private static long lastOpen = Long.MIN_VALUE / 2;
    private static Language chinese;
    private static Language chineseFor;

    private EditorWiki() {}

    record Request(String requestId, String kind, String id) {
        static Request parse(JsonElement value) {
            if (value == null || !value.isJsonObject() || value.toString().length() > 512)
                throw new IllegalArgumentException(EditorI18n.tr("cadeditor.message.editorwiki.invalid_request"));
            var message = value.getAsJsonObject();
            String requestId = string(message, "requestId");
            String kind = string(message, "kind");
            String id = string(message, "id");
            if (requestId.isBlank()
                    || requestId.length() > 80
                    || !List.of("item", "block", "entity").contains(kind)
                    || !ID.matcher(id).matches())
                throw new IllegalArgumentException(EditorI18n.tr("cadeditor.message.editorwiki.invalid_request"));
            return new Request(requestId, kind, id);
        }

        private static String string(JsonObject message, String key) {
            var value = message.get(key);
            return value != null
                            && value.isJsonPrimitive()
                            && value.getAsJsonPrimitive().isString()
                    ? value.getAsString()
                    : "";
        }
    }

    static void attach(DocumentDriver driver) {
        if (driver.serverSession()) return;
        driver.onMessage("editor_wiki", value -> {
            var result = new JsonObject();
            try {
                var request = Request.parse(value);
                result.addProperty("requestId", request.requestId());
                long now = Util.getMillis();
                if (now - lastOpen < MIN_INTERVAL_MS) {
                    result.addProperty("status", "ignored");
                } else {
                    String title = title(request.kind(), request.id());
                    lastOpen = now;
                    com.mojang.blaze3d.Blaze3D.openUri(uri(title));
                    result.addProperty("status", "ok");
                    result.addProperty("title", title);
                }
            } catch (RuntimeException failure) {
                result.addProperty("status", "error");
                result.addProperty(
                        "reason",
                        failure instanceof IllegalArgumentException
                                ? failure.getMessage()
                                : EditorI18n.tr("cadeditor.message.editorwiki.open_failed"));
                if (!(failure instanceof IllegalArgumentException))
                    LoggerFactory.getLogger("EditorWiki").warn("Opening the wiki failed", failure);
            }
            driver.patch("editor_wiki", result);
        });
    }

    /** The wiki search for {@code title}: an exact entry (or redirect) opens directly. */
    static URI uri(String title) {
        return URI.create(
                SEARCH + URLEncoder.encode(title, StandardCharsets.UTF_8).replace("+", "%20"));
    }

    /** The object's Simplified Chinese game name; its ID path when zh_cn has none. */
    static String title(String kind, String id) {
        var key = Identifier.parse(id);
        Optional<String> descriptionId = switch (kind) {
            case "item" -> BuiltInRegistries.ITEM.getOptional(key).map(Item::getDescriptionId);
            case "block" -> BuiltInRegistries.BLOCK.getOptional(key).map(Block::getDescriptionId);
            default -> BuiltInRegistries.ENTITY_TYPE.getOptional(key).map(EntityType::getDescriptionId);
        };
        if (descriptionId.isEmpty())
            throw new IllegalArgumentException(EditorI18n.tr("cadeditor.message.editorwiki.unknown_object", id));
        String name = chinese().getOrDefault(descriptionId.get(), key.getPath());
        return name.isBlank() ? key.getPath() : name;
    }

    /** zh_cn even when the game is in another language; reloaded with the game's language (resource reloads). */
    private static Language chinese() {
        var current = Language.getInstance();
        var mc = Minecraft.getInstance();
        if ("zh_cn".equals(mc.options.languageCode)) return current;
        if (chinese == null || chineseFor != current) {
            chinese = ClientLanguage.loadFrom(mc.getResourceManager(), List.of("zh_cn"), false);
            chineseFor = current;
        }
        return chinese;
    }
}
