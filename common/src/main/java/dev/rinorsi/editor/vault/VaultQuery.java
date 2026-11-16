package dev.rinorsi.editor.vault;

import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.registry.search.Pinyin;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Vault search syntax. Recognised {@code field:value} prefixes combine with AND, a leading {@code -} negates one
 * condition, quotes keep spaces in a value. Words without a recognised prefix keep the original substring and pinyin
 * matching, so {@code minecraft:stone} is still a plain word. Nothing here decodes an item: lore comes from the
 * plain-text index written when the entry was saved.
 */
public final class VaultQuery {
    /** Field prefixes in the order the page offers them. {@code amount} and {@code bytes} are aliases. */
    public static final List<String> FIELDS = List.of(
            "item", "name", "lore", "tag", "note", "count", "amount", "size", "saved", "updated", "page", "kind");

    private static final Map<String, String> ALIASES = Map.of("amount", "count", "bytes", "size");
    private static final Map<String, String> KINDS = Map.of(
            "item", "item",
            "entity", "entity",
            "block", "block",
            "player_preset", "player_preset",
            "player", "player_preset",
            "preset", "player_preset");
    private static final Pattern COUNT = Pattern.compile("\\d{1,10}");
    private static final Pattern SIZE = Pattern.compile("(\\d{1,10}(?:\\.\\d{1,3})?)(b|k|kb|kib|m|mb|mib)?");
    private static final Pattern AGE = Pattern.compile("(\\d{1,6}(?:\\.\\d{1,3})?)(m|h|d)");

    /** What one entry exposes to the matcher; all text is compared case-insensitively. */
    public interface Subject {
        String kind();

        /** Full registry ID: item, entity type or block; {@code minecraft:player} for presets. */
        String itemId();

        String name();

        /** Current-language name, may be empty. */
        String translated();

        /** Plain-text lore index, may be empty. */
        String lore();

        List<String> tags();

        String note();

        long count();

        long bytes();

        long created();

        long updated();

        String pageId();

        String pageName();

        /** Lowercase text the original search matched (name, note, tags, ID, translated name). */
        String haystack();
    }

    private record Term(String field, String text, Pattern glob, long min, long max, boolean negate) {}

    private final List<Term> terms;
    private final List<String> words;
    private final String bare;
    private final long now;

    private VaultQuery(List<Term> terms, List<String> words, long now) {
        this.terms = terms;
        this.words = words;
        this.bare = String.join(" ", words);
        this.now = now;
    }

    public boolean isEmpty() {
        return terms.isEmpty() && words.isEmpty();
    }

