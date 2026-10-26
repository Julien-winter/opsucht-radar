# OPSUCHT Market iOS-App – Vorbereitung

Das Repository enthält aktuell eine native Android-WebView-App. Eine iOS-App ist
grundsätzlich möglich, weil die Website responsive ist und die gleiche WebView-
Architektur auf iOS mit `WKWebView` umgesetzt werden kann. Eine fertige `.ipa`
kann hier jedoch nicht gebaut werden: Dafür werden macOS, Xcode und ein Apple-
Signing-Profil benötigt.

Der Ordner enthält jetzt mit `OpsuchtMarketApp.swift` und `ContentView.swift`
einen direkt übernehmbaren SwiftUI-Starter. Er lädt die konfigurierbare URL aus
`RadarURL` (Standard: der aktuelle HTTP-Host), zeigt einen markierten Ladezustand
und einen Retry-/Offline-Zustand und verwendet den normalen WebKit-Cache. Die
Dateien sind bewusst kein vollständiges Xcode-Projekt und enthalten keine
Telemetrie, Standortabfrage oder IP-Erfassung.

## Voraussetzungen für den iOS-Build

- macOS mit aktueller Xcode-Version
- Apple-ID für einen lokalen Gerätestart; Apple Developer Account für TestFlight
  oder App-Store-Veröffentlichung
- iOS Deployment Target passend zu den gewünschten Geräten
- Der Webserver muss für eine öffentliche Veröffentlichung HTTPS anbieten.
  Der aktuelle OPSUCHT-Host läuft absichtlich über HTTP; iOS kann das nur mit
  einer `NSAppTransportSecurity`-Ausnahme laden, die für den App Store nicht
  empfohlen ist.

## Empfohlene Umsetzung

1. Neues Xcode-Projekt mit Swift und `WKWebView` anlegen.
2. `http://45.93.249.214:63816/` zunächst als konfigurierbare Start-URL laden.
3. Einen eigenen Ladebildschirm, Timeout, Offline-Zustand und „Erneut versuchen“
   anzeigen, damit ein nicht erreichbarer Host nie als leerer grauer Bildschirm
   erscheint.
4. `WKWebsiteDataStore` und einen Service-Worker-Cache nutzen; Marktpreise und
   ABC dürfen aus dem letzten erfolgreichen WLAN-Refresh angezeigt werden,
   während Live-Auktionen einen klaren Offline-Hinweis erhalten.
5. Vor TestFlight den Host auf HTTPS umstellen und die HTTP-Ausnahme entfernen.

Eine spätere iOS-App sollte dieselben Datenschutz- und Einwilligungsregeln wie
die Website verwenden. Standort, IP-Adresse und andere nicht benötigte Daten
werden nicht erfasst.
