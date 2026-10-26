# OPSUCHT Market iOS-App

Das Repository enthält eine SwiftUI-WebView-App für iPhone und iPad. Sie lädt die
responsive OPSUCHT-Market-Webseite, nutzt den WebKit-Cache für bereits geladene
Daten und zeigt bei Offline- oder Timeout-Situationen einen verständlichen
Retry-Zustand statt eines leeren grauen Bildschirms. Eine signierte `.ipa` kann
hier nicht erzeugt werden: Dafür braucht Apple macOS, Xcode und ein
Signing-Profil.

Der Ordner enthält mit `OpsuchtMarketApp.swift`, `ContentView.swift` und
`project.yml` ein reproduzierbares SwiftUI-Projekt. GitHub Actions erzeugt daraus
automatisch ein Xcode-Projekt und baut bei Änderungen einen unsignierten
iOS-Simulator-Artefakt. Er lädt die konfigurierbare URL aus
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

## GitHub-Build ohne eigenes Apple-Gerät

Der Workflow [`.github/workflows/ios.yml`](../.github/workflows/ios.yml) läuft auf
`macos-14`. Der Simulator-Build braucht weder ein iPhone noch Zertifikate und
legt nach jedem Push ein `OPSUCHTMarket-iOS-simulator`-Artefakt ab. Es ist für
Tests im iOS-Simulator gedacht und keine installierbare App für echte Geräte.

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

## Signierter IPA-/TestFlight-Build

Der Workflow enthält zusätzlich einen standardmäßig deaktivierten Job. Setze im
Repository die Variable `IOS_SIGNING_ENABLED=true` und hinterlege anschließend
diese GitHub-Actions-Secrets: `IOS_TEAM_ID`, `IOS_CERTIFICATE_BASE64`,
`IOS_CERTIFICATE_PASSWORD`, `IOS_KEYCHAIN_PASSWORD`,
`IOS_PROVISIONING_PROFILE_BASE64` und `IOS_EXPORT_OPTIONS_PLIST_BASE64`.
Die Base64-Werte werden nur temporär auf dem macOS-Runner verwendet und nie
ausgegeben. Dafür brauchst du das Apple-Developer-Programm und ein passendes
Distribution-Zertifikat beziehungsweise Provisioning-Profil. Danach erzeugt der
Workflow ein signiertes `.ipa`-Artefakt für TestFlight oder die manuelle
Verteilung.

## Veröffentlichung im Repository

Der Ordner enthält absichtlich nur den signierbaren Swift-Quellcode und keine
Zertifikate, Provisioning-Profile oder `.ipa`-Dateien. GitHub kann den Quellcode
mit der Website veröffentlichen; die signierte App wird anschließend auf einem
Mac in Xcode oder über TestFlight gebaut. Eine iOS-Release-Datei darf nicht aus
privaten Signing-Dateien oder aus dem Entwicklerzertifikat erzeugt werden.
