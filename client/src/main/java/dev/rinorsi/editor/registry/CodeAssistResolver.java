package dev.rinorsi.editor.registry;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import net.minecraft.core.Registry;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.locale.Language;
import net.minecraft.resources.Identifier;
import net.minecraft.util.Util;

/**
 * Completion candidates for one SNBT cursor context that the page computed (key path from the document root, key or
 * value position, typed prefix). Field shapes come from the running codecs ({@link ComponentSchema}); IDs and tags
 * from the live registries. No world entities, no writes, no network. Call on the client thread: registries are live
 * game state. The result only suggests text; the document is still parsed and validated by the usual routes.
 */
final class CodeAssistResolver {
    static final int MAX_ITEMS = 200;
    static final int MAX_PATH = 24;
    private static final int MAX_BRANCHES = 12;

    record Request(
            String root,
            String component,
            String item,
            List<String> path,
            boolean keyMode,
            String prefix,
            Set<String> siblings,
            Map<String, String> values,
            int limit) {}

    /** A component's structural schema root ({@code ComponentSchema.Node#toJson}); throws for unknown components. */
    interface Schemas {
        JsonObject root(String componentId);
    }

    private record Scope(JsonObject root, Map<String, JsonObject> byPath) {}

    private record At(JsonObject node, Scope scope) {}

    private final RegistryAccess access;
    private final Function<String, Scope> scopes;

    CodeAssistResolver(RegistryAccess access, Schemas schemas) {
        this.access = access;
        Map<String, Scope> cache = new HashMap<>();
        this.scopes = id -> cache.computeIfAbsent(id, key -> {
            JsonObject root = schemas.root(key);
            Map<String, JsonObject> index = new HashMap<>();
            indexPaths(root, index, 0);
            return new Scope(root, index);
        });
    }

    static Schemas derived(RegistryAccess access) {
        return id -> ComponentSchema.derive(id, access).root().toJson();
    }

    JsonObject resolve(Request request) {
        var out = new Candidates(request);
        At start = start(request);
        String where = request.root();
        if (start != null) {
            List<At> nodes = List.of(start);
            List<String> path = request.path();
            for (int i = 0; i < path.size() && !nodes.isEmpty(); i++) {
                // Sibling values describe the innermost object only: the key's container in value position.
                boolean container = request.keyMode() ? i == path.size() : i == path.size() - 1;
                nodes = descend(nodes, path.get(i), container ? request.values() : Map.of());
            }
            for (At at : nodes) {
                if (request.keyMode()) keys(at, request, out);
                else values(at, out);
            }
            if (!nodes.isEmpty()) where = where + ":" + type(nodes.getFirst().node());
        } else if (!request.keyMode()) {
            // Free NBT: only literals are certain.
            booleans(out);
        }
        JsonObject result = new JsonObject();
        result.add("items", out.json());
        result.addProperty("complete", !out.truncated);
        result.addProperty("where", where);
        return result;
    }

    // ---- Navigation ----

    private At start(Request request) {
        if ("stack".equals(request.root())) {
            JsonObject root = node("object");
            JsonArray fields = new JsonArray();
            JsonObject id = node("registry");
            id.addProperty("name", "id");
            id.addProperty("registry", "minecraft:item");
            fields.add(id);
            JsonObject count = node("int");
            count.addProperty("name", "count");
            count.addProperty("optional", true);
            fields.add(count);
            JsonObject components = node("component_patch");
            components.addProperty("name", "components");
            components.addProperty("optional", true);
            fields.add(components);
            root.add("fields", fields);
            return new At(root, new Scope(root, Map.of()));
        }
        if ("component".equals(request.root()) && request.component() != null) {
            Scope scope = scope(canonical(request.component()));
            return scope == null ? null : new At(scope.root(), scope);
        }
        return null;
    }

    private Scope scope(String component) {
        try {
            return scopes.apply(component);
        } catch (RuntimeException unknown) {
            return null;
        }
    }

