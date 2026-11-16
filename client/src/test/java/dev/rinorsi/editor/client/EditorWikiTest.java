package dev.rinorsi.editor.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

/** The page names a vanilla object; the address is always a zh.minecraft.wiki search built here. */
class EditorWikiTest {
    private static EditorWiki.Request parse(String json) {
        return EditorWiki.Request.parse(JsonParser.parseString(json));
    }

    @Test
    void acceptsVanillaItemsBlocksAndEntities() {
        var item = parse("{requestId:'wiki-1',kind:'item',id:'minecraft:diamond_sword'}");
        assertEquals("item", item.kind());
        assertEquals("minecraft:diamond_sword", item.id());
        assertEquals(
                "block",
                parse("{requestId:'b',kind:'block',id:'minecraft:chest'}").kind());
        assertEquals(
                "entity",
                parse("{requestId:'e',kind:'entity',id:'minecraft:tropical_fish'}")
                        .kind());
    }

    @Test
    void rejectsAnythingElse() {
        for (String json : new String[] {
            "[]",
            "{kind:'item',id:'minecraft:stone'}",
            "{requestId:'x',kind:'url',id:'minecraft:stone'}",
            "{requestId:'x',kind:'item',id:'mymod:ruby'}",
            "{requestId:'x',kind:'item',id:'https://example.com'}",
            "{requestId:'x',kind:'item',id:'minecraft:'}",
            "{requestId:'x',kind:'item',id:'minecraft:Stone'}",
            "{requestId:'x',kind:'item',id:'minecraft:stone',url:'https://example.com'," + "pad:'" + "a".repeat(600)
                    + "'}"
        }) assertThrows(IllegalArgumentException.class, () -> parse(json), json);
    }

    @Test
    void searchAddressIsAlwaysTheChineseWiki() {
        assertEquals(
                "https://zh.minecraft.wiki/w/Special:Search?search=%E9%92%BB%E7%9F%B3%E5%89%91",
                EditorWiki.uri("钻石剑").toString());
        assertEquals(
                "https://zh.minecraft.wiki/w/Special:Search?search=a%20b%26c%3Fd",
                EditorWiki.uri("a b&c?d").toString(), "a name cannot add parameters or change the page");
    }
}