    /** {@code now} anchors relative ages ({@code saved:<7d}); it is the store clock, not wall time. */
    public static VaultQuery parse(String text, long now) {
        List<Term> terms = new ArrayList<>();
        List<String> words = new ArrayList<>();
        int i = 0, n = text.length();
        while (i < n) {
            if (Character.isWhitespace(text.charAt(i))) {
                i++;
                continue;
            }
            boolean negate = false;
            if (text.charAt(i) == '-' && i + 1 < n && !Character.isWhitespace(text.charAt(i + 1))) {
                negate = true;
                i++;
            }
            StringBuilder value = new StringBuilder();
            String field = null;
            boolean quoted = false;
            while (i < n && !Character.isWhitespace(text.charAt(i))) {
                char c = text.charAt(i);
                if ((c == '"' || c == '\'') && value.length() == 0 && !quoted) {
                    int end = text.indexOf(c, i + 1);
                    if (end < 0)
                        throw new VaultStore.Failure(
                                "BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultquery.unclosed_quote"));
                    value.append(text, i + 1, end);
                    quoted = true;
                    i = end + 1;
                    continue;
                }
                if (c == ':' && field == null && !quoted) {
                    String prefix = value.toString().toLowerCase(Locale.ROOT);
                    if (FIELDS.contains(prefix) || ALIASES.containsKey(prefix)) {
                        field = ALIASES.getOrDefault(prefix, prefix);
                        value.setLength(0);
                        i++;
                        continue;
                    }
                }
                value.append(c);
                i++;
            }
            String v = value.toString().strip().toLowerCase(Locale.ROOT);
            if (v.isEmpty()) continue; // "item:" while typing, or an empty pair of quotes.
            if (field == null) {
                if (negate) terms.add(new Term("", v, null, 0, 0, true));
                else words.add(v);
                continue;
            }
            terms.add(term(field, v, negate, now));
        }
        return new VaultQuery(List.copyOf(terms), List.copyOf(words), now);
    }

    private static Term term(String field, String v, boolean negate, long now) {
        return switch (field) {
            case "count" -> {
                long[] r = range(v, field, s -> COUNT.matcher(s).matches() ? Long.parseLong(s) : -1, false);
                yield new Term(field, v, null, r[0], r[1], negate);
            }
            case "size" -> {
                long[] r = range(v, field, VaultQuery::size, false);
                yield new Term(field, v, null, r[0], r[1], negate);
            }
            case "saved", "updated" -> {
                long[] r = range(v, field, VaultQuery::age, true);
                yield new Term(field, v, null, r[0], r[1], negate);
            }
            case "kind" -> {
                String kind = KINDS.get(v);
                if (kind == null)
                    throw new VaultStore.Failure(
                            "BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultquery.bad_kind", v));
                yield new Term(field, kind, null, 0, 0, negate);
            }
            default -> new Term(field, v, v.indexOf('*') >= 0 ? glob(v) : null, 0, 0, negate);
        };
    }

    private static Pattern glob(String v) {
        StringBuilder out = new StringBuilder();
        int start = 0;
        for (int i = 0; i <= v.length(); i++) {
            if (i < v.length() && v.charAt(i) != '*') continue;
            if (i > start) out.append(Pattern.quote(v.substring(start, i)));
            if (i < v.length()) out.append(".*");
            start = i + 1;
        }
        return Pattern.compile(out.toString());
    }

    private static long size(String s) {
        Matcher m = SIZE.matcher(s);
        if (!m.matches()) return -1;
        double base = Double.parseDouble(m.group(1));
        String unit = m.group(2) == null ? "b" : m.group(2);
        double scale = unit.startsWith("m") ? 1024d * 1024d : unit.startsWith("k") ? 1024d : 1d;
        return Math.round(base * scale);
    }

    private static long age(String s) {
        Matcher m = AGE.matcher(s);
        if (!m.matches()) return -1;
        double base = Double.parseDouble(m.group(1));
        long unit = switch (m.group(2)) {
            case "m" -> 60_000L;
            case "h" -> 3_600_000L;
            default -> 86_400_000L;
        };
        return Math.round(base * unit);
    }

    @FunctionalInterface
    private interface Amount {
        long parse(String text);
    }

    /**
     * {@code N}, {@code =N}, {@code >N}, {@code >=N}, {@code <N}, {@code <=N} or {@code A-B}; inclusive bounds. A bare
     * age means "within", so {@code saved:7d} reads like {@code saved:<=7d}.
     */
    private static long[] range(String v, String field, Amount number, boolean ages) {
        long min = 0, max = Long.MAX_VALUE;
        String op = v.startsWith(">=") || v.startsWith("<=") ? v.substring(0, 2) : v.substring(0, 1);
        if (!op.equals(">=") && !op.equals("<=") && !op.equals(">") && !op.equals("<") && !op.equals("=")) op = "";
        String rest = v.substring(op.length());
        int dash = op.isEmpty() ? rest.indexOf('-') : -1;
        if (dash > 0) {
            long a = number.parse(rest.substring(0, dash)), b = number.parse(rest.substring(dash + 1));
            if (a < 0 || b < 0) throw bad(field, ages);
            return new long[] {Math.min(a, b), Math.max(a, b)};
        }
        long x = number.parse(rest);
        if (x < 0) throw bad(field, ages);
        switch (op) {
            case ">" -> min = x == Long.MAX_VALUE ? x : x + 1;
            case ">=" -> min = x;
            case "<" -> max = x - 1;
            case "<=" -> max = x;
            case "=" -> min = max = x;
            default -> {
                if (ages) max = x;
                else min = max = x;
            }
        }
        if (max < min) max = min - 1; // "<0": nothing matches, still a valid query.
        return new long[] {min, max};
    }

    private static VaultStore.Failure bad(String field, boolean ages) {
        String key = ages
                ? "cadeditor.message.vaultquery.bad_age"
                : field.equals("size")
                        ? "cadeditor.message.vaultquery.bad_size"
                        : "cadeditor.message.vaultquery.bad_count";
        return new VaultStore.Failure("BAD_REQUEST", EditorI18n.tr(key, field + ":"));
    }

    public boolean matches(Subject s, Pinyin pinyin) {
        for (Term t : terms) if (test(t, s, pinyin) == t.negate()) return false;
        if (words.isEmpty()) return true;
        String hay = s.haystack();
        if (text(hay, bare, pinyin)) return true;
        for (String w : words) if (!text(hay, w, pinyin)) return false;
        return true;
    }

    private static boolean text(String hay, String v, Pinyin pinyin) {
        if (hay == null || hay.isEmpty()) return false;
        String lower = hay.toLowerCase(Locale.ROOT);
        return lower.contains(v) || (pinyin != null && pinyin.matches(lower, v));
    }

    private static boolean within(long value, Term t) {
        return value >= t.min() && value <= t.max();
    }

    private boolean test(Term t, Subject s, Pinyin pinyin) {
        return switch (t.field()) {
            case "" -> text(s.haystack(), t.text(), pinyin);
            case "item" -> {
                String id = s.itemId().toLowerCase(Locale.ROOT);
                String path = id.indexOf(':') >= 0 ? id.substring(id.indexOf(':') + 1) : id;
                yield t.glob() != null
                        ? t.glob().matcher(id).matches()
                                || t.glob().matcher(path).matches()
                        : id.startsWith(t.text()) || path.startsWith(t.text());
            }
            case "name" -> text(s.name(), t.text(), pinyin) || text(s.translated(), t.text(), pinyin);
            case "lore" -> text(s.lore(), t.text(), pinyin);
            case "note" -> text(s.note(), t.text(), pinyin);
            case "tag" -> {
                for (String tag : s.tags()) {
                    if (t.glob() != null
                            ? t.glob().matcher(tag.toLowerCase(Locale.ROOT)).matches()
                            : text(tag, t.text(), pinyin)) yield true;
                }
                yield false;
            }
            case "page" -> s.pageId().equals(t.text()) || text(s.pageName(), t.text(), pinyin);
            case "kind" -> s.kind().equals(t.text());
            case "count" -> within(s.count(), t);
            case "size" -> within(s.bytes(), t);
            case "saved" -> within(Math.max(0, now - s.created()), t);
            case "updated" -> within(Math.max(0, now - s.updated()), t);
            default -> false;
        };
    }
}
