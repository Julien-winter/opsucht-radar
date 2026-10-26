# OPSUCHT Market — Node.js

Öffentliche Read-only-Website und dauerhaft speichernder Markt-/Auktionssammler. Der aktive Hosting-Einstiegspunkt ist **`index.js` (Node.js)**. Es wird kein Python-Prozess zum Starten benötigt.

## Lokal starten

Voraussetzung: Node.js **22.13 oder neuer** (empfohlen 24). SQLite kommt aus `node:sqlite`; Discord-Panels nutzen `discord.js`.

```sh
npm install
node index.js
```

Windows: `start.cmd` doppelklicken. Die lokale `.env` liegt nur auf deinem Rechner und ist von Git ignoriert. Standardmäßig ist die lokale Vorschau `http://127.0.0.1:8787`.

## Pterodactyl-Hosting

Dein Node-Startbefehl funktioniert mit diesem Projekt. Port, Webhook, Owner-ID, Datenpfad, Firewall und Neustart sind hier dokumentiert:

**[`deploy-pterodactyl/README.md`](deploy-pterodactyl/README.md)**

Für deine Zuweisung ist die öffentliche Adresse `http://45.93.249.214:63816`. Pterodactyl muss TCP-Port `63816` dem Server zuweisen und freigeben. Die Datenbank liegt unter `/home/container/data/radar.sqlite`; den Ordner regelmäßig über das Panel sichern.

## Website

- Marktpreise mit Kategorie-Chips, 24-Stunden-Vergleich, Orderzahlen und Preisverlauf.
- ABC-/sw-abc-Referenzpreise werden aus `Kn0cki/sw_abc_prices` synchronisiert und im Itemdetail getrennt von den aktuellen OPSUCHT-BUY/SELL-Orders angezeigt.
- Marktpreise, ABC-Referenzkurse und feste OPSHARD-Händlerkurse sind öffentlich. Nur aus Auktionsverkäufen abgeleitete Itemwerte, Katalog-/Variantenpreise und Verkaufsdetails benötigen ein Konto und werden als Schätzungen gekennzeichnet.
- Alle aktiven Auktionen, inklusive normaler Gebote ohne Sofortkauf, Bieter, Skins und Itemdetails.
- Item-Katalog mit 444 Marktmaterialien plus Items/Varianten, die in aktiven oder archivierten öffentlichen Auktionen und bestätigten Verkäufen beobachtet wurden. **Die OPSUCHT-API veröffentlicht keine vollständige Shop-/Inventar-Itemdatenbank**, daher können nie öffentlich gelistete Items nicht vorab aufgelistet werden.
- Filterkette Hauptkategorie → Unterkategorie → Typ, zum Beispiel Werkzeuge → Spitzhacken; Spezial-Verzauberungsfilter passen sich der aktuellen Auktionensuche an.
- Itemwerte aus bestätigten Verkäufen, häufigste Preisgruppen, Verlaufsgrafik und grobe OPShards-/Redcoin-Umrechnung.
- Händlerrechner verwendet **standardmäßig die aktuelle BUY-Kauforder**. „Eigenen Preis setzen“ aktiviert eine lokale Browser-Überschreibung; „Kaufpreis verwenden“ setzt auf den neuesten BUY-Kurs zurück. Diamanten und Diamantblöcke haben zusätzlich einen Mengenrechner für 100× und den Vergleich 9 Diamanten ↔ 1 Block.

Die öffentliche Startseite enthält keine persönliche Alarm-/Webhook-Oberfläche. Private API-Routen und Änderungen sind geschützt. Die Seite bindet standardmäßig an `127.0.0.1`; ein externer Bind an `0.0.0.0` aktiviert automatisch den öffentlichen Read-only-Modus.

## Sammler und Datenspeicherung

Der Node-Prozess betreibt **Website, API und Collector gemeinsam**:

- Marktpreise und BUY-/SELL-Orderzahlen: alle 60 Sekunden.
- Auktionen: SSE-Livestream plus vollständiger Abgleich alle 30 Sekunden.
- Ausgeführte Verkäufe: dauerhaft in SQLite; Preisverläufe werden aus bestätigten Verkäufen aufgebaut.
- Historische Rohstoffdaten: erster Durchlauf nacheinander, danach Aktualisierung je Material alle 12 Stunden.
- Auktions- und Spieleralarme werden in einer persistenten Warteschlange verarbeitet und nach einem Neustart fortgesetzt.

