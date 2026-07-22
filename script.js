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
            let currentModel = 'gemini';
            let uncensored = false;
            let withoutEmail = false;

            // Все API-ключи теперь живут ТОЛЬКО на сервере (Vercel Environment Variables).
            // Браузер обращается к собственным serverless-эндпоинтам в /api/*, которые
            // сами подставляют ключи и проксируют запрос к Gemini / OpenRouter / Agnes AI.
            const OPENROUTER_CHAT_MODEL = "poolside/laguna-xs-2.1:free";
            const OPENROUTER_CODER_MODEL = "openai/o3-mini";
            const MAX_POLL_ATTEMPTS = 60;
            const POLL_INTERVAL = 4000;

            const PRICE_IMAGE = 40;
            const PRICE_VIDEO = 55;
            const PRICE_CODER = 2;
            const ADS_COUNT_IMAGE = 1;
            const ADS_COUNT_VIDEO = 2;

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
                registrationBonusClaimed: false,
                regionWarningShown: false,
                paymentResolve: null,
                paymentReject: null,
                paymentType: null,
            };

            function getActiveChat() {
                return state.chats.find(c => c.id === state.activeChatId) || state.chats[0];
            }

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
            const payAdsBtn = $("#payAdsBtn");
            const payCancelBtn = $("#payCancelBtn");
            const paymentTitle = $("#paymentTitle");
            const paymentSubtitle = $("#paymentSubtitle");
            const paymentStars = $("#paymentStars");
            const paymentAds = $("#paymentAds");

            const adFullscreen = $("#adFullscreen");
            const adVideo = $("#adVideo");
            const adOverlay = $("#adOverlay");
            const adCloseBtn = $("#adCloseBtn");
            const adRemaining = $("#adRemaining");
            const adTimer = $("#adTimer");
            const adProgressFill = $("#adProgressFill");

            const starsCountHeader = document.getElementById('starsCountHeader');
            const starsCountMobile = document.getElementById('starsCountMobile');
            const starsHeaderBtn = document.getElementById('starsHeaderBtn');
            const mobileStarsBtn = document.getElementById('mobileStarsBtn');

            /* ============ STARS SYSTEM (Clerk) ============ */
            const NEW_ACCOUNT_BONUS_STARS = 60;
            const GUEST_BONUS_STARS = 55;
            let starsSyncInFlight = null;

            async function syncStarsFromClerk() {
                const user = window.Clerk?.user;
                if (!user) {
                    state.stars = 0;
                    state.starsLoaded = false;
                    updateStars();
                    return;
                }
                try {
                    const pubMeta = user.publicMetadata || {};
                    const unsafeMeta = user.unsafeMetadata || {};
                    if (typeof pubMeta.stars === 'number') {
                        state.stars = pubMeta.stars;
                    } else if (typeof unsafeMeta.stars === 'number') {
                        state.stars = unsafeMeta.stars;
                    } else {
                        state.stars = NEW_ACCOUNT_BONUS_STARS;
                        await user.update({
                            publicMetadata: { ...pubMeta, stars: NEW_ACCOUNT_BONUS_STARS },
                        }).catch(() => {
                            return user.update({
                                unsafeMetadata: { ...unsafeMeta, stars: NEW_ACCOUNT_BONUS_STARS },
                            });
                        });
                    }
                    state.starsLoaded = true;
                } catch (e) {
                    console.warn('Could not read stars from Clerk:', e);
                    const meta2 = user.unsafeMetadata || {};
                    state.stars = typeof meta2.stars === 'number' ? meta2.stars : NEW_ACCOUNT_BONUS_STARS;
                    state.starsLoaded = true;
                }
                updateStars();
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
                updateStars();
            }

            async function persistStarsToClerk() {
                const user = window.Clerk?.user;
                if (!user) {
                    if (withoutEmail) {
                        try { localStorage.setItem('freebies_guest_stars', String(state.stars)); } catch (e) {}
                    }
                    return;
                }
                const task = (async () => {
                    try {
                        const meta = user.publicMetadata || {};
                        await user.update({ publicMetadata: { ...meta, stars: state.stars } });
                    } catch (e) {
                        try {
                            const meta2 = user.unsafeMetadata || {};
                            await user.update({ unsafeMetadata: { ...meta2, stars: state.stars } });
                        } catch (e2) {
                            console.warn('Could not save stars to Clerk:', e2);
                        }
                    }
                })();
                starsSyncInFlight = task;
                await task;
            }

            function updateStars() {
                const count = state.stars;
                if (starsCountHeader) starsCountHeader.textContent = count;
                if (starsCountMobile) starsCountMobile.textContent = count;
                saveState();
            }

            async function spendStarsLocal(amount) {
                if (state.stars < amount) return false;
                state.stars -= amount;
                updateStars();
                await persistStarsToClerk();
                return true;
            }

            async function addStarsLocal(amount) {
                state.stars += amount;
                updateStars();
                await persistStarsToClerk();
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
            function getPriceForType(type) {
                if (type === 'coder') return PRICE_CODER;
                if (type === 'video') return PRICE_VIDEO;
                return PRICE_IMAGE;
            }

            function showPaymentModal(type) {
                return new Promise((resolve, reject) => {
                    const price = getPriceForType(type);
                    const isCoder = type === 'coder';
                    const itemName = type === 'image' ? 'image' : (type === 'video' ? 'video' : 'code');

                    if (!withoutEmail && !window.Clerk?.user) {
                        window.Clerk?.openSignIn?.();
                        reject(new Error('Authorization required'));
                        return;
                    }

                    paymentTitle.textContent = type === 'image' ? '🎨 Generate Image'
                        : type === 'video' ? '🎬 Generate Video'
                        : '👨‍💻 Generate Code (The Coder)';
                    paymentSubtitle.textContent = `Choose payment method for ${itemName}`;
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

                    if (isCoder) {
                        payAdsBtn.style.display = 'none';
                        paymentAds.parentElement.style.display = 'none';
                    } else {
                        const adsCount = type === 'video' ? ADS_COUNT_VIDEO : ADS_COUNT_IMAGE;
                        payAdsBtn.style.display = '';
                        paymentAds.parentElement.style.display = '';
                        paymentAds.textContent = `${adsCount} × 30s`;
                        payAdsBtn.textContent = adsCount > 1
                            ? `📺 Watch ${adsCount} ads (cannot skip)`
                            : '📺 Watch ad (cannot skip)';
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

            payAdsBtn.addEventListener('click', () => {
                const type = state.paymentType || 'image';
                if (type === 'coder') return;
                const adsCount = type === 'video' ? ADS_COUNT_VIDEO : ADS_COUNT_IMAGE;
                closePaymentModal();
                showAdFullscreen(adsCount).then(() => {
                    if (state.paymentResolve) state.paymentResolve();
                    state.paymentResolve = null;
                }).catch(() => {
                    if (state.paymentReject) state.paymentReject(new Error('Ad not completed'));
                    state.paymentReject = null;
                });
            });

            payCancelBtn.addEventListener('click', () => {
                closePaymentModal();
                if (state.paymentReject) state.paymentReject(new Error('Cancelled by user'));
                state.paymentReject = null;
            });

            /* ============ SHOP / PROMO ============ */
            function openShopAndPromo() {
                if (typeof window.setTab === 'function') window.setTab('chat');
                const promo = document.getElementById('shop2000Promo');
                const shopItem2000 = document.querySelector('.shop-item[data-stars="2000"]');
                if (typeof window.openSidebarForBilling === 'function') window.openSidebarForBilling();
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

            /* ============ AD FULLSCREEN ============ */
            function showAdFullscreen(count) {
                return new Promise((resolve, reject) => {
                    let remaining = count;
                    let adResolve = resolve;
                    let adReject = reject;
                    let progressInterval = null;

                    adFullscreen.classList.add('active');
                    adOverlay.classList.remove('show');
                    adRemaining.textContent = `Ad ${remaining} of ${count}`;
                    adProgressFill.style.width = '0%';
                    adTimer.textContent = '0s';

                    const video = adVideo;
                    video.muted = true;

                    function playNextAd() {
                        video.load();
                        video.play().catch(() => {});
                        adProgressFill.style.width = '0%';
                        adOverlay.classList.remove('show');
                        adRemaining.textContent = `Ad ${remaining} of ${count}`;
                        if (progressInterval) clearInterval(progressInterval);
                        progressInterval = setInterval(() => {
                            if (video.duration) {
                                const progress = (video.currentTime / video.duration) * 100;
                                adProgressFill.style.width = Math.min(progress, 100) + '%';
                                adTimer.textContent = Math.floor(video.currentTime) + 's';
                            }
                        }, 200);
                    }

                    function onVideoEnded() {
                        if (progressInterval) clearInterval(progressInterval);
                        remaining--;
                        if (remaining <= 0) {
                            adOverlay.classList.add('show');
                            adRemaining.textContent = 'Ad completed ✓';
                            adTimer.textContent = '0s';
                            adProgressFill.style.width = '100%';
                            return;
                        }
                        playNextAd();
                    }

                    video.addEventListener('ended', onVideoEnded);

                    adCloseBtn.addEventListener('click', function handler() {
                        if (remaining > 0) return;
                        adFullscreen.classList.remove('active');
                        video.pause();
                        video.removeEventListener('ended', onVideoEnded);
                        adCloseBtn.removeEventListener('click', handler);
                        if (progressInterval) clearInterval(progressInterval);
                        if (adResolve) adResolve();
                    });

                    video.addEventListener('click', (e) => {
                        e.preventDefault();
                        if (remaining > 0) {
                            video.currentTime = Math.min(video.currentTime + 0.5, video.duration);
                        }
                    });

                    document.addEventListener('keydown', function keyHandler(e) {
                        if (remaining > 0 && (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                        if (e.key === 'Escape' && remaining <= 0) {
                            adCloseBtn.click();
                        }
                    }, true);

                    playNextAd();

                    setTimeout(() => {
                        if (adFullscreen.classList.contains('active') && remaining > 0) {
                            onVideoEnded();
                        }
                    }, 60000);
                });
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
                const userId = window.Clerk?.user?.id || null;
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
                    const id = window.Clerk?.user?.id;
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

            /* ============ USERNAME UPDATE ============ */
            async function updateUsername(newName) {
                if (!window.Clerk || !window.Clerk.user) {
                    alert('You are not authorized.');
                    return;
                }
                try {
                    await window.Clerk.user.update({ firstName: newName });
                    alert('✅ Name updated successfully!');
                    const sidebarName = document.getElementById('sidebarUserName');
                    if (sidebarName) sidebarName.textContent = newName;
                    const profileName = document.getElementById('profileName');
                    if (profileName) profileName.textContent = newName;
                } catch (err) {
                    console.error(err);
                    alert('❌ Error updating name: ' + err.message);
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

            /* ============ NOTIFICATIONS ============ */
            function openNotifModal() {
                notifModal.classList.add("active");
            }

            function closeNotifModal() {
                notifModal.classList.remove("active");
            }

            notifBtn.addEventListener("click", openNotifModal);
            mobileNotifBtn.addEventListener("click", openNotifModal);
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

            /* ============ TABS ============ */
            const ALL_TABS = ["chat", "gen-image", "unlimited-gen", "gen-video", "coder", "photos", "videos", "history", "profile", "contacts"];

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
            }
            $$(".tab-btn").forEach(btn => {
                btn.addEventListener("click", () => setTab(btn.dataset.tab));
            });

            const adBannerBtn = $("#adBannerBtn");
            if (adBannerBtn) {
                adBannerBtn.addEventListener("click", () => setTab("gen-video"));
            }

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
                img.src = role === "user" ? "img/user-avatar.png" : "favicon.png";
                img.onerror = () => {
                    img.style.display = "none";
                    av.textContent = role === "user" ? "🙂" : "🎁";
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
                    p.className = "text-[15px] leading-6 whitespace-pre-wrap";
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
                        loadWrap.innerHTML = `
                  <span class="dot w-2 h-2 rounded-full bg-beige-400 inline-block"></span>
                  <span class="dot w-2 h-2 rounded-full bg-beige-400 inline-block"></span>
                  <span class="dot w-2 h-2 rounded-full bg-beige-400 inline-block"></span>
                `;
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
                return wrap;
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

                const res = await fetch('/api/gemini', {
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

            async function callLagunaChat(prompt, imageBase64 = null, mimeType = null) {
                const messages = [
                    { role: "system", content: getSystemPrompt() },
                    { role: "user", content: prompt },
                ];
                const res = await fetch('/api/openrouter', {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: OPENROUTER_CHAT_MODEL,
                        messages,
                        max_tokens: 800,
                    }),
                });
                if (!res.ok) {
                    const errText = await res.text().catch(() => "");
                    throw new Error(`Laguna error (${res.status}): ${errText.slice(0, 200)}`);
                }
                const data = await res.json();
                let content = data?.choices?.[0]?.message?.content;
                if (!content) throw new Error("Empty response from Laguna.");
                return cleanText(content);
            }

            async function callChatAI(prompt, imageBase64 = null, mimeType = null) {
                let lastError = null;
                try {
                    if (currentModel === 'gemini') {
                        return await callGemini(prompt, imageBase64, mimeType, true);
                    } else {
                        return await callLagunaChat(prompt, imageBase64, mimeType);
                    }
                } catch (err) {
                    console.warn(`Model ${currentModel} failed:`, err);
                    lastError = err;
                }
                const fallback = currentModel === 'gemini' ? 'laguna' : 'gemini';
                try {
                    console.log(`Trying fallback: ${fallback}`);
                    let result;
                    if (fallback === 'gemini') {
                        result = await callGemini(prompt, imageBase64, mimeType, true);
                    } else {
                        result = await callLagunaChat(prompt, imageBase64, mimeType);
                    }
                    currentModel = fallback;
                    saveState();
                    return result;
                } catch (err) {
                    console.warn(`Fallback ${fallback} failed:`, err);
                    lastError = err;
                }
                throw lastError || new Error("All models unavailable");
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
                    const res = await fetch('/api/agnes-image', {
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

            async function callAgnesVideo(prompt, startImageBase64, onStatus, options) {
                options = options || {};
                const res = await fetch('/api/agnes-video', {
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
                        const pollRes = await fetch(`/api/agnes-video-status?video_id=${encodeURIComponent(videoId)}`);
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
                    } else if (command === '/laguna') {
                        currentModel = 'laguna';
                        saveState();
                        addMessage({ role: "assistant", text: "✅ Switched to **Laguna** model" });
                        msgInput.value = '';
                        return;
                    } else if (command === '/gemini') {
                        currentModel = 'gemini';
                        saveState();
                        addMessage({ role: "assistant", text: "✅ Switched to **Gemini** model" });
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
                            if (typeof window.syncStarsFromClerk === 'function') window.syncStarsFromClerk();
                            addMessage({ role: "assistant", text: `✅ Guest mode **${status}**.` });
                        }
                        msgInput.value = '';
                        return;
                    } else {
                        msgInput.value = '';
                        return;
                    }
                }

                // Check auth
                if (!withoutEmail && (!window.Clerk || !window.Clerk.user)) {
                    if (window.Clerk) window.Clerk.openSignIn();
                    else alert('Please log in.');
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

                try {
                    if (intent.type === "text") {
                        const thinking = addMessage({ role: "assistant", loading: true });
                        let imageBase64 = null,
                            mimeType = null;
                        if (attach && attach.type === "image") {
                            imageBase64 = attach.base64.split(',')[1];
                            mimeType = attach.type === "image" ? "image/png" : "image/jpeg";
                        }
                        const reply = await callChatAI(text, imageBase64, mimeType);
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

                if (!withoutEmail && (!window.Clerk || !window.Clerk.user)) {
                    if (window.Clerk) window.Clerk.openSignIn();
                    else alert('Please log in.');
                    return;
                }

                const size = selectedImgRatioBtn.dataset.size;

                try {
                    const imgUrl = await generateWithQueue('image', async () => {
                        const enhanced = await enhancePrompt(prompt, 'image');
                        return await callAgnesImage(enhanced, imgMode === "image" ? imgSourceBase64 : null, { size });
                    });
                    renderImageResult(imgGenResult, imgUrl);
                    state.photos.push({ id: "p_" + Date.now(), url: imgUrl, ts: nowLabel(), prompt });
                    renderGalleries();
                    saveState();
                    addNotification('🖼️ Image generated successfully!', 'success');
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

            let selectedUgStyleBtn = $('#ugStyleGroup .ug-style-btn[data-style=""]');
            if (selectedUgStyleBtn) selectedUgStyleBtn.classList.add("selected");
            $$("#ugStyleGroup .ug-style-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    $$("#ugStyleGroup .ug-style-btn").forEach(b => b.classList.remove("selected"));
                    btn.classList.add("selected");
                    selectedUgStyleBtn = btn;
                });
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
                        <span class="ug-card-loader-text">Generating…</span>
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
                const encodedPrompt = encodeURIComponent(prompt);
                const seed = Math.floor(Math.random() * 1000000);
                const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 45000);
                try {
                    const response = await fetch(url, { signal: controller.signal });
                    if (!response.ok) throw new Error('Pollinations request failed');
                    const blob = await response.blob();
                    return URL.createObjectURL(blob);
                } finally {
                    clearTimeout(timeoutId);
                }
            }

            if (ugGenerateBtn) {
                ugGenerateBtn.addEventListener("click", async () => {
                    const basePrompt = (ugPromptInput.value || "").trim();
                    if (!basePrompt) {
                        ugPromptInput.focus();
                        return;
                    }
                    const styleSuffix = selectedUgStyleBtn ? selectedUgStyleBtn.dataset.style : "";
                    const fullPrompt = styleSuffix ? `${basePrompt}, ${styleSuffix}` : basePrompt;
                    const [width, height] = selectedUgRatioBtn.dataset.size.split("x").map(Number);
                    const count = Number(selectedUgCountBtn.dataset.count);

                    ugGenerateBtn.disabled = true;
                    ugGrid.innerHTML = "";
                    const cards = [];
                    for (let i = 0; i < count; i++) {
                        const card = createUgCard();
                        ugGrid.appendChild(card);
                        cards.push(card);
                    }

                    const MAX_CONCURRENT = 3;
                    const MAX_RETRIES = 2;
                    let nextIndex = 0;

                    async function generateWithRetry(card) {
                        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                            try {
                                const url = await generateOnePollinationsImage(fullPrompt, width, height);
                                fillUgCardWithImage(card, url);
                                state.photos.push({ id: "ug_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7), url, ts: nowLabel(), prompt: fullPrompt });
                                return;
                            } catch (err) {
                                if (attempt === MAX_RETRIES) {
                                    console.error(err);
                                    fillUgCardWithError(card);
                                } else {
                                    await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
                                }
                            }
                        }
                    }

                    async function worker() {
                        while (nextIndex < cards.length) {
                            const i = nextIndex++;
                            await generateWithRetry(cards[i]);
                            await new Promise(r => setTimeout(r, 300));
                        }
                    }

                    const workerCount = Math.min(MAX_CONCURRENT, cards.length);
                    await Promise.all(Array.from({ length: workerCount }, () => worker()));

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

                if (!withoutEmail && (!window.Clerk || !window.Clerk.user)) {
                    if (window.Clerk) window.Clerk.openSignIn();
                    else alert('Please log in.');
                    return;
                }

                const dims = selectedVidRatioBtn.dataset.dims;
                const duration = Number(selectedVidDurationBtn.dataset.duration);

                try {
                    const vidUrl = await generateWithQueue('video', async () => {
                        const enhanced = await enhancePrompt(prompt, 'video');
                        return await callAgnesVideo(enhanced, vidMode === "image" ? vidSourceBase64 : null, (label) => {
                            loaderText.textContent = label;
                        }, { dims, duration });
                    });
                    renderVideoResult(vidGenResult, vidUrl);
                    state.videos.push({ id: "v_" + Date.now(), url: vidUrl, ts: nowLabel(), prompt });
                    renderGalleries();
                    saveState();
                    addNotification('🎬 Video generated successfully!', 'success');
                } catch (err) {
                    console.error(err);
                    if (err.message !== 'Cancelled by user' && err.message !== 'Not enough stars') {
                        renderGenError(vidGenResult, err.message || "Generation error. Stars refunded.");
                    }
                }
            });

            /* ============ CODER ============ */
            const coderPromptInput = $("#coderPromptInput");
            const coderGenerateBtn = $("#coderGenerateBtn");
            const coderGenResult = $("#coderGenResult");

            function renderTextLoading(container, label) {
                container.innerHTML = "";
                const col = document.createElement("div");
                col.className = "flex items-center gap-2";
                col.innerHTML = `
                  <span class="dot w-2 h-2 rounded-full bg-beige-400 inline-block"></span>
                  <span class="dot w-2 h-2 rounded-full bg-beige-400 inline-block"></span>
                  <span class="dot w-2 h-2 rounded-full bg-beige-400 inline-block"></span>
                  <span class="text-[12px] text-slate-400 ml-1">${label}</span>
                `;
                container.appendChild(col);
            }

            async function callCoder(userText) {
                const messages = [
                    { role: "system",
                        content: "You are an experienced coding assistant. Generate working code based on the user's request, split into separate files (1-15 files — choose the optimal number based on the task and logical project structure). Total code should not exceed about 8999 lines. Each file MUST be formatted as follows:\n\n===FILE: filename.extension===\n```language\n(code)\n```\n\nGive meaningful filenames (e.g. main.py, utils.py, index.html, styles.css, api/routes.js). Before the first file, briefly (1-3 sentences) describe the project structure in English. No extra comments between files — only ===FILE: ...=== headers before each code block." },
                    { role: "user", content: userText },
                ];

                const res = await fetch('/api/openrouter', {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: OPENROUTER_CODER_MODEL,
                        messages,
                        max_tokens: 16000,
                    }),
                });

                if (!res.ok) {
                    const errText = await res.text().catch(() => "");
                    throw new Error(`Coder error (${res.status}): ${errText.slice(0, 200)}`);
                }
                const data = await res.json();
                let content = data?.choices?.[0]?.message?.content;
                if (!content) throw new Error("Empty response from model.");
                return content;
            }

            function parseCoderFiles(raw) {
                const files = [];
                let intro = "";
                const fileHeaderRe = /===FILE:\s*([^\n=]+?)\s*===/gi;
                const matches = [...raw.matchAll(fileHeaderRe)];

                if (matches.length === 0) {
                    const parts = raw.split(/```/g);
                    let fileIdx = 0;
                    parts.forEach((part, idx) => {
                        if (!part.trim()) return;
                        if (idx % 2 === 1) {
                            const lines = part.split("\n");
                            let lang = "";
                            if (lines[0] && /^[a-zA-Z0-9+#.-]{1,20}$/.test(lines[0].trim())) {
                                lang = lines.shift().trim();
                            }
                            const code = lines.join("\n").replace(/\n$/, "");
                            fileIdx++;
                            const ext = extForLang(lang);
                            files.push({ name: `file${fileIdx}${ext}`, lang: lang || "text", code });
                        } else if (!intro) {
                            intro = part.trim();
                        }
                    });
                    return { intro, files: files.slice(0, 15) };
                }

                intro = raw.slice(0, matches[0].index).trim();

                for (let i = 0; i < matches.length; i++) {
                    const name = matches[i][1].trim();
                    const segStart = matches[i].index + matches[i][0].length;
                    const segEnd = i + 1 < matches.length ? matches[i + 1].index : raw.length;
                    const segment = raw.slice(segStart, segEnd);

                    const fenceMatch = segment.match(/```([a-zA-Z0-9+#.-]*)\n?([\s\S]*?)```/);
                    let lang = "",
                        code;
                    if (fenceMatch) {
                        lang = (fenceMatch[1] || "").trim();
                        code = fenceMatch[2].replace(/\n$/, "");
                    } else {
                        code = segment.trim();
                    }
                    files.push({ name, lang: lang || "text", code });
                }

                return { intro, files: files.slice(0, 15) };
            }

            function extForLang(lang) {
                const map = {
                    python: ".py",
                    py: ".py",
                    javascript: ".js",
                    js: ".js",
                    typescript: ".ts",
                    ts: ".ts",
                    html: ".html",
                    css: ".css",
                    json: ".json",
                    java: ".java",
                    c: ".c",
                    cpp: ".cpp",
                    "c++": ".cpp",
                    csharp: ".cs",
                    "c#": ".cs",
                    go: ".go",
                    rust: ".rs",
                    php: ".php",
                    ruby: ".rb",
                    sql: ".sql",
                    bash: ".sh",
                    sh: ".sh",
                    yaml: ".yml",
                    xml: ".xml",
                    swift: ".swift",
                    kotlin: ".kt",
                };
                return map[lang.toLowerCase()] || ".txt";
            }

            function renderCodeResult(container, raw) {
                container.innerHTML = "";
                const { intro, files } = parseCoderFiles(raw);

                const wrap = document.createElement("div");
                wrap.className = "flex flex-col gap-3";

                if (intro) {
                    const p = document.createElement("p");
                    p.className = "text-[14px] leading-6 text-slate-700 whitespace-pre-wrap";
                    p.textContent = intro;
                    wrap.appendChild(p);
                }

                if (files.length === 0) {
                    const p = document.createElement("p");
                    p.className = "text-[14px] leading-6 text-slate-700 whitespace-pre-wrap";
                    p.textContent = raw.trim();
                    wrap.appendChild(p);
                    container.appendChild(wrap);
                    return;
                }

                const topBar = document.createElement("div");
                topBar.className = "flex items-center justify-between gap-2 px-1";
                const countLabel = document.createElement("span");
                countLabel.className = "text-[12.5px] text-slate-400";
                countLabel.textContent = files.length === 1 ? "1 file generated" : `${files.length} files generated`;
                topBar.appendChild(countLabel);

                const downloadAllBtn = document.createElement("button");
                downloadAllBtn.className =
                    "flex items-center gap-1.5 rounded-xl btn-accent px-3.5 py-2 text-[13px] font-medium active:scale-[0.98] transition";
                downloadAllBtn.innerHTML = `📦 Download all (.zip)`;
                downloadAllBtn.addEventListener("click", () => downloadFilesAsZip(files, downloadAllBtn));
                topBar.appendChild(downloadAllBtn);
                wrap.appendChild(topBar);

                files.forEach(file => {
                    const block = document.createElement("div");
                    block.className = "relative rounded-2xl overflow-hidden border border-slate-200 bg-[#1e1e1e]";
                    const bar = document.createElement("div");
                    bar.className = "flex items-center justify-between gap-2 px-4 py-2 bg-[#2a2a2a]";
                    bar.innerHTML =
                        `<span class="text-[12px] font-medium text-slate-100 font-mono truncate">${escapeHtml(file.name)}</span>`;
                    const btnGroup = document.createElement("div");
                    btnGroup.className = "flex items-center gap-1.5 shrink-0";
                    const dlBtn = document.createElement("button");
                    dlBtn.className =
                        "text-[11.5px] font-medium text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-lg transition";
                    dlBtn.textContent = "Download .txt";
                    dlBtn.addEventListener("click", () => downloadSingleFileAsTxt(file));
                    btnGroup.appendChild(dlBtn);
                    const copyBtn = document.createElement("button");
                    copyBtn.className =
                        "text-[11.5px] font-medium text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-lg transition";
                    copyBtn.textContent = "Copy";
                    copyBtn.addEventListener("click", () => {
                        navigator.clipboard.writeText(file.code).then(() => {
                            copyBtn.textContent = "Copied ✓";
                            setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
                        });
                    });
                    btnGroup.appendChild(copyBtn);
                    bar.appendChild(btnGroup);
                    block.appendChild(bar);
                    const pre = document.createElement("pre");
                    pre.className = "overflow-x-auto p-4 m-0 max-h-96";
                    const codeEl = document.createElement("code");
                    codeEl.className = "text-[13px] leading-6 text-slate-100 font-mono whitespace-pre";
                    codeEl.textContent = file.code;
                    pre.appendChild(codeEl);
                    block.appendChild(pre);
                    wrap.appendChild(block);
                });

                container.appendChild(wrap);
            }

            function escapeHtml(str) {
                const div = document.createElement("div");
                div.textContent = str;
                return div.innerHTML;
            }

            function downloadSingleFileAsTxt(file) {
                const baseName = file.name.replace(/\.[^/.]+$/, "") || "file";
                const blob = new Blob([file.code], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${baseName}.txt`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }

            async function downloadFilesAsZip(files, triggerBtn) {
                if (typeof JSZip === "undefined") {
                    alert("Could not load archive library.");
                    return;
                }
                const originalLabel = triggerBtn.innerHTML;
                triggerBtn.disabled = true;
                triggerBtn.innerHTML = "Archiving…";
                try {
                    const zip = new JSZip();
                    const usedNames = new Set();
                    files.forEach(file => {
                        let baseName = (file.name || "file").replace(/\.[^/.]+$/, "");
                        let finalName = `${baseName}.txt`;
                        let n = 2;
                        while (usedNames.has(finalName)) {
                            finalName = `${baseName}_${n}.txt`;
                            n++;
                        }
                        usedNames.add(finalName);
                        zip.file(finalName, file.code);
                    });
                    const blob = await zip.generateAsync({ type: "blob" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "freebies-code.zip";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (err) {
                    console.error(err);
                    alert("Could not create archive.");
                } finally {
                    triggerBtn.disabled = false;
                    triggerBtn.innerHTML = originalLabel;
                }
            }

            coderGenerateBtn.addEventListener("click", async () => {
                const prompt = coderPromptInput.value.trim();
                if (!prompt) {
                    coderPromptInput.focus();
                    return;
                }
                coderGenerateBtn.disabled = true;
                try {
                    const result = await generateWithQueue('coder', async () => {
                        renderTextLoading(coderGenResult, "Writing code…");
                        return await callCoder(prompt);
                    });
                    renderCodeResult(coderGenResult, result);
                    addNotification('👨‍💻 Code generated successfully!', 'success');
                } catch (err) {
                    console.error(err);
                    if (err.message !== 'Cancelled by user' && err.message !== 'Not enough stars') {
                        renderGenError(coderGenResult, err.message || "Code generation error.");
                    }
                } finally {
                    coderGenerateBtn.disabled = false;
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
                    appearance_title: "Appearance",
                    appearance_desc: "Theme and look of the app",
                    dark_theme_label: "Dark theme",
                    language_title: "Language",
                    language_desc: "App interface language",
                    language_label: "English / Русский",
                },
                ru: {
                    shop_title: "Магазин звёзд",
                    promo_2000: "Акция: выгодно бери 2000 ⭐",
                    appearance_title: "Внешний вид",
                    appearance_desc: "Тема и оформление приложения",
                    dark_theme_label: "Тёмная тема",
                    language_title: "Язык",
                    language_desc: "Язык интерфейса приложения",
                    language_label: "English / Русский",
                },
            };

            const langToggleEl = $("#langToggle");
            const langSwitchEl = langToggleEl ? langToggleEl.closest(".theme-switch") : null;

            function applyLanguage(lang) {
                const dict = I18N[lang] || I18N.en;
                document.documentElement.setAttribute("lang", lang);
                $$("[data-i18n]").forEach(el => {
                    const key = el.getAttribute("data-i18n");
                    if (dict[key]) el.textContent = dict[key];
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
                if (langSwitchEl) langSwitchEl.classList.toggle("on", lang === "ru");
                if (langToggleEl) langToggleEl.checked = lang === "ru";
                try { localStorage.setItem("freebies_lang", lang); } catch (e) {}
            }
            let savedLang = "en";
            try { savedLang = localStorage.getItem("freebies_lang") || "en"; } catch (e) {}
            applyLanguage(savedLang);
            if (langSwitchEl) {
                langSwitchEl.addEventListener("click", () => applyLanguage(langToggleEl.checked ? "en" : "ru"));
            }

            /* ============ INIT ============ */
            detectRegion().then(() => {
                console.log(`✅ Region detected: ${userCountry || 'unknown'}`);
            });

            initShop();
            document.getElementById('saveUsernameBtn').addEventListener('click', () => {
                const input = document.getElementById('usernameInput');
                const newName = input.value.trim();
                if (newName) {
                    updateUsername(newName);
                    input.value = '';
                } else {
                    alert('Enter a new name.');
                }
            });

            updateStars();
            renderMessages();
            renderGalleries();
            renderHistoryTab();
            setTab("chat");
            saveState();

            /* ============ EXPOSE ============ */
            window.state = state;
            window.syncStarsFromClerk = syncStarsFromClerk;
            window.spendStarsLocal = spendStarsLocal;
            window.addStarsLocal = addStarsLocal;
            window.updateStars = updateStars;
            window.openDonateModal = openDonateModal;
            window.setTab = setTab;
            window.openSidebarForBilling = openSidebar;
            window.PRICE_IMAGE = PRICE_IMAGE;
            window.PRICE_VIDEO = PRICE_VIDEO;
            window.PRICE_CODER = PRICE_CODER;

        })();
        let clerkReady = false;
        let autoLoginShown = false;
        let registrationBonusHandled = false;
        let lastSeenUserId = null;

        window.addEventListener('load', async () => {
            if (typeof window.Clerk === 'undefined') {
                console.error("❌ Clerk script failed to load.");
                return;
            }
            try {
                await window.Clerk.load();
                console.log("✅ Clerk loaded successfully");
                clerkReady = true;
                updateUI();
                window.Clerk.addListener(({ user }) => {
                    updateUI();
                });
            } catch (err) {
                console.error("❌ Clerk init error:", err);
            }
        });

        const accountInfoBtn = document.getElementById('accountInfoBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const editProfileBtn = document.getElementById('editProfileBtn');
        const subscriptionBtn = document.getElementById('subscriptionBtn');
        const billingBtn = document.getElementById('billingBtn');
        const settingsButtons = [editProfileBtn, subscriptionBtn];

        function openBillingPromo() {
            if (typeof window.setTab === 'function') window.setTab('chat');
            const promo = document.getElementById('shop2000Promo');
            const shopItem2000 = document.querySelector('.shop-item[data-stars="2000"]');
            if (typeof window.openSidebarForBilling === 'function') window.openSidebarForBilling();
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
        if (billingBtn) {
            billingBtn.onclick = openBillingPromo;
        }

        function updateUI() {
            if (!window.Clerk) return;

            const user = window.Clerk.user;

            if (!user && !autoLoginShown && clerkReady) {
                autoLoginShown = true;
                setTimeout(() => {
                    if (window.Clerk && !window.Clerk.user) {
                        console.log("🔑 Opening sign-in");
                        window.Clerk.openSignIn();
                    }
                }, 300);
            }

            const sidebarName = document.getElementById('sidebarUserName');
            const profileName = document.getElementById('profileName');
            const profileEmail = document.getElementById('profileEmail');
            const profilePlan = document.getElementById('profilePlan');

            if (user) {
                const fullName = user.fullName || user.username || 'User';
                const email = user.primaryEmailAddress?.emailAddress || 'email@gmail.com';

                if (sidebarName) sidebarName.textContent = fullName;
                if (profileName) profileName.textContent = fullName;
                if (profileEmail) profileEmail.textContent = email;
                if (profilePlan) profilePlan.textContent = 'Premium';

                if (accountInfoBtn) {
                    accountInfoBtn.textContent = `👤 ${email}`;
                    accountInfoBtn.onclick = null;
                }
                if (logoutBtn) {
                    logoutBtn.style.display = 'block';
                    logoutBtn.onclick = async () => {
                        if (confirm("Log out?")) {
                            await window.Clerk.signOut();
                            location.reload();
                        }
                    };
                }
                settingsButtons.forEach(btn => {
                    if (btn) {
                        btn.onclick = () => alert(`🛠 ${btn.textContent.trim()} (demo mode)`);
                    }
                });

                if (user.id !== lastSeenUserId) {
                    lastSeenUserId = user.id;
                    if (typeof window.syncStarsFromClerk === 'function') {
                        window.syncStarsFromClerk();
                    }
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
                          +${window.NEW_ACCOUNT_BONUS_STARS || 60} ⭐ stars
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
                if (profilePlan) profilePlan.textContent = 'Free';

                if (accountInfoBtn) {
                    accountInfoBtn.textContent = '🔑 Sign In';
                    accountInfoBtn.onclick = () => { if (window.Clerk) window.Clerk.openSignIn(); };
                }
                if (logoutBtn) {
                    logoutBtn.style.display = 'none';
                    logoutBtn.onclick = null;
                }
                settingsButtons.forEach(btn => {
                    if (btn) {
                        btn.onclick = () => { if (window.Clerk) window.Clerk.openSignIn(); };
                    }
                });

                if (lastSeenUserId !== null) {
                    lastSeenUserId = null;
                    if (typeof window.syncStarsFromClerk === 'function') {
                        window.syncStarsFromClerk();
                    }
                }
            }
        }

        console.log("✅ Clerk integration complete");
