# Repost Cleaner – lokales Tool

Verwalte und entferne deine **eigenen** TikTok-Reposts über eine Weboberfläche auf deinem Rechner.

## Schnellstart

```bash
npm install
npm start          # öffnet http://localhost:4321
```

Oder per Doppelklick: `start.bat` (Windows), `start.command` (macOS), `./start.sh` (Linux).

- **Ausprobieren ohne TikTok:** `npm run demo` (Beispieldaten, beschleunigte Pausen)
- **Kein Chrome/Edge installiert?** `npm run browser:install` lädt ein passendes Chromium
- Anderer Port: `PORT=4322 npm start` · Browser nicht automatisch öffnen: `npm start -- --no-open`

## Ablauf

Die Oberfläche hat drei Bereiche: **Reposts** (Einrichtung, Lauf mit Zeitleiste, Filter und Raster/Liste),
**Protokoll** und **Einstellungen** (speichern sich sofort, mit Vorschau der Laufdauer).

1. **Browser öffnen** – ein echtes, sichtbares Chrome-/Edge-Fenster startet.
2. **Selbst einloggen** – am besten per QR-Code mit der TikTok-App. Der Login wird automatisch erkannt.
3. **Reposts laden** – das Tool öffnet dein Profil, wechselt in den Reposts-Tab und scrollt gemächlich.
4. **Filtern & auswählen** – Stichwörter (`-wort` schließt aus, `"genaue phrase"`), Zeitraum, Creator, Status. Shift+Klick wählt Bereiche.
5. **Entfernen** – vorher optional Backup exportieren (JSON/CSV) und/oder einen **Testlauf** machen.

## Sicherheit

| | |
|---|---|
| Zugangsdaten | werden **nie** abgefragt; Login nur im Browserfenster |
| Netzwerk | Server lauscht ausschließlich auf `127.0.0.1` |
| Lokale API | Host-Prüfung (DNS-Rebinding-Schutz) + zufälliges Token pro Start (CSRF-Schutz), strikte CSP |
| Cookies | es wird nur geprüft, **ob** ein Sitzungs-Cookie existiert – Inhalt wird weder gespeichert noch übertragen |
| Gespeichert in `data/` | Repost-Liste, Einstellungen, `history.jsonl` (Lösch-Historie) – optional das Browser-Profil, falls „Login lokal merken“ aktiv ist |

## Rate-Limit-Schutz (Standardwerte)

- zufällige Pause **8–18 s** zwischen Vorgängen (+ gelegentliches „Zögern“ von 4–15 s)
- **lange Pause 90–240 s** nach jeweils 8–15 Vorgängen
- max. **150 pro Lauf**, **300 pro 24 h** (aus der lokalen Historie berechnet)
- Fehler → exponentieller Backoff (30 s → 10 min), nach 3 Fehlern in Folge Abbruch
- Rate-Limit-Signal von TikTok → 10–15 min Abkühlphase, beim zweiten Mal Abbruch
- Captcha → Lauf pausiert, du löst es im Fenster und klickst „Fortsetzen“
- harte Untergrenzen (z. B. min. 4 s Pause, min. 30 s lange Pause) sind auch über die Oberfläche nicht unterschreitbar

## Projektstruktur

```
src/
  server.js     Express-Server (127.0.0.1), REST + Server-Sent Events
  browser.js    Playwright-Sitzung: Browserfenster, Login-Erkennung
  scanner.js    Lädt Reposts (liest /api/repost/item_list mit, scrollt)
  actions.js    Entfernt einen Repost (UI-Klick, API-Fallback, Bestätigung)
  job.js        Warteschlange mit Pausen, Backoff, Limits, Pause/Stopp
  throttle.js   Zufalls-Pausen (Pacer)
  selectors.js  ALLE TikTok-spezifischen Selektoren & Endpunkte
  config.js     Standardwerte und Grenzen der Einstellungen
  store.js      Lokale JSON-Ablage
  demo.js       Demo-Sitzung ohne Browser
public/         Weboberfläche (Vanilla JS, kein Build-Schritt; Schriften lokal in public/fonts, OFL)
```

## Wenn TikTok seine Website ändert

TikTok passt sein Web-Frontend regelmäßig an. Alles, was davon abhängt, steht in **`src/selectors.js`**:

- Reposts-Tab, Teilen-Button, „Repost entfernen“-Option (mehrere Varianten, DE/EN)
- Endpunkte: Liste (`/api/repost/item_list`) und Entfernen (`/tiktok/v1/upvote/delete`)

Findet das Tool ein Bedienelement nicht, klickt es nicht blind, sondern meldet einen Fehler bzw. nutzt (Methode „Automatisch“) den API-Fallback. Wurde geklickt, aber keine Bestätigung von TikTok gesehen, wird der Eintrag als **„Unbestätigt“** markiert und die tatsächlich gesendeten Anfragen landen im Protokoll – damit lässt sich der neue Endpunkt schnell eintragen. Ein erneuter Scan zeigt, was wirklich noch repostet ist.

## Hinweis

Automatisierte Aktionen können gegen die Nutzungsbedingungen von TikTok verstoßen; ein Restrisiko für den Account lässt sich nie ganz ausschließen. Das Tool ist bewusst langsam und vorsichtig ausgelegt. Nutzung auf eigene Verantwortung und nur für den eigenen Account. Kein offizielles Produkt von TikTok/ByteDance.
