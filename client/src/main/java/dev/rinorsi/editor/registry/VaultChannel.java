package dev.rinorsi.editor.registry;

import com.google.gson.*;
import dev.oriel.mod.client.DocumentDriver;
import dev.rinorsi.editor.EditorI18n;
import dev.rinorsi.editor.EditorPackets;
import dev.rinorsi.editor.StackCodec;
import dev.rinorsi.editor.client.ClientInventoryCommands;
import dev.rinorsi.editor.client.EditorToast;
import dev.rinorsi.editor.client.HotbarCommandCodec;
import dev.rinorsi.editor.client.HotbarCommandSession;
import dev.rinorsi.editor.platform.ClientPlatform;
import dev.rinorsi.editor.platform.Platform;
import dev.rinorsi.editor.registry.search.Pinyin;
import dev.rinorsi.editor.vault.*;
import java.util.*;
import java.util.concurrent.*;
import net.minecraft.client.Minecraft;
import net.minecraft.network.protocol.game.ServerboundSetCreativeModeSlotPacket;

/** Local storage. Only explicit give can send a detached stack to the current server. */
public final class VaultChannel {
    private static final Map<DocumentDriver, State> STATES = new WeakHashMap<>();
    private static boolean initialized;
    private static CompletableFuture<VaultStore> store;
    private static Object validatorWorld, validatorLanguage;
    private static VaultStore.Validator activeValidator;
    private static Object reservationPlayer;
    private static final Set<Integer> reservedSlots = new HashSet<>();

    private record PendingGive(
            DocumentDriver driver, Object document, Object connection, String pageId, String entryId, long deadline) {}

    private static final Map<String, PendingGive> GIVES = new HashMap<>();
    private static final Map<String, HotbarCommandSession> COMMAND_GIVES = new HashMap<>();

    private static final class State {
        Object document;
        long second;
        int requests;
        final LinkedHashMap<String, JsonObject> lists = new LinkedHashMap<>();
        String uploadToken;
        StringBuilder upload;
        long uploadUntil;
        final LinkedHashMap<String, JsonObject> giveReplies = new LinkedHashMap<>();
    }

    private VaultChannel() {}

    public static PlayerPresetPage openPlayerPreset(String id) {
        var level = Minecraft.getInstance().level;
        if (level == null)
            throw new VaultStore.Failure(
                    "UNAVAILABLE", EditorI18n.tr("cadeditor.message.vaultchannel.edit_player_preset_after_entering"));
        if (store == null || !store.isDone())
            throw new VaultStore.Failure(
                    "NOT_READY", EditorI18n.tr("cadeditor.message.vaultchannel.vault_still_loaded_try_again"));
        return new PlayerPresetPage(store.join(), validator(), level, id);
    }

    public static void attach(DocumentDriver driver) {
        if (driver.serverSession() || STATES.containsKey(driver)) return;
        STATES.put(driver, new State());
        dev.rinorsi.editor.client.WorldEditorClient.attachNavigation(driver);
        driver.onMessage("vault", value -> accept(driver, value));
        driver.onClose(() -> {
            STATES.remove(driver);
            flushNow();
        });
        if (!initialized) {
            initialized = true;
            store = CompletableFuture.supplyAsync(() -> {
                try {
                    VaultStore loaded = new VaultStore(
                            VaultPaths.file(),
                            net.minecraft.SharedConstants.getCurrentVersion()
                                    .dataVersion()
                                    .version(),
                            Platform.get().modVersion("cadeditor"),
                            new Pinyin(
                                    VaultChannel.class.getResourceAsStream("/assets/cadeditor/ui/js/pinyin-data.js")),
                            System::currentTimeMillis);
                    loaded.migrateFrom(Platform.get().configDir().resolve("cadeditor/vault.json"));
                    if (!loaded.flushNow())
                        System.getLogger(VaultChannel.class.getName())
                                .log(
                                        System.Logger.Level.WARNING,
                                        EditorI18n.tr(
                                                "cadeditor.message.vaultchannel.global_vault_initializes_existence_open"));
                    return loaded;
                } catch (Exception e) {
                    throw new CompletionException(e);
                }
            });
            ClientPlatform.get().onTick(mc -> tick());
            ClientPlatform.get().onDisconnect(mc -> flushNow());
            ClientPlatform.get().onStopping(mc -> {
                try {
                    VaultStore.awaitReady(store, VaultStore.FLUSH_TIMEOUT_MS).close();
                } catch (RuntimeException failure) {
                    System.getLogger(VaultChannel.class.getName())
                            .log(
                                    System.Logger.Level.WARNING,
                                    EditorI18n.tr(
                                            "cadeditor.message.vaultchannel.vault_exit_saving_failed", (failure)));
                }
            });
        }
    }

