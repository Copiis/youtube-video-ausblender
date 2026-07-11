// ==UserScript==
// @name YouTube Video Hider with 🚫 Icon and Shorts Toggle
// @name:de YouTube Video Ausblender mit 🚫 Symbol und Shorts Umschalter
// @name:es Ocultador de Videos de YouTube con Icono 🚫 y Alternador de Shorts
// @name:fr Masqueur de Vidéos YouTube avec Icône 🚫 et Basculeur de Shorts
// @name:it Nascondi Video YouTube con Icona 🚫 e Interruttore Shorts
// @namespace https://github.com/Copiis/youtube-video-ausblender
// @version 2026.7.11a
// @description Hide videos using YouTube's native "Not interested"; convenient 🚫 button + Shorts toggle
// @description:de Videos über YouTubes natives "Nicht interessiert" ausblenden; praktischer 🚫-Button + Shorts-Umschalter
// @description:es Oculta vídeos usando el mecanismo nativo "No me interesa" de YouTube con botón 🚫 + alternador de Shorts
// @description:fr Masque les vidéos via le mécanisme natif "Pas intéressé" de YouTube avec bouton 🚫 + bascule Shorts
// @description:it Nasconde i video usando il meccanismo nativo "Non mi interessa" di YouTube con pulsante 🚫 + toggle Shorts
// @icon https://youtube.com/favicon.ico
// @author Copiis
// @license MIT
// @match https://www.youtube.com/*
// @run-at document-idle
// @grant GM_setValue
// @grant GM_getValue
// @downloadURL https://raw.githubusercontent.com/Copiis/youtube-video-ausblender/master/YouTube-Video-Ausblender.js
// @updateURL https://raw.githubusercontent.com/Copiis/youtube-video-ausblender/master/YouTube-Video-Ausblender.js
// @description If you find this script useful and would like to support my work, consider making a small donation!
// @description GitHub Sponsors: https://github.com/sponsors/Copiis
// ==/UserScript==

