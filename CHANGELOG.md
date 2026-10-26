# OPSUCHT Market – Changelog

## 1.0.9

- Android-App nutzt jetzt exakt das aktuelle OPSUCHT-Icon der Website als Launcher- und Benachrichtigungs-Icon.
- Das alte abweichende Favicon wurde aus der APK entfernt.

## 1.0.8

- Update-Download verbessert: Nach dem Download öffnet „Jetzt installieren“ direkt den Android-Paketinstaller.
- Die Benachrichtigung enthält einen echten Installationsbutton und funktioniert auch nach einem App-Neustart weiter.
- Fehlende Installationsfreigaben werden verständlich zur Android-Einstellung geführt; fehlgeschlagene Downloads werden erkannt.
- Scrollen stabilisiert und WebView-Überlauf sowie Renderer-Priorität für weniger eingefrorene Bilder angepasst.
- Itemwerte werden zunächst in kleineren Batches gerendert; weitere Karten laden erst auf Wunsch. Suchfelder rendern mit weniger Arbeit pro Tastendruck.

## 1.0.7

- Grauer oder leerer WebView beim erneuten Öffnen behoben: pausierte Renderer werden sauber fortgesetzt, validiert und bei einem Renderer-Absturz automatisch neu aufgebaut.
- Offline-Icons verbessert: lokale OPSUCHT-Icons und erlaubte Item-Icons werden nach einem Online-Refresh im Service-Worker vorgeladen und bleiben zusammen mit den Markt-, ABC- und OPSHARD-Caches verfügbar.
- Affiliate-Link für Minecraft-Serverhosting ist im Footer und auf der Übersichtsseite sichtbar und als Werbung gekennzeichnet.
- Mobile Footer-Darstellung und Wiederaufnahme nach App-Wechsel stabilisiert.
- Keine Standort- oder IP-Datenerfassung ergänzt.

## 1.0.6

- Android-App aktualisiert und Release-Download direkt in der App verbessert.
- Marktpreise, ABC-Referenzpreise und OPSHARD-Händlerkurse werden offline aus dem letzten erfolgreichen Online-Refresh angezeigt.
- Die Update-Prüfung läuft beim erneuten Öffnen der App automatisch erneut und zeigt den Changelog direkt in der App.
- Ladefehler und graue/leere WebView-Zustände erhalten einen verständlichen Retry-Zustand.
- iOS-Vorbereitung als SwiftUI-/WKWebView-Quellcode unter `ios-app/` ergänzt.
- Keine Standort-, IP- oder sonstigen identifizierenden Telemetriedaten in der App.

Die Auktionshaus-Itemwerte bleiben ausdrücklich geschätzte Werte und werden getrennt von öffentlichen Markt-, ABC- und OPSHARD-Kursen angezeigt.
