        (function() {
            "use strict";

            /* ============ BANNED WORDS ============ */
            const BANNED_WORDS = [
                /osman\s*gasi/i,
                /ozman\s*gazi/i,
                /asman\s*gazi/i,
                /осман\s*гази/i,
                /осман\s*газ/i,
                /osman\s*gaz/i,
                /ozman\s*gaz/i,
                /asman\s*gaz/i,
            ];

            function hasBannedWords(text) {
                if (!text) return false;
                return BANNED_WORDS.some(re => re.test(text));
            }

            function filterBannedWords(text) {
                if (!text) return text;
                let result = text;
                BANNED_WORDS.forEach(re => {
                    result = result.replace(re, '***');
                });
                return result;
            }

            /* ============ CONFIG ============ */
            let uncensored = false;
            let withoutEmail = false;

            // Guest mode: entered via the "Continue as guest" button on the auth gate.
            // Lets someone browse the app and use the text chat without registering, but
            // generation (image / video / Unlimited Generation) stays locked and prompts
            // them to sign up instead.
            let guestMode = false;
            try { guestMode = localStorage.getItem('freebies_guest_mode') === '1'; } catch (e) {}
            function enterGuestMode() {
                guestMode = true;
                try { localStorage.setItem('freebies_guest_mode', '1'); } catch (e) {}
            }
            function exitGuestMode() {
                guestMode = false;
                try { localStorage.removeItem('freebies_guest_mode'); } catch (e) {}
            }
            window.enterGuestMode = enterGuestMode;
            window.exitGuestMode = exitGuestMode;

            // Все API-ключи теперь живут ТОЛЬКО на сервере (Vercel Environment Variables).
            // Браузер обращается к собственным serverless-эндпоинтам в /api/*, которые
            // сами подставляют ключи и проксируют запрос к Gemini / OpenRouter / Agnes AI.
            const MAX_POLL_ATTEMPTS = 60;
            const POLL_INTERVAL = 4000;

            /* ============ CHAT MODEL CATALOG ============
               All text-generation models available in AI Agent chat, routed through a single
               OpenRouter proxy on the server (silent key rotation — see api.js). modality codes
               match the openrouter-console convention: t2t (text only), vt2t (text+image),
               vat2t (text+image+audio), vavt2t (text+image+video+audio). "gemini" is a special
               non-OpenRouter id handled separately (Google Gemini API, used as the ultimate
               fallback if every OpenRouter key/model fails). */
            const CHAT_MODELS = [
                { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "NVIDIA: Nemotron 3 Ultra", logo: "img/NN3U.png", modality: "t2t", tags: ["best"] },
                { id: "nvidia/nemotron-3.5-lightning:free", name: "NVIDIA: Nemotron 3.5 Lightning", logo: "img/NN3.5L.png", modality: "t2t", tags: ["new"] },
                { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "NVIDIA: Nemotron 3 Super", logo: "img/NN3S.png", modality: "t2t", tags: [] },
                { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", name: "NVIDIA: Nemotron 3 Nano Omni", logo: "img/NN3NO.png", modality: "vavt2t", tags: ["new"] },
                { id: "poolside/laguna-s-2.1:free", name: "Poolside: Laguna S 2.1", logo: "img/PLS2.1.png", modality: "t2t", tags: [] },
                { id: "inclusionai/ling-3.0-flash-fin:free", name: "inclusionAI: Ling 3.0 Flash Fin", logo: "img/IL3.0FF.png", modality: "t2t", tags: [] },
                { id: "inclusionai/ling-3.0-flash-vl:free", name: "inclusionAI: Ling 3.0 Flash VL", logo: "img/IL3.0FV.png", modality: "vt2t", tags: ["popular"] },
                { id: "inclusionai/ling-3.0-flash-sante:free", name: "inclusionAI: Ling 3.0 Flash Sante", logo: "img/IL3.0FS.png", modality: "t2t", tags: [] },
                { id: "dots-studio/dots-3-note-preview:free", name: "Dots Studio: Dots3-Note Preview", logo: "img/DSDP.png", modality: "vt2t", tags: ["new"] },
                { id: "nex-agi/nex-n2.5-pro:free", name: "Nex AGI: Nex-N2.5-Pro", logo: "img/NANP.png", modality: "vt2t", tags: [] },
                { id: "nex-agi/nex-n2.5-mini:free", name: "Nex AGI: Nex-N2.5-Mini", logo: "img/NANM.png", modality: "vt2t", tags: [] },
                { id: "cohere/north-mini-code:free", name: "Cohere: North Mini Code", logo: "img/CNMC.png", modality: "t2t", tags: ["code"] },
                { id: "liquid/lfm-2.5-2.6b:free", name: "LiquidAI: LFM2.5-2.6B", logo: "img/LL2.6B.png", modality: "t2t", tags: [] },
                { id: "gemini", name: "Gemini 3.5 Flash", logo: "img/G3.5F.png", modality: "vt2t", tags: ["popular", "best"] },
            ];
            const DEFAULT_CHAT_MODEL_ID = "inclusionai/ling-3.0-flash-vl:free";
            const CHAT_MODEL_STORAGE_KEY = "freebies_chat_model";

            function getSelectedChatModelId() {
                try {
                    const saved = localStorage.getItem(CHAT_MODEL_STORAGE_KEY);
                    if (saved && CHAT_MODELS.some(m => m.id === saved)) return saved;
                } catch (e) {}
                return DEFAULT_CHAT_MODEL_ID;
            }
            function setSelectedChatModelId(id) {
                try { localStorage.setItem(CHAT_MODEL_STORAGE_KEY, id); } catch (e) {}
            }
            let currentModel = getSelectedChatModelId();

            function updateChatModelIndicator() {
                const model = CHAT_MODELS.find(m => m.id === currentModel) || CHAT_MODELS.find(m => m.id === DEFAULT_CHAT_MODEL_ID);
                if (!model) return;
                const logoEl = document.getElementById('chatModelIndicatorLogo');
                const nameEl = document.getElementById('chatModelIndicatorName');
                if (logoEl) {
                    logoEl.style.display = '';
                    logoEl.src = model.logo;
                    logoEl.onerror = () => { logoEl.style.display = 'none'; };
                }
                if (nameEl) nameEl.textContent = model.name;
            }
            window.updateChatModelIndicator = updateChatModelIndicator;
            const chatModelIndicatorBtn = document.getElementById('chatModelIndicator');
            if (chatModelIndicatorBtn) {
                chatModelIndicatorBtn.addEventListener('click', () => {
                    if (typeof window.setTab === 'function') window.setTab('profile');
                    if (typeof window.openSettingsPanel === 'function') window.openSettingsPanel('model');
                });
            }

            // Pricing update: images are now free, video generation is much cheaper.
            // PRICE_VIDEO_FIRST applies only to a user's very first video generation ever (0 stars).
            // PRICE_VIDEO_PROMO applies for the "5 stars first 60 days" promo (see PromoEngine),
            // which unlocks 8 days after registration and lasts 60 days.
            const PRICE_IMAGE = 0;
            const PRICE_VIDEO = 10;
            const PRICE_VIDEO_FIRST = 0;
            const PRICE_VIDEO_PROMO = 5;

            /* ============ STATE ============ */
            function createChat(title) {
                return {
                    id: "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
                    title: title || "New chat",
                    messages: [],
                    createdAt: Date.now(),
                    userMessages: [],
                };
            }

            const firstChat = createChat("Current conversation");
            const state = {
                activeTab: "chat",
                chats: [],
                activeChatId: null,
                photos: [],
                videos: [],
                pendingAttachment: null,
                isSending: false,
                stars: 0,
                starsLoaded: false,
                dailyStars: 0,
                dailyStarsDate: null,
                ugFreeUsesLeft: 3,
                firstVideoGenUsed: false,
                seenFirstGenNotice: false,
                registrationBonusClaimed: false,
                regionWarningShown: false,
                replyingTo: null,
                paymentResolve: null,
                paymentReject: null,
                paymentType: null,
            };
            const DAILY_BONUS_STARS = 40;
            const UG_PRICE_PER_GENERATION = 0.5;
            const UG_FREE_USES = 3;

            function getActiveChat() {
                return state.chats.find(c => c.id === state.activeChatId) || state.chats[0];
            }

            /* ---- First-video-generation flag (persisted locally, per browser) ---- */
            function loadFirstVideoGenUsed() {
                try { state.firstVideoGenUsed = localStorage.getItem('freebies_first_video_used') === '1'; } catch (e) {}
            }
            function markFirstVideoGenUsed() {
                state.firstVideoGenUsed = true;
                try { localStorage.setItem('freebies_first_video_used', '1'); } catch (e) {}
            }
            loadFirstVideoGenUsed();

            function saveState() {
                try {
                    const data = {
                        chats: state.chats,
                        photos: state.photos,
                        videos: state.videos,
                        activeChatId: state.activeChatId,
                        model: currentModel,
                        uncensored: uncensored,
                    };
                    localStorage.setItem('freebies_state', JSON.stringify(data));
                } catch (e) { /* ignore */ }
            }

            function loadState() {
                try {
                    const raw = localStorage.getItem('freebies_state');
                    if (!raw) return false;
                    const data = JSON.parse(raw);
                    if (data.chats && data.chats.length) {
                        state.chats = data.chats;
                        state.activeChatId = data.activeChatId || state.chats[0].id;
                    }
                    if (data.photos) state.photos = data.photos;
                    if (data.videos) state.videos = data.videos;
                    if (data.model) currentModel = data.model;
                    if (data.uncensored !== undefined) uncensored = data.uncensored;
                    return true;
                } catch (e) { return false; }
            }

            if (!loadState()) {
                state.chats = [firstChat];
                state.activeChatId = firstChat.id;
            }

            /* ============ REGION DETECT ============ */
            let userCountry = null;

            async function detectRegion() {
                try {
                    const res = await fetch('https://ipapi.co/json/');
                    if (!res.ok) throw new Error('IP detection failed');
                    const data = await res.json();
                    userCountry = data.country_code;
                    const ruCountries = ['RU', 'BY', 'KZ', 'UA', 'AM', 'AZ', 'GE', 'KG', 'MD', 'TJ', 'TM', 'UZ'];
                    if (ruCountries.includes(userCountry)) {
                        if (!state.regionWarningShown) {
                            state.regionWarningShown = true;
                            saveState();
                            setTimeout(() => {
                                const notifContent = document.getElementById('notifContent');
                                if (notifContent) {
                                    notifContent.innerHTML = `
                            <div style="background:#fff3cd;padding:12px;border-radius:12px;margin-bottom:12px;border:1px solid #ffc107;">
                              <strong>⚠️ Note</strong><br>
                              Some features may be limited in your region.
                            </div>
                            <p>No new notifications</p>
                          `;
                                }
                            }, 500);
                        }
                    }
                    console.log(`🌍 Country: ${userCountry}`);
                } catch (e) {
                    console.warn('Could not detect region:', e);
                }
            }

            /* ============ DOM HELPERS ============ */
            const $ = (sel) => document.querySelector(sel);
            const $$ = (sel) => document.querySelectorAll(sel);

            const chatScroll = $("#chatScroll");
            const emptyState = $("#emptyState");
            const msgInput = $("#msgInput");
            const sendBtn = $("#sendBtn");
            const attachBtn = $("#attachBtn");
            const fileInput = $("#fileInput");
            const attachPreviewWrap = $("#attachPreviewWrap");
            const photoGrid = $("#photoGrid");
            const photoEmpty = $("#photoEmpty");
            const videoGrid = $("#videoGrid");
            const videoEmpty = $("#videoEmpty");
            const historyGrid = $("#historyGrid");
            const historyEmpty = $("#historyEmpty");

            const sidebar = $("#sidebar");
            const sidebarOverlay = $("#sidebarOverlay");
            const mobileMenuBtn = $("#mobileMenuBtn");
            const closeSidebarBtn = $("#closeSidebarBtn");
            const sidebarUser = $("#sidebarUser");
            const mobileNewChatBtn = $("#mobileNewChatBtn");

            const loaderOverlay = $("#loaderOverlay");
            const loaderText = $("#loaderText");
            const queueStatus = $("#queueStatus");
            const notifModal = $("#notifModal");
            const closeNotifBtn = $("#closeNotifBtn");
            const notifBtn = $("#notifBtn");
            const mobileNotifBtn = $("#mobileNotifBtn");

            const paymentModal = $("#paymentModal");
            const payStarsBtn = $("#payStarsBtn");
            const payCancelBtn = $("#payCancelBtn");
            const paymentTitle = $("#paymentTitle");
            const paymentSubtitle = $("#paymentSubtitle");
            const paymentStars = $("#paymentStars");

            const starsCountHeader = document.getElementById('starsCountHeader');
            const starsCountMobile = document.getElementById('starsCountMobile');
            const starsHeaderBtn = document.getElementById('starsHeaderBtn');
            const mobileStarsBtn = document.getElementById('mobileStarsBtn');

            /* ============ AUTH HELPERS (Supabase) ============ */
            function isAuthed() {
                if (window.AppAuth) return window.AppAuth.isLoggedIn();
                return false;
            }
            function openLoginPrompt() {
                const gate = document.getElementById('authGate');
                if (gate) gate.classList.remove('hidden');
            }
            // Item: guest mode blocks generation specifically — text chat still works.
            // Shows a clear "sign up to generate" message, then opens the auth gate.
            function showGuestGenerationBlockedNotice() {
                const lang = (() => { try { return localStorage.getItem('freebies_lang') || 'en'; } catch (e) { return 'en'; } })();
                const msg = lang === 'ru'
                    ? '🔒 Зарегистрируйся, и сможешь генерировать! Гостям генерация недоступна.'
                    : '🔒 Sign up to unlock generation! Guests can chat, but generating images/videos requires an account.';
                if (typeof showToast === 'function') showToast(msg, 4000);
                else alert(msg);
                openLoginPrompt();
            }

            /* ============ PROMO ENGINE (time-based offers, tracked from first visit) ============
               Registration date isn't available from the backend on the client, so we track the
               user's first-seen timestamp in localStorage the moment they land on the app. This
               drives all "N days after signup" promos. If the person clears their browser data or
               switches devices, the timer restarts — this is a known, accepted limitation. */
            const PROMO_FIRST_SEEN_KEY = 'freebies_first_seen_ts';
            const DAY_MS = 24 * 60 * 60 * 1000;

            function getFirstSeenTs() {
                let ts = null;
                try { ts = parseInt(localStorage.getItem(PROMO_FIRST_SEEN_KEY), 10); } catch (e) {}
                if (!ts || isNaN(ts)) {
                    ts = Date.now();
                    try { localStorage.setItem(PROMO_FIRST_SEEN_KEY, String(ts)); } catch (e) {}
                }
                return ts;
            }
            const firstSeenTs = getFirstSeenTs();
            function daysSinceFirstSeen() {
                return (Date.now() - firstSeenTs) / DAY_MS;
            }

            const PromoEngine = {
                // First 7 days after signup: discounted video price (3⭐ instead of 10⭐).
                isFirstWeek: () => daysSinceFirstSeen() < 7,
                // "5⭐ video" promo: unlocks on day 8, runs for 60 days after that.
                isFiveStarVideoPromoActive: () => {
                    const d = daysSinceFirstSeen();
                    return d >= 8 && d < (8 + 60);
                },
                daysUntilFiveStarPromo: () => Math.max(0, Math.ceil(8 - daysSinceFirstSeen())),
            };

            /* ============ STARS SYSTEM (Supabase) ============ */
            const NEW_ACCOUNT_BONUS_STARS = 1000;
            const GUEST_BONUS_STARS = 55;
            let starsSyncInFlight = null;

            // Logged-in users: profile & stars are synced server-side
            // through our own Vercel API routes (/api/auth/get-profile,
            // /api/auth/save-profile), which talk to Supabase.
            async function syncStarsFromSupabase() {
                const sbUser = window.AppAuth?.supabase?.getUser?.();
                if (!sbUser) {
                    state.stars = 0;
                    state.starsLoaded = false;
                    updateStars();
                    return;
                }
                const profile = await window.AppAuth.supabase.fetchProfile();
                if (profile && typeof profile.stars === 'number') {
                    state.stars = profile.stars;
                } else {
                    state.stars = window.AppAuth.supabase.NEW_ACCOUNT_BONUS_STARS || NEW_ACCOUNT_BONUS_STARS;
                    await window.AppAuth.supabase.saveProfile({ stars: state.stars });
                }
                state.starsLoaded = true;
                loadDailyStateFromSource(profile);
                if (ensureDailyStarsFresh()) {
                    await persistDailyStarsToSupabase();
                }
                updateDailyStarsUI();
                updateStars();
            }

            async function persistDailyStarsToSupabase() {
                if (!window.AppAuth?.supabase?.getUser?.()) return;
                await window.AppAuth.supabase.saveProfile({
                    dailyStars: state.dailyStars,
                    dailyStarsDate: state.dailyStarsDate,
                    ugFreeUsesLeft: state.ugFreeUsesLeft,
                });
            }

            function initGuestStars() {
                let raw = null;
                try { raw = localStorage.getItem('freebies_guest_stars'); } catch (e) {}
                if (raw !== null && !isNaN(parseInt(raw, 10))) {
                    state.stars = parseInt(raw, 10);
                } else {
                    state.stars = GUEST_BONUS_STARS;
                    try { localStorage.setItem('freebies_guest_stars', String(GUEST_BONUS_STARS)); } catch (e) {}
                }
                state.starsLoaded = true;
                let dailyRaw = null;
                try { dailyRaw = JSON.parse(localStorage.getItem('freebies_daily_state') || 'null'); } catch (e) {}
                loadDailyStateFromSource(dailyRaw);
                if (ensureDailyStarsFresh()) {
                    persistDailyStars();
                }
                updateDailyStarsUI();
                updateStars();
            }

            async function persistStars() {
                // Logged-in users: persist server-side via Supabase.
                const sbUser = window.AppAuth?.supabase?.getUser?.();
                if (sbUser) {
                    const task = window.AppAuth.supabase.saveProfile({ stars: state.stars });
                    starsSyncInFlight = task;
                    await task;
                    return;
                }
                // Guests: persist locally.
                try { localStorage.setItem('freebies_guest_stars', String(state.stars)); } catch (e) {}
            }

            function updateStars() {
                const count = state.stars;
                if (starsCountHeader) starsCountHeader.textContent = count;
                if (starsCountMobile) starsCountMobile.textContent = count;
                const sidebarStarsEl = document.getElementById('sidebarStarsCount');
                if (sidebarStarsEl) sidebarStarsEl.textContent = count;
                const starShopBalanceEl = document.getElementById('starShopBalance');
                if (starShopBalanceEl) starShopBalanceEl.textContent = count;
                saveState();
            }

            function todayDateStr() {
                const d = new Date();
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            }

            // Resets the daily bonus pool to exactly DAILY_BONUS_STARS if the stored date
            // isn't today. Unused daily stars do NOT carry over — they simply expire.
            function ensureDailyStarsFresh() {
                const today = todayDateStr();
                if (state.dailyStarsDate !== today) {
                    state.dailyStars = DAILY_BONUS_STARS;
                    state.dailyStarsDate = today;
                    updateDailyStarsUI();
                    return true;
                }
                return false;
            }

            function updateDailyStarsUI() {
                const el = $("#dailyStarsCount");
                if (el) el.textContent = state.dailyStars;
                const elMobile = $("#dailyStarsCountMobile");
                if (elMobile) elMobile.textContent = state.dailyStars;
            }

            // Spends from the daily bonus pool first, then falls back to the regular star
            // balance. Returns true if the full amount was covered.
            async function spendWithDailyBonus(amount) {
                ensureDailyStarsFresh();
                let remaining = amount;
                if (state.dailyStars > 0) {
                    const fromDaily = Math.min(state.dailyStars, remaining);
                    state.dailyStars -= fromDaily;
                    remaining -= fromDaily;
                    updateDailyStarsUI();
                }
                if (remaining > 0) {
                    const ok = await spendStarsLocal(remaining);
                    if (!ok) {
                        // refund the daily portion since the overall spend failed
                        state.dailyStars += (amount - remaining);
                        updateDailyStarsUI();
                        return false;
                    }
                } else {
                    await persistDailyStars();
                }
                return true;
            }

            async function persistDailyStars() {
                // Logged-in users: persist server-side via Supabase.
                const sbUser = window.AppAuth?.supabase?.getUser?.();
                if (sbUser) {
                    await persistDailyStarsToSupabase();
                    return;
                }
                // Guests: persist locally.
                const payload = { dailyStars: state.dailyStars, dailyStarsDate: state.dailyStarsDate, ugFreeUsesLeft: state.ugFreeUsesLeft };
                try { localStorage.setItem('freebies_daily_state', JSON.stringify(payload)); } catch (e) {}
            }

            function loadDailyStateFromSource(source) {
                if (!source) return false;
                if (typeof source.dailyStars === 'number') state.dailyStars = source.dailyStars;
                if (typeof source.dailyStarsDate === 'string') state.dailyStarsDate = source.dailyStarsDate;
                if (typeof source.ugFreeUsesLeft === 'number') state.ugFreeUsesLeft = source.ugFreeUsesLeft;
                return true;
            }

            async function spendStarsLocal(amount) {
                if (state.stars < amount) return false;
                state.stars -= amount;
                updateStars();
                await persistStars();
                return true;
            }

            async function addStarsLocal(amount) {
                state.stars += amount;
                updateStars();
                await persistStars();
            }

            /* ============ QUEUE SYSTEM ============ */
            const queue = [];
            let isProcessing = false;

            function enqueue(task) {
                return new Promise((resolve, reject) => {
                    queue.push({ task, resolve, reject });
                    updateQueueStatus();
                    processQueue();
                });
            }

            async function processQueue() {
                if (isProcessing || queue.length === 0) return;
                isProcessing = true;
                updateQueueStatus();
                const item = queue.shift();
                try {
                    const result = await item.task();
                    item.resolve(result);
                } catch (err) {
                    item.reject(err);
                } finally {
                    isProcessing = false;
                    updateQueueStatus();
                    processQueue();
                }
            }

            function updateQueueStatus() {
                const count = queue.length;
                const inProgress = isProcessing ? 1 : 0;
                const total = count + inProgress;
                let statusText = '';
                if (total === 0) {
                    statusText = '';
                } else if (total === 1 && isProcessing) {
                    statusText = 'Generating your request... (you\'re first in queue)';
                } else if (total === 1 && !isProcessing) {
                    statusText = 'Starting generation...';
                } else {
                    statusText = `In queue: ${total} pending`;
                }
                if (queueStatus) queueStatus.textContent = statusText;
                if (loaderOverlay.classList.contains('active')) {
                    if (queueStatus) queueStatus.textContent = statusText;
                }
            }

            /* ============ PAYMENT MODAL ============ */
            // Resolves the current video price, factoring in (in priority order):
            // 1) the very first video generation ever on this browser -> free
            // 2) first 7 days after signup -> 3⭐
            // 3) the "5⭐ for 60 days" promo, active from day 8 to day 68 -> 5⭐
            // 4) otherwise the standard price
            function getVideoPrice() {
                if (!state.firstVideoGenUsed) return PRICE_VIDEO_FIRST;
                if (PromoEngine.isFirstWeek()) return 3;
                if (PromoEngine.isFiveStarVideoPromoActive()) return PRICE_VIDEO_PROMO;
                return PRICE_VIDEO;
            }

            function getPriceForType(type) {
                if (type === 'video') return getVideoPrice();
                return PRICE_IMAGE;
            }

            function updateVidPriceDisplay() {
                const el = document.getElementById('vidPriceDisplay');
                if (!el) return;
                const price = getVideoPrice();
                el.textContent = price === 0 ? '⭐ 0 — Free!' : `⭐ ${price}`;
            }
            window.updateVidPriceDisplay = updateVidPriceDisplay;

            function showPaymentModal(type) {
                return new Promise((resolve, reject) => {
                    const price = getPriceForType(type);
                    const itemName = type === 'image' ? 'image' : 'video';

                    if (!withoutEmail && guestMode && !isAuthed()) {
                        showGuestGenerationBlockedNotice();
                        reject(new Error('Guests cannot generate — sign up required'));
                        return;
                    }
                    if (!withoutEmail && !isAuthed()) {
                        openLoginPrompt();
                        reject(new Error('Authorization required'));
                        return;
                    }

                    // Item 6: generation is now stars-only — if it's free (0⭐), skip the
                    // payment modal entirely and resolve immediately.
                    if (price <= 0) {
                        resolve();
                        return;
                    }

                    paymentTitle.textContent = type === 'image' ? '🎨 Generate Image' : '🎬 Generate Video';
                    paymentSubtitle.textContent = `Confirm payment for ${itemName}`;
                    paymentStars.textContent = `${price} ⭐`;

                    const currentStars = state.stars;
                    const notEnoughStars = currentStars < price;

                    payStarsBtn.disabled = notEnoughStars;
                    payStarsBtn.classList.toggle('disabled', notEnoughStars);
                    payStarsBtn.title = notEnoughStars ? `Not enough stars (you have ${currentStars}, need ${price})` : '';

                    // If not enough stars, clicking the stars button will redirect to shop
                    if (notEnoughStars) {
                        payStarsBtn.textContent = '⭐ Not enough stars — Go to Shop';
                    } else {
                        payStarsBtn.textContent = '⭐ Pay with Stars';
                    }

                    state.paymentResolve = resolve;
                    state.paymentReject = reject;
                    state.paymentType = type;
                    paymentModal.classList.add('active');
                });
            }

            function closePaymentModal() {
                paymentModal.classList.remove('active');
            }

            // Stars button in payment: if not enough stars, open shop; otherwise pay with stars
            payStarsBtn.addEventListener('click', async () => {
                const type = state.paymentType || 'image';
                const price = getPriceForType(type);

                if (state.stars < price) {
                    // Not enough stars — redirect to shop
                    closePaymentModal();
                    if (state.paymentReject) state.paymentReject(new Error('Not enough stars'));
                    state.paymentReject = null;
                    openShopAndPromo();
                    return;
                }

                payStarsBtn.disabled = true;
                const ok = await spendStarsLocal(price);
                payStarsBtn.disabled = false;

                if (!ok) {
                    alert(`❌ Not enough stars! You have ${state.stars}, need ${price}.`);
                    return;
                }

                closePaymentModal();
                if (state.paymentResolve) state.paymentResolve();
                state.paymentResolve = null;
            });

            payCancelBtn.addEventListener('click', () => {
                closePaymentModal();
                if (state.paymentReject) state.paymentReject(new Error('Cancelled by user'));
                state.paymentReject = null;
            });

            /* ============ SHOP / PROMO ============ */
            function openShopAndPromo() {
                if (typeof window.setTab === 'function') window.setTab('star-shop');
                const promo = document.getElementById('shop2000Promo');
                const shopItem2000 = document.querySelector('.shop-item[data-stars="2000"]');
                if (promo) {
                    promo.style.display = 'block';
                    setTimeout(() => { promo.style.display = 'none'; }, 6000);
                }
                if (shopItem2000) {
                    shopItem2000.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    shopItem2000.classList.add('promo-highlight');
                    setTimeout(() => shopItem2000.classList.remove('promo-highlight'), 4000);
                }
            }

            // Click on stars display -> open shop
            if (starsHeaderBtn) {
                starsHeaderBtn.addEventListener('click', openShopAndPromo);
            }
            if (mobileStarsBtn) {
                mobileStarsBtn.addEventListener('click', openShopAndPromo);
            }

            /* ============ SHOP INIT ============ */
            function initShop() {
                const shopItems = document.querySelectorAll('.shop-item');
                shopItems.forEach(item => {
                    item.addEventListener('click', () => {
                        const stars = parseInt(item.dataset.stars);
                        const price = parseInt(item.dataset.price);
                        openDonateModal(stars, price);
                    });
                });
            }

            /* ============ DONATE MODAL ============ */
            const donateModal = $("#donateModal");
            const donateTariffInfo = $("#donateTariffInfo");
            const donateAuthWarning = $("#donateAuthWarning");
            const donateIdBlock = $("#donateIdBlock");
            const donateUserId = $("#donateUserId");
            const donateCopyBtn = $("#donateCopyBtn");
            const donateCloseBtn = $("#donateCloseBtn");
            const donatePayLink = $("#donatePayLink");
            const toastNotice = $("#toastNotice");

            let toastTimeoutId = null;

            function showToast(html, durationMs = 6000) {
                if (!toastNotice) return;
                toastNotice.innerHTML = html;
                toastNotice.classList.add('show');
                if (toastTimeoutId) clearTimeout(toastTimeoutId);
                toastTimeoutId = setTimeout(() => {
                    toastNotice.classList.remove('show');
                }, durationMs);
            }

            function openDonateModal(starsCount, priceAmount) {
                const userId = (window.AppAuth ? window.AppAuth.getUserId() : null) || null;
                donateTariffInfo.textContent = `${starsCount} stars for ${priceAmount} ₽`;
                if (!userId) {
                    donateAuthWarning.classList.remove('hidden');
                    donateIdBlock.classList.add('hidden');
                } else {
                    donateAuthWarning.classList.add('hidden');
                    donateIdBlock.classList.remove('hidden');
                    donateUserId.textContent = userId;
                    donateCopyBtn.textContent = 'Copy my ID';
                }
                donateModal.classList.add('active');
            }

            function closeDonateModal() {
                donateModal.classList.remove('active');
            }

            if (donateCopyBtn) {
                donateCopyBtn.addEventListener('click', () => {
                    const id = window.AppAuth ? window.AppAuth.getUserId() : null;
                    if (!id) return;
                    navigator.clipboard.writeText(id).then(() => {
                        donateCopyBtn.textContent = 'Copied!';
                        setTimeout(() => { donateCopyBtn.textContent = 'Copy my ID'; }, 1800);
                    }).catch(() => {
                        alert('Could not copy ID. Copy manually: ' + id);
                    });
                });
            }

            if (donateCloseBtn) {
                donateCloseBtn.addEventListener('click', closeDonateModal);
            }

            const profileCopyIdBtn = document.getElementById('profileCopyIdBtn');
            if (profileCopyIdBtn) {
                profileCopyIdBtn.addEventListener('click', () => {
                    const id = window.AppAuth ? window.AppAuth.getUserId() : null;
                    if (!id) return;
                    navigator.clipboard.writeText(id).then(() => {
                        profileCopyIdBtn.textContent = 'Copied!';
                        setTimeout(() => { profileCopyIdBtn.textContent = 'Copy my ID'; }, 1800);
                    }).catch(() => {
                        alert('Could not copy ID. Copy manually: ' + id);
                    });
                });
            }
            if (donateModal) {
                donateModal.addEventListener('click', (e) => {
                    if (e.target === donateModal) closeDonateModal();
                });
            }

            if (donatePayLink) {
                donatePayLink.addEventListener('click', () => {
                    showToast(
                        '⏱ Stars will arrive within a day after donation.<br>' +
                        'If not, email <b>zelmir.company@gmail.com</b>',
                        7000
                    );
                });
            }

            /* ============ PLAN SYSTEM ============
               Subscriptions have been removed — everyone is on the single Free tier. This stub
               is kept so other parts of the code that reference window.PlanSystem / getCurrentPlan
               (e.g. video pricing, profile UI) keep working without needing further changes. */
            function getCurrentPlan() {
                return 'free';
            }
            const PlanSystem = { getCurrentPlan };
            window.PlanSystem = PlanSystem;

            function refreshPlanUI() {
                // Item 7: Unlimited Generation is now open to everyone (Free tier included),
                // so make sure no "locked" state / demo badge lingers on the tab.
                const ugTabBtns = document.querySelectorAll('[data-tab="unlimited-gen"]');
                ugTabBtns.forEach(btn => {
                    btn.classList.remove('ug-locked');
                    const badge = btn.querySelector('.ug-demo-badge');
                    if (badge) badge.style.display = 'none';
                });
                updateVidPriceDisplay();
            }

            /* ============ NEW-USER WELCOME MODAL (item 11) ============ */
            function buildWelcomeText(lang, firstName) {
                if (lang === 'ru') {
                    return {
                        title: `Привет, ${firstName}! 👋`,
                        body: `Мы заметили, что ты зарегистрировался в Freebies Ai — твоем проводнике в мир бесплатного творчества! 🎨<br><br>` +
                              `Что мы тебе дарим:<br>` +
                              `🎁 1000 звезд на старте — трать их на создание видео (Text-to-Video и Image-to-Video).<br>` +
                              `🖼 Картинки бесплатно — генерация изображений (Text-to-Image и Image-to-Image) доступна без ограничений!<br><br>` +
                              `🎉 Бонус на первую неделю:<br>` +
                              `Первые 7 дней генерация видео будет стоить всего 3 звезды вместо 10! Это наш подарок специально для тебя ❤️<br><br>` +
                              `Будем очень благодарны за твой отзыв в RuStore — это поможет нам становиться еще лучше! 🙏`,
                    };
                }
                return {
                    title: `Hi, ${firstName}! 👋`,
                    body: `We noticed you just signed up for Freebies AI — your gateway to free creativity! 🎨<br><br>` +
                          `What we're gifting you:<br>` +
                          `🎁 1000 stars to start — spend them on video creation (Text-to-Video and Image-to-Video).<br>` +
                          `🖼 Free images — image generation (Text-to-Image and Image-to-Image) is available with no limits!<br><br>` +
                          `🎉 First-week bonus:<br>` +
                          `For the first 7 days, video generation costs just 3 stars instead of 10! This is our gift, just for you ❤️<br><br>` +
                          `We'd really appreciate a review on RuStore — it helps us keep getting better! 🙏`,
                };
            }

            function showWelcomeModal() {
                const modal = document.getElementById('welcomeModal');
                if (!modal) return;
                const lang = (() => { try { return localStorage.getItem('freebies_lang') || 'en'; } catch (e) { return 'en'; } })();
                const email = window.AppAuth ? window.AppAuth.getUserEmail() : '';
                const firstName = (window.AppAuth ? window.AppAuth.getUserName() : '') || (email && email.includes('@') ? email.split('@')[0] : 'friend');
                const texts = buildWelcomeText(lang, firstName);
                const titleEl = document.getElementById('welcomeModalTitle');
                const bodyEl = document.getElementById('welcomeModalBody');
                if (titleEl) titleEl.textContent = texts.title;
                if (bodyEl) bodyEl.innerHTML = texts.body;
                modal.classList.add('active');
            }
            const welcomeModal = document.getElementById('welcomeModal');
            const welcomeCreateBtn = document.getElementById('welcomeCreateBtn');
            const welcomeReviewBtn = document.getElementById('welcomeReviewBtn');
            function closeWelcomeModal() {
                if (welcomeModal) welcomeModal.classList.remove('active');
            }
            if (welcomeCreateBtn) {
                welcomeCreateBtn.addEventListener('click', () => {
                    closeWelcomeModal();
                    if (typeof window.setTab === 'function') window.setTab('gen-image');
                });
            }
            if (welcomeReviewBtn) {
                welcomeReviewBtn.addEventListener('click', () => {
                    window.open('https://www.rustore.ru/catalog/app/app.vercel.freebies_ai.twa', '_blank', 'noopener,noreferrer');
                });
            }
            if (welcomeModal) {
                welcomeModal.addEventListener('click', (e) => { if (e.target === welcomeModal) closeWelcomeModal(); });
            }

            // Called once per account, the first time we see a logged-in user without the
            // registration bonus flag set. Shows the welcome modal; the 1000-star signup
            // bonus itself is granted server-side the moment the Supabase profile is created
            // (see syncStarsFromSupabase / NEW_ACCOUNT_BONUS_STARS).
            function claimRegistrationBonus() {
                if (state.registrationBonusClaimed) return;
                state.registrationBonusClaimed = true;
                try { localStorage.setItem('freebies_reg_bonus_claimed_' + (window.AppAuth ? window.AppAuth.getUserId() : 'anon'), '1'); } catch (e) {}
                showWelcomeModal();
            }
            window.claimRegistrationBonus = claimRegistrationBonus;

            /* ============ PROFILE AVATAR PICKER (item 8) ============
               Three free avatar styles: default, pro.png, diamond.png. Purely cosmetic —
               available to everyone regardless of plan. Choice is stored locally per browser. */
            const AVATAR_STORAGE_KEY = 'freebies_avatar_choice';
            const AVATAR_SRC = {
                default: 'img/user-avatar.png',
                pro: 'img/pro.png',
                diamond: 'img/diamond.png',
            };
            function getAvatarChoice() {
                try {
                    const v = localStorage.getItem(AVATAR_STORAGE_KEY);
                    if (v === 'pro' || v === 'diamond') return v;
                } catch (e) {}
                return 'default';
            }
            function applyProfileAvatar() {
                const choice = getAvatarChoice();
                const src = AVATAR_SRC[choice] || AVATAR_SRC.default;
                const profileImg = document.getElementById('profileAvatarImg');
                const sidebarImg = document.getElementById('sidebarAvatarImg');
                [profileImg, sidebarImg].forEach(img => {
                    if (!img) return;
                    img.style.display = '';
                    img.src = src;
                });
                document.querySelectorAll('.avatar-picker-option').forEach(btn => {
                    btn.classList.toggle('selected', btn.dataset.avatar === choice);
                });
            }
            window.applyProfileAvatar = applyProfileAvatar;

            const avatarPickerModal = document.getElementById('avatarPickerModal');
            const profileAvatarBtn = document.getElementById('profileAvatarBtn');
            const avatarPickerCloseBtn = document.getElementById('avatarPickerCloseBtn');
            if (profileAvatarBtn && avatarPickerModal) {
                profileAvatarBtn.addEventListener('click', () => {
                    applyProfileAvatar();
                    avatarPickerModal.classList.add('active');
                });
            }
            if (avatarPickerCloseBtn && avatarPickerModal) {
                avatarPickerCloseBtn.addEventListener('click', () => avatarPickerModal.classList.remove('active'));
                avatarPickerModal.addEventListener('click', (e) => {
                    if (e.target === avatarPickerModal) avatarPickerModal.classList.remove('active');
                });
            }
            document.querySelectorAll('.avatar-picker-option').forEach(btn => {
                btn.addEventListener('click', () => {
                    const choice = btn.dataset.avatar;
                    try { localStorage.setItem(AVATAR_STORAGE_KEY, choice); } catch (e) {}
                    applyProfileAvatar();
                    if (avatarPickerModal) avatarPickerModal.classList.remove('active');
                    showToast('✅ Avatar updated!', 2000);
                });
            });
            applyProfileAvatar();

            /* ============ SETTINGS: PANEL NAVIGATION ============ */
            const SETTINGS_PANELS = {
                main: document.getElementById('settingsMainPanel'),
                profile: document.getElementById('settingsProfilePanel'),
                language: document.getElementById('settingsLanguagePanel'),
                model: document.getElementById('settingsModelPanel'),
            };
            function openSettingsPanel(name) {
                Object.entries(SETTINGS_PANELS).forEach(([key, el]) => {
                    if (!el) return;
                    el.classList.toggle('hidden', key !== name);
                });
                const scrollArea = document.querySelector('.settings-scroll');
                if (scrollArea) scrollArea.scrollTop = 0;
                if (name === 'model' && typeof window.renderModelList === 'function') {
                    window.renderModelList();
                }
                if (typeof window.updateSettingsMenuPreviews === 'function') window.updateSettingsMenuPreviews();
            }
            window.openSettingsPanel = openSettingsPanel;
            document.querySelectorAll('[data-open-panel]').forEach(btn => {
                btn.addEventListener('click', () => openSettingsPanel(btn.dataset.openPanel));
            });
            document.querySelectorAll('[data-close-panel]').forEach(btn => {
                btn.addEventListener('click', () => openSettingsPanel('main'));
            });
            // Always land back on the main settings menu when the tab is opened.
            document.querySelectorAll('[data-tab="profile"]').forEach(btn => {
                btn.addEventListener('click', () => openSettingsPanel('main'));
            });

            /* ---- Settings main-menu preview values (avatar, name, language, model) ---- */
            function updateSettingsMenuPreviews() {
                const nameEl = document.getElementById('settingsProfileMiniName');
                if (nameEl) {
                    const profileNameEl = document.getElementById('profileName');
                    nameEl.textContent = profileNameEl ? profileNameEl.textContent : 'User';
                }
                const avatarMini = document.getElementById('settingsProfileAvatarMini');
                const avatarMain = document.getElementById('profileAvatarImg');
                if (avatarMini && avatarMain && avatarMain.src) {
                    avatarMini.style.display = '';
                    avatarMini.src = avatarMain.src;
                }
                const langMini = document.getElementById('settingsLangMiniValue');
                if (langMini) {
                    const lang = (() => { try { return localStorage.getItem('freebies_lang') || 'en'; } catch (e) { return 'en'; } })();
                    langMini.textContent = lang === 'ru' ? 'Русский' : 'English';
                }
                const modelMiniName = document.getElementById('settingsModelMiniName');
                const modelMiniLogo = document.getElementById('settingsModelMiniLogo');
                const model = CHAT_MODELS.find(m => m.id === currentModel) || CHAT_MODELS.find(m => m.id === DEFAULT_CHAT_MODEL_ID);
                if (model) {
                    if (modelMiniName) modelMiniName.textContent = model.name;
                    if (modelMiniLogo) {
                        modelMiniLogo.style.display = '';
                        modelMiniLogo.src = model.logo;
                        modelMiniLogo.onerror = () => { modelMiniLogo.style.display = 'none'; };
                    }
                }
            }
            window.updateSettingsMenuPreviews = updateSettingsMenuPreviews;

            /* ---- Documentation download ---- */
            const settingsDocBtn = document.getElementById('settingsDocBtn');
            if (settingsDocBtn) {
                settingsDocBtn.addEventListener('click', () => {
                    const link = document.getElementById('docDownloadLink');
                    if (link) link.click();
                });
            }

            /* ============ CHAT MODEL SELECTOR: search, filters, ping ============ */
            const MODEL_PING_CACHE_KEY = 'freebies_model_ping_cache';
            const MODEL_PING_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

            function loadPingCache() {
                try {
                    const raw = JSON.parse(localStorage.getItem(MODEL_PING_CACHE_KEY) || '{}');
                    return raw && typeof raw === 'object' ? raw : {};
                } catch (e) { return {}; }
            }
            function savePingCache(cache) {
                try { localStorage.setItem(MODEL_PING_CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
            }
            let pingCache = loadPingCache();

            async function pingModel(modelId) {
                if (modelId === 'gemini') {
                    // Gemini isn't routed through OpenRouter — skip network ping, show a
                    // static "fast" indicator instead of hammering a different API just for a badge.
                    return { ok: true, ms: null };
                }
                try {
                    const res = await fetch('/api/api?action=openrouter-ping', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model: modelId }),
                    });
                    const data = await res.json().catch(() => ({ ok: false, ms: null }));
                    return data;
                } catch (e) {
                    return { ok: false, ms: null };
                }
            }

            function getPingBadgeHtml(modelId) {
                const entry = pingCache[modelId];
                if (!entry) return `<span class="model-ping model-ping-pending">···</span>`;
                if (!entry.ok) return `<span class="model-ping model-ping-fail">offline</span>`;
                if (entry.ms == null) return `<span class="model-ping model-ping-good">fast</span>`;
                const cls = entry.ms < 1200 ? 'model-ping-good' : (entry.ms < 3000 ? 'model-ping-mid' : 'model-ping-slow');
                return `<span class="model-ping ${cls}">${entry.ms}ms</span>`;
            }

            async function refreshPingsInBackground() {
                const now = Date.now();
                const toRefresh = CHAT_MODELS.filter(m => {
                    const entry = pingCache[m.id];
                    return !entry || (now - entry.ts) > MODEL_PING_TTL_MS;
                });
                for (const m of toRefresh) {
                    const result = await pingModel(m.id);
                    pingCache[m.id] = { ok: result.ok, ms: result.ms, ts: Date.now() };
                    savePingCache(pingCache);
                    const badgeEl = document.querySelector(`.model-list-item[data-model-id="${CSS.escape(m.id)}"] .model-ping-slot`);
                    if (badgeEl) badgeEl.innerHTML = getPingBadgeHtml(m.id);
                }
            }

            let modelSearchQuery = '';
            let modelActiveFilter = 'all';

            function modelMatchesFilter(model, filter) {
                switch (filter) {
                    case 'all': return true;
                    case 'working': return !pingCache[model.id] || pingCache[model.id].ok !== false;
                    case 't2t': return model.modality === 't2t';
                    case 'vt2t': return model.modality === 'vt2t';
                    case 'vavt2t': return model.modality === 'vavt2t';
                    case 'vat2t': return model.modality === 'vat2t';
                    case 'free': return true; // every model in the catalog is a free-tier model
                    case 'new': return model.tags.includes('new');
                    case 'popular': return model.tags.includes('popular');
                    case 'best': return model.tags.includes('best');
                    case 'code': return model.tags.includes('code');
                    default: return true;
                }
            }

            const MODALITY_LABEL = { t2t: 'T2T', vt2t: 'T/I2T', vavt2t: 'T/I/V2T', vat2t: 'T/I/A2T' };

            function renderModelList() {
                const wrap = document.getElementById('modelListWrap');
                if (!wrap) return;
                const q = modelSearchQuery.trim().toLowerCase();
                const filtered = CHAT_MODELS.filter(m => {
                    if (q && !m.name.toLowerCase().includes(q)) return false;
                    return modelMatchesFilter(m, modelActiveFilter);
                });

                if (!filtered.length) {
                    wrap.innerHTML = `<div class="model-list-empty">No models found</div>`;
                    return;
                }

                wrap.innerHTML = filtered.map(m => `
                    <button type="button" class="model-list-item${m.id === currentModel ? ' selected' : ''}" data-model-id="${m.id}">
                        <span class="model-list-logo"><img src="${m.logo}" alt="" onerror="this.style.display='none'; this.parentElement.textContent='🤖';"></span>
                        <span class="model-list-text">
                            <span class="model-list-name">${m.name}</span>
                            <span class="model-list-modality">${MODALITY_LABEL[m.modality] || m.modality}</span>
                        </span>
                        <span class="model-ping-slot">${getPingBadgeHtml(m.id)}</span>
                    </button>
                `).join('');

                wrap.querySelectorAll('.model-list-item').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.dataset.modelId;
                        currentModel = id;
                        setSelectedChatModelId(id);
                        updateChatModelIndicator();
                        updateSettingsMenuPreviews();
                        renderModelList();
                        showToast('✅ Model switched', 1500);
                    });
                });

                refreshPingsInBackground();
            }
            window.renderModelList = renderModelList;

            const modelSearchInput = document.getElementById('modelSearchInput');
            if (modelSearchInput) {
                modelSearchInput.addEventListener('input', () => {
                    modelSearchQuery = modelSearchInput.value;
                    renderModelList();
                });
            }
            document.querySelectorAll('#modelFilterRow .model-filter-pill').forEach(pill => {
                pill.addEventListener('click', () => {
                    document.querySelectorAll('#modelFilterRow .model-filter-pill').forEach(p => p.classList.remove('selected'));
                    pill.classList.add('selected');
                    modelActiveFilter = pill.dataset.filter;
                    renderModelList();
                });
            });

            // Warm the ping cache shortly after load, in the background, without blocking anything.
            setTimeout(() => { refreshPingsInBackground(); }, 3000);

            /* ============ USERNAME UPDATE ============ */
            async function updateUsername(newName) {
                const provider = window.AppAuth ? window.AppAuth.getProvider() : null;
                if (!provider) {
                    showToast('⚠️ You are not authorized.', 3000);
                    return;
                }
                const trimmed = (newName || '').trim();
                if (!trimmed) return;
                if (trimmed.length > 40) {
                    showToast('⚠️ Name is too long (max 40 characters).', 3000);
                    return;
                }
                const saveBtn = document.getElementById('saveUsernameBtn');
                if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }
                try {
                    if (provider === 'supabase') {
                        const sbUser = window.AppAuth.supabase.getUser();
                        if (sbUser) {
                            sbUser.name = trimmed;
                            try { localStorage.setItem('freebies_sb_user', JSON.stringify(sbUser)); } catch (e) {}
                            await window.AppAuth.supabase.saveProfile({ name: trimmed });
                        }
                    }
                    const sidebarName = document.getElementById('sidebarUserName');
                    if (sidebarName) sidebarName.textContent = trimmed;
                    const profileName = document.getElementById('profileName');
                    if (profileName) profileName.textContent = trimmed;
                    const homeUserNameEl = document.getElementById('homeUserName');
                    if (homeUserNameEl) homeUserNameEl.textContent = trimmed;
                    showToast('✅ Name updated!', 2500);
                } catch (err) {
                    console.error(err);
                    showToast('❌ Error updating name: ' + err.message, 4000);
                } finally {
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveBtn.dataset.origLabel || 'Change name'; }
                }
            }

            /* ============ SIDEBAR ============ */
            function openSidebar() {
                sidebar.classList.remove("-translate-x-full");
                sidebarOverlay.classList.remove("hidden");
            }
            window.openSidebarForBilling = openSidebar;

            function closeSidebar() {
                sidebar.classList.add("-translate-x-full");
                sidebarOverlay.classList.add("hidden");
            }
            mobileMenuBtn.addEventListener("click", openSidebar);
            closeSidebarBtn.addEventListener("click", closeSidebar);
            sidebarOverlay.addEventListener("click", closeSidebar);
            sidebarUser.addEventListener("click", () => { setTab("profile");
                closeSidebar(); });
            const menuTopBtn = document.getElementById('menuTopBtn');
            if (menuTopBtn) menuTopBtn.addEventListener("click", openSidebar);
            const sidebarStarShopBtn = document.getElementById('sidebarStarShopBtn');
            if (sidebarStarShopBtn) sidebarStarShopBtn.addEventListener("click", () => setTab("star-shop"));

            /* ============ NOTIFICATIONS ============ */
            function openNotifModal() {
                notifModal.classList.add("active");
            }

            function closeNotifModal() {
                notifModal.classList.remove("active");
            }

            // notifBtn / mobileNotifBtn (bell icon) were removed from the header — notifications
            // are still tracked internally and surfaced via toasts/first-gen notice, just without
            // a dedicated bell button anymore.
            closeNotifBtn.addEventListener("click", closeNotifModal);
            notifModal.addEventListener("click", (e) => {
                if (e.target === notifModal) closeNotifModal();
            });

            function addNotification(html, type = 'info') {
                const content = document.getElementById('notifContent');
                if (!content) return;
                const list = content.querySelector('.notif-list') || document.createElement('div');
                list.className = 'notif-list';
                const item = document.createElement('div');
                item.className = `notif-item ${type}`;
                const time = new Date().toLocaleTimeString();
                item.innerHTML = `${html} <div class="time">${time}</div>`;
                list.prepend(item);
                if (!content.querySelector('.notif-list')) {
                    content.innerHTML = '';
                    content.appendChild(list);
                }
                // Keep only last 20
                while (list.children.length > 20) {
                    list.removeChild(list.lastChild);
                }
            }

            // Initial notification
            addNotification('👋 Welcome to Freebies AI! Start chatting or generate media.', 'info');

            /* ============ FIRST-GENERATION NOTICE (shown once, after the first image/video gen) ============ */
            function loadSeenFirstGenNotice() {
                try { state.seenFirstGenNotice = localStorage.getItem('freebies_seen_first_gen_notice') === '1'; } catch (e) {}
            }
            loadSeenFirstGenNotice();

            const firstGenNoticeModal = document.getElementById('firstGenNoticeModal');
            const closeFirstGenNoticeBtn = document.getElementById('closeFirstGenNoticeBtn');
            function maybeShowFirstGenNotice() {
                if (state.seenFirstGenNotice || !firstGenNoticeModal) return;
                state.seenFirstGenNotice = true;
                try { localStorage.setItem('freebies_seen_first_gen_notice', '1'); } catch (e) {}
                firstGenNoticeModal.classList.add('active');
            }
            if (closeFirstGenNoticeBtn && firstGenNoticeModal) {
                closeFirstGenNoticeBtn.addEventListener('click', () => firstGenNoticeModal.classList.remove('active'));
                firstGenNoticeModal.addEventListener('click', (e) => {
                    if (e.target === firstGenNoticeModal) firstGenNoticeModal.classList.remove('active');
                });
            }

            /* ============ TABS ============ */
            const ALL_TABS = ["home", "chat", "gen-image", "unlimited-gen", "gen-video", "photos", "videos", "star-shop", "history", "profile", "contacts"];

            function setTab(tab) {
                state.activeTab = tab;
                ALL_TABS.forEach(t => {
                    const section = $(`#view-${t}`);
                    if (!section) return;
                    section.classList.toggle("hidden", tab !== t);
                    section.classList.toggle("flex", tab === t);
                });
                $$(".tab-btn").forEach(btn => {
                    const active = btn.dataset.tab === tab;
                    btn.classList.toggle("tab-active", active);
                    btn.classList.toggle("text-slate-600", !active);
                });
                closeSidebar();
                // Render history when switching to history tab
                if (tab === 'history') renderHistoryTab();
                if (tab === 'gen-video') updateVidPriceDisplay();
            }
            $$(".tab-btn").forEach(btn => {
                btn.addEventListener("click", () => setTab(btn.dataset.tab));
            });

            /* ============ AD BAR: ROTATING BANNER CAROUSEL ============ */
            const AD_BAR_SLIDES = [
                {
                    id: "bonus1000",
                    img: "img/1000.png",
                    alt: "Register and get 1000 stars for free!",
                    fallbackText: { en: "🎁 Register and get 1000 stars for free!", ru: "🎁 Зарегестрируйся, получи 1000 звезд бесплатно!" },
                    action: () => setTab("profile"),
                },
                {
                    id: "video5star",
                    img: "img/5starvideo.png",
                    alt: "Video generation for 5 stars! First 60 days!",
                    fallbackText: { en: "🎬 Video generation for 5 stars! First 60 days!", ru: "🎬 Генерация видео за 5 звезд! Первые 60 дней!" },
                    action: () => setTab("gen-video"),
                },
                {
                    id: "freeImg",
                    img: "img/FandUImg.png",
                    alt: "Free and unlimited image generation!",
                    fallbackText: { en: "🖼️ Free and unlimited image generation!", ru: "🖼️ Бесплатная и безлимитная генерация картинок!" },
                    action: () => setTab("gen-image"),
                },
                {
                    id: "rustore",
                    img: "img/rustore.png",
                    alt: "We are on RuStore!",
                    fallbackText: { en: "📲 We are on RuStore!", ru: "📲 Мы в Rustore!" },
                    href: "https://www.rustore.ru/catalog/app/app.vercel.freebies_ai.twa",
                },
                {
                    id: "reklama",
                    img: "img/reklama.png",
                    alt: "Advertise on our site!",
                    fallbackText: { en: "📢 Advertise on our site!", ru: "📢 Добавь свою рекламу на сайт!" },
                    href: "mailto:zelmir.company@gmail.com?subject=" + encodeURIComponent("Реклама на Freebies AI"),
                },
            ];

            function initAdBarCarousel() {
                const slidesWrap = document.getElementById("adBarSlides");
                const dotsWrap = document.getElementById("adBarDots");
                if (!slidesWrap || !dotsWrap) return;

                const getLang = () => {
                    try { return localStorage.getItem("freebies_lang") || "en"; } catch (e) { return "en"; }
                };

                AD_BAR_SLIDES.forEach((slide, idx) => {
                    const el = slide.href ? document.createElement("a") : document.createElement("button");
                    el.className = "ad-bar-slide" + (idx === 0 ? " active" : "");
                    el.dataset.slideId = slide.id;
                    if (slide.href) {
                        el.href = slide.href;
                        if (slide.href.startsWith("http")) {
                            el.target = "_blank";
                            el.rel = "noopener noreferrer";
                        }
                    } else {
                        el.type = "button";
                        el.addEventListener("click", () => { if (typeof slide.action === "function") slide.action(); });
                    }

                    const img = document.createElement("img");
                    img.className = "ad-bar-slide-img";
                    img.src = slide.img;
                    img.alt = slide.alt;
                    img.loading = "lazy";
                    img.addEventListener("error", () => {
                        img.remove();
                        const fallback = document.createElement("div");
                        fallback.className = "ad-bar-slide-fallback";
                        const lang = getLang();
                        fallback.textContent = (slide.fallbackText && (slide.fallbackText[lang] || slide.fallbackText.en)) || slide.alt;
                        el.appendChild(fallback);
                    }, { once: true });
                    el.appendChild(img);
                    slidesWrap.appendChild(el);

                    const dot = document.createElement("button");
                    dot.type = "button";
                    dot.className = "ad-bar-dot" + (idx === 0 ? " active" : "");
                    dot.setAttribute("aria-label", `Banner ${idx + 1}`);
                    dot.addEventListener("click", () => showAdBarSlide(idx));
                    dotsWrap.appendChild(dot);
                });

                let currentSlide = 0;
                let rotateTimer = null;

                function showAdBarSlide(idx) {
                    currentSlide = idx;
                    slidesWrap.querySelectorAll(".ad-bar-slide").forEach((el, i) => {
                        el.classList.toggle("active", i === idx);
                    });
                    dotsWrap.querySelectorAll(".ad-bar-dot").forEach((el, i) => {
                        el.classList.toggle("active", i === idx);
                    });
                    resetRotateTimer();
                }

                function resetRotateTimer() {
                    if (rotateTimer) clearInterval(rotateTimer);
                    rotateTimer = setInterval(() => {
                        showAdBarSlide((currentSlide + 1) % AD_BAR_SLIDES.length);
                    }, 5000);
                }

                resetRotateTimer();
            }
            initAdBarCarousel();

            function createNewChat() {
                const chat = createChat("New chat");
                state.chats.unshift(chat);
                state.activeChatId = chat.id;
                renderMessages();
                setTab("chat");
                saveState();
                closeSidebar();
            }

            const newChatBtn = document.getElementById('newChatBtn');
            if (newChatBtn) newChatBtn.addEventListener("click", createNewChat);
            if (mobileNewChatBtn) mobileNewChatBtn.addEventListener("click", createNewChat);

            /* ============ MESSAGE RENDERING ============ */
            function scrollToBottom() {
                chatScroll.scrollTop = chatScroll.scrollHeight;
            }

            function markdownToHtml(text) {
                if (!text) return '';
                let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                html = html.replace(/\n/g, '<br>');
                return html;
            }

            function typeText(element, html, speed = 20) {
                const chars = [];
                let i = 0;
                while (i < html.length) {
                    if (html[i] === '<') {
                        let j = html.indexOf('>', i);
                        if (j !== -1) {
                            chars.push(html.substring(i, j + 1));
                            i = j + 1;
                            continue;
                        }
                    }
                    chars.push(html[i]);
                    i++;
                }
                let currentIndex = 0;
                let interval = setInterval(() => {
                    if (currentIndex < chars.length) {
                        let chunk = chars[currentIndex];
                        element.innerHTML += chunk;
                        currentIndex++;
                        chatScroll.scrollTop = chatScroll.scrollHeight;
                    } else {
                        clearInterval(interval);
                        element.classList.remove('typing-cursor');
                    }
                }, speed);
                element.classList.add('typing-cursor');
                element._typingInterval = interval;
                return interval;
            }

            function buildAvatarEl(role) {
                const av = document.createElement("div");
                av.className =
                    `shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-[16px] overflow-hidden ${role === "user" ? "bg-beige-100" : "bg-accent"}`;
                const img = document.createElement("img");
                img.className = "w-full h-full object-cover";
                img.alt = role === "user" ? "You" : "Freebies AI";
                img.src = role === "user" ? "img/user-avatar.png" : "img/logo.png";
                img.onerror = () => {
                    img.style.display = "none";
                    av.textContent = role === "user" ? "🙂" : "🤖";
                };
                av.appendChild(img);
                return av;
            }

            function buildMessageEl(m) {
                const wrap = document.createElement("div");
                wrap.className = `msg-anim flex w-full items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`;
                wrap.dataset.id = m.id;

                if (m.role !== "user") {
                    wrap.appendChild(buildAvatarEl("assistant"));
                }

                const bubble = document.createElement("div");
                bubble.className = `max-w-[85%] md:max-w-[68%] rounded-3xl px-4 py-3 ${m.role === "user" ? "bg-accent text-white rounded-br-lg" : "bg-white border border-app text-slate-700 rounded-bl-lg shadow-soft"}`;

                if (m.attachments && m.attachments.length) {
                    m.attachments.forEach(a => {
                        const el = a.type === "image" ? document.createElement("img") : document.createElement("video");
                        el.src = a.url;
                        el.className = "rounded-2xl mb-2 max-h-64 w-auto object-cover";
                        if (a.type === "video") { el.controls = true; }
                        bubble.appendChild(el);
                    });
                }

                if (m.text) {
                    const p = document.createElement("p");
                    p.className = "text-[15px] leading-6 whitespace-pre-wrap msg-text";
                    if (m.role === "assistant" && !m.loading && !m.error && !m._typed) {
                        p.innerHTML = '';
                        const htmlContent = markdownToHtml(m.text);
                        p.dataset.html = htmlContent;
                        p.dataset.needsTyping = 'true';
                    } else {
                        p.innerHTML = markdownToHtml(m.text);
                    }
                    bubble.appendChild(p);

                    if (m.role === "assistant" && !m.loading && !m.error && m.text) {
                        const speakBtn = document.createElement("button");
                        speakBtn.className = "speak-btn";
                        speakBtn.innerHTML = `
                  <svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                  <span>Speak</span>
                `;
                        let speaking = false;
                        let utterance = null;
                        speakBtn.addEventListener("click", function(e) {
                            e.stopPropagation();
                            if (speaking) {
                                if (window.speechSynthesis) window.speechSynthesis.cancel();
                                speaking = false;
                                speakBtn.classList.remove("speaking");
                                speakBtn.querySelector('span').textContent = 'Speak';
                                return;
                            }
                            if (!window.speechSynthesis) {
                                alert("Your browser does not support speech synthesis.");
                                return;
                            }
                            const text = m.text.replace(/\*/g, '');
                            if (!text) return;
                            window.speechSynthesis.cancel();
                            utterance = new SpeechSynthesisUtterance(text);
                            utterance.lang = 'en-US';
                            utterance.rate = 1.0;
                            utterance.pitch = 1.0;
                            utterance.onstart = function() {
                                speaking = true;
                                speakBtn.classList.add("speaking");
                                speakBtn.querySelector('span').textContent = 'Stop';
                            };
                            utterance.onend = function() {
                                speaking = false;
                                speakBtn.classList.remove("speaking");
                                speakBtn.querySelector('span').textContent = 'Speak';
                            };
                            utterance.onerror = function() {
                                speaking = false;
                                speakBtn.classList.remove("speaking");
                                speakBtn.querySelector('span').textContent = 'Speak';
                            };
                            window.speechSynthesis.speak(utterance);
                        });
                        bubble.appendChild(speakBtn);
                    }
                }

                if (m.loading) {
                    const loadWrap = document.createElement("div");
                    loadWrap.className = "flex items-center gap-2 mt-2";
                    if (m.loadingKind === "media") {
                        const col = document.createElement("div");
                        col.className = "flex flex-col gap-3 pop-in w-56";
                        const skel = document.createElement("div");
                        skel.className = "shimmer w-full h-40 rounded-2xl";
                        col.appendChild(skel);
                        const track = document.createElement("div");
                        track.className = "gen-progress-track";
                        const fill = document.createElement("div");
                        fill.className = "gen-progress-fill";
                        track.appendChild(fill);
                        col.appendChild(track);
                        const row = document.createElement("div");
                        row.className = "flex items-center justify-between gap-2";
                        const txt = document.createElement("span");
                        txt.className = "gen-label text-[12px] text-slate-400";
                        txt.textContent = m.loadingLabel || "Generating…";
                        row.appendChild(txt);
                        const timer = document.createElement("span");
                        timer.className = "text-[12px] text-slate-300 font-medium tabular-nums shrink-0";
                        row.appendChild(timer);
                        col.appendChild(row);
                        loadWrap.innerHTML = "";
                        loadWrap.appendChild(col);
                        startElapsedTimer(timer);
                    } else {
                        loadWrap.className = "flex items-center gap-2.5 mt-1 chat-thinking-row";
                        const dotsWrap = document.createElement("span");
                        dotsWrap.className = "flex items-center gap-1";
                        dotsWrap.innerHTML = `
                      <span class="dot w-2 h-2 rounded-full bg-beige-400 inline-block"></span>
                      <span class="dot w-2 h-2 rounded-full bg-beige-400 inline-block"></span>
                      <span class="dot w-2 h-2 rounded-full bg-beige-400 inline-block"></span>
                    `;
                        const timerLabel = document.createElement("span");
                        timerLabel.className = "chat-thinking-timer";
                        timerLabel.textContent = "0.0s";
                        loadWrap.appendChild(dotsWrap);
                        loadWrap.appendChild(timerLabel);
                        startElapsedTimerDecimal(timerLabel);
                    }
                    bubble.appendChild(loadWrap);
                }

                if (m.media) {
                    const mediaWrap = document.createElement("div");
                    mediaWrap.className = "mt-2 flex flex-col gap-2";
                    if (m.media.type === "image") {
                        const img = document.createElement("img");
                        img.src = m.media.url;
                        img.className = "rounded-2xl max-h-80 w-full object-cover border border-app";
                        mediaWrap.appendChild(img);
                    } else {
                        const vid = document.createElement("video");
                        vid.src = m.media.url;
                        vid.controls = true;
                        vid.className = "rounded-2xl max-h-80 w-full object-cover border border-app";
                        mediaWrap.appendChild(vid);
                    }
                    const btnRow = document.createElement("div");
                    btnRow.className = "flex items-center gap-2 mt-1 flex-wrap";

                    const dlBtn = document.createElement("a");
                    dlBtn.href = m.media.url;
                    dlBtn.download =
                        `freebies-${m.media.type}-${m.id}.${m.media.type === "image" ? "png" : "mp4"}`;
                    dlBtn.className =
                        "self-start flex items-center gap-1.5 text-[12.5px] font-medium text-[#6B4F3F] bg-beige-100 hover:bg-beige-200 px-3 py-1.5 rounded-full transition";
                    dlBtn.innerHTML = `⬇ Download`;
                    btnRow.appendChild(dlBtn);

                    if (m.media.type === "image") {
                        const animBtn = document.createElement("button");
                        animBtn.className =
                            "self-start flex items-center gap-1.5 text-[12.5px] font-medium text-[#6B4F3F] bg-beige-100 hover:bg-beige-200 px-3 py-1.5 rounded-full transition";
                        animBtn.innerHTML = `🎬 Animate`;
                        animBtn.addEventListener("click", () => {
                            setTab("gen-video");
                            setTimeout(() => {
                                const vidModeBtns = $$("#vidModeGroup .mode-btn");
                                vidModeBtns.forEach(btn => {
                                    if (btn.dataset.mode === "image") {
                                        btn.click();
                                    }
                                });
                                const vidSourceInput = $("#vidSourceInput");
                                fetch(m.media.url)
                                    .then(res => res.blob())
                                    .then(blob => {
                                        const file = new File([blob], "animate_me.png", { type: "image/png" });
                                        const dt = new DataTransfer();
                                        dt.items.add(file);
                                        vidSourceInput.files = dt.files;
                                        vidSourceInput.dispatchEvent(new Event('change'));
                                        const vidPromptInput = $("#vidPromptInput");
                                        vidPromptInput.value = "Animate this";
                                        const container = $("#view-gen-video .flex-1");
                                        if (container) container.scrollTop = container.scrollHeight;
                                    })
                                    .catch(err => console.warn("Could not load image for animation:", err));
                            }, 300);
                        });
                        btnRow.appendChild(animBtn);
                    }

                    mediaWrap.appendChild(btnRow);
                    bubble.appendChild(mediaWrap);
                }

                if (m.error) {
                    const errEl = document.createElement("p");
                    errEl.className = "text-[13px] text-red-500 mt-1";
                    errEl.textContent = m.error;
                    bubble.appendChild(errEl);
                }

                wrap.appendChild(bubble);
                if (m.role === "user") {
                    wrap.appendChild(buildAvatarEl("user"));
                }

                // Long-press (or right-click on desktop) opens the action sheet:
                // Copy / Reply / Select text / Regenerate (assistant messages only).
                if (!m.loading) {
                    attachLongPress(bubble, () => openMsgActionSheet(m, bubble));
                }

                return wrap;
            }

            /* ============ LONG-PRESS MESSAGE ACTIONS ============ */
            function attachLongPress(el, onTrigger) {
                let pressTimer = null;
                let moved = false;
                const LONG_PRESS_MS = 450;

                const start = (e) => {
                    moved = false;
                    pressTimer = setTimeout(() => {
                        if (!moved) {
                            if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
                            onTrigger();
                        }
                    }, LONG_PRESS_MS);
                };
                const cancel = () => { if (pressTimer) clearTimeout(pressTimer); };
                const onMove = () => { moved = true; cancel(); };

                el.addEventListener("touchstart", start, { passive: true });
                el.addEventListener("touchend", cancel);
                el.addEventListener("touchmove", onMove);
                el.addEventListener("mousedown", start);
                el.addEventListener("mouseup", cancel);
                el.addEventListener("mouseleave", cancel);
                el.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    onTrigger();
                });
            }

            const msgActionOverlay = $("#msgActionOverlay");
            const msgActionSheet = $("#msgActionSheet");
            const msgActionPreview = $("#msgActionPreview");
            const msgActionRegenerate = $("#msgActionRegenerate");
            let msgActionTarget = null; // { message, bubbleEl }

            function openMsgActionSheet(message, bubbleEl) {
                if (!msgActionOverlay) return;
                msgActionTarget = { message, bubbleEl };
                if (msgActionPreview) {
                    const plain = (message.text || "").replace(/<[^>]+>/g, "").trim();
                    msgActionPreview.textContent = plain.length > 140 ? plain.slice(0, 140) + "…" : plain;
                    msgActionPreview.classList.toggle("hidden", !plain);
                }
                if (msgActionRegenerate) {
                    msgActionRegenerate.classList.toggle("hidden", message.role === "user");
                }
                msgActionOverlay.classList.add("active");
            }
            function closeMsgActionSheet() {
                if (msgActionOverlay) msgActionOverlay.classList.remove("active");
                msgActionTarget = null;
            }
            if (msgActionOverlay) {
                msgActionOverlay.addEventListener("click", (e) => {
                    if (e.target === msgActionOverlay) closeMsgActionSheet();
                });
            }
            if (msgActionSheet) {
                msgActionSheet.querySelectorAll(".msg-action-btn").forEach(btn => {
                    btn.addEventListener("click", () => {
                        const action = btn.dataset.action;
                        const target = msgActionTarget;
                        closeMsgActionSheet();
                        if (!target) return;
                        handleMsgAction(action, target.message, target.bubbleEl);
                    });
                });
            }

            function handleMsgAction(action, message, bubbleEl) {
                const plainText = (message.text || "").replace(/<[^>]+>/g, "");
                if (action === "copy") {
                    navigator.clipboard.writeText(plainText).then(() => {
                        showToast("✅ Copied", 1500);
                    }).catch(() => {
                        showToast("❌ Could not copy", 1500);
                    });
                } else if (action === "reply") {
                    state.replyingTo = { id: message.id, role: message.role, text: plainText.slice(0, 140) };
                    renderReplyPreview();
                    msgInput.focus();
                } else if (action === "select") {
                    // Make the bubble's text selectable and select it programmatically so
                    // the person can fine-tune the selection and copy manually (long-press
                    // menus / native "Copy" on mobile still work once selection is active).
                    const textNode = bubbleEl.querySelector('.msg-text') || bubbleEl;
                    textNode.style.userSelect = 'text';
                    textNode.style.webkitUserSelect = 'text';
                    const range = document.createRange();
                    range.selectNodeContents(textNode);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                } else if (action === "regenerate") {
                    regenerateMessage(message);
                }
            }

            /* ---- Reply preview above the composer ---- */
            function renderReplyPreview() {
                let bar = document.getElementById("replyPreviewBar");
                if (!state.replyingTo) {
                    if (bar) bar.remove();
                    return;
                }
                if (!bar) {
                    bar = document.createElement("div");
                    bar.id = "replyPreviewBar";
                    bar.className = "reply-preview-bar";
                    const composer = document.querySelector(".chat-composer-v2");
                    if (composer) composer.insertBefore(bar, composer.firstChild);
                }
                bar.innerHTML = `
                    <span class="reply-preview-ic">↩️</span>
                    <span class="reply-preview-text">${escapeHtml(state.replyingTo.text)}</span>
                    <button type="button" class="reply-preview-close" id="replyPreviewCloseBtn">✕</button>
                `;
                const closeBtn = bar.querySelector("#replyPreviewCloseBtn");
                if (closeBtn) closeBtn.addEventListener("click", () => {
                    state.replyingTo = null;
                    renderReplyPreview();
                });
            }
            function escapeHtml(str) {
                const div = document.createElement('div');
                div.textContent = str;
                return div.innerHTML;
            }

            // Regenerate: re-sends the user message that preceded this assistant reply.
            async function regenerateMessage(message) {
                if (message.role !== "assistant") return;
                const chat = getActiveChat();
                if (!chat) return;
                const idx = chat.messages.findIndex(m => m.id === message.id);
                if (idx < 1) return;
                // Find the nearest preceding user message.
                let userMsg = null;
                for (let i = idx - 1; i >= 0; i--) {
                    if (chat.messages[i].role === "user") { userMsg = chat.messages[i]; break; }
                }
                if (!userMsg) return;

                updateMessage(message.id, { loading: true, text: "", error: null });
                const MIN_THINKING_MS = 5000;
                const minDelay = new Promise(resolve => setTimeout(resolve, MIN_THINKING_MS));
                try {
                    const [reply] = await Promise.all([
                        callChatAI(userMsg.text, null, null),
                        minDelay,
                    ]);
                    updateMessage(message.id, { loading: false, text: reply });
                } catch (err) {
                    updateMessage(message.id, { loading: false, error: "Failed to regenerate. Please try again." });
                }
            }

            function renderMessages() {
                chatScroll.innerHTML = "";
                const chat = getActiveChat();
                if (chat.messages.length === 0) {
                    chatScroll.appendChild(emptyState);
                    return;
                }
                chat.messages.forEach(m => {
                    const el = buildMessageEl(m);
                    chatScroll.appendChild(el);
                    if (m.role === "assistant" && !m.loading && !m.error && m.text && !m._typed) {
                        const p = el.querySelector('p');
                        if (p && p.dataset && p.dataset.needsTyping === 'true') {
                            p.innerHTML = '';
                            typeText(p, p.dataset.html, 15);
                            m._typed = true;
                            delete p.dataset.needsTyping;
                        }
                    }
                });
                scrollToBottom();
            }

            function addMessage(msg) {
                msg.id = msg.id || ("m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7));
                // Filter banned words from user messages
                if (msg.role === "user" && msg.text) {
                    if (hasBannedWords(msg.text)) {
                        msg.text = filterBannedWords(msg.text);
                        // Add a warning notification
                        addNotification('⚠️ Some words were filtered due to content policy.', 'warning');
                    }
                }
                const chat = getActiveChat();
                chat.messages.push(msg);

                if (msg.role === "user" && msg.text) {
                    if (!chat.userMessages) chat.userMessages = [];
                    chat.userMessages.push(msg.text);
                    if (chat.userMessages.length >= 2) {
                        const combined = chat.userMessages.join(' ').slice(0, 100);
                        chat.title = combined.length > 28 ? combined.slice(0, 28) + "…" : combined;
                    } else {
                        chat.title = deriveChatTitle(msg.text);
                    }
                    renderHistorySidebar();
                    saveState();
                }

                renderMessages();
                saveState();
                return msg;
            }

            function deriveChatTitle(text) {
                if (!text) return "New chat";
                const trimmed = text.trim();
                return trimmed.length > 28 ? trimmed.slice(0, 28) + "…" : trimmed;
            }

            function updateMessage(id, patch) {
                const chat = getActiveChat();
                const m = chat.messages.find(x => x.id === id);
                if (!m) return;
                Object.assign(m, patch);
                renderMessages();
                saveState();
            }

            /* ============ SIDEBAR HISTORY (chat list) ============ */
            function renderHistorySidebar() {
                // We no longer have a history list in sidebar, but we keep chat switching via other means
                // Actually we removed the history list from sidebar, so this is a no-op.
                // But we still need to update chat titles.
            }

            /* ============ HISTORY TAB ============ */
            function renderHistoryTab() {
                if (!historyGrid) return;
                const allItems = [...state.photos, ...state.videos];
                if (allItems.length === 0) {
                    historyGrid.innerHTML = '';
                    historyGrid.classList.add('hidden');
                    if (historyEmpty) historyEmpty.classList.remove('hidden');
                    return;
                }
                if (historyEmpty) historyEmpty.classList.add('hidden');
                historyGrid.classList.remove('hidden');
                historyGrid.innerHTML = '';

                // Sort by timestamp descending
                const sorted = allItems.slice().sort((a, b) => {
                    const ta = a.ts || '';
                    const tb = b.ts || '';
                    return tb.localeCompare(ta);
                });

                sorted.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'history-item';
                    const thumb = document.createElement('img');
                    thumb.className = 'thumb';
                    thumb.src = item.url;
                    thumb.alt = item.prompt || 'Generated media';
                    div.appendChild(thumb);

                    const info = document.createElement('div');
                    info.className = 'info';
                    const title = document.createElement('div');
                    title.className = 'title';
                    title.textContent = item.prompt || 'Untitled';
                    info.appendChild(title);
                    const meta = document.createElement('div');
                    meta.className = 'meta';
                    const typeLabel = item.url && item.url.includes('.mp4') ? '🎬 Video' : '🖼️ Image';
                    meta.textContent = `${typeLabel} • ${item.ts || ''}`;
                    info.appendChild(meta);
                    div.appendChild(info);

                    // Click to view in gallery
                    div.addEventListener('click', () => {
                        const isVideo = item.url && (item.url.includes('.mp4') || item.url.includes('video'));
                        if (isVideo) {
                            setTab('videos');
                            setTimeout(() => {
                                const vids = state.videos;
                                const idx = vids.findIndex(v => v.id === item.id);
                                if (idx !== -1) {
                                    const grid = document.getElementById('videoGrid');
                                    if (grid) {
                                        const cards = grid.querySelectorAll('.group');
                                        if (cards[idx]) {
                                            cards[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
                                            cards[idx].classList.add('ring-2', 'ring-accent');
                                            setTimeout(() => cards[idx].classList.remove('ring-2', 'ring-accent'),
                                            2000);
                                        }
                                    }
                                }
                            }, 300);
                        } else {
                            setTab('photos');
                            setTimeout(() => {
                                const imgs = state.photos;
                                const idx = imgs.findIndex(p => p.id === item.id);
                                if (idx !== -1) {
                                    const grid = document.getElementById('photoGrid');
                                    if (grid) {
                                        const cards = grid.querySelectorAll('.group');
                                        if (cards[idx]) {
                                            cards[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
                                            cards[idx].classList.add('ring-2', 'ring-accent');
                                            setTimeout(() => cards[idx].classList.remove('ring-2', 'ring-accent'),
                                            2000);
                                        }
                                    }
                                }
                            }, 300);
                        }
                    });

                    historyGrid.appendChild(div);
                });
            }

            /* ============ GALLERY RENDERING ============ */
            function renderGalleries() {
                photoEmpty.classList.toggle("hidden", state.photos.length > 0);
                photoGrid.classList.toggle("hidden", state.photos.length === 0);
                photoGrid.innerHTML = "";
                state.photos.slice().reverse().forEach(p => photoGrid.appendChild(buildGalleryCard(p, "image")));

                videoEmpty.classList.toggle("hidden", state.videos.length > 0);
                videoGrid.classList.toggle("hidden", state.videos.length === 0);
                videoGrid.innerHTML = "";
                state.videos.slice().reverse().forEach(v => videoGrid.appendChild(buildGalleryCard(v, "video")));

                // Also update history tab if visible
                if (state.activeTab === 'history') renderHistoryTab();
            }

            function buildGalleryCard(item, type) {
                const card = document.createElement("div");
                card.className =
                    "group relative rounded-2xl overflow-hidden border border-app bg-white shadow-soft hover:shadow-card transition-all duration-200";
                const mediaEl = type === "image" ? document.createElement("img") : document.createElement("video");
                mediaEl.src = item.url;
                mediaEl.className = "w-full h-56 object-cover group-hover:scale-105 transition-transform duration-300";
                if (type === "video") { mediaEl.muted = true;
                    mediaEl.loop = true;
                    mediaEl.playsInline = true; }
                card.appendChild(mediaEl);
                if (type === "video") {
                    card.addEventListener("mouseenter", () => mediaEl.play().catch(() => {}));
                    card.addEventListener("mouseleave", () => mediaEl.pause());
                }

                /* Three-dot menu */
                const menuBtn = document.createElement("button");
                menuBtn.className = "media-menu-btn";
                menuBtn.type = "button";
                menuBtn.innerHTML = "⋮";
                menuBtn.title = "Options";
                card.appendChild(menuBtn);

                const dropdown = document.createElement("div");
                dropdown.className = "media-menu-dropdown";

                const watchItem = document.createElement("button");
                watchItem.type = "button";
                watchItem.className = "media-menu-item";
                watchItem.innerHTML = '<span class="mmi-icon">👁️</span><span>Watch</span>';
                watchItem.addEventListener("click", (e) => {
                    e.stopPropagation();
                    closeAllMediaMenus();
                    openMediaViewer(item, type);
                });
                dropdown.appendChild(watchItem);

                if (type === "image") {
                    const editItem = document.createElement("button");
                    editItem.type = "button";
                    editItem.className = "media-menu-item";
                    editItem.innerHTML = '<span class="mmi-icon">✏️</span><span>Edit</span>';
                    editItem.addEventListener("click", (e) => {
                        e.stopPropagation();
                        closeAllMediaMenus();
                        sendMediaToImageEdit(item);
                    });
                    dropdown.appendChild(editItem);
                }

                const removeItem = document.createElement("button");
                removeItem.type = "button";
                removeItem.className = "media-menu-item danger";
                removeItem.innerHTML = '<span class="mmi-icon">🗑️</span><span>Remove</span>';
                removeItem.addEventListener("click", (e) => {
                    e.stopPropagation();
                    closeAllMediaMenus();
                    removeMediaItem(item, type);
                });
                dropdown.appendChild(removeItem);

                card.appendChild(dropdown);

                menuBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const isOpen = dropdown.classList.contains("open");
                    closeAllMediaMenus();
                    if (!isOpen) {
                        dropdown.classList.add("open");
                        menuBtn.classList.add("menu-open");
                    }
                });

                const overlay = document.createElement("div");
                overlay.className =
                    "absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-4";
                const promptText = document.createElement("p");
                promptText.className = "text-white text-[13px] line-clamp-2 mb-2";
                promptText.textContent = item.prompt || "";
                overlay.appendChild(promptText);
                const row = document.createElement("div");
                row.className = "flex items-center justify-between";
                const time = document.createElement("span");
                time.className = "text-white/80 text-[11px]";
                time.textContent = item.ts;
                row.appendChild(time);
                const dlBtn = document.createElement("a");
                dlBtn.href = item.url;
                dlBtn.download =
                    `freebies-${type}-${item.id}.${type === "image" ? "png" : "mp4"}`;
                dlBtn.className =
                    "w-9 h-9 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-slate-700 text-[16px]";
                dlBtn.innerHTML = "⬇";
                row.appendChild(dlBtn);
                overlay.appendChild(row);
                card.appendChild(overlay);
                return card;
            }

            /* ============ CHAT SEND ============ */
            function startElapsedTimer(el) {
                const start = Date.now();
                const tick = () => {
                    if (!document.body.contains(el)) return;
                    const secs = Math.floor((Date.now() - start) / 1000);
                    el.textContent = `${secs}s`;
                    requestAnimationFrame(() => setTimeout(tick, 250));
                };
                tick();
            }

            // Same idea but with one decimal place (e.g. "5.4s") — used for the chat
            // "thinking" timer, matching the reference design.
            function startElapsedTimerDecimal(el) {
                const start = Date.now();
                const tick = () => {
                    if (!document.body.contains(el)) return;
                    const secs = ((Date.now() - start) / 1000).toFixed(1);
                    el.textContent = `${secs}s`;
                    requestAnimationFrame(() => setTimeout(tick, 100));
                };
                tick();
            }

            msgInput.addEventListener("input", () => {
                msgInput.style.height = "auto";
                msgInput.style.height = Math.min(msgInput.scrollHeight, 160) + "px";
            });
            msgInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                }
            });

            /* ============ ATTACHMENTS ============ */
            attachBtn.addEventListener("click", () => fileInput.click());

            fileInput.addEventListener("change", async () => {
                const file = fileInput.files[0];
                if (!file) return;
                const isVideo = file.type.startsWith("video/");
                const isImage = file.type.startsWith("image/");
                if (!isVideo && !isImage) {
                    alert("Please select an image or video.");
                    return;
                }
                const objectUrl = URL.createObjectURL(file);
                const base64 = await fileToBase64(file);
                state.pendingAttachment = {
                    type: isVideo ? "video" : "image",
                    url: objectUrl,
                    name: file.name,
                    base64,
                };
                renderAttachPreview();
                fileInput.value = "";
            });

            function fileToBase64(file) {
                return new Promise((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = () => resolve(r.result);
                    r.onerror = reject;
                    r.readAsDataURL(file);
                });
            }

            function renderAttachPreview() {
                const att = state.pendingAttachment;
                if (!att) {
                    attachPreviewWrap.classList.add("hidden");
                    attachPreviewWrap.innerHTML = "";
                    return;
                }
                attachPreviewWrap.classList.remove("hidden");
                attachPreviewWrap.innerHTML = "";
                const card = document.createElement("div");
                card.className =
                    "relative inline-flex items-center gap-2 bg-[#FBF8F5] border border-slate-200 rounded-2xl p-2 pr-3 shadow-sm";
                let mediaEl;
                if (att.type === "image") {
                    mediaEl = document.createElement("img");
                    mediaEl.src = att.url;
                    mediaEl.className = "w-12 h-12 object-cover rounded-xl";
                } else {
                    mediaEl = document.createElement("video");
                    mediaEl.src = att.url;
                    mediaEl.className = "w-12 h-12 object-cover rounded-xl";
                    mediaEl.muted = true;
                }
                card.appendChild(mediaEl);
                const label = document.createElement("span");
                label.className = "text-[12px] text-slate-500 max-w-[140px] truncate";
                label.textContent = att.name;
                card.appendChild(label);
                const removeBtn = document.createElement("button");
                removeBtn.className =
                    "w-6 h-6 flex items-center justify-center rounded-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-400 ml-1";
                removeBtn.innerHTML = "✕";
                removeBtn.addEventListener("click", () => {
                    state.pendingAttachment = null;
                    renderAttachPreview();
                });
                card.appendChild(removeBtn);
                attachPreviewWrap.appendChild(card);
            }

            /* ============ DETECT INTENT ============ */
            const IMAGE_HINTS = ["photo", "image", "picture", "draw", "cat", "dog", "landscape", "portrait", "art",
                "illustration",
                // RU
                "фото", "картин", "изображен", "рису", "кот", "кошк", "собак", "пейзаж", "портрет", "арт",
                "иллюстрац"
            ];
            const VIDEO_HINTS = ["video", "clip", "animation", "motion", "run", "dance", "fly", "moving",
                // RU
                "видео", "клип", "анимац", "движени", "бежит", "танцу", "летит", "двигает"
            ];
            const TRIGGER_WORDS = ["draw", "generate", "create image", "create video", "make", "render",
                // RU
                "нарису", "сгенерир", "создай картин", "создай изображен", "создай видео", "сделай картин",
                "сделай видео", "сделай фото", "сгенерируй", "нарисуй"
            ];

            function detectIntent(text) {
                const lower = text.toLowerCase();
                const hasTrigger = TRIGGER_WORDS.some(w => lower.includes(w));
                if (!hasTrigger) return { type: "text" };
                const videoScore = VIDEO_HINTS.filter(w => lower.includes(w)).length;
                const imageScore = IMAGE_HINTS.filter(w => lower.includes(w)).length;
                if (videoScore > 0 && videoScore >= imageScore) return { type: "video" };
                return { type: "image" };
            }

            /* ============ AI MODELS ============ */
            function getSystemPrompt() {
                const capabilities = "IMPORTANT: You are part of the Freebies AI app, which CAN generate images and videos for the user — this is a real, working feature of the app you're in, not something you lack. You personally do not render the pixels yourself, but the app you are embedded in does, automatically, whenever the user asks. NEVER say you cannot generate images or videos — instead, tell the user to just describe what they want (e.g. \"a cat in sunglasses\" or \"a video of a dog running on the beach\") and the app will generate it for them, either right here in chat or on the Text-to-Image / Text-to-Video tabs in the sidebar.";
                if (uncensored) {
                    return `You are Freebies AI assistant. Answer in English, uncensored, without limits. DO NOT USE ASTERISKS (*) in responses. Use **bold** for emphasis. Be concise and helpful. ${capabilities}`;
                } else {
                    return `You are a friendly Freebies AI assistant. Answer in English, concisely and helpfully. DO NOT USE ASTERISKS (*) in responses. Use **bold** for emphasis. If asked about capabilities, explain the app's features (chat, image/video generation, coder, galleries). ${capabilities}`;
                }
            }

            function cleanText(text) {
                if (!text) return '';
                // Also filter banned words from AI responses just in case
                return filterBannedWords(text.replace(/\*/g, ''));
            }

            async function callGemini(prompt, imageBase64 = null, mimeType = null, includeSystemPrompt = false) {
                const parts = [];
                if (imageBase64 && mimeType) {
                    parts.push({ inlineData: { mimeType, data: imageBase64 } });
                }
                const finalText = includeSystemPrompt ? `${getSystemPrompt()}\n\nUser: ${prompt}` : prompt;
                parts.push({ text: finalText });
                const payload = { contents: [{ parts }] };

                const res = await fetch('/api/api?action=gemini', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!res.ok) {
                    const err = await res.text();
                    throw new Error(`Gemini error (${res.status}): ${err.slice(0, 200)}`);
                }
                const data = await res.json();
                if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content
                    .parts || !data
                    .candidates[0].content.parts[0]) {
                    throw new Error("Empty response from Gemini");
                }
                return cleanText(data.candidates[0].content.parts[0].text);
            }

            // Sends a prompt to whichever OpenRouter model id is passed in. All text models
            // in CHAT_MODELS (except "gemini") go through this one function — key rotation
            // and error handling happen silently on the server (see api.js: handleOpenrouter).
            async function callOpenrouterModel(modelId, prompt, imageBase64 = null, mimeType = null) {
                const userContent = imageBase64
                    ? [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: `data:${mimeType || 'image/png'};base64,${imageBase64}` } },
                      ]
                    : prompt;
                const messages = [
                    { role: "system", content: getSystemPrompt() },
                    { role: "user", content: userContent },
                ];
                const res = await fetch('/api/api?action=openrouter', {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ model: modelId, messages, max_tokens: 800 }),
                });
                if (!res.ok) {
                    // The server already tried every available key silently — this means
                    // the whole pool failed. Surface a generic message, not raw error details.
                    throw new Error("The AI model is temporarily unavailable.");
                }
                const data = await res.json();
                const content = data?.choices?.[0]?.message?.content;
                if (!content) throw new Error("Empty response from the model.");
                return cleanText(content);
            }

            async function callChatAI(prompt, imageBase64 = null, mimeType = null) {
                const modelId = currentModel || DEFAULT_CHAT_MODEL_ID;
                try {
                    if (modelId === 'gemini') {
                        return await callGemini(prompt, imageBase64, mimeType, true);
                    }
                    return await callOpenrouterModel(modelId, prompt, imageBase64, mimeType);
                } catch (err) {
                    console.warn(`Model ${modelId} failed, falling back to Gemini:`, err);
                    // Last-resort fallback so the person always gets a reply, even if the
                    // selected OpenRouter model (and every backup key for it) is down.
                    if (modelId !== 'gemini') {
                        try {
                            return await callGemini(prompt, imageBase64, mimeType, true);
                        } catch (err2) {
                            console.warn('Gemini fallback also failed:', err2);
                            throw err2;
                        }
                    }
                    throw err;
                }
            }

            async function enhancePrompt(originalPrompt, type) {
                const instruction = type === 'image' ?
                    `Improve this prompt for image generation, make it more detailed, cinematic, add artistic details. Respond only with the improved prompt, no extra text. Prompt: "${originalPrompt}"` :
                    `Improve this prompt for video generation, make it more detailed, add dynamics, motion, cinematic quality. Respond only with the improved prompt, no extra text. Prompt: "${originalPrompt}"`;

                try {
                    const enhanced = await callChatAI(instruction);
                    return cleanText(enhanced.trim()) || originalPrompt;
                } catch (e) {
                    console.warn("Could not enhance prompt, using original:", e);
                    return originalPrompt;
                }
            }

            async function getMediaDescription(prompt, type) {
                const instruction = type === 'image' ?
                    `Write a short, beautiful description (1-2 sentences) for the generated image based on the request: "${prompt}". No markdown, just text.` :
                    `Write a short, beautiful description (1-2 sentences) for the generated video based on the request: "${prompt}". No markdown, just text.`;
                try {
                    const desc = await callChatAI(instruction);
                    return cleanText(desc.trim()) || "Done!";
                } catch (e) {
                    return "Done!";
                }
            }

            /* ============ AGNES API (через собственные serverless-эндпоинты) ============ */
            async function generatePollinationsImage(prompt) {
                const encodedPrompt = encodeURIComponent(prompt);
                const seed = Math.floor(Math.random() * 1000000);
                const url =
                    `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true`;
                const response = await fetch(url);
                if (!response.ok) throw new Error('Error generating image via Pollinations');
                const imageBlob = await response.blob();
                return URL.createObjectURL(imageBlob);
            }

            async function callAgnesImage(prompt, startImageBase64, options) {
                options = options || {};
                try {
                    const res = await fetch('/api/api?action=agnes-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            prompt,
                            startImageBase64: startImageBase64 || null,
                            size: options.size || '1024x1024',
                        }),
                    });
                    const data = await res.json();
                    if (!res.ok || !data.url) throw new Error(data.error || 'Agnes did not return a result');
                    return data.url;
                } catch (e) {
                    console.warn("Agnes failed, trying Pollinations:", e);
                    return await generatePollinationsImage(prompt);
                }
            }

            // Stable Diffusion XL Base 1.0 via Pixazo — synchronous, text-to-image only.
            async function callPixazoImage(prompt, options) {
                options = options || {};
                const [w, h] = (options.size || '1024x1024').split('x').map(Number);
                const res = await fetch('/api/api?action=pixazo-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt,
                        width: w || 1024,
                        height: h || 1024,
                    }),
                });
                const data = await res.json();
                if (!res.ok || !data.url) throw new Error(data.error || 'Pixazo SDXL did not return a result');
                return data.url;
            }

            async function callAgnesVideo(prompt, startImageBase64, onStatus, options) {
                options = options || {};
                const res = await fetch('/api/api?action=agnes-video', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt,
                        startImageBase64: startImageBase64 || null,
                        duration: options.duration || 5,
                        dims: options.dims || "1152x768",
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Agnes video request failed');
                if (data.url) return data.url;

                const videoId = data.video_id;
                if (!videoId) throw new Error("Agnes AI did not return URL or video_id.");
                onStatus && onStatus("Processing video on server…");

                for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
                    await new Promise(r => setTimeout(r, POLL_INTERVAL));
                    try {
                        const pollRes = await fetch(`/api/api?action=agnes-video-status&video_id=${encodeURIComponent(videoId)}`);
                        if (!pollRes.ok) continue;
                        const pollData = await pollRes.json();
                        const status = pollData.status || pollData.state;
                        const resultUrl = pollData.url || pollData.video_url || pollData.result?.url;
                        if (resultUrl && (status === "completed" || status === "success" || !status)) {
                            return resultUrl;
                        }
                        if (status === "failed" || status === "error") {
                            throw new Error("Video generation failed.");
                        }
                        onStatus && onStatus(`Generating video… (${Math.round((i + 1) * POLL_INTERVAL / 1000)}s)`);
                    } catch (err) {}
                }
                throw new Error("Video generation timed out.");
            }

            // LTX-2.5 Fast via Pixazo — async (submit + poll request_id), 5-second clips only.
            async function callPixazoVideo(prompt, startImageBase64, onStatus, options) {
                options = options || {};
                const res = await fetch('/api/api?action=pixazo-video', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt,
                        startImage: startImageBase64 || null,
                        duration: 5,
                        aspectRatio: options.aspectRatio || '16:9',
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Pixazo LTX video request failed');
                if (data.url) return data.url;

                const requestId = data.request_id;
                if (!requestId) throw new Error('Pixazo LTX did not return a request_id.');
                onStatus && onStatus("Processing video on server…");

                for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
                    await new Promise(r => setTimeout(r, POLL_INTERVAL));
                    try {
                        const pollRes = await fetch(`/api/api?action=pixazo-video-status&request_id=${encodeURIComponent(requestId)}`);
                        if (!pollRes.ok) continue;
                        const pollData = await pollRes.json();
                        if (pollData.status === 'COMPLETED' && pollData.url) {
                            return pollData.url;
                        }
                        if (pollData.status === 'FAILED') {
                            throw new Error(pollData.error || 'Video generation failed.');
                        }
                        onStatus && onStatus(`Generating video… (${Math.round((i + 1) * POLL_INTERVAL / 1000)}s)`);
                    } catch (err) {}
                }
                throw new Error("Video generation timed out.");
            }

            /* ============ GENERATION WRAPPER ============ */
            async function generateWithQueue(type, generatorFn, ...args) {
                const starsBeforePayment = state.stars;

                await showPaymentModal(type);

                const paidWithStars = state.stars < starsBeforePayment;
                const price = getPriceForType(type);

                return enqueue(async () => {
                    loaderOverlay.classList.add('active');
                    const label = type === 'image' ? 'image' : (type === 'video' ? 'video' : 'code');
                    loaderText.textContent = `Generating ${label}...`;
                    try {
                        const result = await generatorFn(...args);
                        return result;
                    } catch (err) {
                        if (paidWithStars) {
                            await addStarsLocal(price);
                        }
                        throw err;
                    } finally {
                        loaderOverlay.classList.remove('active');
                        queueStatus.textContent = '';
                    }
                });
            }

            /* ============ HANDLE SEND ============ */
            async function handleSend() {
                let text = msgInput.value.trim();
                const attachment = state.pendingAttachment;
                if (!text && !attachment) return;
                if (state.isSending) return;

                // Commands
                if (text.startsWith('/')) {
                    const command = text.trim().toLowerCase();
                    if (command === '/anime') {
                        setTab("gen-image");
                        setTimeout(() => {
                            const imgPrompt = $("#imgPromptInput");
                            if (imgPrompt) imgPrompt.value =
                                "anime 3D, Pixar style, vibrant colors, detailed, cinematic";
                            const container = $("#view-gen-image .flex-1");
                            if (container) container.scrollTop = 0;
                        }, 200);
                        msgInput.value = '';
                        return;
                    } else if (command === '/uncensored') {
                        uncensored = !uncensored;
                        saveState();
                        const status = uncensored ? 'on (uncensored)' : 'off (standard)';
                        addMessage({ role: "assistant", text: `✅ Censorship **${status}**.` });
                        msgInput.value = '';
                        return;
                    } else if (command === '/pollinationsimg') {
                        const gen = addMessage({
                            role: "assistant",
                            loading: true,
                            loadingKind: "media",
                            loadingLabel: "Generating via Pollinations…",
                            text: "",
                        });
                        try {
                            const imgUrl = await generatePollinationsImage(text.replace('/pollinationsimg', '').trim() ||
                            "beautiful landscape");
                            updateMessage(gen.id, {
                                loading: false,
                                text: "Done! (Pollinations)",
                                media: { type: "image", url: imgUrl },
                            });
                            state.photos.push({ id: gen.id, url: imgUrl, ts: nowLabel(), prompt: text });
                            renderGalleries();
                            saveState();
                        } catch (err) {
                            updateMessage(gen.id, { loading: false, error: err.message || "Generation error" });
                        }
                        msgInput.value = '';
                        return;
                    } else if (command === '/withoutemail') {
                        withoutEmail = !withoutEmail;
                        const status = withoutEmail ? 'on (guest mode)' : 'off (login required)';
                        if (withoutEmail) {
                            initGuestStars();
                            addMessage({ role: "assistant",
                                text: `✅ Guest mode **${status}**. You received ${GUEST_BONUS_STARS} ⭐ (one-time guest bonus). Generation still costs stars or ads.` });
                        } else {
                            if (typeof window.syncStarsFromSupabase === 'function') window.syncStarsFromSupabase();
                            addMessage({ role: "assistant", text: `✅ Guest mode **${status}**.` });
                        }
                        msgInput.value = '';
                        return;
                    } else {
                        msgInput.value = '';
                        return;
                    }
                }

                // Check auth — guests are allowed through to use the text chat; the image/video
                // intents further down block guests specifically with a sign-up prompt.
                if (!withoutEmail && !guestMode && !isAuthed()) {
                    openLoginPrompt();
                    return;
                }

                state.isSending = true;
                sendBtn.disabled = true;

                const userMsg = addMessage({
                    role: "user",
                    text,
                    attachments: attachment ? [{ type: attachment.type, url: attachment.url }] : [],
                });

                msgInput.value = "";
                msgInput.style.height = "auto";
                const attach = state.pendingAttachment;
                state.pendingAttachment = null;
                renderAttachPreview();

                const intent = detectIntent(text || "");
                let replyContext = null;
                if (state.replyingTo) {
                    replyContext = state.replyingTo;
                    state.replyingTo = null;
                    renderReplyPreview();
                }

                try {
                    if (intent.type === "text") {
                        const thinking = addMessage({ role: "assistant", loading: true });
                        let imageBase64 = null,
                            mimeType = null;
                        if (attach && attach.type === "image") {
                            imageBase64 = attach.base64.split(',')[1];
                            mimeType = attach.type === "image" ? "image/png" : "image/jpeg";
                        }
                        const promptForModel = replyContext
                            ? `(Replying to: "${replyContext.text}")\n\n${text}`
                            : text;
                        // Item 4: always show the "Thinking" indicator for at least 5 seconds,
                        // regardless of how fast the model actually responds.
                        const MIN_THINKING_MS = 5000;
                        const minDelay = new Promise(resolve => setTimeout(resolve, MIN_THINKING_MS));
                        const [reply] = await Promise.all([
                            callChatAI(promptForModel, imageBase64, mimeType),
                            minDelay,
                        ]);
                        updateMessage(thinking.id, { loading: false, text: reply });

                    } else if (intent.type === "image") {
                        const isRu = /[а-яА-ЯёЁ]/.test(text || "");
                        addMessage({
                            role: "assistant",
                            loading: false,
                            text: isRu ?
                                "📸 Переключаю на Text-to-Image для генерации…" :
                                "📸 Taking you to Text-to-Image to generate that…",
                        });
                        setTab("gen-image");
                        const imgPromptEl = $("#imgPromptInput");
                        if (imgPromptEl) {
                            imgPromptEl.value = text;
                            imgPromptEl.dispatchEvent(new Event("input"));
                        }
                        const imgGenBtnEl = $("#imgGenerateBtn");
                        if (imgGenBtnEl && !(attach && attach.type === "image")) imgGenBtnEl.click();

                    } else if (intent.type === "video") {
                        const isRu = /[а-яА-ЯёЁ]/.test(text || "");
                        addMessage({
                            role: "assistant",
                            loading: false,
                            text: isRu ?
                                "🎬 Переключаю на Text-to-Video для генерации…" :
                                "🎬 Taking you to Text-to-Video to generate that…",
                        });
                        setTab("gen-video");
                        const vidPromptEl = $("#vidPromptInput");
                        if (vidPromptEl) {
                            vidPromptEl.value = text;
                            vidPromptEl.dispatchEvent(new Event("input"));
                        }
                        const vidGenBtnEl = $("#vidGenerateBtn");
                        if (vidGenBtnEl && !(attach && attach.type === "image")) vidGenBtnEl.click();
                    }
                } catch (err) {
                    console.error(err);
                    const activeMessages = getActiveChat().messages;
                    const lastMsg = activeMessages[activeMessages.length - 1];
                    if (lastMsg && lastMsg.role === "assistant") {
                        updateMessage(lastMsg.id, {
                            loading: false,
                            error: err.message || "An error occurred.",
                        });
                    }
                } finally {
                    state.isSending = false;
                    sendBtn.disabled = false;
                    loaderOverlay.classList.remove('active');
                    queueStatus.textContent = '';
                }
            }

            function nowLabel() {
                const d = new Date();
                return d.toLocaleString("en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
            }

            sendBtn.addEventListener("click", handleSend);

            /* ============ STANDALONE GENERATORS ============ */
            const imgPromptInput = $("#imgPromptInput");
            const imgGenerateBtn = $("#imgGenerateBtn");
            const imgGenResult = $("#imgGenResult");
            let selectedImgRatioBtn = $("#imgRatioGroup .ratio-btn");
            selectedImgRatioBtn.classList.add("selected");
            $$("#imgRatioGroup .ratio-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    $$("#imgRatioGroup .ratio-btn").forEach(b => b.classList.remove("selected"));
                    btn.classList.add("selected");
                    selectedImgRatioBtn = btn;
                });
            });

            function renderGenLoading(container, label) {
                container.innerHTML = "";
                const col = document.createElement("div");
                col.className = "flex flex-col gap-3 pop-in";
                const skel = document.createElement("div");
                skel.className = "shimmer w-full h-64 rounded-2xl";
                col.appendChild(skel);
                const track = document.createElement("div");
                track.className = "gen-progress-track";
                const fill = document.createElement("div");
                fill.className = "gen-progress-fill";
                track.appendChild(fill);
                col.appendChild(track);
                const row = document.createElement("div");
                row.className = "flex items-center justify-between";
                const txt = document.createElement("span");
                txt.className = "gen-label text-[12px] text-slate-400";
                txt.textContent = label;
                row.appendChild(txt);
                const timer = document.createElement("span");
                timer.className = "text-[12px] text-slate-300 font-medium tabular-nums";
                row.appendChild(timer);
                col.appendChild(row);
                container.appendChild(col);
                startElapsedTimer(timer);
            }

            function renderGenError(container, message) {
                container.innerHTML = "";
                const p = document.createElement("p");
                p.className = "text-[13px] text-red-500";
                p.textContent = message;
                container.appendChild(p);
            }

            function renderImageResult(container, url) {
                container.innerHTML = "";
                const col = document.createElement("div");
                col.className = "flex flex-col gap-2";
                const img = document.createElement("img");
                img.src = url;
                img.className = "w-full rounded-2xl border border-app";
                col.appendChild(img);
                const dlBtn = document.createElement("a");
                dlBtn.href = url;
                dlBtn.download = `freebies-image-${Date.now()}.png`;
                dlBtn.className =
                    "self-start flex items-center gap-1.5 text-[12.5px] font-medium text-[#6B4F3F] bg-beige-100 hover:bg-beige-200 px-3 py-1.5 rounded-full transition";
                dlBtn.innerHTML = "⬇ Download";
                col.appendChild(dlBtn);
                container.appendChild(col);
            }

            function renderVideoResult(container, url) {
                container.innerHTML = "";
                const col = document.createElement("div");
                col.className = "flex flex-col gap-2";
                const vid = document.createElement("video");
                vid.src = url;
                vid.controls = true;
                vid.className = "w-full rounded-2xl border border-app";
                col.appendChild(vid);
                const dlBtn = document.createElement("a");
                dlBtn.href = url;
                dlBtn.download = `freebies-video-${Date.now()}.mp4`;
                dlBtn.className =
                    "self-start flex items-center gap-1.5 text-[12.5px] font-medium text-[#6B4F3F] bg-beige-100 hover:bg-beige-200 px-3 py-1.5 rounded-full transition";
                dlBtn.innerHTML = "⬇ Download";
                col.appendChild(dlBtn);
                container.appendChild(col);
            }

            let imgMode = "text";
            let imgSourceBase64 = null;
            const imgModeGroup = $("#imgModeGroup");
            const imgUploadWrap = $("#imgUploadWrap");
            const imgSourceInput = $("#imgSourceInput");
            const imgUploadDropzone = $("#imgUploadDropzone");
            const imgSourcePreviewWrap = $("#imgSourcePreviewWrap");
            const imgSourcePreview = $("#imgSourcePreview");
            const imgSourceRemoveBtn = $("#imgSourceRemoveBtn");
            const imgTabTitle = $("#imgTabTitle");
            const imgTabSubtitle = $("#imgTabSubtitle");
            const imgPromptLabel = $("#imgPromptLabel");

            let selectedImgModeBtn = $('#imgModeGroup .mode-btn[data-mode="text"]');
            selectedImgModeBtn.classList.add("selected");

            function setImgMode(mode) {
                imgMode = mode;
                $$("#imgModeGroup .mode-btn").forEach(b => b.classList.toggle("selected", b.dataset.mode === mode));
                if (mode === "image") {
                    imgUploadWrap.classList.remove("hidden");
                    imgTabTitle.textContent = "Image-to-Image";
                    imgTabSubtitle.textContent = "Generate image based on your photo and text description";
                    imgPromptLabel.textContent = "What to change / result description";
                } else {
                    imgUploadWrap.classList.add("hidden");
                    imgTabTitle.textContent = "Text-to-Image";
                    imgTabSubtitle.textContent = "Generate images from text with settings";
                    imgPromptLabel.textContent = "Image description";
                }
            }
            $$("#imgModeGroup .mode-btn").forEach(btn => {
                btn.addEventListener("click", () => setImgMode(btn.dataset.mode));
            });

            /* ============ IMAGE MODEL PICKER (Agnes Image 2.1 Flash / SDXL Base 1.0) ============ */
            let imgModel = "agnes"; // 'agnes' | 'sdxl'
            const imgModeModeBtnImage = $('#imgModeGroup .mode-btn[data-mode="image"]');
            const imgModelDropdownBtn = $("#imgModelDropdownBtn");
            const imgModelDropdownMenu = $("#imgModelDropdownMenu");
            const imgModelDropdownLogo = $("#imgModelDropdownLogo");
            const imgModelDropdownName = $("#imgModelDropdownName");
            const imgModelDropdownTags = $("#imgModelDropdownTags");
            const IMG_MODEL_INFO = {
                agnes: { logo: "img/agnesimg.png", fallback: "🖼️", name: "Agnes Image 2.1 Flash", tags: ["i2i", "t2i"] },
                sdxl: { logo: "img/sd.png", fallback: "🎨", name: "Stable Diffusion XL Base 1.0", tags: ["t2i"] },
            };

            function setImgModel(model) {
                imgModel = model;
                $$("#imgModelDropdownMenu .model-dropdown-option").forEach(c => c.classList.toggle("selected", c.dataset.model === model));

                const info = IMG_MODEL_INFO[model];
                if (info && imgModelDropdownLogo) {
                    imgModelDropdownLogo.style.display = "";
                    imgModelDropdownLogo.src = info.logo;
                    imgModelDropdownLogo.onerror = () => {
                        imgModelDropdownLogo.style.display = "none";
                        imgModelDropdownLogo.parentElement.textContent = info.fallback;
                    };
                }
                if (info && imgModelDropdownName) imgModelDropdownName.textContent = info.name;
                if (info && imgModelDropdownTags) {
                    imgModelDropdownTags.innerHTML = info.tags.map(t => `<span class="model-tag">${t}</span>`).join("");
                }

                // SDXL Base 1.0 is text-to-image only — hide the Image-to-Image mode for it.
                if (model === "sdxl") {
                    if (imgModeModeBtnImage) imgModeModeBtnImage.style.display = "none";
                    if (imgMode === "image") setImgMode("text");
                } else {
                    if (imgModeModeBtnImage) imgModeModeBtnImage.style.display = "";
                }
                if (imgModelDropdownMenu) imgModelDropdownMenu.classList.add("hidden");
            }
            if (imgModelDropdownBtn && imgModelDropdownMenu) {
                imgModelDropdownBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    imgModelDropdownMenu.classList.toggle("hidden");
                });
                $$("#imgModelDropdownMenu .model-dropdown-option").forEach(opt => {
                    opt.addEventListener("click", () => setImgModel(opt.dataset.model));
                });
                document.addEventListener("click", (e) => {
                    if (!imgModelDropdownMenu.contains(e.target) && e.target !== imgModelDropdownBtn && !imgModelDropdownBtn.contains(e.target)) {
                        imgModelDropdownMenu.classList.add("hidden");
                    }
                });
            }

            /* ============ MEDIA CARD MENU ACTIONS (Remove / Edit / Watch) ============ */
            function closeAllMediaMenus() {
                $$(".media-menu-dropdown.open").forEach(d => d.classList.remove("open"));
                $$(".media-menu-btn.menu-open").forEach(b => b.classList.remove("menu-open"));
            }
            document.addEventListener("click", closeAllMediaMenus);

            function removeMediaItem(item, type) {
                if (type === "image") {
                    state.photos = state.photos.filter(p => p.id !== item.id);
                } else {
                    state.videos = state.videos.filter(v => v.id !== item.id);
                }
                renderGalleries();
                saveState();
                addNotification(`🗑️ ${type === "image" ? "Image" : "Video"} removed`, "success");
            }

            async function sendMediaToImageEdit(item) {
                setTab("gen-image");
                setImgMode("image");
                imgPromptInput.value = "";
                imgPromptInput.placeholder = "Describe what you want to change in this image...";

                try {
                    let dataUrl = item.url;
                    if (!dataUrl.startsWith("data:")) {
                        const res = await fetch(item.url);
                        const blob = await res.blob();
                        dataUrl = await new Promise((resolve, reject) => {
                            const r = new FileReader();
                            r.onload = () => resolve(r.result);
                            r.onerror = reject;
                            r.readAsDataURL(blob);
                        });
                    }
                    imgSourceBase64 = dataUrl;
                    imgSourcePreview.src = dataUrl;
                    imgSourcePreviewWrap.classList.remove("hidden");
                    imgUploadDropzone.classList.add("hidden");
                    setTimeout(() => imgPromptInput.focus(), 150);
                    addNotification("🖼️ Image sent to Image-to-Image — enter your edit prompt", "success");
                } catch (e) {
                    console.error("Failed to prepare image for editing:", e);
                    addNotification("⚠️ Could not load this image for editing", "error");
                }
            }

            const mediaViewerOverlay = $("#mediaViewerOverlay");
            const mediaViewerContent = $("#mediaViewerContent");
            const mediaViewerCloseBtn = $("#mediaViewerCloseBtn");

            function openMediaViewer(item, type) {
                if (!mediaViewerOverlay || !mediaViewerContent) return;
                mediaViewerContent.innerHTML = "";
                const el = type === "image" ? document.createElement("img") : document.createElement("video");
                el.src = item.url;
                if (type === "video") {
                    el.controls = true;
                    el.autoplay = true;
                    el.playsInline = true;
                }
                mediaViewerContent.appendChild(el);
                if (item.prompt) {
                    const caption = document.createElement("div");
                    caption.className = "media-viewer-caption";
                    caption.textContent = item.prompt;
                    mediaViewerContent.appendChild(caption);
                }
                mediaViewerOverlay.classList.add("active");
            }

            function closeMediaViewer() {
                if (!mediaViewerOverlay) return;
                mediaViewerOverlay.classList.remove("active");
                if (mediaViewerContent) mediaViewerContent.innerHTML = "";
            }

            if (mediaViewerCloseBtn) mediaViewerCloseBtn.addEventListener("click", closeMediaViewer);
            if (mediaViewerOverlay) {
                mediaViewerOverlay.addEventListener("click", (e) => {
                    if (e.target === mediaViewerOverlay) closeMediaViewer();
                });
            }
            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape") closeMediaViewer();
            });

            imgUploadDropzone.addEventListener("click", () => imgSourceInput.click());
            imgSourceInput.addEventListener("change", () => {
                const file = imgSourceInput.files && imgSourceInput.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    imgSourceBase64 = reader.result;
                    imgSourcePreview.src = imgSourceBase64;
                    imgSourcePreviewWrap.classList.remove("hidden");
                    imgUploadDropzone.classList.add("hidden");
                };
                reader.readAsDataURL(file);
            });
            imgSourceRemoveBtn.addEventListener("click", () => {
                imgSourceBase64 = null;
                imgSourceInput.value = "";
                imgSourcePreviewWrap.classList.add("hidden");
                imgUploadDropzone.classList.remove("hidden");
            });

            imgGenerateBtn.addEventListener("click", async () => {
                let prompt = imgPromptInput.value.trim();
                if (!prompt) {
                    imgPromptInput.focus();
                    return;
                }
                if (imgMode === "image" && !imgSourceBase64) {
                    renderGenError(imgGenResult, "Please upload a source image first.");
                    return;
                }

                if (!withoutEmail && guestMode && !isAuthed()) {
                    showGuestGenerationBlockedNotice();
                    return;
                }
                if (!withoutEmail && !isAuthed()) {
                    openLoginPrompt();
                    return;
                }

                const size = selectedImgRatioBtn.dataset.size;

                try {
                    const imgUrl = await generateWithQueue('image', async () => {
                        if (loaderText) loaderText.textContent = 'Enhancing prompt with AI...';
                        const enhanced = await enhancePrompt(prompt, 'image');
                        if (loaderText) loaderText.textContent = 'Generating image...';
                        if (imgModel === 'sdxl') {
                            return await callPixazoImage(enhanced, { size });
                        }
                        return await callAgnesImage(enhanced, imgMode === "image" ? imgSourceBase64 : null, { size });
                    });
                    renderImageResult(imgGenResult, imgUrl);
                    state.photos.push({ id: "p_" + Date.now(), url: imgUrl, ts: nowLabel(), prompt });
                    renderGalleries();
                    saveState();
                    addNotification('🖼️ Image generated successfully!', 'success');
                    maybeShowFirstGenNotice();
                } catch (err) {
                    console.error(err);
                    if (err.message !== 'Cancelled by user' && err.message !== 'Not enough stars') {
                        renderGenError(imgGenResult, err.message || "Generation error. Stars refunded.");
                    }
                }
            });

            /* ============ UNLIMITED GENERATION (Demo, Pollinations, no stars) ============ */
            const ugPromptInput = $("#ugPromptInput");
            const ugGenerateBtn = $("#ugGenerateBtn");
            const ugGrid = $("#ugGrid");

            const ugStyleDropdownBtn = $("#ugStyleDropdownBtn");
            const ugStyleDropdownMenu = $("#ugStyleDropdownMenu");
            const ugStyleDropdownLabel = $("#ugStyleDropdownLabel");

            let selectedUgStyleBtn = $('#ugStyleDropdownMenu .ug-style-option[data-style=""]');
            if (selectedUgStyleBtn) selectedUgStyleBtn.classList.add("selected");

            if (ugStyleDropdownBtn) {
                ugStyleDropdownBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    ugStyleDropdownMenu.classList.toggle("hidden");
                });
            }
            $$("#ugStyleDropdownMenu .ug-style-option").forEach(opt => {
                opt.addEventListener("click", () => {
                    $$("#ugStyleDropdownMenu .ug-style-option").forEach(o => o.classList.remove("selected"));
                    opt.classList.add("selected");
                    selectedUgStyleBtn = opt;
                    ugStyleDropdownLabel.textContent = opt.dataset.label;
                    ugStyleDropdownMenu.classList.add("hidden");
                });
            });
            document.addEventListener("click", (e) => {
                if (ugStyleDropdownMenu && !ugStyleDropdownMenu.classList.contains("hidden")) {
                    if (!ugStyleDropdownMenu.contains(e.target) && e.target !== ugStyleDropdownBtn) {
                        ugStyleDropdownMenu.classList.add("hidden");
                    }
                }
            });

            let selectedUgRatioBtn = $("#ugRatioGroup .ug-ratio-btn");
            selectedUgRatioBtn.classList.add("selected");
            $$("#ugRatioGroup .ug-ratio-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    $$("#ugRatioGroup .ug-ratio-btn").forEach(b => b.classList.remove("selected"));
                    btn.classList.add("selected");
                    selectedUgRatioBtn = btn;
                });
            });

            let selectedUgCountBtn = $("#ugCountGroup .ug-count-btn");
            selectedUgCountBtn.classList.add("selected");
            $$("#ugCountGroup .ug-count-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    $$("#ugCountGroup .ug-count-btn").forEach(b => b.classList.remove("selected"));
                    btn.classList.add("selected");
                    selectedUgCountBtn = btn;
                });
            });

            function createUgCard() {
                const card = document.createElement("div");
                card.className = "ug-card";
                card.innerHTML = `
                    <div class="ug-card-loader">
                        <span class="ug-spinner"></span>
                        <span class="ug-card-loader-text">In queue…</span>
                    </div>
                `;
                return card;
            }

            function fillUgCardWithImage(card, url) {
                card.innerHTML = `<img src="${url}" class="ug-card-img" alt="Generated image" />`;
            }

            function fillUgCardWithError(card) {
                card.innerHTML = `
                    <div class="ug-card-error">
                        <span class="ug-card-error-icon">⚠️</span>
                        <span class="ug-card-error-text">Failed to generate</span>
                    </div>
                `;
            }

            async function generateOnePollinationsImage(prompt, width, height) {
                const res = await fetch('/api/api?action=pollinations-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt, width, height }),
                });
                const data = await res.json();
                if (!res.ok || !data.url) throw new Error(data.error || 'Pollinations request failed');
                return data.url;
            }

            if (ugGenerateBtn) {
                ugGenerateBtn.addEventListener("click", async () => {
                    const basePrompt = (ugPromptInput.value || "").trim();
                    if (!basePrompt) {
                        ugPromptInput.focus();
                        return;
                    }

                    if (!withoutEmail && guestMode && !isAuthed()) {
                        showGuestGenerationBlockedNotice();
                        return;
                    }
                    if (!withoutEmail && !isAuthed()) {
                        openLoginPrompt();
                        return;
                    }

                    // Pricing: first UG_FREE_USES generations (per account, ever) are free.
                    // After that, each click of Generate costs UG_PRICE_PER_GENERATION stars,
                    // regardless of how many images are requested — spent from the daily
                    // bonus pool first, then the regular star balance.
                    ensureDailyStarsFresh();
                    const isFree = state.ugFreeUsesLeft > 0;
                    if (!isFree) {
                        const totalAvailable = state.dailyStars + state.stars;
                        if (totalAvailable < UG_PRICE_PER_GENERATION) {
                            alert(`❌ Not enough stars! This costs ${UG_PRICE_PER_GENERATION} ⭐ per generation.`);
                            return;
                        }
                    }

                    const styleSuffix = selectedUgStyleBtn ? selectedUgStyleBtn.dataset.style : "";
                    const fullPrompt = styleSuffix ? `${basePrompt}, ${styleSuffix}` : basePrompt;
                    const [width, height] = selectedUgRatioBtn.dataset.size.split("x").map(Number);
                    const count = Number(selectedUgCountBtn.dataset.count);

                    if (isFree) {
                        state.ugFreeUsesLeft -= 1;
                        await persistDailyStars();
                    } else {
                        await spendWithDailyBonus(UG_PRICE_PER_GENERATION);
                    }

                    ugGenerateBtn.disabled = true;
                    const ugGenerateBtnOriginalText = ugGenerateBtn.textContent;
                    ugGrid.innerHTML = "";
                    const cards = [];
                    for (let i = 0; i < count; i++) {
                        const card = createUgCard();
                        ugGrid.appendChild(card);
                        cards.push(card);
                    }

                    const MAX_RETRIES = 2;
                    // Pollinations allows ~1 request every 5s per key/IP on the free Seed tier —
                    // requests are sent strictly one at a time, with a safety margin, to avoid 429s.
                    const REQUEST_INTERVAL_MS = 5500;

                    function setUgCardStatus(card, text) {
                        const textEl = card.querySelector(".ug-card-loader-text");
                        if (textEl) textEl.textContent = text;
                    }

                    async function generateWithRetry(card) {
                        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                            try {
                                setUgCardStatus(card, attempt === 0 ? "Generating…" : `Retrying (${attempt}/${MAX_RETRIES})…`);
                                const url = await generateOnePollinationsImage(fullPrompt, width, height);
                                fillUgCardWithImage(card, url);
                                state.photos.push({ id: "ug_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7), url, ts: nowLabel(), prompt: fullPrompt });
                                return;
                            } catch (err) {
                                if (attempt === MAX_RETRIES) {
                                    console.error(err);
                                    fillUgCardWithError(card);
                                } else {
                                    await new Promise(r => setTimeout(r, REQUEST_INTERVAL_MS));
                                }
                            }
                        }
                    }

                    for (let i = 0; i < cards.length; i++) {
                        ugGenerateBtn.textContent = `♾️ Generating ${i + 1}/${cards.length}…`;
                        await generateWithRetry(cards[i]);
                        if (i < cards.length - 1) {
                            await new Promise(r => setTimeout(r, REQUEST_INTERVAL_MS));
                        }
                    }

                    ugGenerateBtn.textContent = ugGenerateBtnOriginalText;
                    renderGalleries();
                    saveState();
                    ugGenerateBtn.disabled = false;
                });
            }

            /* ============ VIDEO GENERATOR ============ */
            const vidPromptInput = $("#vidPromptInput");
            const vidGenerateBtn = $("#vidGenerateBtn");
            const vidGenResult = $("#vidGenResult");
            let selectedVidRatioBtn = $("#vidRatioGroup .ratio-btn");
            selectedVidRatioBtn.classList.add("selected");
            let selectedVidDurationBtn = $("#vidDurationGroup .duration-btn");
            selectedVidDurationBtn.classList.add("selected");

            $$("#vidRatioGroup .ratio-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    $$("#vidRatioGroup .ratio-btn").forEach(b => b.classList.remove("selected"));
                    btn.classList.add("selected");
                    selectedVidRatioBtn = btn;
                });
            });
            $$("#vidDurationGroup .duration-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    $$("#vidDurationGroup .duration-btn").forEach(b => b.classList.remove("selected"));
                    btn.classList.add("selected");
                    selectedVidDurationBtn = btn;
                });
            });

            let vidMode = "text";
            let vidSourceBase64 = null;
            const vidUploadWrap = $("#vidUploadWrap");
            const vidSourceInput = $("#vidSourceInput");
            const vidUploadDropzone = $("#vidUploadDropzone");
            const vidSourcePreviewWrap = $("#vidSourcePreviewWrap");
            const vidSourcePreview = $("#vidSourcePreview");
            const vidSourceRemoveBtn = $("#vidSourceRemoveBtn");
            const vidTabTitle = $("#vidTabTitle");
            const vidTabSubtitle = $("#vidTabSubtitle");
            const vidPromptLabel = $("#vidPromptLabel");

            let selectedVidModeBtn = $('#vidModeGroup .mode-btn[data-mode="text"]');
            selectedVidModeBtn.classList.add("selected");

            function setVidMode(mode) {
                vidMode = mode;
                $$("#vidModeGroup .mode-btn").forEach(b => b.classList.toggle("selected", b.dataset.mode === mode));
                if (mode === "image") {
                    vidUploadWrap.classList.remove("hidden");
                    vidTabTitle.textContent = "Image-to-Video";
                    vidTabSubtitle.textContent = "Generate video based on your photo and motion description";
                    vidPromptLabel.textContent = "What should happen in the video";
                } else {
                    vidUploadWrap.classList.add("hidden");
                    vidTabTitle.textContent = "Text-to-Video";
                    vidTabSubtitle.textContent = "Generate videos from text with settings";
                    vidPromptLabel.textContent = "Video description";
                }
            }
            $$("#vidModeGroup .mode-btn").forEach(btn => {
                btn.addEventListener("click", () => setVidMode(btn.dataset.mode));
            });

            /* ============ VIDEO MODEL PICKER (Agnes Video 2.5 / LTX-2.5 Fast) ============ */
            let vidModel = "agnes"; // 'agnes' | 'ltx'
            const vidDuration10Btn = $('#vidDurationGroup .duration-btn[data-duration="10"]');
            const vidModelDropdownBtn = $("#vidModelDropdownBtn");
            const vidModelDropdownMenu = $("#vidModelDropdownMenu");
            const vidModelDropdownLogo = $("#vidModelDropdownLogo");
            const vidModelDropdownName = $("#vidModelDropdownName");
            const vidModelDropdownTags = $("#vidModelDropdownTags");
            const VID_MODEL_INFO = {
                agnes: { logo: "img/agnesvid.png", fallback: "🎬", name: "Agnes Video 2.5", tags: ["i2v", "t2v"] },
                ltx: { logo: "img/ltx.png", fallback: "⚡", name: "LTX-2.5 Fast", tags: ["i2v", "t2v"] },
            };

            function setVidModel(model) {
                vidModel = model;
                $$("#vidModelDropdownMenu .model-dropdown-option").forEach(c => c.classList.toggle("selected", c.dataset.model === model));

                const info = VID_MODEL_INFO[model];
                if (info && vidModelDropdownLogo) {
                    vidModelDropdownLogo.style.display = "";
                    vidModelDropdownLogo.src = info.logo;
                    vidModelDropdownLogo.onerror = () => {
                        vidModelDropdownLogo.style.display = "none";
                        vidModelDropdownLogo.parentElement.textContent = info.fallback;
                    };
                }
                if (info && vidModelDropdownName) vidModelDropdownName.textContent = info.name;
                if (info && vidModelDropdownTags) {
                    vidModelDropdownTags.innerHTML = info.tags.map(t => `<span class="model-tag">${t}</span>`).join("");
                }

                // LTX-2.5 Fast only supports 5-second clips — hide the 10s option and force 5s.
                if (model === "ltx") {
                    if (vidDuration10Btn) vidDuration10Btn.style.display = "none";
                    const btn5 = $('#vidDurationGroup .duration-btn[data-duration="5"]');
                    if (btn5) {
                        $$("#vidDurationGroup .duration-btn").forEach(b => b.classList.remove("selected"));
                        btn5.classList.add("selected");
                        selectedVidDurationBtn = btn5;
                    }
                } else {
                    if (vidDuration10Btn) vidDuration10Btn.style.display = "";
                }
                if (typeof updateVidPriceDisplay === "function") updateVidPriceDisplay();
                if (vidModelDropdownMenu) vidModelDropdownMenu.classList.add("hidden");
            }
            if (vidModelDropdownBtn && vidModelDropdownMenu) {
                vidModelDropdownBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    vidModelDropdownMenu.classList.toggle("hidden");
                });
                $$("#vidModelDropdownMenu .model-dropdown-option").forEach(opt => {
                    opt.addEventListener("click", () => setVidModel(opt.dataset.model));
                });
                document.addEventListener("click", (e) => {
                    if (!vidModelDropdownMenu.contains(e.target) && e.target !== vidModelDropdownBtn && !vidModelDropdownBtn.contains(e.target)) {
                        vidModelDropdownMenu.classList.add("hidden");
                    }
                });
            }

            vidUploadDropzone.addEventListener("click", () => vidSourceInput.click());
            vidSourceInput.addEventListener("change", () => {
                const file = vidSourceInput.files && vidSourceInput.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    vidSourceBase64 = reader.result;
                    vidSourcePreview.src = vidSourceBase64;
                    vidSourcePreviewWrap.classList.remove("hidden");
                    vidUploadDropzone.classList.add("hidden");
                };
                reader.readAsDataURL(file);
            });
            vidSourceRemoveBtn.addEventListener("click", () => {
                vidSourceBase64 = null;
                vidSourceInput.value = "";
                vidSourcePreviewWrap.classList.add("hidden");
                vidUploadDropzone.classList.remove("hidden");
            });

            vidGenerateBtn.addEventListener("click", async () => {
                let prompt = vidPromptInput.value.trim();
                if (!prompt) {
                    vidPromptInput.focus();
                    return;
                }
                if (vidMode === "image" && !vidSourceBase64) {
                    renderGenError(vidGenResult, "Please upload a source image first.");
                    return;
                }

                if (!withoutEmail && guestMode && !isAuthed()) {
                    showGuestGenerationBlockedNotice();
                    return;
                }
                if (!withoutEmail && !isAuthed()) {
                    openLoginPrompt();
                    return;
                }

                const dims = selectedVidRatioBtn.dataset.dims;
                const ratio = selectedVidRatioBtn.dataset.ratio;
                const duration = Number(selectedVidDurationBtn.dataset.duration);

                try {
                    const vidUrl = await generateWithQueue('video', async () => {
                        if (loaderText) loaderText.textContent = 'Enhancing prompt with AI...';
                        const enhanced = await enhancePrompt(prompt, 'video');
                        if (vidModel === 'ltx') {
                            return await callPixazoVideo(enhanced, vidMode === "image" ? vidSourceBase64 : null, (label) => {
                                loaderText.textContent = label;
                            }, { aspectRatio: ratio });
                        }
                        return await callAgnesVideo(enhanced, vidMode === "image" ? vidSourceBase64 : null, (label) => {
                            loaderText.textContent = label;
                        }, { dims, duration });
                    });
                    renderVideoResult(vidGenResult, vidUrl);
                    state.videos.push({ id: "v_" + Date.now(), url: vidUrl, ts: nowLabel(), prompt });
                    renderGalleries();
                    if (!state.firstVideoGenUsed) markFirstVideoGenUsed();
                    saveState();
                    addNotification('🎬 Video generated successfully!', 'success');
                    maybeShowFirstGenNotice();
                } catch (err) {
                    console.error(err);
                    if (err.message !== 'Cancelled by user' && err.message !== 'Not enough stars') {
                        renderGenError(vidGenResult, err.message || "Generation error. Stars refunded.");
                    }
                }
            });

            /* ============ THEME ============ */
            const themeToggleEl = $("#themeToggle");
            const themeSwitchEl = themeToggleEl ? themeToggleEl.closest(".theme-switch") : null;

            function applyTheme(dark) {
                document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
                if (themeSwitchEl) themeSwitchEl.classList.toggle("on", dark);
                if (themeToggleEl) themeToggleEl.checked = dark;
                try { localStorage.setItem("freebies_theme", dark ? "dark" : "light"); } catch (e) {}
            }
            let savedTheme = "light";
            try { savedTheme = localStorage.getItem("freebies_theme") || "light"; } catch (e) {}
            applyTheme(savedTheme === "dark");
            if (themeSwitchEl) {
                themeSwitchEl.addEventListener("click", () => applyTheme(!themeToggleEl.checked));
            }

            /* ============ LANGUAGE (EN default, RU optional) ============ */
            const I18N = {
                en: {
                    shop_title: "Star Shop",
                    promo_2000: "Deal: best value at 2000 ⭐",
                    language_title: "Language",
                    language_desc: "App interface language",
                    avatar_picker_title: "Choose your avatar",
                    avatar_picker_sub: "Free for everyone — pick any style",
                    avatar_default_label: "Default",
                    // Sidebar / bottom nav
                    nav_home: "Home",
                    nav_agent: "AI Agent",
                    nav_image: "AI Image",
                    nav_video: "AI Video",
                    nav_unlimited: "Unlimited Gen",
                    nav_photos: "Photo Gallery",
                    nav_videos: "Video Gallery",
                    nav_shop: "Star Shop",
                    nav_history: "History",
                    nav_profile: "Profile",
                    nav_settings: "Settings",
                    nav_contacts: "Contacts & Support",
                    your_stars_label: "Your Stars",
                    free_plan_label: "Free Plan",
                    // Settings
                    settings_title: "Settings",
                    settings_back: "Settings",
                    settings_profile_title: "Profile",
                    settings_language_title: "Language",
                    settings_model_title: "AI Agent chat model",
                    settings_docs_title: "Documentation",
                    settings_docs_sub: "Download as .txt",
                    settings_logout_title: "Log out",
                    account_info_title: "Account info",
                    account_info_desc: "Personal details and profile settings",
                    danger_zone_title: "Danger zone",
                    danger_zone_desc: "Actions that cannot be undone",
                    model_search_placeholder: "Search models…",
                    filter_all: "All",
                    filter_working: "Working",
                    filter_free: "Free",
                    filter_new: "New",
                    filter_popular: "Popular",
                    filter_best: "Best",
                    filter_code: "For code",
                    // Home tab
                    home_welcome_back: "Welcome back,",
                    hero_title: 'Create images, videos and chat with AI for <span class="accent-text">free.</span>',
                    hero_sub: "Powerful AI tools. No limits. Just describe and create.",
                    hero_start_btn: "✳️ Start Creating",
                    hero_gallery_btn: "🖼️ Explore Gallery",
                    hero_card_caption: "✨ The polar bear runs in a 2D game",
                    home_what_to_do: "What would you like to do?",
                    htc_agent_desc: "Chat with AI",
                    htc_image_title: "AI Image Generation",
                    htc_image_desc: "Create stunning AI images",
                    htc_video_title: "AI Video Generation",
                    htc_video_desc: "Generate AI videos",
                    htc_photos_desc: "Explore amazing AI photos",
                    htc_videos_desc: "Watch created AI videos",
                    htc_shop_desc: "Buy stars and unlock more",
                    home_trending_images: "Trending Images",
                    home_trending_videos: "Trending Videos",
                    view_all_btn: "View all",
                    // Star shop
                    star_shop_title: "Star Shop",
                    star_shop_sub: "Buy stars to generate with",
                    close_btn: "Close",
                    copy_id_btn: "Copy my ID",
                    // First-gen notice modal
                    first_gen_notice_title: "Important to know! 💡",
                    first_gen_notice_body: "Since image and video generation is completely free for you, technical errors may sometimes occur during generation. This is normal — we work on stability every day!",
                    first_gen_notice_body2: "If you run into this: 📩 write to us at zelmir.company@gmail.com",
                    first_gen_notice_body3: "Our team will look into the issue and will definitely give you a compensation! ❤️",
                    ok_got_it: "OK",
                    // Welcome modal
                    welcome_create_btn: "Create",
                    welcome_review_btn: "Leave a review",
                    thinking_label: "Thinking…",
                    // Message long-press action sheet
                    msg_action_copy: "Copy",
                    msg_action_reply: "Reply",
                    msg_action_select: "Select text",
                    msg_action_regenerate: "Regenerate",
                },
                ru: {
                    shop_title: "Магазин звёзд",
                    promo_2000: "Акция: выгодно бери 2000 ⭐",
                    language_title: "Язык",
                    language_desc: "Язык интерфейса приложения",
                    avatar_picker_title: "Выберите аватар",
                    avatar_picker_sub: "Бесплатно для всех — выбирайте любой стиль",
                    avatar_default_label: "Обычный",
                    // Sidebar / bottom nav
                    nav_home: "Главная",
                    nav_agent: "AI Агент",
                    nav_image: "AI Картинки",
                    nav_video: "AI Видео",
                    nav_unlimited: "Безлимит",
                    nav_photos: "Галерея фото",
                    nav_videos: "Галерея видео",
                    nav_shop: "Магазин звёзд",
                    nav_history: "История",
                    nav_profile: "Профиль",
                    nav_settings: "Настройки",
                    nav_contacts: "Контакты и поддержка",
                    your_stars_label: "Ваши звёзды",
                    free_plan_label: "Бесплатный план",
                    // Settings
                    settings_title: "Настройки",
                    settings_back: "Настройки",
                    settings_profile_title: "Профиль",
                    settings_language_title: "Язык",
                    settings_model_title: "Модель генерации в чате AI Agent",
                    settings_docs_title: "Документация",
                    settings_docs_sub: "Скачать в .txt",
                    settings_logout_title: "Выйти",
                    account_info_title: "Информация об аккаунте",
                    account_info_desc: "Личные данные и настройки профиля",
                    danger_zone_title: "Опасная зона",
                    danger_zone_desc: "Действия, которые нельзя отменить",
                    model_search_placeholder: "Поиск моделей…",
                    filter_all: "Все",
                    filter_working: "Рабочие",
                    filter_free: "Бесплатные",
                    filter_new: "Новые",
                    filter_popular: "Популярные",
                    filter_best: "Лучшие",
                    filter_code: "Для кода",
                    // Home tab
                    home_welcome_back: "С возвращением,",
                    hero_title: 'Создавай картинки, видео и общайся с AI <span class="accent-text">бесплатно.</span>',
                    hero_sub: "Мощные AI-инструменты. Без ограничений. Просто опиши и создавай.",
                    hero_start_btn: "✳️ Начать создавать",
                    hero_gallery_btn: "🖼️ Смотреть галерею",
                    hero_card_caption: "✨ Белый медведь бежит в 2D игре",
                    home_what_to_do: "Что бы вы хотели сделать?",
                    htc_agent_desc: "Общайтесь с AI",
                    htc_image_title: "Генерация AI картинок",
                    htc_image_desc: "Создавайте потрясающие AI картинки",
                    htc_video_title: "Генерация AI видео",
                    htc_video_desc: "Создавайте AI видео",
                    htc_photos_desc: "Смотрите удивительные AI фото",
                    htc_videos_desc: "Смотрите созданные AI видео",
                    htc_shop_desc: "Покупайте звёзды и открывайте больше",
                    home_trending_images: "Популярные картинки",
                    home_trending_videos: "Популярные видео",
                    view_all_btn: "Смотреть все",
                    // Star shop
                    star_shop_title: "Магазин звёзд",
                    star_shop_sub: "Покупайте звёзды для генерации",
                    close_btn: "Закрыть",
                    copy_id_btn: "Скопировать мой ID",
                    // First-gen notice modal
                    first_gen_notice_title: "Важно знать! 💡",
                    first_gen_notice_body: "Так как генерация картинок и видео у нас полностью бесплатна, иногда могут возникать технические ошибки во время генерации. Это нормально — мы работаем над стабильностью каждый день!",
                    first_gen_notice_body2: "Если ты столкнулся с такой ситуацией: 📩 Напиши нам на zelmir.company@gmail.com",
                    first_gen_notice_body3: "Наша команда разберётся с проблемой и обязательно выдаст тебе компенсацию! ❤️",
                    ok_got_it: "Понятно",
                    // Welcome modal
                    welcome_create_btn: "Творить",
                    welcome_review_btn: "Оставить отзыв",
                    thinking_label: "Думаю…",
                    // Message long-press action sheet
                    msg_action_copy: "Копировать",
                    msg_action_reply: "Ответить",
                    msg_action_select: "Выделить текст",
                    msg_action_regenerate: "Повторить",
                },
            };

            const langBtnEn = $("#langBtnEn");
            const langBtnRu = $("#langBtnRu");

            const I18N_HTML_KEYS = new Set(['hero_title']);
            function applyLanguage(lang) {
                const dict = I18N[lang] || I18N.en;
                document.documentElement.setAttribute("lang", lang);
                $$("[data-i18n]").forEach(el => {
                    const key = el.getAttribute("data-i18n");
                    if (!dict[key]) return;
                    if (I18N_HTML_KEYS.has(key)) el.innerHTML = dict[key];
                    else el.textContent = dict[key];
                });
                $$("[data-i18n-placeholder]").forEach(el => {
                    const key = el.getAttribute("data-i18n-placeholder");
                    if (dict[key]) el.setAttribute("placeholder", dict[key]);
                });
                $$(".shop-item").forEach(item => {
                    const priceEl = item.querySelector(".price");
                    if (!priceEl) return;
                    if (lang === "en" && item.dataset.priceUsd) {
                        priceEl.textContent = `$${item.dataset.priceUsd}`;
                    } else {
                        priceEl.textContent = `${item.dataset.price} ₽`;
                    }
                });
                if (langBtnEn) langBtnEn.classList.toggle("selected", lang === "en");
                if (langBtnRu) langBtnRu.classList.toggle("selected", lang === "ru");
                try { localStorage.setItem("freebies_lang", lang); } catch (e) {}
                if (typeof window.updateSettingsMenuPreviews === 'function') window.updateSettingsMenuPreviews();
            }
            let savedLang = "en";
            try { savedLang = localStorage.getItem("freebies_lang") || "en"; } catch (e) {}
            applyLanguage(savedLang);
            if (langBtnEn) langBtnEn.addEventListener("click", () => applyLanguage("en"));
            if (langBtnRu) langBtnRu.addEventListener("click", () => applyLanguage("ru"));

            /* ============ INIT ============ */
            detectRegion().then(() => {
                console.log(`✅ Region detected: ${userCountry || 'unknown'}`);
            });

            initShop();
            refreshPlanUI();
            updateChatModelIndicator();
            if (typeof updateSettingsMenuPreviews === 'function') updateSettingsMenuPreviews();
            document.getElementById('saveUsernameBtn').addEventListener('click', () => {
                const input = document.getElementById('usernameInput');
                const newName = input.value.trim();
                if (newName) {
                    updateUsername(newName);
                    input.value = '';
                }
            });
            const usernameInputEl = document.getElementById('usernameInput');
            if (usernameInputEl) {
                usernameInputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        document.getElementById('saveUsernameBtn').click();
                    }
                });
            }

            updateStars();
            renderMessages();
            renderGalleries();
            renderHistoryTab();
            setTab("home");
            saveState();

            /* ============ EXPOSE ============ */
            window.state = state;
            window.syncStarsFromSupabase = syncStarsFromSupabase;
            window.spendStarsLocal = spendStarsLocal;
            window.addStarsLocal = addStarsLocal;
            window.updateStars = updateStars;
            window.openDonateModal = openDonateModal;
            window.setTab = setTab;
            window.openSidebarForBilling = openSidebar;
            window.PRICE_IMAGE = PRICE_IMAGE;
            window.PRICE_VIDEO = PRICE_VIDEO;
            window.NEW_ACCOUNT_BONUS_STARS = NEW_ACCOUNT_BONUS_STARS;
            window.PromoEngine = PromoEngine;
            window.maybeShowFirstGenNotice = maybeShowFirstGenNotice;
            window.refreshPlanUI = refreshPlanUI;

        })();
        let autoLoginShown = false;
        let registrationBonusHandled = false;
        let lastSeenUserId = null;

        const accountInfoBtn = document.getElementById('accountInfoBtn');
        const logoutBtn = document.getElementById('logoutBtn');

        function updateUI() {
            const provider = window.AppAuth ? window.AppAuth.getProvider() : null;
            const user = provider === 'supabase' ? window.AppAuth.supabase.getUser() : null;

            // Note: we don't auto-open the sign-in modal here — the authGate
            // overlay already handles first-visit sign-in/sign-up.

            const sidebarName = document.getElementById('sidebarUserName');
            const profileName = document.getElementById('profileName');
            const profileEmail = document.getElementById('profileEmail');
            const homeUserName = document.getElementById('homeUserName');

            if (user) {
                const fullName = window.AppAuth.getUserName();
                const email = window.AppAuth.getUserEmail();
                const userId = window.AppAuth.getUserId();

                if (sidebarName) sidebarName.textContent = fullName;
                if (profileName) profileName.textContent = fullName;
                if (profileEmail) profileEmail.textContent = email;
                if (homeUserName) homeUserName.textContent = fullName;
                const profileUserIdEl = document.getElementById('profileUserId');
                if (profileUserIdEl) profileUserIdEl.textContent = userId || '—';
                if (typeof window.refreshPlanUI === 'function') window.refreshPlanUI();
                if (typeof window.applyProfileAvatar === 'function') window.applyProfileAvatar();

                if (accountInfoBtn) {
                    accountInfoBtn.textContent = `👤 ${fullName}`;
                    accountInfoBtn.onclick = null;
                }
                async function doLogout() {
                    if (confirm("Log out?")) {
                        if (window.AppAuth) await window.AppAuth.signOut();
                        location.reload();
                    }
                }
                if (logoutBtn) {
                    logoutBtn.style.display = 'block';
                    logoutBtn.onclick = doLogout;
                }
                const logoutBtnMain = document.getElementById('logoutBtnMain');
                if (logoutBtnMain) {
                    logoutBtnMain.style.display = 'flex';
                    logoutBtnMain.onclick = doLogout;
                }

                if (userId !== lastSeenUserId) {
                    lastSeenUserId = userId;
                    if (typeof window.syncStarsFromSupabase === 'function') {
                        window.syncStarsFromSupabase();
                    }
                    // Re-check the per-account welcome-bonus flag whenever the logged-in user changes.
                    try {
                        const claimed = localStorage.getItem('freebies_reg_bonus_claimed_' + userId) === '1';
                        if (window.state) window.state.registrationBonusClaimed = claimed;
                    } catch (e) {}
                    registrationBonusHandled = false;
                }

                if (!registrationBonusHandled && window.state && !window.state.registrationBonusClaimed) {
                    registrationBonusHandled = true;
                    if (typeof window.claimRegistrationBonus === 'function') {
                        window.claimRegistrationBonus();
                    } else {
                        // Fallback notification
                        const notifContent = document.getElementById('notifContent');
                        if (notifContent) {
                            notifContent.innerHTML = `
                        <div style="background:#d4edda;padding:12px;border-radius:12px;margin-bottom:12px;border:1px solid #28a745;">
                          <strong>🎉 Welcome bonus!</strong><br>
                          +${window.NEW_ACCOUNT_BONUS_STARS || 1000} ⭐ stars
                        </div>
                        <p>Start generating now!</p>
                      `;
                        }
                    }
                }

            } else {
                if (sidebarName) sidebarName.textContent = 'Guest';
                if (profileName) profileName.textContent = 'Guest';
                if (profileEmail) profileEmail.textContent = 'not set';

                if (accountInfoBtn) {
                    accountInfoBtn.textContent = '🔑 Sign In';
                    accountInfoBtn.onclick = () => {
                        const gate = document.getElementById('authGate');
                        if (gate) gate.classList.remove('hidden');
                    };
                }
                if (logoutBtn) {
                    logoutBtn.style.display = 'none';
                    logoutBtn.onclick = null;
                }
                const logoutBtnMainEl = document.getElementById('logoutBtnMain');
                if (logoutBtnMainEl) {
                    logoutBtnMainEl.style.display = 'none';
                    logoutBtnMainEl.onclick = null;
                }

                if (lastSeenUserId !== null) {
                    lastSeenUserId = null;
                    if (typeof window.syncStarsFromSupabase === 'function') {
                        window.syncStarsFromSupabase();
                    }
                }
            }
        }

        // Keep the UI in sync when Supabase logs a user in/out.
        if (window.AppAuth) {
            window.AppAuth.onChange(() => updateUI());
        }
        window.updateUI = updateUI;

        // Run once on load in case AppAuth already has a session restored
        // from localStorage before this script executed.
        updateUI();

        console.log("✅ Auth integration complete (Supabase)");
