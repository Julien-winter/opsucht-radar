# OPSUCHT Market iOS-App

Das Repository enthält eine SwiftUI-WebView-App für iPhone und iPad. Sie lädt die
responsive OPSUCHT-Market-Webseite, nutzt den WebKit-Cache für bereits geladene
Daten und zeigt bei Offline- oder Timeout-Situationen einen verständlichen
Retry-Zustand statt eines leeren grauen Bildschirms. Eine signierte `.ipa` kann
hier nicht erzeugt werden: Dafür braucht Apple macOS, Xcode und ein
Signing-Profil.

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
- Für den aktuell absichtlich per HTTP betriebenen Host muss die
  `NSAppTransportSecurity`-Ausnahme aus `Info.plist.example` in die App
  übernommen werden. Das ist für Entwicklung und Testgeräte möglich. Für eine
  App-Store-Veröffentlichung sollte der Host auf HTTPS umgestellt und die
  Ausnahme entfernt werden.

## Empfohlene Umsetzung

1. Neues Xcode-Projekt mit SwiftUI anlegen und `OpsuchtMarketApp.swift` sowie
   `ContentView.swift` hinzufügen.
2. `Info.plist.example` als Grundlage für die Target-Info.plist verwenden.
3. Unter **Target → Info** die String-Einstellung `RadarURL` setzen, falls eine
   andere Serveradresse verwendet wird. Ohne Einstellung wird der aktuelle
   OPSUCHT-Host verwendet.
4. Auf einem echten Gerät testen: Start, App-Wechsel, Offline-Modus,
   Wiederverbindung und den Retry-Button. Der WebView-Timeout verhindert, dass
   eine hängende Navigation dauerhaft einen Ladebildschirm blockiert.
5. Für TestFlight den Host auf HTTPS umstellen, die ATS-Ausnahme entfernen und
   anschließend mit dem eigenen Apple-Team signieren.

Eine spätere iOS-App sollte dieselben Datenschutz- und Einwilligungsregeln wie
die Website verwenden. Standort, IP-Adresse und andere nicht benötigte Daten
werden nicht erfasst.

## Veröffentlichung im Repository

Der Ordner enthält absichtlich nur den signierbaren Swift-Quellcode und keine
Zertifikate, Provisioning-Profile oder `.ipa`-Dateien. GitHub kann den Quellcode
mit der Website veröffentlichen; die signierte App wird anschließend auf einem
Mac in Xcode oder über TestFlight gebaut. Eine iOS-Release-Datei darf nicht aus
privaten Signing-Dateien oder aus dem Entwicklerzertifikat erzeugt werden.
