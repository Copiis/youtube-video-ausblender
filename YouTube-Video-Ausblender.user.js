// ==UserScript==
// @name YouTube Video Hider with 🚫 Icon and Shorts Toggle
// @name:de YouTube Video Ausblender mit 🚫 Symbol und Shorts Umschalter
// @name:es Ocultador de Videos de YouTube con Icono 🚫 y Alternador de Shorts
// @name:fr Masqueur de Vidéos YouTube avec Icône 🚫 et Basculeur de Shorts
// @name:it Nascondi Video YouTube con Icona 🚫 e Interruttore Shorts
// @namespace https://github.com/Copiis/youtube-video-ausblender
// @version 2026.6.24j
// @description Hide videos by ID with restore panel; synced list with upload time, sequential auto-hide
// @description:de Videos per ID ausblenden mit Einblend-Panel; sync-Liste mit Upload-Zeit, serielles Auto-Ausblenden
// @description:es Agrega un símbolo 🚫 a los metadatos de video, excluyendo Shorts, y un botón compacto para alternar Shorts con estado persistente
// @description:fr Ajoute un symbole 🚫 aux métadonnées des vidéos, sauf pour les Shorts, et un bouton compact pour activer/désactiver les Shorts avec état persistant
// @description:it Aggiunge un simbolo 🚫 ai metadati dei video, esclusi i Shorts, e un pulsante compatto per attivare/disattivare i Shorts con stato persistente
// @icon https://youtube.com/favicon.ico
// @author Copiis
// @license MIT
// @match https://www.youtube.com/*
// @run-at document-idle
// @grant GM_setValue
// @grant GM_getValue
// @downloadURL https://raw.githubusercontent.com/Copiis/youtube-video-ausblender/master/YouTube-Video-Ausblender.user.js
// @updateURL https://raw.githubusercontent.com/Copiis/youtube-video-ausblender/master/YouTube-Video-Ausblender.user.js
// @description If you find this script useful and would like to support my work, consider making a small donation!
// @description GitHub Sponsors: https://github.com/sponsors/Copiis
// ==/UserScript==

