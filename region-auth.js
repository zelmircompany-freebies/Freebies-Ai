/* ============================================================
   AUTH (Supabase)
   - Supabase Auth (email/password) is the sole sign-in method for
     everyone. Profile & stars are synced server-side via our own
     Vercel API routes (which talk to Supabase).
   - Exposes a common window.AppAuth interface so the rest of the
     app (script.js) has a stable API to work against.
   ============================================================ */
(function () {
    "use strict";

    const LS_SB_USER_KEY = 'freebies_sb_user';   // { id, email, name }
    const LS_SB_TOKEN_KEY = 'freebies_sb_token'; // access_token from Supabase session

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

    function emitAuthChange() {
        listeners.forEach((fn) => {
            try { fn(); } catch (e) { /* ignore */ }
        });
    }

    sbAuthState.listeners.push(() => emitAuthChange());

    const AppAuth = {
        // Unified user getters (Supabase-backed).
        getUser: () => sbAuthState.user || null,
        getUserId: () => (sbAuthState.user ? sbAuthState.user.id : null),
        getUserName: () => (sbAuthState.user ? sbAuthState.user.name : 'Guest'),
        getUserEmail: () => (sbAuthState.user ? (sbAuthState.user.email || 'not set') : 'not set'),
        getProvider: () => (sbAuthState.user ? 'supabase' : null),
        isLoggedIn: () => !!AppAuth.getUser(),

        signOut: async () => {
            if (sbAuthState.user) {
                await sbSignOut();
            }
        },

        // Supabase-specific bits, used by script.js's star system.
        // Profile & stars are synced server-side via our own Vercel API
        // routes (which talk to Supabase).
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