Pterodactyl muss den Node-Prozess eingeschaltet halten und bei Absturz neu starten, damit die Aufnahme 24/7 weiterläuft. SQLite verwendet WAL; Backups des Datenordners gehören auf den Backup-/Snapshot-Zeitplan des Hosters.

### Datenordner schützen

`DATA_DIR` enthält die SQLite-Datenbank mit Marktverlauf, Auktionen, Konten und Alarmwarteschlangen. Der Startvorgang legt den Ordner nur an und überschreibt keine vorhandene Datenbank. Bei einer beschädigten SQLite-Datei wird die Originaldatei zusammen mit ihren `-wal`/`-shm`-Dateien automatisch unter `radar.sqlite.corrupt-<Zeitstempel>` gesichert; erst danach startet der Sammler mit einer neuen Datei. Diese Sicherung darf erst nach einer manuellen Prüfung gelöscht werden.

Für Backups den gesamten Datenordner im laufenden Betrieb kopieren oder einen Host-Snapshot verwenden. Beispiel auf Linux/Pterodactyl:

```sh
tar -czf "radar-data-$(date +%Y%m%d-%H%M).tar.gz" -C /home/container data
```

Auf Windows sollte der Prozess vor dem Kopieren kurz angehalten oder die SQLite-Datei über einen Snapshot gesichert werden. Niemals `data/`, `radar.sqlite` oder die `.corrupt-*`-Sicherungen beim Deploy-Schritt löschen. `data/` ist absichtlich von Git ignoriert und gehört in den Backup-Plan des Hosters.

## Umgebungsvariablen

Siehe `deploy-pterodactyl/.env.example`. Wichtig:
- `HOST=0.0.0.0`, `PORT=63816`, `PUBLIC_URL=http://45.93.249.214:63816`
- `PUBLIC_SITE=true`, `DATA_DIR=/home/container/data`
- `DISCORD_WEBHOOK_URL` (geheim), `PING_TARGET`
- `WATCHED_PLAYER_NAME=SaikoWasTaken`
- `ADMIN_TOKEN` (mit `openssl rand -hex 32` erzeugen)
- `PUBLIC_API_RATE_LIMIT=180` (API-Anfragen je Client-IP und Minute)

Die API ist pro Client rate-limitiert; Profilauflösung ist auf IDs aus aktiven Auktionen begrenzt und zusätzlich gedrosselt. Markt-, Auktions- und Wertabfragen werden kurz zwischengespeichert.

## Tests

```sh
npm test
```

Die lokale Testausführung verändert keine Produktionsdaten. Für einen manuellen Integrationscheck kann `DATA_DIR` auf einen neu angelegten temporären Ordner und `RADAR_DISABLE_COLLECTOR=true` gesetzt werden; danach den Ordner vollständig löschen. Der Test sollte Registrierung, Login, `/api/me` und den privaten Zugriff mit dem zurückgegebenen Bearer-Token prüfen. Produktions-`data/` niemals als Testziel verwenden.

## Veröffentlichungen und Downloads

Quellcode und Laufzeitdaten werden getrennt gehalten. APKs, Server-ZIPs, Datenbanken
und lokale Build-Ausgaben gehören nicht in den Git-Verlauf. Ein Tag im Format
`v1.2.3` startet `.github/workflows/release.yml`; der Workflow baut die Release-APK,
legt eine SHA-256-Prüfsummendatei bei und veröffentlicht APK sowie ein bereinigtes
Server-Quellarchiv als GitHub-Release-Assets. Die Android-App fragt nur die Release-
Metadaten ab und lädt niemals beliebige Dateien aus dem Repository herunter.


Discord-Community: https://discord.gg/RmwFCMdghA

### Werbung und Sponsoring

Es ist ein optionaler, nicht personalisierter Sponsorenplatz vorbereitet. Er bleibt standardmäßig deaktiviert (`SPONSOR_ENABLED=false`) und lädt keine AdSense-/AdMob-Skripte oder Tracker. Für einen Sponsor setzt du `SPONSOR_ENABLED=true`, `SPONSOR_TITLE`, `SPONSOR_TEXT` und eine eigene `SPONSOR_URL` in der Server-Umgebung. Der Link muss `http://` oder `https://` verwenden. Für echte Werbenetzwerke brauchst du zusätzlich deren Publisher-/App-ID, eine Einwilligungslösung, eine Datenschutzerklärung und im App-Store praktisch HTTPS; das wird bewusst nicht automatisch aktiviert.
