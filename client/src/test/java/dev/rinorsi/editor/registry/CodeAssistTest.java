package dev.rinorsi.editor.registry;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Regression for the code editor's host-side helpers: SNBT completion candidates from live codecs/registries for a
 * page-computed cursor context, and command checking/completion on a plain Brigadier tree (no game client).
 */
public final class CodeAssistTest {
    private static int checks;

    public static void main(String[] args) throws Exception {
        commands();
        completion();
        System.out.println("PASS code assist: " + checks + " checks");
    }

    private static void commands() throws Exception {
        CommandDispatcher<Object> dispatcher = new CommandDispatcher<>();
        dispatcher.register(LiteralArgumentBuilder.<Object>literal("give")
                .then(RequiredArgumentBuilder.<Object, Integer>argument("count", IntegerArgumentType.integer(1, 64))
                        .executes(c -> 1)));
        dispatcher.register(LiteralArgumentBuilder.<Object>literal("gamerule").executes(c -> 1));
        var source = new Object();
        java.util.function.Function<com.mojang.brigadier.exceptions.CommandSyntaxException, String> messages =
                e -> e.getRawMessage().getString();
        var ok = CommandAssistLogic.check(dispatcher, source, "give 5", messages, "incomplete");
        check(ok.status() == CommandAssistLogic.Status.OK, "valid command");
        var slash = CommandAssistLogic.check(dispatcher, source, "/give 5", messages, "incomplete");
        check(slash.status() == CommandAssistLogic.Status.OK, "leading slash accepted");
        var bad = CommandAssistLogic.check(dispatcher, source, "/give 99", messages, "incomplete");
        check(bad.status() == CommandAssistLogic.Status.ERROR, "range error " + bad);
        check(bad.start() == 6, "error offset counts the kept slash: " + bad.start());
        var word = CommandAssistLogic.check(dispatcher, source, "give x", messages, "incomplete");
        check(word.status() == CommandAssistLogic.Status.ERROR && word.start() == 5, "argument error at 5 " + word);
        var incomplete = CommandAssistLogic.check(dispatcher, source, "give", messages, "incomplete");
        check(incomplete.status() == CommandAssistLogic.Status.INCOMPLETE, "incomplete " + incomplete);
        check(incomplete.message().equals("incomplete"), "incomplete message is the caller's");
        var trailing = CommandAssistLogic.check(dispatcher, source, "give 5 6", messages, "incomplete");
        check(trailing.status() == CommandAssistLogic.Status.ERROR, "unknown trailing argument " + trailing);
        var unknown = CommandAssistLogic.check(dispatcher, source, "op Steve", messages, "incomplete");
        check(
                unknown.status() == CommandAssistLogic.Status.UNCHECKED
                        && "unknown_root".equals(unknown.reason())
                        && "op".equals(unknown.root()),
                "missing root is not a syntax verdict");
        check(
                CommandAssistLogic.check(dispatcher, source, "/", messages, "x").status()
                        == CommandAssistLogic.Status.EMPTY,
                "empty");
        check(
                CommandAssistLogic.check(dispatcher, source, "give " + "1".repeat(32767), messages, "x")
                        .reason()
                        .equals("too_long"),
                "too long is not checked");
        var hints = CommandAssistLogic.suggest(dispatcher, source, "/ga", 3, m -> m.getString())
                .get();
        check(hints.size() == 1 && hints.getFirst().text().equals("gamerule"), "root completion " + hints);
        check(hints.getFirst().from() == 1 && hints.getFirst().to() == 3, "range into original text " + hints);
        var all = CommandAssistLogic.suggest(dispatcher, source, "", 0, m -> m.getString())
                .get();
        check(all.size() == 2, "all roots " + all);
    }

