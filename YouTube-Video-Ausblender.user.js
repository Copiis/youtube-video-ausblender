// ==UserScript==
// @name         YouTube Video Ausblender
// @namespace    https://github.com/Copiis/youtube-video-ausblender
// @version      0.1.0
// @description  Blendet YouTube-Videos in Feed, Shorts und Vorschlägen aus — mit einzeln schaltbaren Bereichen.
// @description:en Hides YouTube videos in feed, Shorts, and suggestions — each area can be toggled separately.
// @author       Copiis
// @license      MIT
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @icon         https://www.youtube.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/Copiis/youtube-video-ausblender/main/YouTube-Video-Ausblender.user.js
// @updateURL    https://raw.githubusercontent.com/Copiis/youtube-video-ausblender/main/YouTube-Video-Ausblender.user.js
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'yva_settings_v1';

    const DEFAULTS = {
        hideHomeFeed: true,
        hideSubscriptions: true,
        hideSearchResults: false,
        hideShorts: true,
        hideSidebarSuggestions: true,
        hideMixes: true,
    };

    const BODY_CLASSES = {
        hideHomeFeed: 'yva-hide-home',
        hideSubscriptions: 'yva-hide-subscriptions',
        hideSearchResults: 'yva-hide-search',
        hideShorts: 'yva-hide-shorts',
        hideSidebarSuggestions: 'yva-hide-sidebar',
        hideMixes: 'yva-hide-mixes',
    };

    const STYLE_ID = 'youtube-video-ausblender-style';

    function loadSettings() {
        const stored = GM_getValue(STORAGE_KEY, null);
        return { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
    }

    function saveSettings(settings) {
        GM_setValue(STORAGE_KEY, settings);
    }

    function buildCss() {
        return `
            /* Startseite / Entdecken */
            body.yva-hide-home ytd-rich-item-renderer,
            body.yva-hide-home ytd-rich-grid-renderer #contents > ytd-rich-item-renderer,
            body.yva-hide-home ytd-grid-video-renderer,
            body.yva-hide-home ytd-video-renderer[is-rich-grid-hover],

            /* Abos */
            body.yva-hide-subscriptions ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer,
            body.yva-hide-subscriptions ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer,
            body.yva-hide-subscriptions ytd-item-section-renderer[page-subtype="subscriptions"] ytd-video-renderer,

            /* Suche */
            body.yva-hide-search ytd-search #contents ytd-video-renderer,
            body.yva-hide-search ytd-search #contents ytd-grid-video-renderer,

            /* Shorts */
            body.yva-hide-shorts ytd-reel-shelf-renderer,
            body.yva-hide-shorts ytd-reel-item-renderer,
            body.yva-hide-shorts ytd-rich-section-renderer[is-shorts],
            body.yva-hide-shorts [overlay-style="SHORTS"],
            body.yva-hide-shorts ytd-mini-guide-entry-renderer[aria-label="Shorts"],
            body.yva-hide-shorts a[title="Shorts"],

            /* Sidebar / Vorschläge auf Watch-Seite */
            body.yva-hide-sidebar #secondary ytd-compact-video-renderer,
            body.yva-hide-sidebar #secondary ytd-video-renderer,
            body.yva-hide-sidebar #related ytd-compact-video-renderer,
            body.yva-hide-sidebar #related ytd-video-renderer,

            /* Mixes / Playlists in Feeds */
            body.yva-hide-mixes ytd-rich-item-renderer[is-mix],
            body.yva-hide-mixes ytd-rich-shelf-renderer[is-shorts=""],
            body.yva-hide-mixes ytd-playlist-renderer
            {
                display: none !important;
            }
        `;
    }

    function ensureStyle() {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            document.documentElement.appendChild(style);
        }
        style.textContent = buildCss();
    }

    function applySettings(settings) {
        const body = document.body;
        if (!body) {
            return;
        }
        Object.entries(BODY_CLASSES).forEach(([key, className]) => {
            body.classList.toggle(className, !!settings[key]);
        });
    }

    function toggleSetting(key, label) {
        const settings = loadSettings();
        settings[key] = !settings[key];
        saveSettings(settings);
        applySettings(settings);
        console.info(`[YouTube Video Ausblender] ${label}: ${settings[key] ? 'an' : 'aus'}`);
    }

    function registerMenus() {
        const items = [
            ['hideHomeFeed', 'Startseite: Videos ausblenden'],
            ['hideSubscriptions', 'Abos: Videos ausblenden'],
            ['hideSearchResults', 'Suche: Videos ausblenden'],
            ['hideShorts', 'Shorts ausblenden'],
            ['hideSidebarSuggestions', 'Watch-Seite: Vorschläge ausblenden'],
            ['hideMixes', 'Mixes / Playlists ausblenden'],
        ];

        items.forEach(([key, label]) => {
            GM_registerMenuCommand(`${label} (umschalten)`, () => toggleSetting(key, label));
        });

        GM_registerMenuCommand('Alle Optionen: Standard wiederherstellen', () => {
            saveSettings({ ...DEFAULTS });
            applySettings(loadSettings());
            console.info('[YouTube Video Ausblender] Einstellungen auf Standard zurückgesetzt');
        });
    }

    function init() {
        ensureStyle();
        applySettings(loadSettings());
        registerMenus();

        const observer = new MutationObserver(() => {
            applySettings(loadSettings());
        });
        observer.observe(document.documentElement, { childList: true, subtree: false });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();