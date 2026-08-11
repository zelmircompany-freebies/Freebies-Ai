/* ============================================================
   REGION-AWARE AUTH
   - Detects whether the visitor is in Russia.
   - Russia  -> Supabase Auth (email/password), full server-side sync
               of profile & stars via our own Vercel API routes.
   - Rest of the world -> Clerk (unchanged, still synced server-side).
   - Both paths also expose a common window.AppAuth interface so the
     rest of the app (script.js) doesn't need to care which provider
     is active.
   ============================================================ */
(function () {
    "use strict";

    const LS_REGION_KEY = 'freebies_region_cache';
    const LS_SB_USER_KEY = 'freebies_sb_user';   // { id, email, name }
    const LS_SB_TOKEN_KEY = 'freebies_sb_token'; // access_token from Supabase session

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

    /* ---------- Supabase (email / password) ---------- */

    function readSbUser() {
        try {
            const raw = localStorage.getItem(LS_SB_USER_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function writeSbUser(user) {
        try { localStorage.setItem(LS_SB_USER_KEY, JSON.stringify(user)); } catch (e) { /* ignore */ }
    }

    function readSbToken() {
        try { return localStorage.getItem(LS_SB_TOKEN_KEY); } catch (e) { return null; }
    }

    function writeSbToken(token) {
        try { localStorage.setItem(LS_SB_TOKEN_KEY, token); } catch (e) { /* ignore */ }
    }

    function clearSbSession() {
        try {
            localStorage.removeItem(LS_SB_USER_KEY);
            localStorage.removeItem(LS_SB_TOKEN_KEY);
        } catch (e) { /* ignore */ }
    }

    const sbAuthState = {
        user: readSbUser(),
        listeners: [],
    };

    function notifySbListeners() {
        sbAuthState.listeners.forEach((fn) => {
            try { fn(sbAuthState.user); } catch (e) { /* ignore */ }
        });
    }

    // Small helper: every call to our own /api/auth/* routes goes through here
    // so the access token is attached consistently and errors surface the
    // same way everywhere.
    async function callAuthApi(path, body) {
        const res = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* ignore */ }
        if (!res.ok) {
            const message = (data && data.error) || `Request failed (${res.status})`;
            throw new Error(message);
        }
        return data;
    }

    async function sbRegister(email, password) {
        const data = await callAuthApi('/api/auth/register', { email, password });
        return applySbSession(data);
    }

    async function sbLogin(email, password) {
        const data = await callAuthApi('/api/auth/login', { email, password });
        return applySbSession(data);
    }

    function applySbSession(data) {
        if (!data || !data.user || !data.session) {
            throw new Error('Unexpected response from server');
        }
        const user = {
            id: data.user.id,
            email: data.user.email,
            name: data.profile?.name || (data.user.email ? data.user.email.split('@')[0] : 'User'),
            provider: 'supabase',
            ts: Date.now(),
        };
        sbAuthState.user = user;
        writeSbUser(user);
        writeSbToken(data.session.access_token);
        notifySbListeners();
        return user;
    }

    async function sbSignOut() {
        const token = readSbToken();
        sbAuthState.user = null;
        clearSbSession();
        notifySbListeners();
        if (token) {
            // best-effort; don't block sign-out on the network call
            callAuthApi('/api/auth/logout', { token }).catch(() => {});
        }
    }

    /* ---------- Supabase-side profile & stars (server-synced) ---------- */

    const SB_NEW_ACCOUNT_BONUS_STARS = 110;

    async function sbFetchProfile() {
        const token = readSbToken();
        if (!token) return null;
        try {
            return await callAuthApi('/api/auth/get-profile', { token });
        } catch (e) {
            console.warn('Could not fetch Supabase profile:', e);
            return null;
        }
    }

    async function sbSaveProfile(payload) {
        const token = readSbToken();
        if (!token) return;
        try {
            await callAuthApi('/api/auth/save-profile', { token, ...payload });
        } catch (e) {
            console.warn('Could not save Supabase profile:', e);
        }
    }

    /* ---------- Unified AppAuth interface ---------- */

    const listeners = [];
    let regionIsRussia = null; // null = not yet determined

    function emitAuthChange() {
        listeners.forEach((fn) => {
            try { fn(); } catch (e) { /* ignore */ }
        });
    }

    sbAuthState.listeners.push(() => emitAuthChange());

    const AppAuth = {
        // Region — used to decide which login method is shown in the auth
        // gate (Supabase email/password for Russia, Clerk for everyone else)
        // and whether to show the "restricted in your region" warning.
        isRussia: () => regionIsRussia,
        detectRegion: async () => {
            regionIsRussia = await detectRegionIsRussia();
            return regionIsRussia;
        },

        // Unified user getters — provider-agnostic. Supabase takes priority
        // when both happen to be present (shouldn't normally happen),
        // otherwise whichever provider actually has a logged-in user wins.
        getUser: () => {
            if (sbAuthState.user) return sbAuthState.user;
            if (window.Clerk?.user) return window.Clerk.user;
            return null;
        },
        getUserId: () => {
            if (sbAuthState.user) return sbAuthState.user.id;
            if (window.Clerk?.user) return window.Clerk.user.id;
            return null;
        },
        getUserName: () => {
            if (sbAuthState.user) return sbAuthState.user.name;
            if (window.Clerk?.user) return window.Clerk.user.fullName || window.Clerk.user.username || 'User';
            return 'Guest';
        },
        getUserEmail: () => {
            if (sbAuthState.user) return sbAuthState.user.email || 'not set';
            if (window.Clerk?.user) return window.Clerk.user.primaryEmailAddress?.emailAddress || 'email@gmail.com';
            return 'not set';
        },
        getProvider: () => {
            if (sbAuthState.user) return 'supabase';
            if (window.Clerk?.user) return 'clerk';
            return null;
        },
        isLoggedIn: () => !!AppAuth.getUser(),

        signOut: async () => {
            if (sbAuthState.user) {
                await sbSignOut();
                return;
            }
            if (window.Clerk) {
                await window.Clerk.signOut();
            }
        },

        // Supabase-specific bits, used by script.js's star system for
        // Russia-region users. Profile & stars are synced server-side via
        // our own Vercel API routes (which talk to Supabase).
        supabase: {
            register: sbRegister,
            login: sbLogin,
            getUser: () => sbAuthState.user,
            fetchProfile: sbFetchProfile,
            saveProfile: sbSaveProfile,
            NEW_ACCOUNT_BONUS_STARS: SB_NEW_ACCOUNT_BONUS_STARS,
        },

        onChange: (fn) => { listeners.push(fn); },
    };

    window.AppAuth = AppAuth;
})();