    private static JsonObject node(String type) {
        JsonObject n = new JsonObject();
        n.addProperty("type", type);
        return n;
    }

    private static void indexPaths(JsonElement element, Map<String, JsonObject> index, int depth) {
        if (!(element instanceof JsonObject node) || depth > 40) return;
        String path = text(node, "path");
        if (path != null) index.putIfAbsent(path, node);
        for (String child : List.of("fields", "alternatives", "variants"))
            if (node.get(child) instanceof JsonArray array) array.forEach(e -> indexPaths(e, index, depth + 1));
        indexPaths(node.get("element"), index, depth + 1);
        indexPaths(node.get("key"), index, depth + 1);
    }

    private List<At> descend(List<At> from, String segment, Map<String, String> values) {
        List<At> out = new ArrayList<>();
        for (At start : from)
            for (At at : expand(start)) {
                if (out.size() >= MAX_BRANCHES) return out;
                JsonObject n = at.node();
                switch (type(n)) {
                    case "object", "typed_data" -> {
                        JsonObject field = field(n, segment);
                        if (field != null) out.add(new At(field, at.scope()));
                    }
                    case "variants" -> {
                        String discriminator = text(n, "discriminator");
                        if (segment.equals(discriminator)) out.add(new At(discriminatorNode(n), at.scope()));
                        else
                            for (JsonObject variant : variants(n, values)) {
                                JsonObject field = field(variant, segment);
                                if (field != null) out.add(new At(field, at.scope()));
                            }
                    }
                    case "list" -> {
                        if (segment.equals("[]") && n.get("element") instanceof JsonObject element)
                            out.add(new At(element, at.scope()));
                    }
                    case "map" -> {
                        if (!segment.equals("[]") && n.get("element") instanceof JsonObject element)
                            out.add(new At(element, at.scope()));
                    }
                    case "component_patch" -> {
                        // "!id" removes a component: its value is an empty compound, nothing to complete.
                        if (!segment.equals("[]") && !segment.startsWith("!")) {
                            Scope scope = scope(canonical(segment));
                            if (scope != null) out.add(new At(scope.root(), scope));
                        }
                    }
                    default -> {}
                }
            }
        return out;
    }

    /** Unions and inline-capable holders stand for each of their branches. */
    private List<At> expand(At at) {
        List<At> out = new ArrayList<>();
        expand(at, out, 0);
        return out;
    }

    private void expand(At at, List<At> out, int depth) {
        at = dereference(at);
        if (at == null || depth > 6 || out.size() >= MAX_BRANCHES) return;
        String t = type(at.node());
        JsonArray alternatives = at.node().get("alternatives") instanceof JsonArray a ? a : null;
        if (t.equals("union") && alternatives != null) {
            for (JsonElement e : alternatives)
                if (e instanceof JsonObject alt) expand(new At(alt, at.scope()), out, depth + 1);
            return;
        }
        out.add(at);
        if (t.equals("holder") && alternatives != null)
            for (JsonElement e : alternatives)
                if (e instanceof JsonObject alt) expand(new At(alt, at.scope()), out, depth + 1);
    }

    private static At dereference(At at) {
        for (int guard = 0; at != null && type(at.node()).equals("recursive_ref"); guard++) {
            String ref = text(at.node(), "ref_path");
            JsonObject target =
                    ref == null || guard > 8 ? null : at.scope().byPath().get(ref);
            at = target == null ? null : new At(target, at.scope());
        }
        return at;
    }

    private static JsonObject field(JsonObject node, String name) {
        if (!(node.get("fields") instanceof JsonArray fields)) return null;
        for (JsonElement e : fields) if (e instanceof JsonObject f && name.equals(text(f, "name"))) return f;
        return null;
    }