(function () {
    'use strict';

    // Konfigurationsobjekt
    const config = {
        hideButtonSize: '44px',
        shortsCheckInterval: 2000,
        debugMode: false,   // temporär auf true setzen für detaillierte Logs im Console (bei Menü-Problemen)
        debounceMs: 350,
        viewportMarginPx: 300,
        viewportBatchMax: 24,
        viewportButtonRefreshMax: 48,
        scrollCheckMs: 200,
        playbackNavGuardMs: 8000,
        playbackDomCleanupDelayMs: 8000
    };

    const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
    const VIDEO_CONTAINER_SELECTOR = 'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-video-renderer, yt-lockup-view-model';
    const NESTED_VIDEO_CONTAINER_PARENT_SELECTOR = 'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-video-renderer';
    const PRIMARY_PLAYBACK_SELECTOR = '#movie_player, #player-container, #player-theater-container, #player-capabilities, ytd-shorts, ytd-reel-video-renderer';
    const ALLOWED_HIDE_AREA_SELECTOR = 'ytd-watch-next-secondary-results-renderer, ytd-search, ytd-browse';
    const THUMBNAIL_HOST_SELECTOR = 'a.ytLockupViewModelContentImage, yt-lockup-view-model a, ytd-thumbnail a#thumbnail, ytd-thumbnail a, a#thumbnail, yt-thumbnail-view-model';
    const THUMBNAIL_SHADOW_HOST_SELECTOR = 'yt-img-shadow, yt-image, yt-thumbnail, ytd-thumbnail';
    const YTIMG_SRC_PATTERN = /ytimg\.com|ggpht\.com|googleusercontent\.com/;
    const EXCLUDED_UI_SELECTOR = 'ytd-guide-renderer, ytd-mini-guide-renderer, tp-yt-app-drawer, #guide, #guide-content, #guide-inner-content, ytd-masthead';
    const FEED_ROOT_SELECTOR = 'ytd-browse, ytd-page-manager, ytd-watch-flexy, ytd-search, #primary, #contents';
    const SHORTS_SHELF_SELECTOR = 'ytd-rich-shelf-renderer[is-shorts], ytd-rich-section-renderer ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer, ytm-shorts-lockup-view-model, ytd-rich-item-renderer[is-shelf-item]';
    const NATIVE_HIDE_LABELS = [
        'nicht interessiert', 'not interested',
        'pas intéressé', 'no me interesa', 'non mi interessa', 'não tenho interesse',
        'interessiert', 'interested', 'nicht sehen', 'dont recommend', 'keinen kanal', 'nicht empfehlen',
        'ausblenden', 'hide', 'verstecken', 'ausblenden video', 'video ausblenden'
    ];

    let observedFeedTargets = new WeakSet();
    let feedMutationObserver = null;
    let navigationGuardUntil = 0;
    let feedMaintenanceEnabled = true;
    let browseFeaturesActive = false;
    let mastheadMutationObserver = null;
    let navigationListenersInstalled = false;
    let playbackDomCleanupTimer = null;

    function isInExcludedUiArea(element) {
        return !!(element && element.closest(EXCLUDED_UI_SELECTOR));
    }

    function isPlaybackPage() {
        const path = window.location.pathname || '';
        return path === '/watch' || path.startsWith('/shorts/') || path === '/live';
    }

    function shouldShowHideButtons() {
        return shouldRunFeedMaintenance();
    }

    function shouldRunFeedMaintenance() {
        return feedMaintenanceEnabled && !isPlaybackPage() && !isNavigationGuardActive();
    }

    function removeMastheadButtons() {
        document.querySelector('.shorts-toggle-wrapper')?.remove();
    }

    function stopAllIntervals() {
        if (shortsCheckIntervalId) {
            clearInterval(shortsCheckIntervalId);
            shortsCheckIntervalId = null;
        }
    }

    function disconnectFeedObservers() {
        feedMutationObserver?.disconnect();
        observedFeedTargets = new WeakSet();
    }

    function disconnectMastheadObserver() {
        mastheadMutationObserver?.disconnect();
        mastheadMutationObserver = null;
        document.querySelector('ytd-masthead')?.removeAttribute('data-shorts-toggle-observed');
    }

    function pauseBrowseFeatures() {
        browseFeaturesActive = false;
        feedMaintenanceEnabled = false;
        disconnectMastheadObserver();
        disconnectFeedObservers();
        stopAllIntervals();
    }

    function cleanupBrowseDom() {
        try {
            removeAllHideButtons();
            removeMastheadButtons();
        } catch (err) {
            if (config.debugMode) console.log('[Ausblender] DOM-Cleanup:', err.message);
        }
    }

    function cancelPlaybackDomCleanup() {
        if (playbackDomCleanupTimer) {
            clearTimeout(playbackDomCleanupTimer);
            playbackDomCleanupTimer = null;
        }
    }

    function schedulePlaybackDomCleanup() {
        cancelPlaybackDomCleanup();
        playbackDomCleanupTimer = setTimeout(() => {
            playbackDomCleanupTimer = null;
            if (!isPlaybackPage()) return;
            cleanupBrowseDom();
        }, config.playbackDomCleanupDelayMs);
    }

    function teardownBrowseFeatures() {
        pauseBrowseFeatures();
        cleanupBrowseDom();
    }

    function startBrowseFeatures() {
        if (browseFeaturesActive) return;
        browseFeaturesActive = true;
        feedMaintenanceEnabled = true;

        installHideInteractionGuard();
        observeFeedSections();
        ensureFeedObserver();
        observeMastheadForToggleButton();
        migrateHideButtonsOutOfAnchors();
        removeLegacyHideButtons();
        addShortsToggleButton();
        ensureShortsCheckInterval();
        checkShortsSection();

        setTimeout(() => maintainButtonsNearViewport(config.viewportButtonRefreshMax), 400);
        setTimeout(() => maintainButtonsNearViewport(config.viewportButtonRefreshMax), 900);
    }

    function isTopLevelVideoContainer(element) {
        if (!element) return false;
        if (element.matches('yt-lockup-view-model')) {
            return !element.closest(NESTED_VIDEO_CONTAINER_PARENT_SELECTOR);
        }
        return true;
    }

    function isInPrimaryPlaybackArea(element) {
        if (!element) return false;
        if (element.closest(ALLOWED_HIDE_AREA_SELECTOR)) return false;
        return !!element.closest(PRIMARY_PLAYBACK_SELECTOR);
    }

    function isNavigationGuardActive() {
        return Date.now() < navigationGuardUntil;
    }

    function activateNavigationGuard(durationMs = config.playbackNavGuardMs) {
        navigationGuardUntil = Math.max(navigationGuardUntil, Date.now() + durationMs);
    }

    function isFeedVideoContainer(element) {
        return !!(element && element.matches(VIDEO_CONTAINER_SELECTOR) && isTopLevelVideoContainer(element) && !isInExcludedUiArea(element));
    }

    function isButtonableFeedContainer(container) {
        if (!isFeedVideoContainer(container)) return false;
        if (isInPrimaryPlaybackArea(container)) return false;
        if (container.closest('ytd-continuation-item-renderer')) return false;
        if (container.hasAttribute('is-shelf-item')) return false;
        return true;
    }

    function isYtThumbnailSrc(src) {
        return !!(src && !src.startsWith('data:') && YTIMG_SRC_PATTERN.test(src));
    }

    function findThumbnailHost(video) {
        if (!video) return null;
        if (video.matches?.('a.ytLockupViewModelContentImage, yt-thumbnail-view-model, a#thumbnail')) return video;

        for (const selector of THUMBNAIL_HOST_SELECTOR.split(', ')) {
            const host = video.querySelector(selector);
            if (host) return host;
        }

        return video.querySelector('ytd-thumbnail')
            || video.querySelector('yt-thumbnail-view-model')
            || null;
    }

    function isReadyForButton(element) {
        if (!shouldShowHideButtons()) return false;
        if (isNavigationGuardActive()) return false;
        if (!isButtonableFeedContainer(element)) return false;
        if (!extractVideoId(element)) return false;
        if (!findThumbnailHost(element)) return false;
        return true;
    }

    const FEED_CONTENTS_SELECTOR = 'ytd-rich-grid-renderer #contents, ytd-rich-section-renderer #contents, ytd-item-section-renderer #contents, ytd-section-list-renderer #contents, ytd-shelf-renderer #contents, ytd-search #contents';

    function getFeedContentRoots() {
        const roots = Array.from(document.querySelectorAll(FEED_CONTENTS_SELECTOR))
            .filter(root => !isInExcludedUiArea(root));
        return roots.length > 0 ? roots : [document];
    }

    function queryFeedVideoContainers(extraSelector = '') {
        const selector = extraSelector
            ? `${VIDEO_CONTAINER_SELECTOR}${extraSelector}`
            : VIDEO_CONTAINER_SELECTOR;
        const seen = new Set();
        const containers = [];

        for (const root of getFeedContentRoots()) {
            root.querySelectorAll(selector).forEach((element) => {
                if (!isFeedVideoContainer(element) || seen.has(element)) return;
                seen.add(element);
                containers.push(element);
            });
        }

        return containers;
    }

    function queryShortsSections() {
        if (isPlaybackPage()) return [];

        const sections = [];
        const roots = document.querySelectorAll('ytd-browse, ytd-page-manager, ytd-search, #contents');

        if (roots.length === 0) {
            document.querySelectorAll(SHORTS_SHELF_SELECTOR).forEach((section) => {
                if (!isInExcludedUiArea(section)) sections.push(section);
            });
            return sections;
        }

        roots.forEach((root) => {
            root.querySelectorAll(SHORTS_SHELF_SELECTOR).forEach((section) => {
                if (!isInExcludedUiArea(section)) sections.push(section);
            });
        });

        return sections;
    }

    // Spracherkennung
    const userLang = (navigator.language || navigator.languages[0] || 'en').substring(0, 2);
    if (config.debugMode) console.log(`[Initializer] Erkannte Sprache: ${userLang}`);

    // Übersetzungen
    const translations = {
        en: {
            hideVideosFound: 'Found videos: ${count}',
            hideButtonAdded: 'Video ${index}: Button added',
            hideNoVideoId: 'Video ${index}: No video ID found',
            hideNoThumbnail: 'Video ${index}: Thumbnail container not found',
            hideVideoStored: 'Video ${index}: Hidden (${videoId}), list size: ${count}',
            hideListEvicted: 'Oldest video ID removed from list: ${videoId}',
            hideError: 'Video ${index}: Error while hiding: ${error}',
            shortsNoTopbar: 'Topbar or YouTube logo not found',
            shortsButtonExists: 'Toggle button already exists, skipping',
            shortsButtonAdded: 'Toggle button added to topbar',
            shortsNotFound: 'Shorts section not found',
            shortsFound: 'Shorts section found: ${details}',
            shortsSectionHidden: 'Shorts section: hidden',
            shortsSectionShown: 'Shorts section: shown',
            shortsButtonText: 'Shorts',
            initStarted: 'Script initialized',
            initAttempt: 'Attempt ${current} of ${max} for Shorts section',
            initMaxAttempts: 'Maximum attempts reached, no Shorts section found',
            initError: 'Error during initialization: ${error}',
            observerError: 'Error in MutationObserver: ${error}',
            noMetadataFound: 'Video ${index}: No metadata container found',
            hideTriggered: 'Native Ausblendung für Video ${videoId} ausgelöst'
        },
        de: {
            hideVideosFound: 'Gefundene Videos: ${count}',
            hideButtonAdded: 'Video ${index}: Button hinzugefügt',
            hideNoVideoId: 'Video ${index}: Keine Video-ID gefunden',
            hideNoThumbnail: 'Video ${index}: Vorschaubild-Container nicht gefunden',
            hideVideoStored: 'Video ${index}: Ausgeblendet (${videoId}), Listengröße: ${count}',
            hideListEvicted: 'Älteste Video-ID aus Liste entfernt: ${videoId}',
            hideError: 'Video ${index}: Fehler beim Ausblenden: ${error}',
            shortsNoTopbar: 'Obere Leiste oder YouTube-Logo nicht gefunden',
            shortsButtonExists: 'Toggle-Button bereits vorhanden, überspringe',
            shortsButtonAdded: 'Toggle-Button in oberer Leiste hinzugefügt',
            shortsNotFound: 'Shorts-Abschnitt nicht gefunden',
            shortsFound: 'Shorts-Abschnitt gefunden: ${details}',
            shortsSectionHidden: 'Shorts-Abschnitt: ausgeblendet',
            shortsSectionShown: 'Shorts-Abschnitt: eingeblendet',
            shortsButtonText: 'Shorts',
            initStarted: 'Skript initialisiert',
            initAttempt: 'Versuch ${current} von ${max} für Shorts-Abschnitt',
            initMaxAttempts: 'Maximale Versuche erreicht, kein Shorts-Abschnitt gefunden',
            initError: 'Fehler bei der Initialisierung: ${error}',
            observerError: 'Fehler im MutationObserver: ${error}',
            noMetadataFound: 'Video ${index}: Kein Metadaten-Container gefunden',
            hideTriggered: 'Native Ausblendung für Video ${videoId} ausgelöst'
        }
    };

    const t = translations[userLang] || translations.en;

    // Funktion zum Formatieren von Übersetzungen
    function formatTranslation(key, params = {}) {
        let str = t[key] || translations.en[key] || key;
        Object.keys(params).forEach(param => {
            str = str.replace(`\${${param}}`, params[param]);
        });
        return str;
    }





    function forEachElementDeep(root, callback) {
        if (!root) return;
        const stack = [root];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
            callback(node);
            if (node.shadowRoot) stack.push(...node.shadowRoot.children);
            stack.push(...node.children);
        }
    }

    function queryAllDeep(root, selector) {
        const results = [];
        forEachElementDeep(root, (element) => {
            if (element.matches?.(selector)) results.push(element);
        });
        return results;
    }





    function parseContentIdFromClassList(classList) {
        for (const cls of classList) {
            if (!cls.startsWith('content-id-')) continue;
            const id = cls.slice('content-id-'.length);
            if (VIDEO_ID_PATTERN.test(id)) return id;
        }
        return null;
    }

    function extractVideoId(container) {
        if (!container) return null;

        const idFromSelf = parseContentIdFromClassList(container.classList);
        if (idFromSelf) return idFromSelf;

        for (const host of container.querySelectorAll('[class*="content-id-"]')) {
            const id = parseContentIdFromClassList(host.classList);
            if (id) return id;
        }

        const links = container.querySelectorAll('a[href*="watch"], a[href*="/shorts/"], a[href*="youtu.be/"]');
        for (const link of links) {
            const href = link.getAttribute('href') || '';
            const patterns = [
                /[?&]v=([a-zA-Z0-9_-]{11})/,
                /\/shorts\/([a-zA-Z0-9_-]{11})/,
                /youtu\.be\/([a-zA-Z0-9_-]{11})/
            ];
            for (const pattern of patterns) {
                const match = href.match(pattern);
                if (match) return match[1];
            }
        }
        return null;
    }

    function blockPointerEvent(e) {
        e.stopImmediatePropagation();
        e.preventDefault();
    }

    let hideInteractionGuardInstalled = false;

    function findVideoMenuButton(container) {
        if (!container) return null;
        const selectors = [
            'ytd-menu-renderer #button',
            'ytd-menu-renderer yt-icon-button#button',
            'ytd-menu-renderer button[aria-label]',
            'ytd-menu-renderer button',
            'yt-icon-button[aria-label*="Aktionen"]',
            'yt-icon-button[aria-label*="actions"]',
            'button[aria-label*="Mehr"]',
            'button[aria-label*="More"]',
            'button[aria-haspopup="true"]',
            '[role="button"][aria-label*="Aktionen"]'
        ];
        for (const sel of selectors) {
            let btn = container.querySelector(sel);
            if (btn) return btn;
            const deep = queryAllDeep(container, sel)[0];
            if (deep) return deep;
        }
        const menu = container.querySelector('ytd-menu-renderer, yt-menu-renderer');
        if (menu) {
            return menu.querySelector('yt-icon-button, button, [role="button"]');
        }
        return null;
    }

    function simulateClick(el) {
        if (!el) return false;
        try {
            // Direct click
            el.click();
            // Realistic mouse events (helps with some YT handlers and shadow DOM)
            const rect = (typeof el.getBoundingClientRect === 'function') ? el.getBoundingClientRect() : { left: 10, top: 10, width: 10, height: 10 };
            const cx = rect.left + Math.max(5, rect.width / 2);
            const cy = rect.top + Math.max(5, rect.height / 2);
            const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: cx, clientY: cy };
            el.dispatchEvent(new MouseEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            return true;
        } catch (e) {
            return false;
        }
    }

    function findNotInterestedMenuItem() {
        const candidates = [];

        // Try the most common popup containers first
        const popupRoots = document.querySelectorAll(
            'ytd-popup-container, ' +
            'tp-yt-iron-dropdown, ' +
            'ytd-menu-popup-renderer, ' +
            'iron-dropdown, ' +
            'tp-yt-paper-listbox, ' +
            'yt-list-item-view-model[role="menuitem"]'
        );

        popupRoots.forEach((el) => {
            try {
                const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
                const isVisible = !r || (r.width > 20 && r.height > 10) || el.offsetParent !== null;
                if (isVisible) candidates.push(el);
            } catch (_) {
                candidates.push(el);
            }
        });

        candidates.push(document);

        // Broad set of possible menu item containers (YouTube changes these often)
        const itemSelectors = [
            'ytd-menu-service-item-renderer',
            'tp-yt-paper-item',
            'ytd-menu-navigation-item-renderer',
            '[role="menuitem"]',
            '[role="option"]',
            'yt-list-item-view-model[role="menuitem"]',
            'yt-list-item-view-model.ytListItemViewModelHost',
            'ytListItemViewModelHost',
            'button.ytListItemViewModelButtonOrAnchor',
            '.ytListItemViewModelButtonOrAnchor',
            'button[ class*="ListItem" ]',
            'button[role]'
        ].join(',');

        for (const root of candidates) {
            if (!root) continue;

            let items = [];
            try {
                items = queryAllDeep(root, itemSelectors);
            } catch (_) {
                // fallback to normal query
                items = Array.from(root.querySelectorAll ? root.querySelectorAll(itemSelectors) : []);
            }

            for (const item of items) {
                if (!item) continue;

                // Visibility check
                let r = null;
                try { r = item.getBoundingClientRect(); } catch (_) {}
                if (r && (r.width < 15 || r.height < 6)) continue;

                // Collect all possible text
                const texts = [];
                const tc = (item.textContent || item.innerText || '').trim();
                if (tc) texts.push(tc);

                if (item.getAttribute) {
                    const aria = item.getAttribute('aria-label') || '';
                    if (aria) texts.push(aria);
                    const title = item.getAttribute('title') || '';
                    if (title) texts.push(title);
                }

                // Also check common text children
                const textChildren = item.querySelectorAll ? item.querySelectorAll(
                    'yt-formatted-string, ' +
                    '.yt-core-attributed-string, ' +
                    'yt-attributed-string, ' +
                    'span[role="text"], ' +
                    'span.ytAttributedStringHost, ' +
                    '.ytAttributedStringHost, ' +
                    '.ytListItemViewModelTitle, ' +
                    'span'
                ) : [];

                for (const child of textChildren) {
                    const t = (child.textContent || child.innerText || '').trim();
                    if (t) texts.push(t);
                }

                const combined = texts.join(' ').toLowerCase();

                if (NATIVE_HIDE_LABELS.some(l => combined.includes(l))) {
                    // For the new yt-list-item-view-model structure, explicitly find the inner button
                    if (item.closest('yt-list-item-view-model') || item.matches?.('yt-list-item-view-model, .ytListItemViewModelHost')) {
                        const btn = item.querySelector?.('button.ytListItemViewModelButtonOrAnchor') ||
                                    item.closest('button.ytListItemViewModelButtonOrAnchor') ||
                                    item.querySelector?.('button');
                        if (btn) return btn;
                    }

                    // Prefer the actual clickable button
                    const clickable = item.closest('button') ||
                                      item.closest('.ytListItemViewModelButtonOrAnchor') ||
                                      item.closest('yt-list-item-view-model') ||
                                      item.closest('ytd-menu-service-item-renderer') ||
                                      item;
                    return clickable;
                }
            }
        }

        // Last resort: search the whole document for any element containing the text
        try {
            const allPossible = document.querySelectorAll(
                'ytd-menu-service-item-renderer, tp-yt-paper-item, [role="menuitem"], ' +
                'yt-list-item-view-model[role="menuitem"], ' +
                'button.ytListItemViewModelButtonOrAnchor, .ytListItemViewModelButtonOrAnchor, ' +
                'button[ class*="ListItem" ], .ytAttributedStringHost, .ytListItemViewModelTitle'
            );
            for (const el of allPossible) {
                const txt = (el.textContent || el.innerText || '').toLowerCase();
                if (NATIVE_HIDE_LABELS.some(l => txt.includes(l))) {
                    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
                    if (!rect || (rect.width > 10 && rect.height > 5)) {
                        // For new structure prefer the button
                        if (el.closest('yt-list-item-view-model') || el.matches?.('yt-list-item-view-model')) {
                            const btn = el.querySelector?.('button.ytListItemViewModelButtonOrAnchor') || el.querySelector?.('button');
                            if (btn) return btn;
                        }
                        return el.closest('button') || el.closest('[role="button"]') || el;
                    }
                }
            }
        } catch (_) {}

        return null;
    }

    async function triggerNativeHide(container) {
        try {
            const menuBtn = findVideoMenuButton(container);
            if (!menuBtn) {
                if (config.debugMode) console.log('[Ausblender] Kein Menü-Button für natives Ausblenden gefunden');
                return false;
            }
            simulateClick(menuBtn);
            await new Promise(r => setTimeout(r, 250));

            let item = null;
            for (let i = 0; i < 20; i++) {
                item = findNotInterestedMenuItem();
                if (item) break;
                await new Promise(r => setTimeout(r, 70));
            }
            if (item) {
                // Click the item (and try inner actionable element)
                simulateClick(item);
                try {
                    const inner = item.querySelector && (
                        item.querySelector('button.ytListItemViewModelButtonOrAnchor') ||
                        item.querySelector('tp-yt-paper-item, yt-formatted-string, .yt-core-attributed-string') ||
                        null
                    );
                    if (inner && inner !== item) {
                        setTimeout(() => simulateClick(inner), 15);
                    }
                } catch (_) {}

                // Pause our observers briefly so YouTube can fully process the native hide
                // without our feed maintenance potentially triggering a re-render that undoes it
                const prevEnabled = feedMaintenanceEnabled;
                feedMaintenanceEnabled = false;
                setTimeout(() => {
                    feedMaintenanceEnabled = prevEnabled;
                }, 6000);

                if (config.debugMode) console.log('[Ausblender] Natives "Nicht interessiert" ausgelöst');
                else console.log('[Ausblender] Natives Ausblenden ausgelöst');
                return true;
            } else {
                // Close popup gracefully
                try {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                    document.body.click();
                } catch (e) {}
                if (config.debugMode) {
                    // Debug dump: log visible menu items
                    const all = queryAllDeep(document, 'ytd-menu-service-item-renderer, tp-yt-paper-item');
                    console.log('[Ausblender DEBUG] Kein passender Menüeintrag. Gefundene Items:', all.map(el => (el.textContent || '').trim().slice(0,80)));
                }
                console.log('[Ausblender] Kein passender Menüeintrag gefunden (Popup war offen)');
                return false;
            }
        } catch (err) {
            if (config.debugMode) console.error('[Ausblender] triggerNativeHide Fehler:', err);
            // Try to close any open menu
            try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
            return false;
        }
    }

    function installHideInteractionGuard() {
        if (hideInteractionGuardInstalled) return;
        hideInteractionGuardInstalled = true;

        ['pointerdown', 'mousedown', 'touchstart', 'contextmenu'].forEach((type) => {
            document.addEventListener(type, (e) => {
                if (!e.target.closest('.hide-video-btn')) return;
                blockPointerEvent(e);
            }, true);
        });

        document.addEventListener('click', (e) => {
            const hideButton = e.target.closest('.hide-video-btn');
            if (!hideButton) return;
            blockPointerEvent(e);

            const video = hideButton.closest(VIDEO_CONTAINER_SELECTOR);
            if (!video) return;

            try {
                triggerNativeHide(video);
            } catch (err) {
                console.error(formatTranslation('hideError', { index: '?', error: err.message }));
            }
        }, true);
    }

    function findThumbnailHost(video) {
        if (!video) return null;
        if (video.matches?.('a.ytLockupViewModelContentImage, yt-thumbnail-view-model, a#thumbnail')) return video;

        for (const selector of THUMBNAIL_HOST_SELECTOR.split(', ')) {
            const host = video.querySelector(selector);
            if (host) return host;
        }

        return video.querySelector('ytd-thumbnail')
            || video.querySelector('yt-thumbnail-view-model')
            || null;
    }

    function needsHideButton(video) {
        if (video.hasAttribute('data-hide-button-added')) {
            const host = findThumbnailHost(video);
            if (findExistingHideButton(host)) return false;
            video.removeAttribute('data-hide-button-added');
        }
        return isReadyForButton(video);
    }

    function isNearViewport(element) {
        const rect = element.getBoundingClientRect();
        const margin = config.viewportMarginPx;
        return rect.bottom >= -margin && rect.top <= window.innerHeight + margin;
    }

    function isInViewport(element) {
        const rect = element.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight
            && rect.right > 0 && rect.left < window.innerWidth;
    }

    function collectContainersNearViewport() {
        const seen = new Set();
        const near = [];

        document.querySelectorAll(VIDEO_CONTAINER_SELECTOR).forEach((element) => {
            if (!isButtonableFeedContainer(element) || seen.has(element)) return;
            if (!isNearViewport(element)) return;
            seen.add(element);
            near.push(element);
        });

        return near;
    }

    function maintainButtonsNearViewport(limit = config.viewportBatchMax) {
        if (!shouldShowHideButtons()) return;
        const near = collectContainersNearViewport();
        if (near.length === 0) return;
        maintainButtons(limit > 0 ? near.slice(0, limit) : near);
    }

    let maintainButtonsNearViewportTimer = null;

    function scheduleMaintainButtonsNearViewport() {
        if (maintainButtonsNearViewportTimer) clearTimeout(maintainButtonsNearViewportTimer);
        maintainButtonsNearViewportTimer = setTimeout(() => {
            maintainButtonsNearViewportTimer = null;
            maintainButtonsNearViewport(config.viewportButtonRefreshMax);
        }, 80);
    }

    function createHideButton(ariaLabel) {
        const button = document.createElement('div');
        button.className = 'hide-video-btn';
        button.title = ariaLabel;
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '0');
        button.setAttribute('aria-label', ariaLabel);

        Object.assign(button.style, {
            width: config.hideButtonSize,
            height: config.hideButtonSize,
            backgroundColor: 'rgba(29, 155, 240, 0.18)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '50%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.35)',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            backdropFilter: 'blur(4px)',
            zIndex: '10010',
            position: 'absolute',
            right: '10px',
            bottom: '10px',
            margin: '0',
            padding: '0',
            pointerEvents: 'auto'
        });

        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('width', '22');
        svg.setAttribute('height', '22');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', '#ffffff');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');

        const circle = document.createElementNS(svgNs, 'circle');
        circle.setAttribute('cx', '12');
        circle.setAttribute('cy', '12');
        circle.setAttribute('r', '10');

        const line = document.createElementNS(svgNs, 'line');
        line.setAttribute('x1', '5');
        line.setAttribute('y1', '5');
        line.setAttribute('x2', '19');
        line.setAttribute('y2', '19');

        svg.appendChild(circle);
        svg.appendChild(line);
        button.appendChild(svg);

        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = 'rgba(29, 155, 240, 0.35)';
            button.style.transform = 'scale(1.12)';
            button.style.boxShadow = '0 4px 14px rgba(29, 155, 240, 0.45)';
        });

        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = 'rgba(29, 155, 240, 0.18)';
            button.style.transform = 'scale(1)';
            button.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.35)';
        });

        button.addEventListener('mousedown', () => {
            button.style.transform = 'scale(0.9)';
        });

        button.addEventListener('mouseup', () => {
            button.style.transform = 'scale(1.12)';
        });

        return button;
    }

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function throttle(func, wait) {
        let lastRun = 0;
        let trailingTimer = null;

        return function (...args) {
            const now = Date.now();
            const remaining = wait - (now - lastRun);

            if (remaining <= 0) {
                if (trailingTimer) {
                    clearTimeout(trailingTimer);
                    trailingTimer = null;
                }
                lastRun = now;
                func.apply(this, args);
                return;
            }

            if (!trailingTimer) {
                trailingTimer = setTimeout(() => {
                    lastRun = Date.now();
                    trailingTimer = null;
                    func.apply(this, args);
                }, remaining);
            }
        };
    }

    function isHideButtonInsideAnchor(btn) {
        return !!btn.closest('a[href*="watch"], a[href*="/shorts/"], a#thumbnail, a.ytLockupViewModelContentImage');
    }

    function getHideButtonMountHost(thumbnailHost) {
        if (!thumbnailHost) return null;
        if (thumbnailHost.matches('a[href*="watch"], a[href*="/shorts/"], a#thumbnail, a.ytLockupViewModelContentImage')) {
            return thumbnailHost.parentElement || thumbnailHost;
        }
        return thumbnailHost;
    }

    function findExistingHideButton(thumbnailHost) {
        if (!thumbnailHost) return null;
        const mountHost = getHideButtonMountHost(thumbnailHost);
        return mountHost?.querySelector(':scope > .hide-video-btn')
            || thumbnailHost.querySelector('.hide-video-btn')
            || null;
    }

    function migrateHideButtonsOutOfAnchors() {
        document.querySelectorAll('a .hide-video-btn').forEach((btn) => {
            const anchor = btn.closest('a[href*="watch"], a[href*="/shorts/"], a#thumbnail, a.ytLockupViewModelContentImage');
            if (!anchor?.parentElement) return;

            const mountHost = anchor.parentElement;
            anchor.classList.remove('hide-video-btn-host');
            mountHost.classList.add('hide-video-btn-host');
            mountHost.appendChild(btn);
        });
    }

    let legacyCleanupDone = false;

    function removeLegacyHideButtons() {
        migrateHideButtonsOutOfAnchors();

        if (legacyCleanupDone) return;
        legacyCleanupDone = true;

        document.querySelectorAll('.hide-video-btn').forEach((btn) => {
            const video = btn.closest(VIDEO_CONTAINER_SELECTOR);
            if (!video) {
                btn.remove();
                return;
            }

            const thumbnailHost = findThumbnailHost(video);
            const mountHost = getHideButtonMountHost(thumbnailHost);
            if (mountHost && btn.parentElement === mountHost) return;

            btn.remove();
            if (!findExistingHideButton(thumbnailHost)) {
                video.removeAttribute('data-hide-button-added');
            }
        });
    }

    function collectVideoContainersFromNodes(nodes) {
        const containers = [];
        const seen = new Set();

        for (const node of nodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;

            if (isFeedVideoContainer(node)) {
                if (!seen.has(node)) {
                    seen.add(node);
                    containers.push(node);
                }
                continue;
            }

            node.querySelectorAll?.(VIDEO_CONTAINER_SELECTOR).forEach((element) => {
                if (!isFeedVideoContainer(element) || seen.has(element)) return;
                seen.add(element);
                containers.push(element);
            });
        }

        return containers;
    }

    function removeAllHideButtons() {
        document.querySelectorAll('.hide-video-btn').forEach((btn) => {
            const video = btn.closest(VIDEO_CONTAINER_SELECTOR);
            const mountHost = btn.parentElement;
            btn.remove();
            mountHost?.classList.remove('hide-video-btn-host');

            if (video) {
                findThumbnailHost(video)?.classList.remove('hide-video-btn-host');
                video.removeAttribute('data-hide-button-added');
            }
        });
    }

    function attachHideButton(video) {
        if (!shouldShowHideButtons()) return false;

        try {
            const thumbnailHost = findThumbnailHost(video);
            if (!thumbnailHost) return false;

            const existingButton = findExistingHideButton(thumbnailHost);
            if (existingButton) {
                if (isHideButtonInsideAnchor(existingButton)) {
                    const mountHost = getHideButtonMountHost(thumbnailHost);
                    if (mountHost) {
                        thumbnailHost.classList.remove('hide-video-btn-host');
                        mountHost.classList.add('hide-video-btn-host');
                        mountHost.appendChild(existingButton);
                    }
                }
                video.setAttribute('data-hide-button-added', 'true');
                return false;
            }

            const mountHost = getHideButtonMountHost(thumbnailHost);
            if (!mountHost) return false;

            thumbnailHost.classList.remove('hide-video-btn-host');
            mountHost.classList.add('hide-video-btn-host');
            mountHost.appendChild(createHideButton(userLang === 'de' ? 'Video ausblenden' : 'Hide video'));

            video.setAttribute('data-hide-button-added', 'true');
            return true;
        } catch (err) {
            if (config.debugMode) console.log('[Ausblender] attachHideButton:', err.message);
            return false;
        }
    }

    function maintainButtons(containers) {
        if (!shouldShowHideButtons()) return;
        let addedCount = 0;
        for (const video of containers) {
            if (needsHideButton(video) && attachHideButton(video)) addedCount += 1;
        }
        if (config.debugMode && addedCount > 0) {
            console.log(formatTranslation('hideVideosFound', { count: addedCount }));
        }
    }

    function maintainContainers(containers) {
        maintainButtons(containers);
    }

    const runFeedMaintenance = debounce((addedNodes = []) => {
        if (!shouldRunFeedMaintenance()) return;

        if (addedNodes.length === 0) {
            maintainButtonsNearViewport();
            return;
        }

        const pending = collectVideoContainersFromNodes(addedNodes).slice(0, config.viewportBatchMax);
        if (pending.length > 0) maintainContainers(pending);
        maintainButtonsNearViewport();
    }, config.debounceMs);

    function queueFeedMaintenance(addedNodes = []) {
        if (!shouldRunFeedMaintenance()) return;
        runFeedMaintenance(addedNodes);
    }

    const onViewportScroll = throttle(() => {
        if (!shouldRunFeedMaintenance()) return;
        maintainButtonsNearViewport();
    }, config.scrollCheckMs);

    let isShortsHidden = GM_getValue('isShortsHidden', false);
    let shortsCheckIntervalId = null;

    function findMastheadButtonsHost() {
        return document.querySelector('ytd-masthead #end #buttons')
            || document.querySelector('ytd-masthead #buttons');
    }

    function checkShortsSection() {
        const wrapper = document.querySelector('.shorts-toggle-wrapper');
        const shortsButton = wrapper?.querySelector('.shorts-toggle-btn');
        const iconSpan = wrapper?.querySelector('.shorts-toggle-icon');
        if (!shortsButton || !iconSpan) return;

        shortsButton.classList.toggle('shorts-toggle-btn--active', isShortsHidden);
        iconSpan.style.display = isShortsHidden ? 'inline-flex' : 'none';

        if (isPlaybackPage()) {
            shortsButton.disabled = false;
            return;
        }

        const shortsSections = queryShortsSections();
        if (shortsSections.length > 0) {
            if (config.debugMode) {
                console.log(formatTranslation('shortsFound', { details: shortsSections[0].outerHTML.slice(0, 100) }));
            }
            shortsButton.disabled = false;
            shortsButton.classList.toggle('shorts-toggle-btn--active', isShortsHidden);
            iconSpan.style.display = isShortsHidden ? 'inline-flex' : 'none';
            shortsSections.forEach(section => {
                const parentSection = section.closest('ytd-rich-section-renderer');
                if (parentSection && !isInExcludedUiArea(parentSection)) {
                    parentSection.style.display = isShortsHidden ? 'none' : '';
                } else if (section.tagName === 'YTM-SHORTS-LOCKUP-VIEW-MODEL' || section.tagName === 'YTD-RICH-ITEM-RENDERER') {
                    const parent = section.closest('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer');
                    if (parent && isFeedVideoContainer(parent)) {
                        parent.style.display = isShortsHidden ? 'none' : '';
                    }
                } else if (!isInExcludedUiArea(section)) {
                    section.style.display = isShortsHidden ? 'none' : '';
                }
            });
        } else {
            if (config.debugMode) console.log(formatTranslation('shortsNotFound'));
            shortsButton.disabled = false;
            shortsButton.classList.toggle('shorts-toggle-btn--active', isShortsHidden);
            iconSpan.style.display = isShortsHidden ? 'inline-flex' : 'none';
        }
    }

    function ensureShortsCheckInterval() {
        if (shortsCheckIntervalId) return;
        shortsCheckIntervalId = setInterval(checkShortsSection, config.shortsCheckInterval);
    }

    function addShortsToggleButton() {
        if (isPlaybackPage()) return;
        if (document.querySelector('.shorts-toggle-wrapper')) return;

        const buttonsHost = findMastheadButtonsHost();
        if (!buttonsHost) {
            if (config.debugMode) console.log(formatTranslation('shortsNoTopbar'));
            return;
        }

        const toggleWrapper = document.createElement('div');
        toggleWrapper.className = 'shorts-toggle-wrapper style-scope ytd-masthead';

        const shortsButton = document.createElement('button');
        shortsButton.type = 'button';
        shortsButton.className = 'shorts-toggle-btn';
        shortsButton.setAttribute('aria-label', userLang === 'de' ? 'Shorts ein- oder ausblenden' : 'Toggle Shorts visibility');

        const textSpan = document.createElement('span');
        textSpan.className = 'shorts-toggle-text';
        textSpan.textContent = formatTranslation('shortsButtonText');

        const iconSpan = document.createElement('span');
        iconSpan.className = 'shorts-toggle-icon';
        iconSpan.textContent = '🚫';
        iconSpan.setAttribute('aria-hidden', 'true');

        shortsButton.appendChild(textSpan);
        shortsButton.appendChild(iconSpan);
        toggleWrapper.appendChild(shortsButton);

        const createButton = buttonsHost.querySelector('ytd-button-renderer');
        if (createButton) {
            buttonsHost.insertBefore(toggleWrapper, createButton);
        } else {
            buttonsHost.prepend(toggleWrapper);
        }

        shortsButton.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            isShortsHidden = !isShortsHidden;
            GM_setValue('isShortsHidden', isShortsHidden);
            checkShortsSection();
            console.log(isShortsHidden ? formatTranslation('shortsSectionHidden') : formatTranslation('shortsSectionShown'));
        });

        if (config.debugMode) console.log(formatTranslation('shortsButtonAdded'));
        ensureShortsCheckInterval();
        checkShortsSection();
    }

    function observeMastheadForToggleButton() {
        if (isPlaybackPage()) return;

        const attach = () => {
            if (isPlaybackPage()) return;

            const masthead = document.querySelector('ytd-masthead');
            if (!masthead || masthead.dataset.shortsToggleObserved === 'true') return;
            masthead.dataset.shortsToggleObserved = 'true';
            mastheadMutationObserver = new MutationObserver(() => {
                if (isPlaybackPage()) {
                    removeMastheadButtons();
                    return;
                }
                addShortsToggleButton();
            });
            mastheadMutationObserver.observe(masthead, { childList: true, subtree: true });
            addShortsToggleButton();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', attach, { once: true });
        } else {
            attach();
        }
    }

    function onDomReady(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback, { once: true });
        } else {
            callback();
        }
    }

    function getFeedObserverTargets() {
        const selectors = [
            'ytd-rich-grid-renderer #contents',
            'ytd-rich-section-renderer #contents',
            'ytd-item-section-renderer #contents',
            'ytd-section-list-renderer #contents',
            'ytd-search #contents'
        ];
        const seen = new Set();
        const targets = [];

        selectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((target) => {
                if (isInExcludedUiArea(target) || seen.has(target)) return;
                seen.add(target);
                targets.push(target);
            });
        });

        return targets;
    }

    function ensureFeedMutationObserver() {
        if (!feedMutationObserver) {
            feedMutationObserver = new MutationObserver((mutations) => {
                try {
                    const addedNodes = [];

                    for (const mutation of mutations) {
                        if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue;
                        if (mutation.target.closest?.('ytd-continuation-item-renderer')) continue;
                        addedNodes.push(...mutation.addedNodes);
                    }

                    if (addedNodes.length > 0) queueFeedMaintenance(addedNodes);
                } catch (err) {
                    console.error(formatTranslation('observerError', { error: err.message }));
                }
            });
        }

        let attached = false;
        getFeedObserverTargets().forEach((target) => {
            if (observedFeedTargets.has(target)) return;
            observedFeedTargets.add(target);
            feedMutationObserver.observe(target, { childList: true, subtree: true });
            attached = true;
        });

        return attached;
    }

    function ensureFeedObserver() {
        if (ensureFeedMutationObserver()) return;

        let attempts = 0;
        const retry = () => {
            if (ensureFeedMutationObserver() || attempts >= 40) return;
            attempts += 1;
            setTimeout(retry, 250);
        };
        onDomReady(retry);
    }

    function observeFeedSections() {
        const attach = () => {
            ensureFeedMutationObserver();
            const browseRoot = document.querySelector('ytd-browse')
                || document.querySelector('ytd-page-manager')
                || document.querySelector('ytd-app');
            if (!browseRoot || browseRoot.dataset.ytAusblenderFeedMeta === 'true') return;
            browseRoot.dataset.ytAusblenderFeedMeta = 'true';
            new MutationObserver(debounce(() => {
                ensureFeedMutationObserver();
            }, 500)).observe(browseRoot, { childList: true, subtree: true });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', attach, { once: true });
        } else {
            attach();
        }
    }

    // CSS hinzufügen
    const style = document.createElement('style');
    style.id = 'yt-video-ausblender-styles';
    style.textContent = `
        .hide-video-btn-host {
            position: relative !important;
            overflow: visible !important;
        }
        .hide-video-btn {
            width: ${config.hideButtonSize} !important;
            height: ${config.hideButtonSize} !important;
            background-color: rgba(29, 155, 240, 0.18) !important;
            border: 1px solid rgba(255, 255, 255, 0.15) !important;
            border-radius: 50% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            cursor: pointer !important;
            pointer-events: auto !important;
            position: absolute !important;
            right: 10px !important;
            bottom: 10px !important;
            z-index: 10010 !important;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35) !important;
            backdrop-filter: blur(4px) !important;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .shorts-toggle-wrapper {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            margin: 0 8px 0 0 !important;
            height: 40px !important;
            vertical-align: middle !important;
            flex-shrink: 0 !important;
        }
        .shorts-toggle-btn {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 6px !important;
            height: 36px !important;
            padding: 0 14px !important;
            border: 1px solid rgba(255, 255, 255, 0.15) !important;
            border-radius: 18px !important;
            background: rgba(29, 155, 240, 0.18) !important;
            color: #fff !important;
            cursor: pointer !important;
            font-size: 14px !important;
            font-family: inherit !important;
            line-height: 1 !important;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25) !important;
            backdrop-filter: blur(4px) !important;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .shorts-toggle-btn:hover {
            background: rgba(29, 155, 240, 0.35) !important;
            transform: scale(1.04) !important;
            box-shadow: 0 4px 14px rgba(29, 155, 240, 0.35) !important;
        }
        .shorts-toggle-btn--active {
            background: rgba(204, 0, 0, 0.28) !important;
            border-color: rgba(255, 120, 120, 0.35) !important;
        }
        .shorts-toggle-text {
            font-weight: 500 !important;
            white-space: nowrap !important;
        }
        .shorts-toggle-icon {
            display: none;
            align-items: center !important;
            justify-content: center !important;
            font-size: 12px !important;
            width: 18px !important;
            height: 18px !important;
            border-radius: 50% !important;
            background-color: rgba(0, 0, 0, 0.55) !important;
            line-height: 18px !important;
        }
        .yt-ausblender-restore-wrapper {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            margin: 0 8px 0 0 !important;
            height: 40px !important;
            vertical-align: middle !important;
            flex-shrink: 0 !important;
        }
        .yt-ausblender-restore-btn {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            height: 36px !important;
            padding: 0 14px !important;
            border: 1px solid rgba(255, 255, 255, 0.15) !important;
            border-radius: 18px !important;
            background: rgba(29, 155, 240, 0.18) !important;
            color: #fff !important;
            cursor: pointer !important;
            font-size: 14px !important;
            font-family: inherit !important;
            line-height: 1 !important;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25) !important;
            backdrop-filter: blur(4px) !important;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
            white-space: nowrap !important;
        }
        .yt-ausblender-restore-btn:hover:not(:disabled) {
            background: rgba(29, 155, 240, 0.35) !important;
            transform: scale(1.04) !important;
        }
        .yt-ausblender-restore-btn--active {
            background: rgba(46, 204, 113, 0.28) !important;
            border-color: rgba(140, 255, 180, 0.35) !important;
        }
        .yt-ausblender-restore-btn:disabled {
            opacity: 0.45 !important;
            cursor: default !important;
        }
        .yt-ausblender-restore-backdrop {
            position: fixed !important;
            inset: 0 !important;
            z-index: 10020 !important;
            background: rgba(0, 0, 0, 0.55) !important;
            display: flex !important;
            align-items: flex-start !important;
            justify-content: center !important;
            padding: 72px 16px 24px !important;
        }
        .yt-ausblender-restore-panel {
            width: min(560px, 100%) !important;
            max-height: min(70vh, 640px) !important;
            overflow: hidden !important;
            display: flex !important;
            flex-direction: column !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            border-radius: 16px !important;
            background: rgba(24, 24, 24, 0.96) !important;
            color: #fff !important;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45) !important;
            backdrop-filter: blur(12px) !important;
        }
        .yt-ausblender-restore-panel__header {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 12px !important;
            padding: 16px 18px !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        }
        .yt-ausblender-restore-panel__title {
            margin: 0 !important;
            font-size: 18px !important;
            font-weight: 600 !important;
        }
        .yt-ausblender-restore-panel__header-actions {
            display: flex !important;
            gap: 8px !important;
            flex-shrink: 0 !important;
        }
        .yt-ausblender-restore-panel__action-btn,
        .yt-ausblender-restore-panel__close-btn,
        .yt-ausblender-restore-panel__restore-btn {
            border: 1px solid rgba(255, 255, 255, 0.15) !important;
            border-radius: 14px !important;
            background: rgba(29, 155, 240, 0.18) !important;
            color: #fff !important;
            cursor: pointer !important;
            font-size: 13px !important;
            font-family: inherit !important;
            padding: 8px 12px !important;
        }
        .yt-ausblender-restore-panel__restore-btn {
            background: rgba(46, 204, 113, 0.22) !important;
            flex-shrink: 0 !important;
        }
        .yt-ausblender-restore-panel__action-btn:disabled {
            opacity: 0.45 !important;
            cursor: default !important;
        }
        .yt-ausblender-restore-panel__list {
            overflow-y: auto !important;
            padding: 10px !important;
        }
        .yt-ausblender-restore-panel__empty {
            margin: 0 !important;
            padding: 24px 12px !important;
            text-align: center !important;
            opacity: 0.75 !important;
        }
        .yt-ausblender-restore-panel__item {
            display: flex !important;
            align-items: center !important;
            gap: 12px !important;
            padding: 10px !important;
            border-radius: 12px !important;
        }
        .yt-ausblender-restore-panel__item:hover {
            background: rgba(255, 255, 255, 0.05) !important;
        }
        .yt-ausblender-restore-panel__thumb-link {
            flex-shrink: 0 !important;
        }
        .yt-ausblender-restore-panel__thumb {
            width: 96px !important;
            height: 54px !important;
            object-fit: cover !important;
            border-radius: 8px !important;
            display: block !important;
        }
        .yt-ausblender-restore-panel__meta {
            display: flex !important;
            flex-direction: column !important;
            gap: 4px !important;
            min-width: 0 !important;
            flex: 1 !important;
        }
        .yt-ausblender-restore-panel__id-link {
            color: #fff !important;
            text-decoration: none !important;
            font-weight: 500 !important;
            word-break: break-all !important;
        }
        .yt-ausblender-restore-panel__id-link:hover {
            text-decoration: underline !important;
        }
        .yt-ausblender-restore-panel__date {
            font-size: 12px !important;
            opacity: 0.7 !important;
        }
    `;
    function injectStyles() {
        if (document.getElementById('yt-video-ausblender-styles')) return;
        (document.head || document.documentElement).appendChild(style);
    }

    function onNavigationStart() {
        cancelPlaybackDomCleanup();
        pauseBrowseFeatures();
        activateNavigationGuard(config.playbackNavGuardMs);
    }

    function onNavigationFinish() {
        if (isPlaybackPage()) {
            pauseBrowseFeatures();
            schedulePlaybackDomCleanup();
        } else {
            cancelPlaybackDomCleanup();
            startBrowseFeatures();
        }
    }

    function setupNavigationListeners() {
        if (navigationListenersInstalled) return;
        navigationListenersInstalled = true;
        document.addEventListener('yt-navigate-start', onNavigationStart);
        document.addEventListener('yt-navigate-finish', onNavigationFinish);
    }

    function initialize() {
        try {
            injectStyles();
            setupNavigationListeners();
            window.addEventListener('scroll', onViewportScroll, { passive: true });
            if (isPlaybackPage()) {
                teardownBrowseFeatures();
            } else {
                startBrowseFeatures();
            }

            if (config.debugMode) console.log(formatTranslation('initStarted'));
        } catch (err) {
            console.error(formatTranslation('initError', { error: err.message }));
        }
    }

    onDomReady(() => setTimeout(initialize, 100));
})();
