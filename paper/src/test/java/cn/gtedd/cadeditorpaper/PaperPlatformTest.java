package cn.gtedd.cadeditorpaper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.util.ServiceLoader;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.tags.TagKey;
import org.junit.jupiter.api.Test;

class PaperPlatformTest {
    @Test
    void theEditorFindsThePaperPlatformThroughServiceLoader() {
        var found = ServiceLoader.load(
                        dev.rinorsi.editor.platform.Platform.class, PaperPlatformTest.class.getClassLoader())
                .findFirst();
        assertTrue(found.orElseThrow() instanceof PaperPlatform);
    }

    @Test
    void tagTranslationKeysFollowFabric() {
        PaperPlatform platform = new PaperPlatform();
        assertEquals(
                "tag.item.minecraft.logs",
                platform.tagTranslationKey(TagKey.create(Registries.ITEM, Identifier.withDefaultNamespace("logs"))));
        assertEquals(
                "tag.worldgen.biome.minecraft.is_ocean",
                platform.tagTranslationKey(
                        TagKey.create(Registries.BIOME, Identifier.withDefaultNamespace("is_ocean"))));
        assertEquals(
                "tag.block.c.ores.iron",
                platform.tagTranslationKey(
                        TagKey.create(Registries.BLOCK, Identifier.fromNamespaceAndPath("c", "ores/iron"))));
    }

    @Test
    void theEditorsServerLanguageFilesShip() throws Exception {
        for (String locale : new String[] {"en_us", "zh_cn"}) {
            try (InputStream in =
                    PaperPlatformTest.class.getResourceAsStream("/assets/cadeditor/lang/" + locale + ".json")) {
                assertNotNull(in, locale);
                assertTrue(in.readAllBytes().length > 1000, locale);
            }
        }
    }
}