    private static List<JsonObject> variants(JsonObject node, Map<String, String> values) {
        List<JsonObject> all = new ArrayList<>();
        if (node.get("variants") instanceof JsonArray array)
            array.forEach(e -> {
                if (e instanceof JsonObject v) all.add(v);
            });
        String discriminator = text(node, "discriminator");
        String chosen = discriminator == null ? null : values.get(discriminator);
        if (chosen != null) {
            String wanted = canonical(chosen);
            for (JsonObject v : all) {
                String value = text(v, "discriminator_value");
                if (value != null && (value.equals(chosen) || canonical(value).equals(wanted))) return List.of(v);
            }
        }
        return all;
    }

    private static JsonObject discriminatorNode(JsonObject variants) {
        JsonObject n = node("enum");
        JsonArray values = new JsonArray();
        if (variants.get("variants") instanceof JsonArray array)
            for (JsonElement e : array)
                if (e instanceof JsonObject v && text(v, "discriminator_value") != null)
                    values.add(text(v, "discriminator_value"));
        n.add("values", values);
        return n;
    }

    // ---- Candidates ----

    private void keys(At start, Request request, Candidates out) {
        for (At at : expand(start)) {
            JsonObject n = at.node();
            switch (type(n)) {
                case "object", "typed_data" -> fields(n, request, out);
                case "variants" -> {
                    String discriminator = text(n, "discriminator");
                    if (discriminator != null && !request.siblings().contains(discriminator))
                        out.add(discriminator, "key", null, "\"\"", false, false, 0);
                    for (JsonObject variant : variants(n, request.values())) fields(variant, request, out);
                }
                case "map" -> {
                    if (n.get("key") instanceof JsonObject key) {
                        String template = template(n.get("element") instanceof JsonObject e ? e : null, at.scope());
                        for (At k : expand(new At(key, at.scope()))) mapKeys(k.node(), template, request, out);
                    }
                }
                case "component_patch" -> components(request, out);
                default -> {}
            }
        }
    }

    private void fields(JsonObject node, Request request, Candidates out) {
        if (!(node.get("fields") instanceof JsonArray fields)) return;
        int order = 0;
        for (JsonElement e : fields) {
            if (!(e instanceof JsonObject f)) continue;
            String name = text(f, "name");
            if (name == null || request.siblings().contains(name)) continue;
            boolean optional = f.has("optional") && f.get("optional").getAsBoolean();
            // Required fields first, then the codec's own declaration order.
            out.add(name, "key", null, template(f, null), optional, false, (optional ? 1000 : 0) + order++);
        }
    }

    private void mapKeys(JsonObject key, String template, Request request, Candidates out) {
        switch (type(key)) {
            case "registry", "holder" -> ids(text(key, "registry"), "key", template, request.siblings(), out);
            case "enum" -> {
                if (key.get("values") instanceof JsonArray values)
                    for (JsonElement v : values)
                        if (!request.siblings().contains(v.getAsString()))
                            out.add(v.getAsString(), "key", null, template, false, false, 0);
            }
            default -> {}
        }
    }

    private void components(Request request, Candidates out) {
        boolean removal = out.prefix.startsWith("!");
        Set<String> defaults = itemDefaults(request.item());
        Set<String> present = new HashSet<>();
        for (String sibling : request.siblings())
            present.add(canonical(sibling.startsWith("!") ? sibling.substring(1) : sibling));
        for (String id : ComponentSchema.persistentIds()) {
            if (present.contains(id)) continue;
            boolean isDefault = defaults.contains(id);
            if (removal) {
                // Only an item's prototype components can be removed; others are still allowed but ranked last.
                out.add("!" + id, "removal", null, "{}", false, isDefault, isDefault ? 0 : 500);
            } else out.add(id, "component", null, null, false, isDefault, 0);
        }
    }