    private static void completion() {
        var access = ComponentSchemaTest.bootstrap();
        var resolver = new CodeAssistResolver(access, CodeAssistResolver.derived(access));
        var top = values(resolver.resolve(request("stack", null, null, List.of(), true, "", Set.of(), Map.of())));
        check(top.equals(List.of("id", "count", "components")), "stack keys " + top);
        var rest = values(resolver.resolve(request("stack", null, null, List.of(), true, "", Set.of("id"), Map.of())));
        check(rest.equals(List.of("count", "components")), "present keys excluded " + rest);
        var items = values(
                resolver.resolve(request("stack", null, null, List.of("id"), false, "diamond_sw", Set.of(), Map.of())));
        check(items.contains("minecraft:diamond_sword"), "item ids by path prefix " + items);
        var comps = resolver.resolve(request(
                "stack", null, "minecraft:diamond_sword", List.of("components"), true, "ench", Set.of(), Map.of()));
        var compIds = values(comps);
        check(compIds.contains("minecraft:enchantments"), "component ids " + compIds);
        check(kinds(comps).contains("component"), "component kind");
        var removal = resolver.resolve(request(
                "stack", null, "minecraft:diamond_sword", List.of("components"), true, "!max_d", Set.of(), Map.of()));
        check(values(removal).contains("!minecraft:max_damage"), "removal form " + values(removal));
        check(
                removal.getAsJsonArray("items").get(0).getAsJsonObject().has("df"),
                "item prototype components rank first for removal");
        var present = values(resolver.resolve(request(
                "stack", null, null, List.of("components"), true, "minecraft:rar", Set.of("rarity"), Map.of())));
        check(!present.contains("minecraft:rarity"), "short sibling component id excluded " + present);
        var food = values(resolver.resolve(
                request("stack", null, null, List.of("components", "minecraft:food"), true, "", Set.of(), Map.of())));
        check(food.containsAll(List.of("nutrition", "saturation", "can_always_eat")), "food fields " + food);
        check(food.indexOf("nutrition") < food.indexOf("can_always_eat"), "required fields first " + food);
        var bool = values(resolver.resolve(request(
                "stack", null, null, List.of("components", "food", "can_always_eat"), false, "", Set.of(), Map.of())));
        check(bool.equals(List.of("true", "false")), "boolean values " + bool);
        var rarity = values(resolver.resolve(
                request("component", "minecraft:rarity", null, List.of(), false, "", Set.of(), Map.of())));
        check(rarity.containsAll(List.of("common", "uncommon", "rare", "epic")), "enum values " + rarity);
        var repair = values(resolver.resolve(request(
                "stack",
                null,
                null,
                List.of("components", "minecraft:repairable", "items"),
                false,
                "iron_ing",
                Set.of(),
                Map.of())));
        check(repair.contains("minecraft:iron_ingot"), "holder set ids " + repair);
        var deathTypes = values(resolver.resolve(request(
                "stack",
                null,
                null,
                List.of("components", "minecraft:death_protection", "death_effects", "[]", "type"),
                false,
                "clear",
                Set.of(),
                Map.of())));
        check(deathTypes.contains("minecraft:clear_all_effects"), "list element dispatch type values " + deathTypes);
        var effects = resolver.resolve(request(
                "stack",
                null,
                null,
                List.of("components", "minecraft:consumable", "on_consume_effects", "[]"),
                true,
                "",
                Set.of(),
                Map.of("type", "apply_effects")));
        var effectKeys = values(effects);
        check(effectKeys.contains("type") && effectKeys.contains("effects"), "dispatch fields " + effectKeys);
        check(!effectKeys.contains("sound"), "discriminator value selects one branch " + effectKeys);
        var effectTypes = values(resolver.resolve(request(
                "stack",
                null,
                null,
                List.of("components", "minecraft:consumable", "on_consume_effects", "[]", "type"),
                false,
                "",
                Set.of(),
                Map.of())));
        check(effectTypes.contains("minecraft:apply_effects"), "dispatch type " + effectTypes);
        var free = values(resolver.resolve(request("nbt", null, null, List.of("a"), false, "t", Set.of(), Map.of())));
        check(free.equals(List.of("true")), "free NBT literal values " + free);
        check(
                values(resolver.resolve(request(
                                "stack",
                                null,
                                null,
                                List.of("components", "!minecraft:food"),
                                true,
                                "",
                                Set.of(),
                                Map.of())))
                        .isEmpty(),
                "removal body has no fields");
        var parsed = CodeAssistChannel.parse(JsonParser.parseString(
                        "{\"requestId\":\"a\",\"root\":\"stack\",\"mode\":\"key\",\"path\":[\"components\"],\"prefix\":\"x\",\"siblings\":[\"a\"],\"values\":{\"type\":\"b\"},\"limit\":9999}")
                .getAsJsonObject());
        check(parsed.limit() == CodeAssistResolver.MAX_ITEMS && parsed.keyMode(), "request bounds");
        boolean rejected = false;
        try {
            CodeAssistChannel.parse(
                    JsonParser.parseString("{\"root\":\"world\"}").getAsJsonObject());
        } catch (IllegalArgumentException expected) {
            rejected = true;
        }
        check(rejected, "unknown root rejected");
    }

    private static CodeAssistResolver.Request request(
            String root,
            String component,
            String item,
            List<String> path,
            boolean key,
            String prefix,
            Set<String> siblings,
            Map<String, String> values) {
        return new CodeAssistResolver.Request(root, component, item, path, key, prefix, siblings, values, 200);
    }

    private static List<String> values(JsonObject result) {
        List<String> out = new ArrayList<>();
        JsonArray items = result.getAsJsonArray("items");
        items.forEach(e -> out.add(e.getAsJsonObject().get("v").getAsString()));
        return out;
    }

    private static List<String> kinds(JsonObject result) {
        List<String> out = new ArrayList<>();
        result.getAsJsonArray("items")
                .forEach(e -> out.add(e.getAsJsonObject().get("k").getAsString()));
        return out;
    }

    private static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }
}
