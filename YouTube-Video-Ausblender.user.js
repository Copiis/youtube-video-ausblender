// ==UserScript==
// @name YouTube Video Hider with 🚫 Icon and Shorts Toggle
// @name:de YouTube Video Ausblender mit 🚫 Symbol und Shorts Umschalter
// @name:es Ocultador de Videos de YouTube con Icono 🚫 y Alternador de Shorts
// @name:fr Masqueur de Vidéos YouTube avec Icône 🚫 et Basculeur de Shorts
// @name:it Nascondi Video YouTube con Icona 🚫 e Interruttore Shorts
// @namespace https://github.com/Copiis/youtube-video-ausblender
// @version 2026.4.20
// @description Adds a 🚫 symbol to video metadata for hiding videos, excludes Shorts thumbnails, with persistent Shorts toggle state
// @description:de Fügt ein 🚫 Symbol zu Video-Metadaten hinzu, exklusive Shorts, und einen kompakten Button zum Ein-/Ausblenden von Shorts mit persistentem Zustand
// @description:es Agrega un símbolo 🚫 a los metadatos de video, excluyendo Shorts, y un botón compacto para alternar Shorts con estado persistente
// @description:fr Ajoute un symbole 🚫 aux métadonnées des vidéos, sauf pour les Shorts, et un bouton compact pour activer/désactiver les Shorts avec état persistant
// @description:it Aggiunge un simbolo 🚫 ai metadati dei video, esclusi i Shorts, e un pulsante compatto per attivare/disattivare i Shorts con stato persistente
// @icon https://youtube.com/favicon.ico
// @author Copiis
// @license MIT
// @match https://www.youtube.com/*
// @grant GM_setValue
// @grant GM_getValue
// If you find this script useful and would like to support my work, consider making a small donation!
// Bitcoin (BTC): bc1quc5mkudlwwkktzhvzw5u2nruxyepef957p68r7
// PayPal: https://www.paypal.com/paypalme/Coopiis?country.x=DE&locale.x=de_DE
// @downloadURL https://raw.githubusercontent.com/Copiis/youtube-video-ausblender/master/YouTube-Video-Ausblender.user.js
// @updateURL https://raw.githubusercontent.com/Copiis/youtube-video-ausblender/master/YouTube-Video-Ausblender.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Konfigurationsobjekt
    const config = {
        hideButtonSize: '24px',
        hideButtonOpacity: '0.7',
        shortsCheckInterval: 2000, // Erhöht auf 2000ms
        maxShortsAttempts: 30, // Erhöht auf 30 Versuche
        debugMode: true,
        reapplyInterval: 1000,
        menuLoadDelay: 150,
        maxMenuAttempts: 15
    };

    // Spracherkennung
    const userLang = (navigator.language || navigator.languages[0] || 'en').substring(0, 2);
    if (config.debugMode) console.log(`[Initializer] Erkannte Sprache: ${userLang}`);

    // Übersetzungen
    const translations = {
        en: {
            hideVideosFound: 'Found videos: ${count}',
            hideButtonAdded: 'Video ${index}: Button added',
            hideNoMenuButton: 'Video ${index}: No menu button found',
            hideMenuOpened: 'Video ${index}: Menu opened',
            hideOptionClicked: 'Video ${index}: Hide option clicked',
            hideOptionNotFound: 'Video ${index}: Hide option not found',
            hideError: 'Video ${index}: Error while hiding: ${error}',
            hideConfirmClicked: 'Video ${index}: Confirm button clicked',
            hideConfirmNotFound: 'Video ${index}: Confirm button not found',
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
            noMetadataFound: 'Video ${index}: No metadata container found'
        },
        de: {
            hideVideosFound: 'Gefundene Videos: ${count}',
            hideButtonAdded: 'Video ${index}: Button hinzugefügt',
            hideNoMenuButton: 'Video ${index}: Kein Menü-Button gefunden',
            hideMenuOpened: 'Video ${index}: Menü geöffnet',
            hideOptionClicked: 'Video ${index}: Ausblenden geklickt',
            hideOptionNotFound: 'Video ${index}: Ausblenden-Option nicht gefunden',
            hideError: 'Video ${index}: Fehler beim Ausblenden: ${error}',
            hideConfirmClicked: 'Video ${index}: Bestätigen-Button geklickt',
            hideConfirmNotFound: 'Video ${index}: Bestätigen-Button nicht gefunden',
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
            noMetadataFound: 'Video ${index}: Kein Metadaten-Container gefunden'
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

    // Funktion zum Warten auf ein Element
    async function waitForElement(selector, timeout = 3000, maxAttempts = 5) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const start = Date.now();
            while (Date.now() - start < timeout) {
                const element = document.querySelector(selector);
                if (element) return element;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (config.debugMode) console.log(`[Wait Debug] Versuch ${attempt}/${maxAttempts}: Element ${selector} nicht gefunden`);
        }
        return null;
    }

    // Funktion zum Simulieren eines Klicks
    function simulateClick(element) {
        const events = [
            new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
            new MouseEvent('click', { bubbles: true, cancelable: true }),
            new MouseEvent('mouseup', { bubbles: true, cancelable: true })
        ];
        element.focus();
        events.forEach(event => element.dispatchEvent(event));
    }

    // Debounce-Funktion
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // Funktion zum Hinzufügen des Ausblende-Buttons + automatisches Klicken auf "Ausblenden"
const addHideButton = debounce(async () => {
    const videoContainers = document.querySelectorAll('ytd-rich-item-renderer:not([data-hide-button-added]), ytd-grid-video-renderer:not([data-hide-button-added])');

    for (const [index, video] of Array.from(videoContainers).entries()) {
        video.setAttribute('data-hide-button-added', 'true');

        // === PLATZIERUNG: direkt NACH dem Avatar (wie gewünscht) ===
        const avatarContainer = video.querySelector('div.ytLockupMetadataViewModelAvatar');
        if (!avatarContainer) {
            if (config.debugMode) console.log(`[Hide Button] Video ${index}: ytLockupMetadataViewModelAvatar nicht gefunden`);
            continue;
        }

        // Doppelte Buttons verhindern
        if (avatarContainer.parentElement.querySelector('.hide-video-btn')) continue;

        const hideButton = document.createElement('div');
        hideButton.className = 'hide-video-btn';
        hideButton.textContent = '🚫';
        hideButton.style.cssText = `
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: ${config.hideButtonSize} !important;
            height: ${config.hideButtonSize} !important;
            border-radius: 50% !important;
            font-size: 18px !important;
            background-color: rgba(0, 0, 0, ${config.hideButtonOpacity}) !important;
            color: #fff !important;
            cursor: pointer !important;
            margin-left: 8px !important;
            margin-top: 4px !important;
            z-index: 10010 !important;
            flex-shrink: 0 !important;
            visibility: visible !important;
            opacity: 1 !important;
            pointer-events: auto !important;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
            vertical-align: middle !important;
        `;

        avatarContainer.insertAdjacentElement('afterend', hideButton);

        hideButton.addEventListener('click', async (e) => {
            e.stopImmediatePropagation();
            e.preventDefault();
            try {
                // === EXAKTER Klick auf den 3-Punkte-Button ===
                const menuBtn = video.querySelector('div.ytLockupMetadataViewModelMenuButton button, button[aria-label="Mehr Aktionen"]');
                if (!menuBtn) {
                    console.log(formatTranslation('hideNoMenuButton', { index }));
                    if (config.debugMode) console.log(`[Hide Button] Video ${index}: Kein Menü-Button gefunden`);
                    return;
                }
                simulateClick(menuBtn);
                console.log(formatTranslation('hideMenuOpened', { index }));

                // === VERZÖGERUNG AUF 1 SEKUNDE ERHÖHT (wie gewünscht) ===
                await new Promise(r => setTimeout(r, 1000));

                let menu = null;
                let attempt = 0;
                const menuSelectors = [
                    'tp-yt-iron-dropdown:not([aria-hidden="true"])',
                    'ytd-menu-popup-renderer',
                    'ytd-popup-container'
                ];

                while (!menu && attempt < config.maxMenuAttempts) {
                    attempt++;
                    for (const sel of menuSelectors) {
                        menu = document.querySelector(sel);
                        if (menu) break;
                    }
                    if (!menu) await new Promise(r => setTimeout(r, 1000));   // auch hier 1 Sekunde
                }
                if (!menu) {
                    console.log(formatTranslation('hideOptionNotFound', { index }));
                    return;
                }

                // === Exakte Erkennung des "Ausblenden"-Eintrags ===
                let option = null;
                attempt = 0;
                while (!option && attempt < config.maxMenuAttempts) {
                    attempt++;
                    const menuItems = menu.querySelectorAll('yt-list-item-view-model, ytd-menu-service-item-renderer');
                    option = Array.from(menuItems).find(item => {
                        const span = item.querySelector('span.ytAttributedStringHost.ytListItemViewModelTitle');
                        if (span) {
                            const text = span.textContent.trim();
                            return text === 'Ausblenden' || text.includes('Ausblenden');
                        }
                        return false;
                    });
                    if (option) {
                        const clickTarget = option.querySelector('button.ytButtonOrAnchorButton') || option;
                        simulateClick(clickTarget);
                        console.log(formatTranslation('hideOptionClicked', { index }));
                        break;
                    }
                    await new Promise(r => setTimeout(r, 1000));   // auch hier 1 Sekunde
                }
                if (!option) {
                    console.log(formatTranslation('hideOptionNotFound', { index }));
                    return;
                }

                const confirmButton = await waitForElement('yt-button-renderer#confirm-button button, tp-yt-paper-button, button[aria-label*="Bestätigen" i], button.yt-confirm-button', 2500, 6);
                if (confirmButton) {
                    simulateClick(confirmButton);
                    console.log(formatTranslation('hideConfirmClicked', { index }));
                }
            } catch (err) {
                console.error(formatTranslation('hideError', { index, error: err.message }));
            }
        });

        if (config.debugMode) console.log(formatTranslation('hideButtonAdded', { index }));
    }
});

    // Funktion zum Hinzufügen des Shorts-Toggle-Buttons
    let shortsButton = null;
    let shortsSection = null;
    let isShortsHidden = GM_getValue('isShortsHidden', false); // Lade gespeicherten Zustand

    function addShortsToggleButton() {
    const topbar = document.querySelector('ytd-masthead #masthead-container') || document.querySelector('ytd-masthead');
    if (!topbar) {
        console.log(formatTranslation('shortsNoTopbar'));
        return;
    }
    if (document.querySelector('.shorts-toggle-wrapper')) {
        console.log(formatTranslation('shortsButtonExists'));
        return;
    }
    const toggleWrapper = document.createElement('div');
    toggleWrapper.className = 'shorts-toggle-wrapper';
    shortsButton = document.createElement('button');
    shortsButton.className = 'shorts-toggle-btn';
    const textSpan = document.createElement('span');
    textSpan.textContent = formatTranslation('shortsButtonText');
    const iconSpan = document.createElement('span');
    iconSpan.className = 'shorts-toggle-icon';
    iconSpan.textContent = '🚫';
    shortsButton.appendChild(textSpan);
    shortsButton.appendChild(iconSpan);
    Object.assign(shortsButton.style, {
        padding: '2px 8px',
        border: 'none',
        borderRadius: '4px',
        backgroundColor: 'transparent',
        color: 'white',
        cursor: 'pointer',
        fontSize: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px'
    });
    toggleWrapper.appendChild(shortsButton);
    const logoContainer = topbar.querySelector('#logo') || topbar.querySelector('#container');
    if (logoContainer) {
        logoContainer.appendChild(toggleWrapper);
        console.log(formatTranslation('shortsButtonAdded'));
    }
    const checkShortsSection = () => {
        const shortsSections = document.querySelectorAll(
            'ytd-rich-shelf-renderer[is-shorts], ' +
            'ytd-rich-section-renderer ytd-rich-shelf-renderer[is-shorts], ' +
            'ytd-reel-shelf-renderer, ' +
            'ytm-shorts-lockup-view-model, ' +
            'a[href*="/shorts/"], ' +
            'ytd-rich-item-renderer[is-shelf-item], ' +
            'div[id*="contents"] ytd-rich-shelf-renderer'
        );
        if (shortsSections.length > 0) {
            console.log(formatTranslation('shortsFound', { details: shortsSections[0].outerHTML.slice(0, 100) }));
            shortsButton.disabled = false;
            iconSpan.style.display = isShortsHidden ? 'none' : 'inline';
            shortsSections.forEach(section => {
                const parentSection = section.closest('ytd-rich-section-renderer');
                if (parentSection) {
                    parentSection.style.display = isShortsHidden ? 'none' : '';
                } else if (section.tagName === 'YTM-SHORTS-LOCKUP-VIEW-MODEL' || section.tagName === 'A' || section.tagName === 'YTD-RICH-ITEM-RENDERER') {
                    const parent = section.closest('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer');
                    if (parent) parent.style.display = isShortsHidden ? 'none' : '';
                } else {
                    section.style.display = isShortsHidden ? 'none' : '';
                }
            });
        } else {
            console.log(formatTranslation('shortsNotFound'));
            if (config.debugMode) {
                console.log('[Debug] Verfügbare Sektionen:', Array.from(document.querySelectorAll('ytd-rich-shelf-renderer, ytd-rich-section-renderer, ytm-shorts-lockup-view-model, ytd-reel-shelf-renderer, a[href*="/shorts/"], ytd-rich-item-renderer[is-shelf-item], div[id*="contents"] ytd-rich-shelf-renderer')).map(el => ({
                    tag: el.tagName,
                    outerHTML: el.outerHTML.slice(0, 100)
                })));
            }
            shortsButton.disabled = true;
            iconSpan.style.display = 'none';
        }
    };
    checkShortsSection();
    shortsButton.addEventListener('click', () => {
        isShortsHidden = !isShortsHidden;
        GM_setValue('isShortsHidden', isShortsHidden);
        checkShortsSection(); // Neu anwenden nach Toggle
        console.log(isShortsHidden ? formatTranslation('shortsSectionHidden') : formatTranslation('shortsSectionShown'));
    });
    if (isShortsHidden) {
        checkShortsSection();
        iconSpan.style.display = 'none';
    }
    // Kontinuierlicher Check für Shorts
    setInterval(checkShortsSection, config.shortsCheckInterval);
}

    // CSS hinzufügen
    const style = document.createElement('style');
    style.textContent = `
        .hide-video-btn {
            color: white !important;
            background-color: rgba(0, 0, 0, ${config.hideButtonOpacity}) !important;
            border-radius: 50% !important;
            font-size: 16px !important;
            width: ${config.hideButtonSize} !important;
            height: ${config.hideButtonSize} !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            cursor: pointer !important;
            pointerEvents: auto !important;
            z-index: 10003 !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        .hide-video-btn:hover {
            background-color: rgba(0, 0, 0, 0.9) !important;
            box-shadow: 0 0 10px 2px rgba(255, 215, 0, 0.8) !important;
        }
        .yt-lockup-metadata-view-model__avatar {
            display: flex !important;
            align-items: center !important;
        }
        .shorts-toggle-btn {
            transition: color 0.2s !important;
        }
        .shorts-toggle-btn:not(:disabled):hover {
            color: #cc0000 !important;
        }
        .shorts-toggle-wrapper {
            display: inline-flex !important;
            align-items: center !important;
            margin-left: 8px !important;
            z-index: 10001 !important;
        }
        .shorts-toggle-icon {
            display: none;
            font-size: 12px;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background-color: rgba(0, 0, 0, 0.7);
            text-align: center;
            line-height: 16px;
            color: white;
        }
    `;
    document.head.appendChild(style);

    // Initiale Ausführung
    function initialize() {
        try {
            addHideButton();
            addShortsToggleButton();
            console.log(formatTranslation('initStarted'));
            let attempts = 0;
            const interval = setInterval(() => {
                console.log(formatTranslation('initAttempt', { current: attempts + 1, max: config.maxShortsAttempts }));
                const shortsSection = document.querySelector(
                    'ytd-rich-shelf-renderer[is-shorts], ' +
                    'ytd-rich-section-renderer ytd-rich-shelf-renderer[is-shorts], ' +
                    'ytd-rich-shelf-renderer span#title-container span#title[textContent*="Shorts" i], ' +
                    'ytd-reel-shelf-renderer, ' +
                    'ytm-shorts-lockup-view-model, ' +
                    'a[href*="/shorts/"], ' +
                    'ytd-rich-item-renderer[is-shelf-item], ' +
                    'div[id*="contents"] ytd-rich-shelf-renderer'
                );
                if (shortsSection) {
                    addShortsToggleButton();
                    clearInterval(interval);
                } else if (attempts >= config.maxShortsAttempts) {
                    console.log(formatTranslation('initMaxAttempts'));
                    clearInterval(interval);
                }
                attempts++;
            }, config.shortsCheckInterval);
            setInterval(addHideButton, config.reapplyInterval);
        } catch (err) {
            console.error(formatTranslation('initError', { error: err.message }));
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initialize, 1000);
    } else {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initialize, 1000));
    }

    // MutationObserver
    const observerTarget = document.querySelector('ytd-app #contents') || document.body;
    const observer = new MutationObserver((mutations) => {
        try {
            const hasRelevantChanges = mutations.some(mutation =>
                mutation.addedNodes.length > 0 &&
                mutation.addedNodes[0]?.nodeType === Node.ELEMENT_NODE &&
                (mutation.target.matches('yt-lockup-view-model, ytd-rich-grid-media, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-rich-shelf-renderer, ytd-rich-section-renderer, ytm-shorts-lockup-view-model, ytd-reel-shelf-renderer, a[href*="/shorts/"], ytd-rich-item-renderer[is-shelf-item], div[id*="contents"] ytd-rich-shelf-renderer') ||
                 mutation.target.querySelector('yt-lockup-view-model, ytd-rich-grid-media, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-rich-shelf-renderer[is-shorts], ytd-rich-section-renderer, ytm-shorts-lockup-view-model, ytd-reel-shelf-renderer, a[href*="/shorts/"], ytd-rich-item-renderer[is-shelf-item], div[id*="contents"] ytd-rich-shelf-renderer, .yt-lockup-metadata-view-model')))
            if (hasRelevantChanges) {
                addHideButton();
                addShortsToggleButton();
            }
        } catch (err) {
            console.error(formatTranslation('observerError', { error: err.message }));
        }
    });
    observer.observe(observerTarget, { childList: true, subtree: true });
})();
