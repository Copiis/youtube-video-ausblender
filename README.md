# YouTube Video Ausblender

Userscript (Tampermonkey) — Videos per 🚫-Symbol ausblenden, Shorts ein-/ausblendbar.

## Quelle

**GitHub:** https://github.com/Copiis/youtube-video-ausblender

**GreasyFork:** https://greasyfork.org/de/scripts/535329-youtube-video-hider-with-icon-and-shorts-toggle

**GreasyFork-Sync (Raw-URL):**

```
https://raw.githubusercontent.com/Copiis/youtube-video-ausblender/master/YouTube-Video-Ausblender.js
```

Ausführliche Projekt-Regeln, AI-Workflow und Tampermonkey-Schritte: **`status.md`** (lokal/Syncthing).

## Schnellstart

```bash
./update-tampermonkey.sh    # automatisch nach Änderung → Zwischenablage
./git-push.sh "2026.x.y: …" # nur auf Kommando → GitHub
./sync.sh url               # GreasyFork-URL in Zwischenablage
```

## GreasyFork

**Code-Synchronisation** (einmalig / nach URL-Wechsel):

```
https://raw.githubusercontent.com/Copiis/youtube-video-ausblender/master/YouTube-Video-Ausblender.js
```

**Beschreibung aktualisieren:** Als Autor einloggen → Skript bearbeiten → „Zusätzliche Informationen“ → Inhalt aus `greasyfork-info-de.html` einfügen (auch in Zwischenablage nach `./update-greasyfork-info.sh`).