(function () {
    'use strict';

    // Konfigurationsobjekt
    const config = {
        hideButtonSize: '44px',
        maxHiddenVideos: 1000,
        shortsCheckInterval: 2000,
        maxShortsAttempts: 30,
        debugMode: false,
        debounceMs: 350,
        viewportMarginPx: 300,
        viewportBatchMax: 24,
        viewportButtonRefreshMax: 48,
        hideDelayAfterThumbnailMs: 100,
        hideCheckIntervalMs: 1200,
        maxSimultaneousHides: 3,
        hideBatchCooldownMs: 800,
        hideThumbnailFallbackMs: 2500,
        publishDateBackfillIntervalMs: 5000,
        publishDateNetworkBatchDelayMs: 2500,
        publishDateNetworkMaxPerSession: 12,
        scrollCheckMs: 200,
        thumbnailMinWidthPx: 120,
        thumbnailDecodeTimeoutMs: 500,
        continuationGuardPx: 320,
        playbackNavGuardMs: 8000,
        playbackDomCleanupDelayMs: 8000
    };

    const HIDDEN_VIDEOS_KEY = 'hiddenVideoIds';
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
    const PUBLISH_META_SELECTOR = '#metadata-line span.inline-metadata-item, #metadata-line yt-formatted-string, ytd-video-meta-block span.inline-metadata-item, yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-text, .yt-lockup-metadata-view-model__metadata-text, ytd-video-meta-block #metadata-line span, .ytContentMetadataViewModelMetadataText, .ytLockupMetadataViewModelMetadataText, [class*="ContentMetadataViewModelMetadataText"], span[role="text"][aria-label]';
    let hiddenVideoIdSet = new Set();
    let hiddenVideoEntries = [];
    let hiddenVideoPublishedAt = new Map();
    const publishDateFetchCache = new Map();
    let publishDateBackfillToken = 0;
    let publishDateNetworkFetchedThisSession = 0;
    const pendingThumbnailHideWait = new WeakSet();
    const scheduledHideContainers = new WeakSet();
    let observedFeedTargets = new WeakSet();
    let feedMutationObserver = null;
    let lastAppliedHideAt = 0;
    let hideBatchActive = false;
    let hideBatchCooldownTimer = null;
    let navigationGuardUntil = 0;
    let feedMaintenanceEnabled = true;
    let browseFeaturesActive = false;
    let mastheadMutationObserver = null;
    let navigationListenersInstalled = false;
    let playbackDomCleanupTimer = null;
    const activeDateFetchControllers = new Set();

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

    function stopHideBatch() {
        hideBatchActive = false;
        if (hideBatchCooldownTimer) {
            clearTimeout(hideBatchCooldownTimer);
            hideBatchCooldownTimer = null;
        }
    }

    function removeMastheadButtons() {
        closeRestoreListPanel();
        document.querySelector('.shorts-toggle-wrapper')?.remove();
        document.querySelector('.yt-ausblender-restore-wrapper')?.remove();
    }

    function stopAllIntervals() {
        if (hideCheckIntervalId) {
            clearInterval(hideCheckIntervalId);
            hideCheckIntervalId = null;
        }
        if (backfillIntervalId) {
            clearInterval(backfillIntervalId);
            backfillIntervalId = null;
        }
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
        stopHideBatch();
        cancelPendingNetworkDateFetches();
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
        addRestoreListButton();
        updateRestoreListButtonLabel();
        ensureShortsCheckInterval();
        checkShortsSection();
        ensureFeedIntervalsStarted();

        setTimeout(runContinuousHideCheck, 300);
        setTimeout(runContinuousHideCheck, 800);
        setTimeout(() => maintainButtonsNearViewport(config.viewportButtonRefreshMax), 1000);
    }

    function restoreWatchPrimaryHiddenContainers() {
        document.querySelectorAll('ytd-watch-flexy [data-hidden-by-script]').forEach((container) => {
            if (!container.closest('ytd-watch-next-secondary-results-renderer')) {
                restoreVideoContainer(container);
            }
        });

        document.querySelectorAll('ytd-watch-flexy #primary ytd-rich-section-renderer, ytd-watch-flexy #primary ytd-rich-item-renderer, ytd-watch-flexy #primary yt-lockup-view-model').forEach((element) => {
            if (element.closest('ytd-watch-next-secondary-results-renderer')) return;
            if (element.hasAttribute('data-hidden-by-script')) return;
            if (element.style.display === 'none') element.style.display = '';
        });
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

    function cancelPendingNetworkDateFetches() {
        publishDateBackfillToken += 1;
        activeDateFetchControllers.forEach((controller) => {
            try {
                controller.abort();
            } catch (err) {
                if (config.debugMode) console.log('[Ausblender] Fetch-Abort:', err.message);
            }
        });
        activeDateFetchControllers.clear();
    }

    function canRunNetworkDateBackfill() {
        if (isNavigationGuardActive()) return false;
        if (isPlaybackPage()) return false;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
        if (typeof document !== 'undefined' && document.hidden) return false;
        return true;
    }

    function isAllowedMaintenanceContainer(container) {
        if (!shouldRunFeedMaintenance()) return false;
        return isHideableFeedContainer(container);
    }

    function isFeedVideoContainer(element) {
        return !!(element && element.matches(VIDEO_CONTAINER_SELECTOR) && isTopLevelVideoContainer(element) && !isInExcludedUiArea(element));
    }

    function isHideableFeedContainer(container) {
        if (!isFeedVideoContainer(container)) return false;
        if (isInPrimaryPlaybackArea(container)) return false;
        if (container.closest('ytd-continuation-item-renderer')) return false;
        if (container.hasAttribute('is-shelf-item')) return false;
        return true;
    }

    function shouldHideById(container) {
        if (!isAllowedMaintenanceContainer(container)) return false;
        const videoId = extractVideoId(container);
        return !!(videoId && hiddenVideoIdSet.has(videoId));
    }

    function isYtThumbnailSrc(src) {
        return !!(src && !src.startsWith('data:') && YTIMG_SRC_PATTERN.test(src));
    }

    function pickThumbnailImg(img) {
        if (!img || img.tagName !== 'IMG') return null;
        const src = img.currentSrc || img.src || '';
        return isYtThumbnailSrc(src) ? img : null;
    }

    function findThumbnailImgInRoot(root) {
        if (!root) return null;

        for (const img of root.querySelectorAll?.('img') || []) {
            const picked = pickThumbnailImg(img);
            if (picked) return picked;
        }

        const stack = [root];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;

            if (node.shadowRoot) {
                for (const img of node.shadowRoot.querySelectorAll('img')) {
                    const picked = pickThumbnailImg(img);
                    if (picked) return picked;
                }
                stack.push(...node.shadowRoot.children);
            }

            stack.push(...node.children);
        }

        return null;
    }

    function getThumbnailImage(container) {
        if (!container) return null;

        const host = findThumbnailHost(container);
        if (host) {
            const hostImg = findThumbnailImgInRoot(host);
            if (hostImg) return hostImg;
        }

        for (const shadowHost of container.querySelectorAll(THUMBNAIL_SHADOW_HOST_SELECTOR)) {
            const shadowImg = findThumbnailImgInRoot(shadowHost);
            if (shadowImg) return shadowImg;
        }

        return findThumbnailImgInRoot(container);
    }

    function hasThumbnailSrc(img) {
        const src = img?.currentSrc || img?.src || '';
        return isYtThumbnailSrc(src);
    }

    function hasThumbnailBackgroundImage(root) {
        if (!root) return false;

        const stack = [root];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;

            const bg = getComputedStyle(node).backgroundImage || '';
            if (bg !== 'none' && YTIMG_SRC_PATTERN.test(bg)) return true;

            if (node.shadowRoot) stack.push(...node.shadowRoot.children);
            stack.push(...node.children);
        }

        return false;
    }

    function isThumbnailFullyLoaded(container) {
        const img = getThumbnailImage(container);
        if (img && hasThumbnailSrc(img) && img.complete) {
            if (img.naturalWidth >= config.thumbnailMinWidthPx) return true;
            if (img.naturalWidth > 0) return true;
        }

        const host = findThumbnailHost(container);
        return hasThumbnailBackgroundImage(host);
    }

    function afterThumbnailDecoded(container, callback) {
        const run = () => {
            if (!container.isConnected) return;
            callback();
        };
        const img = getThumbnailImage(container);
        if (!img) {
            run();
            return;
        }

        if (typeof img.decode === 'function') {
            Promise.race([
                img.decode(),
                new Promise((resolve) => setTimeout(resolve, config.thumbnailDecodeTimeoutMs))
            ]).then(run).catch(run);
        } else {
            run();
        }
    }

    function whenThumbnailFullyLoaded(container, callback) {
        if (isThumbnailFullyLoaded(container)) {
            afterThumbnailDecoded(container, callback);
            return;
        }

        const img = getThumbnailImage(container);
        if (!img) {
            watchContainerForThumbnail(container, callback);
            return;
        }

        if (!pendingThumbnailHideWait.has(img)) {
            pendingThumbnailHideWait.add(img);

            const done = () => {
                img.removeEventListener('load', done);
                img.removeEventListener('error', done);
                pendingThumbnailHideWait.delete(img);
                if (!container.isConnected || !isThumbnailFullyLoaded(container)) return;
                afterThumbnailDecoded(container, callback);
            };

            if (img.complete) {
                setTimeout(done, 0);
            } else {
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
            }
            return;
        }

        if (isThumbnailFullyLoaded(container)) {
            afterThumbnailDecoded(container, callback);
        }
    }

    function watchContainerForThumbnail(container, callback) {
        if (container.dataset.ytAusblenderThumbWatch === 'true') return;
        container.dataset.ytAusblenderThumbWatch = 'true';

        const observer = new MutationObserver(() => {
            if (!container.isConnected || !shouldHideById(container)) {
                observer.disconnect();
                delete container.dataset.ytAusblenderThumbWatch;
                return;
            }
            if (!isThumbnailFullyLoaded(container)) return;
            observer.disconnect();
            delete container.dataset.ytAusblenderThumbWatch;
            whenThumbnailFullyLoaded(container, callback);
        });

        observer.observe(container, { childList: true, subtree: true });
    }

    function isHydratedVideoContainer(container) {
        if (!extractVideoId(container) || !findThumbnailHost(container)) return false;
        return !!(
            container.matches('yt-lockup-view-model, ytd-video-renderer')
            || container.querySelector('yt-lockup-view-model, ytd-rich-grid-media, #video-title, h3 a, .yt-lockup-metadata-view-model__title, [class*="LockupMetadata"], [class*="ContentMetadataViewModel"], span[role="text"][aria-label]')
            || getThumbnailImage(container)
        );
    }

    function isAboveContinuationZone(container) {
        const contents = container.closest('ytd-rich-grid-renderer #contents, ytd-item-section-renderer #contents, ytd-section-list-renderer #contents, #contents');
        if (!contents) return true;

        const continuation = contents.querySelector(':scope > ytd-continuation-item-renderer');
        if (!continuation) return true;

        return container.getBoundingClientRect().top < continuation.getBoundingClientRect().top - config.continuationGuardPx;
    }

    function canAutoHideNow(container) {
        if (isNavigationGuardActive()) return false;
        if (!shouldHideById(container)) return false;
        if (!extractVideoId(container) || !findThumbnailHost(container)) return false;
        return isNearViewport(container);
    }

    function isSafeToAutoHide(container) {
        return canAutoHideNow(container) && isThumbnailFullyLoaded(container);
    }

    function isReadyForButton(element) {
        if (!shouldShowHideButtons()) return false;
        if (isNavigationGuardActive()) return false;
        if (!isAllowedMaintenanceContainer(element)) return false;
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
            restoreButtonText: 'Hidden',
            restorePanelTitle: 'Hidden videos',
            restoreItemButton: 'Show again',
            restoreAllButton: 'Show all',
            restoreEmpty: 'No hidden videos',
            restoreClose: 'Close',
            restoreUnknownDate: 'Unknown date',
            restoreVideoShown: 'Video shown again: ${videoId}',
            restoreAllShown: 'All videos shown again (${count})'
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
            restoreButtonText: 'Ausgeblendet',
            restorePanelTitle: 'Ausgeblendete Videos',
            restoreItemButton: 'Einblenden',
            restoreAllButton: 'Alle einblenden',
            restoreEmpty: 'Keine ausgeblendeten Videos',
            restoreClose: 'Schließen',
            restoreUnknownDate: 'Datum unbekannt',
            restoreVideoShown: 'Video wieder eingeblendet: ${videoId}',
            restoreAllShown: 'Alle Videos eingeblendet (${count})'
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

    function normalizeHiddenEntry(item) {
        if (typeof item === 'string' && VIDEO_ID_PATTERN.test(item)) {
            return { id: item, publishedAt: 0 };
        }
        if (item && typeof item.id === 'string' && VIDEO_ID_PATTERN.test(item.id)) {
            const publishedAt = sanitizePublishTimestamp(Number(item.publishedAt));
            return { id: item.id, publishedAt };
        }
        return null;
    }

    function loadHiddenVideoEntries() {
        const list = GM_getValue(HIDDEN_VIDEOS_KEY, []);
        if (!Array.isArray(list)) return [];
        return list.map(normalizeHiddenEntry).filter(Boolean);
    }

    function persistHiddenVideoEntries() {
        GM_setValue(HIDDEN_VIDEOS_KEY, hiddenVideoEntries);
    }

    function refreshHiddenVideoSet() {
        hiddenVideoEntries = loadHiddenVideoEntries();
        hiddenVideoIdSet = new Set(hiddenVideoEntries.map((entry) => entry.id));
        hiddenVideoPublishedAt = new Map(hiddenVideoEntries.map((entry) => [entry.id, entry.publishedAt || 0]));
    }

    const YOUTUBE_LAUNCH_MS = Date.UTC(2005, 1, 14);
    const PUBLISH_DATE_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

    function isPlausiblePublishTimestamp(ts) {
        if (!ts || !Number.isFinite(ts)) return false;
        const now = Date.now();
        return ts >= YOUTUBE_LAUNCH_MS && ts <= now + PUBLISH_DATE_FUTURE_SLACK_MS;
    }

    function normalizeTwoDigitYear(year) {
        if (year >= 100) return year;
        const currentYear = new Date().getFullYear();
        const century = Math.floor(currentYear / 100) * 100;
        let candidate = century + year;
        if (candidate > currentYear + 1) candidate -= 100;
        return candidate;
    }

    function looksLikeDurationToken(text) {
        const match = text.trim().match(/^(\d{1,2})[.:](\d{1,2})[.:](\d{2})$/);
        if (!match) return false;

        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseInt(match[3], 10);
        return hours <= 9 && minutes <= 59 && seconds <= 59;
    }

    function looksLikeViewCountToken(text) {
        const raw = (text || '').trim();
        if (!raw) return false;
        const lower = raw.toLowerCase();

        if (/\b(?:views?|aufrufe?|visualizaciones|visualizzazioni|wyświetle|观看|조회)\b/i.test(lower)) return true;
        if (/\b(?:vor\s+|ago|gestern|yesterday|heute|today|gerade eben|just now|gestreamt|streamed|premiere)\b/i.test(lower)) return false;
        if (/\b(?:mrd|milliarden|billion|million|mio\.?|bio\.?|tys\.?)\b/i.test(lower)) return true;
        if (/^\d[\d.,\s]*(?:\s*(?:k|m|b|mrd|mio|tys))?\.?$/i.test(lower)) return true;
        return false;
    }

    function sanitizePublishTimestamp(ts) {
        return isPlausiblePublishTimestamp(ts) ? ts : 0;
    }

    function getPublishedAtForId(videoId) {
        const ts = hiddenVideoPublishedAt.get(videoId) || 0;
        return isPlausiblePublishTimestamp(ts) ? ts : 0;
    }

    function updatePublishedAtIfMissing(videoId, publishedAt) {
        const sanitized = sanitizePublishTimestamp(publishedAt);
        if (!videoId || !sanitized) return;

        const current = hiddenVideoPublishedAt.get(videoId) || 0;
        if (isPlausiblePublishTimestamp(current)) return;

        const entry = hiddenVideoEntries.find((item) => item.id === videoId);
        if (!entry) return;

        entry.publishedAt = sanitized;
        hiddenVideoPublishedAt.set(videoId, sanitized);
        persistHiddenVideoEntries();
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

    function backfillPublishedAtFromDom(container) {
        const videoId = extractVideoId(container);
        if (!videoId || !hiddenVideoIdSet.has(videoId)) return 0;
        if (getPublishedAtForId(videoId) > 0) return getPublishedAtForId(videoId);

        const publishedAt = extractPublishedAt(container);
        if (publishedAt > 0) updatePublishedAtIfMissing(videoId, publishedAt);
        return getPublishedAtForId(videoId);
    }

    function backfillPublishedAtFromVisibleDom() {
        if (!shouldRunFeedMaintenance()) return;

        document.querySelectorAll(`${VIDEO_CONTAINER_SELECTOR}[data-hidden-by-script]`).forEach((container) => {
            backfillPublishedAtFromDom(container);
        });
        collectContainersNearViewport().forEach((container) => {
            if (shouldHideById(container)) backfillPublishedAtFromDom(container);
        });
    }

    function parseUploadDateFromHtml(html) {
        if (!html || typeof html !== 'string') return 0;
        const match = html.match(/"uploadDate":"([^"]+)"/) || html.match(/"publishDate":"([^"]+)"/);
        if (!match) return 0;
        return sanitizePublishTimestamp(Date.parse(match[1]));
    }

    function fetchPublishedAtFromVideoPage(videoId) {
        if (!videoId) return Promise.resolve(0);
        if (!canRunNetworkDateBackfill()) return Promise.resolve(0);
        if (publishDateNetworkFetchedThisSession >= config.publishDateNetworkMaxPerSession) {
            return Promise.resolve(0);
        }

        const cached = publishDateFetchCache.get(videoId);
        if (typeof cached === 'number') return Promise.resolve(cached);
        if (cached) return cached;

        publishDateNetworkFetchedThisSession += 1;
        const controller = new AbortController();
        activeDateFetchControllers.add(controller);

        const request = fetch(`https://www.youtube.com/watch?v=${videoId}`, {
            credentials: 'same-origin',
            signal: controller.signal
        })
            .then((response) => (response.ok ? response.text() : ''))
            .then((html) => {
                const ts = parseUploadDateFromHtml(html);
                publishDateFetchCache.set(videoId, ts);
                return ts;
            })
            .catch((err) => {
                if (err?.name !== 'AbortError') {
                    publishDateFetchCache.set(videoId, 0);
                }
                return 0;
            })
            .finally(() => {
                activeDateFetchControllers.delete(controller);
            });

        publishDateFetchCache.set(videoId, request);
        return request;
    }

    function updateRestorePanelDates() {
        document.querySelectorAll('.yt-ausblender-restore-panel__item').forEach((item) => {
            const idLink = item.querySelector('.yt-ausblender-restore-panel__id-link');
            const dateEl = item.querySelector('.yt-ausblender-restore-panel__date');
            if (!idLink || !dateEl) return;

            const videoId = (idLink.textContent || '').trim();
            if (!videoId) return;
            dateEl.textContent = formatPublishedAtLabel(getPublishedAtForId(videoId));
        });
    }

    function backfillMissingPublishedDatesFromNetwork() {
        if (!canRunNetworkDateBackfill()) {
            if (config.debugMode) {
                console.log('[Ausblender] Upload-Datum-Netzwerk-Backfill übersprungen (Wiedergabe/Offline)');
            }
            return;
        }

        const missingIds = hiddenVideoEntries
            .filter((entry) => !entry.publishedAt)
            .map((entry) => entry.id);
        if (missingIds.length === 0) return;

        const token = ++publishDateBackfillToken;
        const batchSize = 2;
        const batchDelayMs = config.publishDateNetworkBatchDelayMs;

        const runBatch = (startIndex) => {
            if (token !== publishDateBackfillToken) return;
            if (!canRunNetworkDateBackfill()) return;
            if (publishDateNetworkFetchedThisSession >= config.publishDateNetworkMaxPerSession) return;

            const batch = missingIds.slice(startIndex, startIndex + batchSize);
            if (batch.length === 0) return;

            Promise.all(batch.map((videoId) => fetchPublishedAtFromVideoPage(videoId).then((publishedAt) => {
                if (publishedAt > 0) updatePublishedAtIfMissing(videoId, publishedAt);
            }))).finally(() => {
                if (token !== publishDateBackfillToken) return;
                updateRestorePanelDates();
                if (startIndex + batchSize < missingIds.length) {
                    setTimeout(() => runBatch(startIndex + batchSize), batchDelayMs);
                }
            });
        };

        setTimeout(() => runBatch(0), 1500);
    }

    function parsePublishTextToTimestamp(text) {
        if (!text || typeof text !== 'string') return 0;
        const raw = text.trim();
        if (!raw) return 0;

        if (looksLikeDurationToken(raw)) return 0;

        const lower = raw.toLowerCase().replace(/\.$/, '');
        const relativeText = lower
            .replace(/^(?:premiere|streamed live|live|uploaded|published|veröffentlicht)\s+/i, '')
            .replace(/\s+(?:gestreamt|streamed)(?:\s+live)?$/i, '')
            .trim();

        const relativeRules = [
            [/^(?:vor\s+)?(?:einer?|1)\s+minute(?:n)?(?:\s+ago)?$/, 60 * 1000],
            [/^(?:vor\s+)?(?:einer?|1)\s+stunde(?:n)?(?:\s+ago)?$/, 60 * 60 * 1000],
            [/^(?:vor\s+)?(?:einem?|1)\s+tag(?:e|en)?(?:\s+ago)?$/, 24 * 60 * 60 * 1000],
            [/^(?:vor\s+)?(\d+)\s+sekunden?(?:\s+ago)?$/, (n) => Number(n) * 1000],
            [/^(?:vor\s+)?(\d+)\s+minuten?(?:\s+ago)?$/, (n) => Number(n) * 60 * 1000],
            [/^(?:vor\s+)?(\d+)\s+stunden?(?:\s+ago)?$/, (n) => Number(n) * 60 * 60 * 1000],
            [/^(?:vor\s+)?(\d+)\s+tagen?(?:\s+ago)?$/, (n) => Number(n) * 24 * 60 * 60 * 1000],
            [/^(?:vor\s+)?(\d+)\s+wochen?(?:\s+ago)?$/, (n) => Number(n) * 7 * 24 * 60 * 60 * 1000],
            [/^(?:vor\s+)?(\d+)\s+monaten?(?:\s+ago)?$/, (n) => Number(n) * 30 * 24 * 60 * 60 * 1000],
            [/^(?:vor\s+)?(\d+)\s+jahren?(?:\s+ago)?$/, (n) => Number(n) * 365 * 24 * 60 * 60 * 1000],
            [/^(\d+)\s+seconds?\s+ago$/, (n) => Number(n) * 1000],
            [/^(\d+)\s+minutes?\s+ago$/, (n) => Number(n) * 60 * 1000],
            [/^(\d+)\s+hours?\s+ago$/, (n) => Number(n) * 60 * 60 * 1000],
            [/^(\d+)\s+days?\s+ago$/, (n) => Number(n) * 24 * 60 * 60 * 1000],
            [/^(\d+)\s+weeks?\s+ago$/, (n) => Number(n) * 7 * 24 * 60 * 60 * 1000],
            [/^(\d+)\s+months?\s+ago$/, (n) => Number(n) * 30 * 24 * 60 * 60 * 1000],
            [/^(\d+)\s+years?\s+ago$/, (n) => Number(n) * 365 * 24 * 60 * 60 * 1000],
            [/^(?:gestern|yesterday)$/, 24 * 60 * 60 * 1000],
            [/^(?:heute|today|gerade eben|just now)$/, 0],
            [/streamed\s+live/, 0]
        ];

        for (const [pattern, offset] of relativeRules) {
            const match = relativeText.match(pattern);
            if (!match) continue;
            const ms = typeof offset === 'function' ? offset(match[1]) : offset;
            return sanitizePublishTimestamp(Date.now() - ms);
        }

        const germanDate = raw.match(/(?:^|[^\d])(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[^\d]|$)/);
        if (germanDate) {
            const day = parseInt(germanDate[1], 10);
            const month = parseInt(germanDate[2], 10);
            let year = parseInt(germanDate[3], 10);
            if (month < 1 || month > 12 || day < 1 || day > 31) return 0;
            if (year < 100) year = normalizeTwoDigitYear(year);
            const ts = new Date(year, month - 1, day).getTime();
            return sanitizePublishTimestamp(ts);
        }

        const monthNames = {
            jan: 0, january: 0, januar: 0,
            feb: 1, february: 1, februar: 1,
            mar: 2, march: 2, märz: 2, maerz: 2,
            apr: 3, april: 3,
            may: 4, mai: 4,
            jun: 5, june: 5, juni: 5,
            jul: 6, july: 6, juli: 6,
            aug: 7, august: 7,
            sep: 8, sept: 8, september: 8,
            oct: 9, october: 9, okt: 9, oktober: 9,
            nov: 10, november: 10,
            dec: 11, december: 11, dez: 11, dezember: 11
        };

        const englishDate = lower.match(/([a-zäöüß.]+)\s+(\d{1,2}),?\s+(\d{4})/);
        if (englishDate) {
            const month = monthNames[englishDate[1].replace(/\./g, '')];
            if (month !== undefined) {
                const ts = new Date(parseInt(englishDate[3], 10), month, parseInt(englishDate[2], 10)).getTime();
                return sanitizePublishTimestamp(ts);
            }
        }

        const parsed = Date.parse(raw);
        return sanitizePublishTimestamp(parsed);
    }

    function pushPublishTextCandidate(bucket, text) {
        const trimmed = (text || '').trim();
        if (!trimmed || looksLikeViewCountToken(trimmed)) return;
        bucket.push(trimmed);
    }

    function collectPublishTextCandidates(container) {
        const prioritized = [];
        const fallback = [];

        queryAllDeep(container, 'time[datetime]').forEach((timeEl) => {
            pushPublishTextCandidate(prioritized, timeEl.getAttribute('datetime'));
        });

        PUBLISH_META_SELECTOR.split(',').map((selector) => selector.trim()).forEach((selector) => {
            queryAllDeep(container, selector).forEach((el) => {
                pushPublishTextCandidate(prioritized, el.getAttribute('aria-label'));
                pushPublishTextCandidate(prioritized, el.textContent);
            });
        });

        queryAllDeep(container, 'a[href*="watch"], a[href*="/shorts/"]').forEach((el) => {
            pushPublishTextCandidate(fallback, el.getAttribute('aria-label'));
        });

        return [...prioritized, ...fallback];
    }

    function extractPublishedAt(container) {
        if (!container) return 0;

        const texts = collectPublishTextCandidates(container);
        for (const text of texts) {
            const directTs = sanitizePublishTimestamp(Date.parse(text));
            if (directTs > 0) return directTs;
        }
        for (let i = texts.length - 1; i >= 0; i -= 1) {
            const parts = texts[i].split(/\s*[•·|]\s*/);
            for (let j = parts.length - 1; j >= 0; j -= 1) {
                const ts = parsePublishTextToTimestamp(parts[j]);
                if (ts > 0) return ts;
            }

            const ts = parsePublishTextToTimestamp(texts[i]);
            if (ts > 0) return ts;
        }

        return 0;
    }

    function compareHidePriority(containerA, containerB) {
        const idA = extractVideoId(containerA) || '';
        const idB = extractVideoId(containerB) || '';
        const timeA = getPublishedAtForId(idA);
        const timeB = getPublishedAtForId(idB);

        if (timeA === 0 && timeB === 0) return idB.localeCompare(idA);
        if (timeA === 0) return 1;
        if (timeB === 0) return -1;
        return timeB - timeA;
    }

    function addHiddenVideoId(videoId, container) {
        const publishedAt = container ? extractPublishedAt(container) : 0;
        const list = loadHiddenVideoEntries().filter((entry) => entry.id !== videoId);
        list.push({ id: videoId, publishedAt: publishedAt || 0 });

        while (list.length > config.maxHiddenVideos) {
            const removed = list.shift();
            if (config.debugMode && removed) {
                console.log(formatTranslation('hideListEvicted', { videoId: removed.id }));
            }
        }

        hiddenVideoEntries = list;
        hiddenVideoIdSet = new Set(list.map((entry) => entry.id));
        hiddenVideoPublishedAt = new Map(list.map((entry) => [entry.id, entry.publishedAt || 0]));
        persistHiddenVideoEntries();
        updateRestoreListButtonLabel();
        return list.length;
    }

    function purgePendingHideForId(videoId) {
        document.querySelectorAll(VIDEO_CONTAINER_SELECTOR).forEach((container) => {
            if (extractVideoId(container) !== videoId) return;
            scheduledHideContainers.delete(container);
        });
    }

    function removeHiddenVideoId(videoId) {
        if (!videoId || !hiddenVideoIdSet.has(videoId)) return false;

        hiddenVideoEntries = hiddenVideoEntries.filter((entry) => entry.id !== videoId);
        hiddenVideoIdSet.delete(videoId);
        hiddenVideoPublishedAt.delete(videoId);
        persistHiddenVideoEntries();
        purgePendingHideForId(videoId);
        updateRestoreListButtonLabel();
        return true;
    }

    function restoreVideoContainer(container) {
        if (!container) return;
        container.style.display = '';
        container.removeAttribute('data-hidden-by-script');
        container.removeAttribute('data-hidden-video-id');
        container.removeAttribute('data-hide-button-added');
        scheduledHideContainers.delete(container);
        if (shouldRunFeedMaintenance()) maintainButtons([container]);
    }

    function restoreHiddenContainersForId(videoId) {
        document.querySelectorAll(`${VIDEO_CONTAINER_SELECTOR}[data-hidden-by-script]`).forEach((container) => {
            if (extractVideoId(container) === videoId) restoreVideoContainer(container);
        });
    }

    function unhideVideo(videoId) {
        if (!removeHiddenVideoId(videoId)) return false;
        restoreHiddenContainersForId(videoId);
        if (document.getElementById('yt-ausblender-restore-panel')) renderRestoreListPanel();
        console.log(formatTranslation('restoreVideoShown', { videoId }));
        return true;
    }

    function unhideAllVideos() {
        const ids = hiddenVideoEntries.map((entry) => entry.id);
        if (ids.length === 0) return 0;

        hiddenVideoEntries = [];
        hiddenVideoIdSet.clear();
        hiddenVideoPublishedAt.clear();
        hideBatchActive = false;
        if (hideBatchCooldownTimer) {
            clearTimeout(hideBatchCooldownTimer);
            hideBatchCooldownTimer = null;
        }
        persistHiddenVideoEntries();
        ids.forEach((id) => restoreHiddenContainersForId(id));
        updateRestoreListButtonLabel();
        if (document.getElementById('yt-ausblender-restore-panel')) renderRestoreListPanel();
        console.log(formatTranslation('restoreAllShown', { count: ids.length }));
        return ids.length;
    }

    function getHiddenEntriesNewestFirst() {
        return [...hiddenVideoEntries].sort((entryA, entryB) => {
            const timeA = entryA.publishedAt || 0;
            const timeB = entryB.publishedAt || 0;
            if (timeA === 0 && timeB === 0) return entryB.id.localeCompare(entryA.id);
            if (timeA === 0) return 1;
            if (timeB === 0) return -1;
            return timeB - timeA;
        });
    }

    function formatPublishedAtLabel(publishedAt) {
        if (!publishedAt) return formatTranslation('restoreUnknownDate');
        return new Date(publishedAt).toLocaleDateString(userLang === 'de' ? 'de-DE' : 'en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    function closeRestoreListPanel() {
        document.getElementById('yt-ausblender-restore-backdrop')?.remove();
        document.getElementById('yt-ausblender-restore-panel')?.remove();
        document.querySelector('.yt-ausblender-restore-btn')?.classList.remove('yt-ausblender-restore-btn--active');
    }

    function renderRestoreListPanel() {
        closeRestoreListPanel();
        refreshHiddenVideoSet();

        const backdrop = document.createElement('div');
        backdrop.id = 'yt-ausblender-restore-backdrop';
        backdrop.className = 'yt-ausblender-restore-backdrop';

        const panel = document.createElement('div');
        panel.id = 'yt-ausblender-restore-panel';
        panel.className = 'yt-ausblender-restore-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', formatTranslation('restorePanelTitle'));

        const header = document.createElement('div');
        header.className = 'yt-ausblender-restore-panel__header';

        const title = document.createElement('h2');
        title.className = 'yt-ausblender-restore-panel__title';
        title.textContent = formatTranslation('restorePanelTitle');

        const headerActions = document.createElement('div');
        headerActions.className = 'yt-ausblender-restore-panel__header-actions';

        const restoreAllBtn = document.createElement('button');
        restoreAllBtn.type = 'button';
        restoreAllBtn.className = 'yt-ausblender-restore-panel__action-btn';
        restoreAllBtn.textContent = formatTranslation('restoreAllButton');
        restoreAllBtn.disabled = hiddenVideoEntries.length === 0;
        restoreAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            unhideAllVideos();
        });

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'yt-ausblender-restore-panel__close-btn';
        closeBtn.textContent = formatTranslation('restoreClose');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeRestoreListPanel();
        });

        headerActions.appendChild(restoreAllBtn);
        headerActions.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(headerActions);
        panel.appendChild(header);

        const list = document.createElement('div');
        list.className = 'yt-ausblender-restore-panel__list';

        const entries = getHiddenEntriesNewestFirst();
        if (entries.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'yt-ausblender-restore-panel__empty';
            empty.textContent = formatTranslation('restoreEmpty');
            list.appendChild(empty);
        } else {
            entries.forEach((entry) => {
                const item = document.createElement('div');
                item.className = 'yt-ausblender-restore-panel__item';

                const thumbLink = document.createElement('a');
                thumbLink.className = 'yt-ausblender-restore-panel__thumb-link';
                thumbLink.href = `https://www.youtube.com/watch?v=${entry.id}`;
                thumbLink.target = '_blank';
                thumbLink.rel = 'noopener noreferrer';

                const thumb = document.createElement('img');
                thumb.className = 'yt-ausblender-restore-panel__thumb';
                thumb.src = `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`;
                thumb.alt = entry.id;
                thumb.loading = 'lazy';
                thumbLink.appendChild(thumb);

                const meta = document.createElement('div');
                meta.className = 'yt-ausblender-restore-panel__meta';

                const idLink = document.createElement('a');
                idLink.className = 'yt-ausblender-restore-panel__id-link';
                idLink.href = `https://www.youtube.com/watch?v=${entry.id}`;
                idLink.target = '_blank';
                idLink.rel = 'noopener noreferrer';
                idLink.textContent = entry.id;

                const date = document.createElement('span');
                date.className = 'yt-ausblender-restore-panel__date';
                date.textContent = formatPublishedAtLabel(entry.publishedAt);

                meta.appendChild(idLink);
                meta.appendChild(date);

                const restoreBtn = document.createElement('button');
                restoreBtn.type = 'button';
                restoreBtn.className = 'yt-ausblender-restore-panel__restore-btn';
                restoreBtn.textContent = formatTranslation('restoreItemButton');
                restoreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    unhideVideo(entry.id);
                });

                item.appendChild(thumbLink);
                item.appendChild(meta);
                item.appendChild(restoreBtn);
                list.appendChild(item);
            });
        }

        panel.appendChild(list);
        panel.addEventListener('click', (e) => e.stopPropagation());
        backdrop.addEventListener('click', closeRestoreListPanel);
        backdrop.appendChild(panel);
        document.body.appendChild(backdrop);
        document.querySelector('.yt-ausblender-restore-btn')?.classList.add('yt-ausblender-restore-btn--active');
        backfillPublishedAtFromVisibleDom();
        backfillMissingPublishedDatesFromNetwork();
    }

    function toggleRestoreListPanel() {
        if (document.getElementById('yt-ausblender-restore-panel')) {
            closeRestoreListPanel();
            return;
        }
        renderRestoreListPanel();
    }

    function updateRestoreListButtonLabel() {
        const button = document.querySelector('.yt-ausblender-restore-btn');
        if (!button) return;
        const count = hiddenVideoEntries.length;
        const label = formatTranslation('restoreButtonText');
        button.textContent = count > 0 ? `${label} (${count})` : label;
        button.disabled = count === 0;
    }

    function addRestoreListButton() {
        if (isPlaybackPage()) return;
        if (document.querySelector('.yt-ausblender-restore-wrapper')) return;

        const buttonsHost = findMastheadButtonsHost();
        if (!buttonsHost) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'yt-ausblender-restore-wrapper style-scope ytd-masthead';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'yt-ausblender-restore-btn';
        button.setAttribute('aria-label', formatTranslation('restorePanelTitle'));

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleRestoreListPanel();
        });

        wrapper.appendChild(button);
        updateRestoreListButtonLabel();

        const shortsWrapper = buttonsHost.querySelector('.shorts-toggle-wrapper');
        if (shortsWrapper?.nextSibling) {
            buttonsHost.insertBefore(wrapper, shortsWrapper.nextSibling);
        } else if (shortsWrapper) {
            buttonsHost.appendChild(wrapper);
        } else {
            const createButton = buttonsHost.querySelector('ytd-button-renderer');
            if (createButton) {
                buttonsHost.insertBefore(wrapper, createButton);
            } else {
                buttonsHost.prepend(wrapper);
            }
        }
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
                const id = extractVideoId(video);
                if (!id) {
                    console.log(formatTranslation('hideNoVideoId', { index: '?' }));
                    return;
                }

                const count = addHiddenVideoId(id, video);
                applyHideStyles(video);
                runContinuousHideCheck();
                console.log(formatTranslation('hideVideoStored', { index: id, videoId: id, count }));
            } catch (err) {
                console.error(formatTranslation('hideError', { index: '?', error: err.message }));
            }
        }, true);
    }

    function applyHideStyles(container) {
        const videoId = extractVideoId(container);
        if (!videoId) return;
        container.style.display = 'none';
        container.setAttribute('data-hidden-by-script', 'true');
        container.setAttribute('data-hidden-video-id', videoId);
        scheduledHideContainers.delete(container);
    }

    function waitUntilHideReady(container) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };

            const run = () => {
                if (!container.isConnected || container.hasAttribute('data-hidden-by-script')) {
                    finish();
                    return;
                }

                if (!canAutoHideNow(container)) {
                    finish();
                    return;
                }

                if (!isThumbnailFullyLoaded(container)) {
                    whenThumbnailFullyLoaded(container, run);
                    return;
                }

                afterThumbnailDecoded(container, () => {
                    setTimeout(finish, config.hideDelayAfterThumbnailMs);
                });
            };

            run();
            setTimeout(finish, config.hideThumbnailFallbackMs);
        });
    }

    function hasPendingHideBatchWork() {
        return collectBlockedContainersForHide().some((container) => !scheduledHideContainers.has(container));
    }

    function scheduleNextHideBatch() {
        if (hideBatchCooldownTimer || !hasPendingHideBatchWork()) return;

        const cooldown = Math.max(0, config.hideBatchCooldownMs - (Date.now() - lastAppliedHideAt));
        hideBatchCooldownTimer = setTimeout(() => {
            hideBatchCooldownTimer = null;
            processHideBatch();
        }, cooldown);
    }

    function finishHideBatch(candidates) {
        candidates.forEach((container) => scheduledHideContainers.delete(container));
        hideBatchActive = false;
        scheduleNextHideBatch();
    }

    function processHideBatch() {
        if (!shouldRunFeedMaintenance()) return;
        if (hideBatchActive) return;
        if (hiddenVideoIdSet.size === 0) return;

        const candidates = collectBlockedContainersForHide()
            .filter((container) => !scheduledHideContainers.has(container))
            .slice(0, config.maxSimultaneousHides);

        if (candidates.length === 0) return;

        hideBatchActive = true;
        candidates.forEach((container) => scheduledHideContainers.add(container));

        if (config.debugMode) {
            console.log(`[Ausblender] Batch: ${candidates.length} neueste Video(s) werden geladen`);
        }

        const batchWatchdog = setTimeout(() => {
            if (!hideBatchActive) return;
            if (config.debugMode) {
                console.log('[Ausblender] Batch-Watchdog: erzwinge Fortsetzung');
            }
            finishHideBatch(candidates);
        }, config.hideThumbnailFallbackMs + config.hideDelayAfterThumbnailMs + 500);

        Promise.all(candidates.map((container) => waitUntilHideReady(container)))
            .then(() => {
                clearTimeout(batchWatchdog);

                const ready = candidates.filter((container) => (
                    container.isConnected
                    && !container.hasAttribute('data-hidden-by-script')
                    && canAutoHideNow(container)
                ));

                if (ready.length > 0) {
                    ready.forEach((container) => applyHideStyles(container));
                    lastAppliedHideAt = Date.now();
                    if (config.debugMode) {
                        console.log(`[Ausblender] Batch: ${ready.length} Video(s) gleichzeitig ausgeblendet`);
                    }
                    scheduleMaintainButtonsNearViewport();
                }

                finishHideBatch(candidates);
            })
            .catch((err) => {
                clearTimeout(batchWatchdog);
                console.error(`[Ausblender] Batch-Fehler: ${err.message}`);
                finishHideBatch(candidates);
            });
    }

    function findThumbnailHost(video) {
        if (!video) return null;
        if (video.matches?.('a.ytLockupViewModelContentImage, yt-thumbnail-view-model, a#thumbnail')) return video;

        for (const selector of THUMBNAIL_HOST_SELECTOR.split(', ')) {
            const host = video.querySelector(selector);
            if (host) return host;

            const deepMatches = queryAllDeep(video, selector);
            if (deepMatches.length > 0) return deepMatches[0];
        }

        return video.querySelector('ytd-thumbnail')
            || video.querySelector('yt-thumbnail-view-model')
            || queryAllDeep(video, 'a[href*="watch"], a[href*="/shorts/"]')[0]
            || null;
    }

    function needsHideButton(video) {
        if (video.hasAttribute('data-hidden-by-script') || shouldHideById(video)) return false;
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
            if (!isAllowedMaintenanceContainer(element) || seen.has(element)) return;
            if (!isNearViewport(element)) return;
            seen.add(element);
            near.push(element);
        });

        return near;
    }

    function collectBlockedContainersForHide() {
        return collectContainersNearViewport()
            .filter((container) => !container.hasAttribute('data-hidden-by-script') && shouldHideById(container))
            .sort(compareHidePriority);
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

    function runContinuousHideCheck() {
        if (!shouldRunFeedMaintenance()) return;
        maintainButtonsNearViewport(config.viewportButtonRefreshMax);
        processHideBatch();
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
            runContinuousHideCheck();
            return;
        }

        const pending = collectVideoContainersFromNodes(addedNodes).slice(0, config.viewportBatchMax);
        if (pending.length > 0) maintainContainers(pending);
        runContinuousHideCheck();
    }, config.debounceMs);

    function queueFeedMaintenance(addedNodes = []) {
        if (!shouldRunFeedMaintenance()) return;
        runFeedMaintenance(addedNodes);
    }

    const onViewportScroll = throttle(() => {
        if (!shouldRunFeedMaintenance()) return;
        maintainButtonsNearViewport();
        runContinuousHideCheck();
    }, config.scrollCheckMs);

    let isShortsHidden = GM_getValue('isShortsHidden', false);
    let shortsCheckIntervalId = null;
    let hideCheckIntervalId = null;
    let backfillIntervalId = null;

    function ensureFeedIntervalsStarted() {
        if (!hideCheckIntervalId) {
            hideCheckIntervalId = setInterval(runContinuousHideCheck, config.hideCheckIntervalMs);
        }
        if (!backfillIntervalId) {
            backfillIntervalId = setInterval(backfillPublishedAtFromVisibleDom, config.publishDateBackfillIntervalMs);
        }
    }

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
                addRestoreListButton();
            });
            mastheadMutationObserver.observe(masthead, { childList: true, subtree: true });
            addShortsToggleButton();
            addRestoreListButton();
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
        refreshHiddenVideoSet();

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
            refreshHiddenVideoSet();
            setupNavigationListeners();
            window.addEventListener('scroll', onViewportScroll, { passive: true });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeRestoreListPanel();
            }, true);

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