    private static void reset(DocumentDriver d, State s) {
        if (s.document != d.document()) {
            s.document = d.document();
            s.lists.clear();
            s.requests = 0;
            s.upload = null;
            s.uploadToken = null;
            s.giveReplies.clear();
        }
    }

    private static void accept(DocumentDriver driver, JsonElement message) {
        var mc = Minecraft.getInstance();
        if (!mc.isSameThread()) {
            JsonElement detached = message == null ? null : message.deepCopy();
            mc.execute(() -> accept(driver, detached));
            return;
        }
        State s = STATES.get(driver);
        if (s == null || driver.serverSession()) return;
        reset(driver, s);
        String id = "", op = "";
        try {
            if (message == null || !message.isJsonObject() || message.toString().length() > 8192)
                throw new VaultStore.Failure(
                        "BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultchannel.request_up_8192_characters"));
            VaultStore.checkDepth(message);
            JsonObject r = message.getAsJsonObject();
            id = VaultStore.text(r, "requestId", "", 128);
            op = VaultStore.text(r, "op", "", 32);
            String view = VaultStore.text(r, "view", "vault", 128);
            if (id.isEmpty() || view.isEmpty())
                throw new VaultStore.Failure(
                        "BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultchannel.requestid_view_missing"));
            if (op.equals("list")) {
                if (!s.lists.containsKey(view) && s.lists.size() >= 8)
                    throw new VaultStore.Failure(
                            "BUSY", EditorI18n.tr("cadeditor.message.vaultchannel.up_8_fixed_view"));
                s.lists.put(view, null);
            }
            long second = System.nanoTime() / 1_000_000_000L;
            if (second != s.second) {
                s.second = second;
                s.requests = 0;
            }
            if (++s.requests > 20)
                throw new VaultStore.Failure(
                        "BUSY", EditorI18n.tr("cadeditor.message.vaultchannel.up_every_second_20_number"));
            if (store == null || !store.isDone())
                throw new VaultStore.Failure(
                        "NOT_READY", EditorI18n.tr("cadeditor.message.vaultchannel.loading_local_vault_try_again"));
            if (store.isCompletedExceptionally())
                throw new VaultStore.Failure(
                        "STORAGE_FAILED", EditorI18n.tr("cadeditor.message.vaultchannel.vault_loading_failed"));
            if (op.equals("list")) {
                s.lists.put(view, r.deepCopy());
                return;
            }
            reply(driver, r, s);
        } catch (RuntimeException e) {
            error(driver, id, op, e);
        }
    }

    private static VaultStore.Validator validator() {
        var mc = Minecraft.getInstance();
        Object language = net.minecraft.locale.Language.getInstance();
        if (activeValidator == null || validatorWorld != mc.level || validatorLanguage != language) {
            if (store != null && store.isDone() && !store.isCompletedExceptionally())
                store.join().invalidateRows();
            validatorWorld = mc.level;
            validatorLanguage = language;
            var level = mc.level;
            activeValidator = stack -> {
                if (level == null)
                    throw new VaultStore.Failure(
                            "UNAVAILABLE",
                            EditorI18n.tr("cadeditor.message.vaultchannel.item_component_cannot_deconstructed"));
                return VaultStacks.validate(stack, level.registryAccess());
            };
        }
        return activeValidator;
    }

    /** Close/disconnect must not discard pending writes, and must not wait forever. */
    public static boolean flushNow() {
        if (store == null) return true;
        try {
            return VaultStore.awaitReady(store, VaultStore.FLUSH_TIMEOUT_MS).flushNow();
        } catch (RuntimeException failure) {
            System.getLogger(VaultChannel.class.getName())
                    .log(
                            System.Logger.Level.WARNING,
                            EditorI18n.tr("cadeditor.message.vaultchannel.vault_flush_failed", (failure)));
            return false;
        }
    }

    private static void tick() {
        validator();
        VaultHostOps.tick(store != null && store.isDone() && !store.isCompletedExceptionally() ? store.join() : null);
        refreshReservations();
        for (var entry : new ArrayList<>(GIVES.entrySet())) {
            var pending = entry.getValue();
            var mc = Minecraft.getInstance();
            var command = COMMAND_GIVES.get(entry.getKey());
            if (command != null) {
                boolean live = STATES.containsKey(pending.driver) && pending.driver.document() == pending.document;
                var outcome = command.observe(
                        live ? ClientInventoryCommands.context(mc, command.index()) : null,
                        pending.pageId,
                        System.nanoTime());
                if (outcome == HotbarCommandSession.Outcome.WAITING) continue;
                COMMAND_GIVES.remove(entry.getKey());
                boolean saved = outcome == HotbarCommandSession.Outcome.SAVED;
                if (saved) GIVES.remove(entry.getKey());
                else
                    GIVES.put(
                            entry.getKey(),
                            new PendingGive(
                                    pending.driver,
                                    pending.document,
                                    pending.connection,
                                    pending.pageId,
                                    pending.entryId,
                                    Long.MAX_VALUE));
                var result = new JsonObject();
                result.addProperty("path", "command");
                result.addProperty("confirmed", saved);
                result.addProperty("status", saved ? "saved" : "unknown");
                result.addProperty("inventoryIndex", command.index());
                giveReply(
                        pending,
                        saved,
                        saved ? "ok" : "request_timeout",
                        saved
                                ? EditorI18n.tr(
                                        "cadeditor.message.vaultchannel.server_confirmed_sync_own_inventory",
                                        ((command.index() + 1)))
                                : EditorI18n.tr("cadeditor.message.vaultchannel.retrieve_result_unknown_slot_changed"),
                        result);
                continue;
            }
            if (mc.getConnection() != pending.connection || System.nanoTime() > pending.deadline) {
                // A MAX_VALUE record is an already-reported unknown tombstone, not a live request.
                if (pending.deadline == Long.MAX_VALUE) {
                    GIVES.remove(entry.getKey());
                    continue;
                }
                if (mc.getConnection() != pending.connection) GIVES.remove(entry.getKey());
                else
                    GIVES.put(
                            entry.getKey(),
                            new PendingGive(
                                    pending.driver,
                                    pending.document,
                                    pending.connection,
                                    pending.pageId,
                                    pending.entryId,
                                    Long.MAX_VALUE));
                giveReply(
                        pending,
                        false,
                        mc.getConnection() != pending.connection ? "not_connected" : "request_timeout",
                        mc.getConnection() != pending.connection
                                ? EditorI18n.tr(
                                        "cadeditor.message.vaultchannel.connection_disconnected_check_inventory")
                                : EditorI18n.tr("cadeditor.message.vaultchannel.retrieve_response_received_result"),
                        null);
            }
        }
        for (var entry : List.copyOf(STATES.entrySet())) {
            var driver = entry.getKey();
            var s = entry.getValue();
            reset(driver, s);
            if (s.upload != null && System.currentTimeMillis() >= s.uploadUntil) {
                s.upload = null;
                s.uploadToken = null;
            }
            for (var view : new ArrayList<>(s.lists.entrySet())) {
                JsonObject r = view.getValue();
                if (r == null) continue;
                try {
                    if (!store.join().warm(validator(), 8)) return;
                    s.lists.put(view.getKey(), null);
                    reply(driver, r, s);
                } catch (RuntimeException e) {
                    s.lists.put(view.getKey(), null);
                    error(driver, VaultStore.text(r, "requestId", "", 128), "list", e);
                }
                return;
            }
        }
    }

    /** Late replies (imports, backups) only go to a page that is still attached. */
    static boolean live(DocumentDriver driver) {
        return STATES.containsKey(driver);
    }

    private static void reply(DocumentDriver driver, JsonObject r, State s) {
        String op = VaultStore.text(r, "op", "", 32);
        JsonObject result;
        if (VaultHostOps.handles(op)) {
            result = VaultHostOps.reply(driver, r, store.join());
            if (result == null) return; // Answered later from the background/tick.
        } else if (op.equals("upload")) {
            long now = System.currentTimeMillis();
            String token = VaultStore.text(r, "token", "", 36);
            String chunk = VaultStore.text(r, "text", "", 6000);
            if (token.isEmpty()) {
                s.upload = new StringBuilder();
                s.uploadToken = UUID.randomUUID().toString();
            } else if (!token.equals(s.uploadToken) || s.upload == null || now >= s.uploadUntil)
                throw new VaultStore.Failure(
                        "UPLOAD_EXPIRED", EditorI18n.tr("cadeditor.message.vaultchannel.upload_expired"));
            if (s.upload.length() + chunk.length() > VaultStore.MAX_FILE_BYTES) {
                s.upload = null;
                s.uploadToken = null;
                throw new VaultStore.Failure(
                        "FILE_LIMIT", EditorI18n.tr("cadeditor.message.vaultchannel.upload_up_64_mi_characters"));
            }
            s.upload.append(chunk);
            s.uploadUntil = now + 30000;
            result = new JsonObject();
            result.addProperty("ok", true);
            result.addProperty("version", 1);
            result.addProperty("op", op);
            result.addProperty("requestId", VaultStore.text(r, "requestId", "", 128));
            result.addProperty("token", s.uploadToken);
            result.addProperty("chars", s.upload.length());
            result.addProperty("expires", s.uploadUntil);
        } else if (op.equals("give")) {
            String pageId = VaultStore.text(r, "requestId", "", 128);
            if (s.giveReplies.containsKey(pageId)) {
                driver.patch("vault.result", s.giveReplies.get(pageId));
                return;
            }
            if (s.giveReplies.size() >= 4096)
                throw new VaultStore.Failure(
                        "rate_limited",
                        EditorI18n.tr("cadeditor.message.vaultchannel.too_many_requests_page_retrieve"));
            if (r.has("uploadToken")) {
                // A new item larger than one page request arrives as an upload, like a large vault save.
                String token = VaultStore.text(r, "uploadToken", "", 36);
                if (!token.equals(s.uploadToken) || s.upload == null || System.currentTimeMillis() >= s.uploadUntil)
                    throw new VaultStore.Failure(
                            "UPLOAD_EXPIRED", EditorI18n.tr("cadeditor.message.vaultchannel.upload_expired"));
                r = r.deepCopy();
                r.add("stack", VaultStore.parse(s.upload.toString()));
                s.upload = null;
                s.uploadToken = null;
            }
            JsonObject wire = giveStack(r);
            String entryId = r.has("stack") ? inlineGiveKey(wire) : VaultStore.text(r, "id", "", 36);
            for (var pending : GIVES.values())
                if (pending.connection == Minecraft.getInstance().getConnection()
                        && ((pending.driver == driver && pending.pageId.equals(pageId))
                                || pending.entryId.equals(entryId))) {
                    if (pending.driver == driver && pending.pageId.equals(pageId)) return;
                    throw new VaultStore.Failure(
                            "request_pending",
                            EditorI18n.tr("cadeditor.message.vaultchannel.retrieve_same_entry_awaits_server"));
                }
            result = give(driver, r, wire, entryId);
            if (result == null) return;
            remember(s, pageId, result);
        } else {
            if (r.has("uploadToken")) {
                if (!Set.of("save", "import", "preview", "has_backup").contains(op))
                    throw new VaultStore.Failure(
                            "BAD_REQUEST",
                            EditorI18n.tr("cadeditor.message.vaultchannel.upload_only_supports_save_import"));
                String token = VaultStore.text(r, "uploadToken", "", 36);
                if (!token.equals(s.uploadToken) || s.upload == null || System.currentTimeMillis() >= s.uploadUntil)
                    throw new VaultStore.Failure(
                            "UPLOAD_EXPIRED", EditorI18n.tr("cadeditor.message.vaultchannel.upload_expired"));
                JsonObject payload = VaultStore.parse(s.upload.toString());
                r = r.deepCopy();
                if (op.equals("has_backup")
                        || op.equals("preview")
                        || (op.equals("save") && VaultTemplates.supported(VaultStore.text(r, "kind", "item", 16)))) {
                    for (String key : List.of("world", "template", "sections"))
                        if (payload.has(key) && !(op.equals("has_backup") && key.equals("sections") && r.has(key)))
                            r.add(key, payload.get(key));
                } else if (op.equals("save")) {
                    if (VaultStore.text(r, "kind", "item", 16).equals("entity"))
                        r.addProperty("snbt", VaultStore.text(payload, "snbt", "", VaultStore.MAX_FILE_BYTES));
                    else r.add("stack", payload);
                } else {
                    r.add("entries", payload.get("entries"));
                    if (payload.has("version")) r.add("version", payload.get("version"));
                } /* Keep upload for subsequent import pages; expires after 30 seconds idle. */
                s.uploadUntil = System.currentTimeMillis() + 30000;
            }
            if (op.equals("save")
                    && VaultStore.text(r, "kind", "item", 16).equals("item")
                    && Minecraft.getInstance().level == null)
                throw new VaultStore.Failure(
                        "UNAVAILABLE", EditorI18n.tr("cadeditor.message.vaultchannel.save_needs_enter_world_rigorous"));
            result = store.join().execute(r, validator(), VaultHostOps.upgrader());
        }
        var mc = Minecraft.getInstance();
        result.addProperty(
                "giveCapability",
                mc.player != null && mc.player.isCreative()
                        ? EditorI18n.tr("cadeditor.message.vaultchannel.creative_mode_retrieve_own_inventory")
                        : dev.rinorsi.editor.client.ServerLink.connected()
                                ? EditorI18n.tr("cadeditor.message.vaultchannel.retrieve_requires_server_authorization")
                                : ClientInventoryCommands.closed(mc)
                                        ? dev.rinorsi.editor.client.VanillaWriteRule.vaultCapability()
                                        : EditorI18n.tr(
                                                "cadeditor.message.vaultchannel.retrieve_only_placed_empty_slot",
                                                (ClientInventoryCommands.capabilityHint(mc))));
        driver.patchJson("vault.result", result.toString());
    }

    /**
     * The stack to give: a vault entry ({@code id}, entity kinds rejected before permission/connection checks) or a
     * new item drafted on the page ({@code stack}, decoded strictly here and handed on in canonical form). Both take
     * the same give path: empty slots only, the same confirmations, and on an editor server its permission node and
     * item rules.
     */
    private static JsonObject giveStack(JsonObject r) {
        if (!r.has("stack")) return store.join().stack(VaultStore.text(r, "id", "", 36));
        var level = Minecraft.getInstance().level;
        if (level == null)
            throw new VaultStore.Failure(
                    "UNAVAILABLE", EditorI18n.tr("cadeditor.message.worldeditorclient.currently_world"));
        if (!r.get("stack").isJsonObject())
            throw new VaultStore.Failure(
                    "INVALID_STACK", EditorI18n.tr("cadeditor.message.vaultchannel.new_item_invalid"));
        net.minecraft.world.item.ItemStack stack;
        try {
            stack = StackCodec.decode(r.getAsJsonObject("stack"), level.registryAccess());
        } catch (RuntimeException invalid) {
            throw new VaultStore.Failure("INVALID_STACK", VaultStore.reason(invalid));
        }
        if (stack.isEmpty())
            throw new VaultStore.Failure(
                    "INVALID_STACK", EditorI18n.tr("cadeditor.message.vaultchannel.new_item_invalid"));
        var wire = StackCodec.snapshot(stack, level.registryAccess(), new JsonObject(), "");
        wire.remove("slot");
        wire.remove("label");
        return wire;
    }

    /** In-flight and unknown-outcome locks for a new item work like a vault entry's: the same stack is not resent. */
    private static String inlineGiveKey(JsonObject wire) {
        return "new-" + UUID.nameUUIDFromBytes(wire.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    private static JsonObject give(DocumentDriver driver, JsonObject r, JsonObject wire, String entryId) {
        var mc = Minecraft.getInstance();
        if (mc.player == null || mc.level == null || mc.getConnection() == null)
            throw new VaultStore.Failure(
                    "UNAVAILABLE", EditorI18n.tr("cadeditor.message.worldeditorclient.currently_world"));
        if (dev.rinorsi.editor.client.ServerLink.state() == dev.rinorsi.editor.client.ServerLink.State.PROBING)
            throw new VaultStore.Failure("handshake_pending", EditorI18n.tr("cadeditor.message.serverlink.pending"));
        boolean editorServer = dev.rinorsi.editor.client.ServerLink.connected();
        if (InventoryWrites.givePath(mc.player.isCreative(), editorServer) != InventoryWrites.GivePath.CREATIVE) {
            if (!editorServer) return commandGive(driver, r, wire, entryId);
            var request = new JsonObject();
            if (GIVES.size() >= 8)
                throw new VaultStore.Failure(
                        "request_pending",
                        EditorI18n.tr("cadeditor.message.vaultchannel.n8_retrieve_response_most_check"));
            String networkId = "vault-give-" + UUID.randomUUID();
            request.addProperty("op", "vault_give");
            request.addProperty("requestId", networkId);
            request.add("stack", wire.deepCopy());
            request.addProperty("slot", VaultStore.text(r, "slot", "inventory", 16));
            if (r.has("inventoryIndex"))
                request.add("inventoryIndex", r.get("inventoryIndex").deepCopy());
            String json = request.toString();
            dev.rinorsi.editor.EditorWire.requirePayload(json);
            GIVES.put(
                    networkId,
                    new PendingGive(
                            driver,
                            driver.document(),
                            mc.getConnection(),
                            VaultStore.text(r, "requestId", "", 128),
                            entryId,
                            System.nanoTime() + 10_000_000_000L));
            try {
                ClientPlatform.get().send(new EditorPackets.Request(json));
            } catch (RuntimeException failure) {
                GIVES.remove(networkId);
                throw failure;
            }
            return null;
        }
        String target = VaultStore.text(r, "slot", "inventory", 16);
        if (target.equals("cursor"))
            throw new VaultStore.Failure(
                    "UNSUPPORTED_SLOT",
                    EditorI18n.tr("cadeditor.message.vaultchannel.secure_vanilla_minecraft_cursor_returns"));
        if (!Set.of("inventory", "hotbar").contains(target))
            throw new VaultStore.Failure("BAD_REQUEST", EditorI18n.tr("cadeditor.message.vaultchannel.slot_invalid"));
        // Never overwrite an item or write into a currently open container.
        if (mc.player.containerMenu != mc.player.inventoryMenu)
            throw new VaultStore.Failure(
                    "NOT_ALLOWED", EditorI18n.tr("cadeditor.message.vaultchannel.close_container_ui_first"));
        net.minecraft.world.item.ItemStack stack;
        try {
            stack = StackCodec.decode(wire, mc.level.registryAccess());
        } catch (RuntimeException invalid) {
            throw new VaultStore.Failure("INVALID_STACK", VaultStore.reason(invalid));
        }
        refreshReservations();
        int requestedIndex = r.has("inventoryIndex") ? StackCodec.integer(r, "inventoryIndex", 0, 35) : -1;
        if (requestedIndex >= 0
                && !mc.player.getInventory().getItem(requestedIndex).isEmpty())
            throw new VaultStore.Failure(
                    "slot_changed",
                    EditorI18n.tr("cadeditor.message.hotbarcommandcodec.specifies_slot_occupied_previous_item"));
        int from = target.equals("hotbar") ? 0 : 9, to = target.equals("hotbar") ? 9 : 36;
        var slot = mc.player.inventoryMenu.slots.stream()
                .filter(v -> v.container == mc.player.getInventory()
                        && (requestedIndex >= 0
                                ? v.getContainerSlot() == requestedIndex
                                : v.getContainerSlot() >= from && v.getContainerSlot() < to)
                        && v.index >= 1
                        && v.index <= 45
                        && !reservedSlots.contains(v.getContainerSlot())
                        && !v.hasItem())
                .findFirst()
                .orElseThrow(() -> new VaultStore.Failure(
                        "INVENTORY_FULL", EditorI18n.tr("cadeditor.message.vaultchannel.target_area_open_slot")));
        mc.player.connection.send(new ServerboundSetCreativeModeSlotPacket(slot.index, stack));
        // Creative inventory ignores ordinary server refreshes: update the owned client inventory too.
        mc.player.getInventory().setItem(slot.getContainerSlot(), stack.copy());
        mc.player.getInventory().setChanged();
        // Client inventory is visibly occupied immediately; never claim server acknowledgement.
        reservedSlots.add(slot.getContainerSlot());
        JsonObject out = new JsonObject();
        out.addProperty("version", 1);
        out.addProperty("ok", true);
        out.addProperty("op", "give");
        out.addProperty("requestId", VaultStore.text(r, "requestId", "", 128));
        out.addProperty("status", "sent");
        out.addProperty("confirmed", false);
        out.addProperty("inventoryIndex", slot.getContainerSlot());
        out.addProperty("creativeSlot", slot.index);
        out.addProperty("code", "ok");
        out.addProperty("path", "creative");
        var item = new JsonObject();
        item.addProperty("id", wire.get("id").getAsString());
        item.addProperty("count", stack.getCount());
        out.add("item", item);
        out.addProperty(
                "reason",
                slot.getContainerSlot() < 9
                        ? EditorI18n.tr(
                                "cadeditor.message.vaultchannel.grid_hotbar_client_already_display",
                                ((slot.getContainerSlot() + 1)))
                        : EditorI18n.tr(
                                "cadeditor.message.vaultchannel.grid_inventory_slot_client_already",
                                ((slot.getContainerSlot() - 8)),
                                (slot.getContainerSlot())));
        EditorToast.show(EditorToast.Level.OK, out.get("reason").getAsString());
        return out;
    }

    private static JsonObject commandGive(DocumentDriver driver, JsonObject r, JsonObject wire, String entryId) {
        var mc = Minecraft.getInstance();
        ClientInventoryCommands.requireAvailable(mc);
        if (mc.player.containerMenu != mc.player.inventoryMenu)
            throw new VaultStore.Failure(
                    "NOT_ALLOWED", EditorI18n.tr("cadeditor.message.vaultchannel.close_container_ui_first_support"));
        String region = VaultStore.text(r, "slot", "inventory", 16);
        int requested = r.has("inventoryIndex") ? StackCodec.integer(r, "inventoryIndex", 0, 35) : -1;
        int index = HotbarCommandCodec.emptySlot(
                region, requested, i -> mc.player.getInventory().getItem(i).isEmpty());
        var next = StackCodec.decode(wire, mc.level.registryAccess());
        dev.rinorsi.editor.registry.EntitySchemaValidation.validateStack(next, mc.level);
        var session = new HotbarCommandSession(index, ClientInventoryCommands.context(mc, index));
        String id = "vault-command-" + UUID.randomUUID();
        String pageId = VaultStore.text(r, "requestId", "", 128);
        if (GIVES.size() >= 8)
            throw new VaultStore.Failure(
                    "request_pending",
                    EditorI18n.tr("cadeditor.message.vaultchannel.check_unidentified_retrieve_results"));
        GIVES.put(id, new PendingGive(driver, driver.document(), mc.getConnection(), pageId, entryId, Long.MAX_VALUE));
        COMMAND_GIVES.put(id, session);
        try {
            ClientInventoryCommands.send(mc, session, pageId, net.minecraft.world.item.ItemStack.EMPTY, next);
        } catch (RuntimeException failure) {
            COMMAND_GIVES.remove(id);
            GIVES.remove(id);
            session.invalidate();
            throw failure;
        }
        return null;
    }

    public static boolean receive(JsonObject result) {
        if (!result.has("op") || !result.get("op").getAsString().equals("vault_give")) return false;
        String id = result.has("requestId") ? result.get("requestId").getAsString() : "";
        var pending = GIVES.remove(id);
        if (pending == null) return true;
        boolean ok = result.has("ok") && result.get("ok").getAsBoolean();
        giveReply(
                pending,
                ok,
                result.has("code") ? result.get("code").getAsString() : "invalid_request",
                result.has("reason")
                        ? result.get("reason").getAsString()
                        : EditorI18n.tr("cadeditor.message.vaultchannel.vault_retrieve_failed"),
                result);
        return true;
    }

    private static void remember(State state, String id, JsonObject result) {
        state.giveReplies.put(id, result.deepCopy());
    }

    private static void giveReply(PendingGive pending, boolean ok, String code, String reason, JsonObject result) {
        if (Minecraft.getInstance().getConnection() != pending.connection && ok) return;
        var out = result == null ? new JsonObject() : result.deepCopy();
        out.addProperty("version", 1);
        out.addProperty("op", "give");
        out.addProperty("requestId", pending.pageId);
        out.addProperty("ok", ok);
        out.addProperty("code", code);
        out.addProperty("reason", reason);
        if (!out.has("path")) out.addProperty("path", "server");
        if (!ok) out.addProperty("error", code);
        var state = STATES.get(pending.driver);
        if (state != null && pending.driver.document() == pending.document) {
            remember(state, pending.pageId, out);
            pending.driver.patch("vault.result", out);
        }
        EditorToast.show(ok ? EditorToast.Level.OK : EditorToast.Level.ERROR, reason);
    }

    private static void refreshReservations() {
        var player = Minecraft.getInstance().player;
        if (reservationPlayer != player) {
            reservedSlots.clear();
            reservationPlayer = player;
        }
        if (player != null)
            reservedSlots.removeIf(i -> !player.getInventory().getItem(i).isEmpty());
    }

    private static void error(DocumentDriver driver, String id, String op, RuntimeException e) {
        JsonObject out = new JsonObject();
        out.addProperty("version", 1);
        out.addProperty("requestId", id);
        out.addProperty("op", op);
        out.addProperty("ok", false);
        out.addProperty("error", e instanceof VaultStore.Failure f ? f.code : "BAD_REQUEST");
        out.addProperty("reason", VaultStore.reason(e));
        if (op.equals("give")) {
            String code = e instanceof VaultStore.Failure f
                    ? f.code
                    : e instanceof dev.rinorsi.editor.EditorSessions.Failure f ? f.code : "invalid_request";
            out.addProperty(
                    "code",
                    switch (code) {
                        case "UNAVAILABLE" -> "not_connected";
                        case "BAD_REQUEST" -> "invalid_request";
                        default -> code.toLowerCase(Locale.ROOT);
                    });
            EditorToast.show(EditorToast.Level.ERROR, VaultStore.reason(e));
        }
        if (e instanceof VaultStore.Failure f && f.code.equals("NOT_READY")) {
            out.addProperty("retryAfterMs", 250);
            out.addProperty("loading", true);
        }
        driver.patch("vault.result", out);
    }
}
