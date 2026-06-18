# YouTube Video Ausblender

Userscript (Tampermonkey / Violentmonkey) zum Ausblenden von YouTube-Videos in Feed, Shorts und Vorschlägen.

## Installation

1. Skript in Tampermonkey installieren (`YouTube-Video-Ausblender.user.js`)
2. YouTube neu laden
3. Einstellungen über das Tampermonkey-Menü (Userscript → Befehle)

## Bereiche (einzeln schaltbar)

| Option | Wirkung |
|--------|---------|
| Startseite | Video-Kacheln auf der Startseite |
| Abos | Videos im Abo-Feed |
| Suche | Video-Ergebnisse in der Suche (standard: aus) |
| Shorts | Shorts-Regale und Shorts-Link |
| Watch-Seite | Vorschläge in der Sidebar |
| Mixes | Mix-/Playlist-Kacheln |

## Entwicklung

```bash
cd /home/arctic/Projekte/youtube-video-ausblender
# Nach Änderung: @version erhöhen, dann:
git add -u && git commit -m "v0.x.y: …" && git push
```

## GreasyFork (optional)

1. Neues Skript auf [greasyfork.org](https://greasyfork.org) anlegen
2. **Code-Synchronisation** → Raw-URL:

   `https://raw.githubusercontent.com/Copiis/youtube-video-ausblender/main/YouTube-Video-Ausblender.user.js`

3. Bei jedem Release `@version` im Skript-Header erhöhen

## GitHub-Repo anlegen

```bash
gh repo create Copiis/youtube-video-ausblender --public --source=. --remote=origin --push
```

(Lokal bereits `git init`; erst pushen, wenn Repo existiert.)