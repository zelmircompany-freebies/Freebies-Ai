/* ============================================================
   REGION-AWARE AUTH
   - Detects whether the visitor is in Russia.
   - Russia  -> VK ID (VK / Odnoklassniki / Mail) as the primary login.
               Stars & profile for these users live in localStorage.
   - Rest of the world -> Clerk (unchanged, still synced server-side).
   - Both paths also expose a common window.AppAuth interface so the
     rest of the app (script.js) doesn't need to care which provider
     is active.
   ============================================================ */
(function () {
    "use strict";

    const VK_APP_ID = 54715015;
    // Redirect URL registered in the VK ID app settings. VK ID only allows
    // redirecting to URLs registered there, so we keep the vercel.app URL
    // here and let the custom domain (freebies-ai.site) simply load the
    // same app — the OAuth round-trip always finishes on the vercel.app
    // origin and the SDK/localStorage state is shared through the same
    // deployment, so this keeps things working reliably either way.
    const VK_REDIRECT_URL = 'https://freebies-ai.vercel.app/';

    const LS_REGION_KEY = 'freebies_region_cache';
    const LS_VK_USER_KEY = 'freebies_vk_user';
    const LS_VK_STARS_KEY = 'freebies_vk_stars';
    const LS_VK_DAILY_KEY = 'freebies_vk_daily';

    const REGION_CACHE_MS = 6 * 60 * 60 * 1000; // 6h cache so we don't re-hit the geo API every load

    /* ---------- Region detection ---------- */

    function readCachedRegion() {
        try {
            const raw = localStorage.getItem(LS_REGION_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || typeof data.isRussia !== 'boolean' || !data.ts) return null;
            if (Date.now() - data.ts > REGION_CACHE_MS) return null;
            return data.isRussia;
        } catch (e) { return null; }
    }

    function cacheRegion(isRussia) {
        try {
            localStorage.setItem(LS_REGION_KEY, JSON.stringify({ isRussia, ts: Date.now() }));
        } catch (e) { /* ignore */ }
    }

    function guessRegionFromTimezone() {
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            const ruZones = [
                'Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Europe/Volgograd',
                'Europe/Saratov', 'Europe/Ulyanovsk', 'Europe/Kirov', 'Europe/Astrakhan',
                'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Barnaul',
                'Asia/Tomsk', 'Asia/Novokuznetsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk',
                'Asia/Chita', 'Asia/Yakutsk', 'Asia/Khandyga', 'Asia/Vladivostok',
                'Asia/Ust-Nera', 'Asia/Magadan', 'Asia/Sakhalin', 'Asia/Srednekolymsk',
                'Asia/Kamchatka', 'Asia/Anadyr',
            ];
            if (ruZones.includes(tz)) return true;
            // Language is a weak secondary signal, only used if timezone is inconclusive.
            const lang = (navigator.language || '').toLowerCase();
            if (lang.startsWith('ru')) return true;
            return false;
        } catch (e) {
            return false;
        }
    }

    async function detectRegionIsRussia() {
        const cached = readCachedRegion();
        if (cached !== null) return cached;

        // Free, no-key geo IP lookup. If it fails for any reason (network,
        // rate limit, blocked in the deployment env) we fall back to the
        // timezone/language heuristic so the login gate never gets stuck.
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3500);
            const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
            clearTimeout(timeout);
            if (res.ok) {
                const data = await res.json();
                if (data && data.country_code) {
                    const isRussia = data.country_code === 'RU';
                    cacheRegion(isRussia);
                    return isRussia;
                }
            }
        } catch (e) {
            // fall through to heuristic
        }

        const heuristic = guessRegionFromTimezone();
        cacheRegion(heuristic);
        return heuristic;
    }

    /* ---------- VK ID ---------- */

    let vkSdkLoadPromise = null;
    function loadVkSdk() {
        if (vkSdkLoadPromise) return vkSdkLoadPromise;
        vkSdkLoadPromise = new Promise((resolve, reject) => {
            if (window.VKIDSDK) { resolve(window.VKIDSDK); return; }
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@vkid/sdk@<3.0.0/dist-sdk/umd/index.js';
            script.async = true;
            script.onload = () => {
                if (window.VKIDSDK) resolve(window.VKIDSDK);
                else reject(new Error('VK ID SDK failed to initialize'));
            };
            script.onerror = () => reject(new Error('VK ID SDK failed to load'));
            document.head.appendChild(script);
        });
        return vkSdkLoadPromise;
    }

    function readVkUser() {
        try {
            const raw = localStorage.getItem(LS_VK_USER_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function writeVkUser(user) {
        try { localStorage.setItem(LS_VK_USER_KEY, JSON.stringify(user)); } catch (e) { /* ignore */ }
    }

    function clearVkUser() {
        try {
            localStorage.removeItem(LS_VK_USER_KEY);
            localStorage.removeItem(LS_VK_STARS_KEY);
            localStorage.removeItem(LS_VK_DAILY_KEY);
        } catch (e) { /* ignore */ }
    }

    const vkAuthState = {
        user: readVkUser(),
        listeners: [],
    };

    function notifyVkListeners() {
        vkAuthState.listeners.forEach((fn) => {
            try { fn(vkAuthState.user); } catch (e) { /* ignore */ }
        });
    }

    async function fetchVkUserInfo(VKID, accessToken) {
        try {
            const info = await VKID.Auth.userInfo({ token: accessToken });
            return info?.user || info;
        } catch (e) {
            return null;
        }
    }

    async function initVkWidget(containerEl) {
        const VKID = await loadVkSdk();

        VKID.Config.init({
            app: VK_APP_ID,
            redirectUrl: VK_REDIRECT_URL,
            responseMode: VKID.ConfigResponseMode.Callback,
            source: VKID.ConfigSource.LOWCODE,
            scope: '',
        });

        const oneTap = new VKID.OneTap();

        oneTap.render({
            container: containerEl,
            showAlternativeLogin: true,
            skin: 'secondary',
            styles: {
                borderRadius: 50,
                width: 250,
                height: 38,
            },
            oauthList: ['ok_ru', 'mail_ru'],
        })
            .on(VKID.WidgetEvents.ERROR, (error) => {
                console.warn('VK ID error:', error);
            })
            .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, async (payload) => {
                const code = payload.code;
                const deviceId = payload.device_id;
                try {
                    const tokenData = await VKID.Auth.exchangeCode(code, deviceId);
                    const accessToken = tokenData?.access_token;
                    let profile = null;
                    if (accessToken) {
                        profile = await fetchVkUserInfo(VKID, accessToken);
                    }
                    const displayName = profile
                        ? [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
                        : 'VK User';
                    const user = {
                        id: 'vk_' + (profile?.user_id || tokenData?.user_id || Date.now()),
                        name: displayName || 'VK User',
                        email: profile?.email || null,
                        avatar: profile?.avatar || null,
                        provider: 'vk',
                        ts: Date.now(),
                    };
                    vkAuthState.user = user;
                    writeVkUser(user);
                    notifyVkListeners();
                } catch (err) {
                    console.warn('VK ID exchange/login failed:', err);
                }
            });

        return oneTap;
    }

    function vkSignOut() {
        vkAuthState.user = null;
        clearVkUser();
        notifyVkListeners();
    }

    /* ---------- VK-side stars (localStorage only, per requirements) ---------- */

    const VK_NEW_ACCOUNT_BONUS_STARS = 110;

    function vkReadStars() {
        try {
            const raw = localStorage.getItem(LS_VK_STARS_KEY);
            if (raw !== null && !isNaN(parseInt(raw, 10))) return parseInt(raw, 10);
        } catch (e) { /* ignore */ }
        return null;
    }

    function vkWriteStars(amount) {
        try { localStorage.setItem(LS_VK_STARS_KEY, String(amount)); } catch (e) { /* ignore */ }
    }

    function vkReadDaily() {
        try {
            const raw = localStorage.getItem(LS_VK_DAILY_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function vkWriteDaily(payload) {
        try { localStorage.setItem(LS_VK_DAILY_KEY, JSON.stringify(payload)); } catch (e) { /* ignore */ }
    }

    /* ---------- Unified AppAuth interface ---------- */

    const listeners = [];
    let regionIsRussia = null; // null = not yet determined

    function emitAuthChange() {
        listeners.forEach((fn) => {
            try { fn(); } catch (e) { /* ignore */ }
        });
    }

    vkAuthState.listeners.push(() => emitAuthChange());

    const AppAuth = {
        // Region
        isRussia: () => regionIsRussia,
        detectRegion: async () => {
            regionIsRussia = await detectRegionIsRussia();
            return regionIsRussia;
        },

        // Unified user getters — provider-agnostic
        getUser: () => {
            if (regionIsRussia && vkAuthState.user) return vkAuthState.user;
            if (window.Clerk?.user) return window.Clerk.user;
            return null;
        },
        getUserId: () => {
            if (regionIsRussia && vkAuthState.user) return vkAuthState.user.id;
            if (window.Clerk?.user) return window.Clerk.user.id;
            return null;
        },
        getUserName: () => {
            if (regionIsRussia && vkAuthState.user) return vkAuthState.user.name;
            if (window.Clerk?.user) return window.Clerk.user.fullName || window.Clerk.user.username || 'User';
            return 'Guest';
        },
        getUserEmail: () => {
            if (regionIsRussia && vkAuthState.user) return vkAuthState.user.email || 'not set';
            if (window.Clerk?.user) return window.Clerk.user.primaryEmailAddress?.emailAddress || 'email@gmail.com';
            return 'not set';
        },
        getProvider: () => {
            if (regionIsRussia && vkAuthState.user) return 'vk';
            if (window.Clerk?.user) return 'clerk';
            return null;
        },
        isLoggedIn: () => !!AppAuth.getUser(),

        signOut: async () => {
            if (regionIsRussia && vkAuthState.user) {
                vkSignOut();
                return;
            }
            if (window.Clerk) {
                await window.Clerk.signOut();
            }
        },

        // VK-specific bits, used by script.js's star system for VK users
        vk: {
            initWidget: initVkWidget,
            getUser: () => vkAuthState.user,
            readStars: vkReadStars,
            writeStars: vkWriteStars,
            readDaily: vkReadDaily,
            writeDaily: vkWriteDaily,
            NEW_ACCOUNT_BONUS_STARS: VK_NEW_ACCOUNT_BONUS_STARS,
        },

        onChange: (fn) => { listeners.push(fn); },
    };

    window.AppAuth = AppAuth;
})();