    private Set<String> itemDefaults(String item) {
        Set<String> out = new HashSet<>();
        Identifier id = item == null ? null : Identifier.tryParse(canonical(item));
        if (id == null || !BuiltInRegistries.ITEM.containsKey(id)) return out;
        for (var type : BuiltInRegistries.ITEM.getValue(id).components().keySet()) {
            Identifier key = BuiltInRegistries.DATA_COMPONENT_TYPE.getKey(type);
            if (key != null) out.add(key.toString());
        }
        return out;
    }

    private void values(At start, Candidates out) {
        for (At at : expand(start)) {
            JsonObject n = at.node();
            switch (type(n)) {
                case "registry", "holder" -> ids(text(n, "registry"), "id", null, Set.of(), out);
                case "tag" -> tags(text(n, "registry"), "#".equals(text(n, "prefix")), out);
                case "holder_set" -> {
                    tags(text(n, "registry"), true, out);
                    ids(text(n, "registry"), "id", null, Set.of(), out);
                }
                case "enum" -> {
                    if (n.get("values") instanceof JsonArray values)
                        for (JsonElement v : values) out.add(v.getAsString(), "enum", null, null, false, false, 0);
                }
                case "bool" -> booleans(out);
                default -> {}
            }
        }
    }

    private static void booleans(Candidates out) {
        out.add("true", "bool", null, null, false, false, 0);
        out.add("false", "bool", null, null, false, false, 1);
    }

    private void ids(String registryId, String kind, String template, Set<String> exclude, Candidates out) {
        Registry<?> registry = registry(registryId);
        if (registry == null) return;
        String labelKind = labelKind(registryId);
        for (Identifier id : registry.keySet()) {
            String value = id.toString();
            if (exclude.contains(value)
                    || exclude.contains(id.getPath()) && id.getNamespace().equals("minecraft")) continue;
            int rank = out.rank(value);
            if (rank < 0) continue;
            out.add(
                    value,
                    kind,
                    labelKind == null ? null : () -> label(labelKind, id),
                    template,
                    false,
                    false,
                    id.getNamespace().equals("minecraft") ? 0 : 1);
        }
    }

    private void tags(String registryId, boolean hash, Candidates out) {
        Registry<?> registry = registry(registryId);
        if (registry == null) return;
        registry.getTags().forEach(tag -> {
            String value = (hash ? "#" : "") + tag.key().location();
            if (out.rank(value) >= 0) out.add(value, "tag", null, null, false, false, 2);
        });
    }

    private Registry<?> registry(String id) {
        Identifier key = id == null ? null : Identifier.tryParse(id);
        if (key == null) return null;
        for (var entry : (Iterable<RegistryAccess.RegistryEntry<?>>) access.registries()::iterator)
            if (entry.key().identifier().equals(key)) return entry.value();
        return BuiltInRegistries.REGISTRY.getValue(key);
    }

    private static String labelKind(String registry) {
        if (registry == null) return null;
        return switch (registry) {
            case "minecraft:item" -> "item";
            case "minecraft:block" -> "block";
            case "minecraft:entity_type" -> "entity";
            case "minecraft:mob_effect" -> "effect";
            case "minecraft:enchantment" -> "enchantment";
            case "minecraft:biome" -> "biome";
            default -> null;
        };
    }

    private static String label(String kind, Identifier id) {
        Language language = Language.getInstance();
        if (kind.equals("item") && BuiltInRegistries.ITEM.containsKey(id)) {
            String key = BuiltInRegistries.ITEM.getValue(id).getDescriptionId();
            if (language.has(key)) return language.getOrDefault(key);
        }
        String key = Util.makeDescriptionId(kind, id);
        if (language.has(key)) return language.getOrDefault(key);
        if (kind.equals("item")) {
            key = Util.makeDescriptionId("block", id);
            if (language.has(key)) return language.getOrDefault(key);
        }
        return null;
    }

