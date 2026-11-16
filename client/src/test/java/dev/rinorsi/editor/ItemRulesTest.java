package dev.rinorsi.editor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.google.gson.JsonParser;
import dev.rinorsi.editor.ItemRules.Violation.Kind;
import net.minecraft.nbt.NbtOps;
import net.minecraft.nbt.Tag;
import net.minecraft.nbt.TagParser;
import org.junit.jupiter.api.Test;

/** The item rule on saved NBT: only what a write adds, alters, copies or strips counts. */
class ItemRulesTest {
    private static final ItemRules.Settings RULES = ItemRules.Settings.DEFAULT;

    private static Tag nbt(String snbt) {
        try {
            return TagParser.create(NbtOps.INSTANCE).parseFully(snbt);
        } catch (Exception e) {
            throw new IllegalArgumentException(snbt, e);
        }
    }

    private static Kind kind(String before, String after) {
        var violation = ItemRules.find(RULES, before == null ? null : nbt(before), after == null ? null : nbt(after));
        return violation == null ? null : violation.kind();
    }

    @Test
    void bannedItems() {
        assertEquals(Kind.BANNED, kind(null, "{id:\"minecraft:barrier\",count:1}"));
        assertEquals(Kind.BANNED, kind("{id:\"minecraft:stone\"}", "{id:\"barrier\"}"), "namespace optional");
        assertNull(
                kind(
                        "{id:\"minecraft:barrier\",count:1}",
                        "{id:\"minecraft:barrier\",count:1,components:{\"minecraft:custom_name\":\"x\"}}"),
                "an existing banned stack may be renamed");
        assertEquals(
                Kind.BANNED,
                kind("{id:\"minecraft:barrier\",count:1}", "{id:\"minecraft:barrier\",count:64}"),
                "but not multiplied");
        // Nested: a shulker box whose container gains a command block.
        assertEquals(
                Kind.BANNED,
                kind(
                        "{id:\"minecraft:shulker_box\"}",
                        "{id:\"minecraft:shulker_box\",components:{\"minecraft:container\":[{slot:0,item:{id:\"minecraft:command_block\"}}]}}"));
        // A chest's block entity data gains a debug stick.
        assertEquals(
                Kind.BANNED,
                kind(
                        "{id:\"minecraft:chest\",Items:[]}",
                        "{id:\"minecraft:chest\",Items:[{Slot:0b,id:\"minecraft:debug_stick\",count:1}]}"));
        assertNull(
                kind(
                        "{id:\"minecraft:chest\",Items:[{Slot:0b,id:\"minecraft:debug_stick\",count:1}]}",
                        "{id:\"minecraft:chest\",Items:[]}"),
                "removing a banned item is fine");
    }

    @Test
    void restrictedComponents() {
        String plain = "{id:\"minecraft:paper\",count:1}";
        String key = "{id:\"minecraft:paper\",count:1,components:{\"minecraft:custom_data\":{crate:\"legendary\"}}}";
        assertEquals(Kind.COMPONENT, kind(plain, key), "forging plugin data");
        assertEquals(
                Kind.COMPONENT,
                kind(key, "{id:\"minecraft:paper\",count:1,components:{\"minecraft:custom_data\":{crate:\"mythic\"}}}"),
                "altering it");
        assertEquals(
                Kind.COMPONENT,
                kind(
                        key,
                        "{id:\"minecraft:paper\",count:64,components:{\"minecraft:custom_data\":{crate:\"legendary\"}}}"),
                "duplicating it");
        assertEquals(Kind.STRIPPED, kind(key, plain), "stripping it (soulbound markers)");
        assertNull(
                kind(
                        key,
                        "{id:\"minecraft:paper\",count:1,components:{\"minecraft:custom_data\":{crate:\"legendary\"},\"minecraft:custom_name\":\"Key\"}}"),
                "other components of a plugin item stay editable");
        assertNull(kind("{Items:[" + key + "]}", "{Items:[]}"), "deleting the whole item is fine");
        assertEquals(
                Kind.COMPONENT,
                kind(
                        plain,
                        "{id:\"minecraft:stone\",components:{\"minecraft:can_break\":{blocks:\"minecraft:stone\"}}}"),
                "adventure-mode predicates");
        assertEquals(
                Kind.COMPONENT,
                kind(plain, "{id:\"minecraft:diamond_sword\",components:{\"!minecraft:custom_data\":{}}}"),
                "removal markers count");
        assertNull(
                kind(plain, "{id:\"minecraft:paper\",count:5,components:{\"minecraft:custom_name\":\"x\"}}"),
                "plain edits");
    }

    @Test
    void commandClicks() {
        String run =
                "{id:\"minecraft:written_book\",components:{\"minecraft:written_book_content\":{title:\"t\",author:\"a\",pages:[{raw:{text:\"x\",click_event:{action:\"run_command\",command:\"/op someone\"}}}]}}}";
        assertEquals(Kind.CLICK, kind(null, run));
        assertNull(kind(run, run), "an existing book stays as it is");
        assertNull(
                kind(
                        null,
                        "{front_text:{messages:[{text:\"x\",click_event:{action:\"suggest_command\",command:\"/help\"}},\"\",\"\",\"\"]}}"),
                "suggest_command runs nothing");
        assertEquals(
                Kind.CLICK,
                kind(
                        "{front_text:{messages:[\"\",\"\",\"\",\"\"]}}",
                        "{front_text:{messages:[{text:\"x\",click_event:{action:\"run_command\",command:\"/give @s diamond\"}},\"\",\"\",\"\"]}}"));
        var off = new ItemRules.Settings(RULES.bannedItems(), RULES.restrictedComponents(), false);
        assertNull(ItemRules.find(off, null, nbt(run)), "blockCommandClicks=false");
    }

    @Test
    void settings() {
        var parsed = ItemRules.Settings.parse(JsonParser.parseString("{\"bannedItems\":[\"Bedrock\",\"mymod:wand\"]}"));
        assertEquals(java.util.Set.of("minecraft:bedrock", "mymod:wand"), parsed.bannedItems());
        assertEquals(RULES.restrictedComponents(), parsed.restrictedComponents(), "missing keys keep their defaults");
        assertEquals(parsed, ItemRules.Settings.parse(parsed.toJson()));
        assertThrows(
                IllegalArgumentException.class,
                () -> ItemRules.Settings.parse(JsonParser.parseString("{\"bannedItems\":\"barrier\"}")));
        assertThrows(
                IllegalArgumentException.class,
                () -> ItemRules.Settings.parse(JsonParser.parseString("{\"bannedItems\":[\"a b\"]}")));
    }
}