    /** What to insert after {@code key: } so the cursor lands inside the value's opening shape. */
    private String template(JsonObject node, Scope scope) {
        if (node == null) return null;
        At at = dereference(new At(node, scope == null ? new Scope(node, Map.of()) : scope));
        if (at == null) return null;
        return switch (type(at.node())) {
            case "object", "typed_data", "variants", "nbt", "component_patch", "map", "unit" -> "{}";
            case "list" -> "[]";
            case "string", "registry", "tag", "enum", "identifier", "resource_path", "holder" -> "\"\"";
            default -> null;
        };
    }

    // ---- Helpers ----

    static String canonical(String id) {
        if (id == null) return "";
        String s = id.trim();
        if (s.startsWith("!")) s = s.substring(1);
        return s.indexOf(':') < 0 && !s.isEmpty() ? "minecraft:" + s : s;
    }

    private static String type(JsonObject node) {
        String t = text(node, "type");
        return t == null ? "" : t;
    }

    private static String text(JsonObject node, String name) {
        JsonElement e = node == null ? null : node.get(name);
        return e != null && e.isJsonPrimitive() ? e.getAsString() : null;
    }

    /** Ranked, de-duplicated, prefix-filtered rows; labels are looked up only for rows that are returned. */
    private static final class Candidates {
        private record Row(
                String value,
                String kind,
                java.util.function.Supplier<String> label,
                String template,
                boolean optional,
                boolean isDefault,
                int rank,
                int order) {}

        final String prefix;
        private final String needle;
        private final int limit;
        private final Map<String, Row> rows = new LinkedHashMap<>();
        boolean truncated;

        Candidates(Request request) {
            this.prefix = request.prefix() == null ? "" : request.prefix();
            String p = prefix.toLowerCase(Locale.ROOT);
            while (p.startsWith("!") || p.startsWith("#")) p = p.substring(1);
            this.needle = p;
            this.limit = Math.max(1, Math.min(MAX_ITEMS, request.limit()));
        }

        /** 0: the ID or its path starts with the typed text; 1: contains it; -1: no match. */
        int rank(String value) {
            if (needle.isEmpty()) return 0;
            String v = value.toLowerCase(Locale.ROOT);
            while (v.startsWith("!") || v.startsWith("#")) v = v.substring(1);
            if (v.startsWith(needle)) return 0;
            int colon = v.indexOf(':');
            if (colon >= 0 && needle.indexOf(':') < 0 && v.startsWith(needle, colon + 1)) return 0;
            return v.contains(needle) ? 1 : -1;
        }

        void add(
                String value,
                String kind,
                java.util.function.Supplier<String> label,
                String template,
                boolean optional,
                boolean isDefault,
                int order) {
            int match = rank(value);
            if (match < 0 || rows.containsKey(value)) return;
            if (rows.size() >= 4096) {
                truncated = true;
                return;
            }
            rows.put(value, new Row(value, kind, label, template, optional, isDefault, match, order));
        }

        JsonArray json() {
            List<Row> sorted = new ArrayList<>(rows.values());
            sorted.sort((a, b) -> {
                if (a.rank != b.rank) return Integer.compare(a.rank, b.rank);
                if (a.isDefault != b.isDefault) return a.isDefault ? -1 : 1;
                if (a.order != b.order) return Integer.compare(a.order, b.order);
                return a.kind.equals("key") && b.kind.equals("key") ? 0 : a.value.compareTo(b.value);
            });
            JsonArray out = new JsonArray();
            for (Row row : sorted) {
                if (out.size() >= limit) {
                    truncated = true;
                    break;
                }
                JsonObject o = new JsonObject();
                o.addProperty("v", row.value);
                o.addProperty("k", row.kind);
                String label = row.label == null ? null : row.label.get();
                if (label != null && !label.isEmpty() && !label.equals(row.value)) o.addProperty("d", label);
                if (row.template != null) o.addProperty("t", row.template);
                if (row.optional) o.addProperty("o", true);
                if (row.isDefault) o.addProperty("df", true);
                out.add(o);
            }
            return out;
        }
    }
}
