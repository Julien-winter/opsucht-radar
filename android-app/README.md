# OPSUCHT Market Android-App

Diese kleine Android-App lädt die responsive OPSUCHT-Market-Web-App in einer
nativen WebView. Dadurch bleiben Marktpreise, Auktionen, ABC, Itemwerte,
Händler-Rechner, Konten und Discord-Alarme an einer Stelle aktuell.

## Voraussetzungen

- Android Studio oder JDK 17+
- Android SDK mit `platforms;android-35` und Build Tools
- Gradle 8.x (Android Studio liefert das automatisch)

## Build

Im Ordner `android-app`:

```text
gradlew.bat assembleDebug
```

Die APK liegt danach unter `app/build/outputs/apk/debug/app-debug.apk`.

Die Web-Adresse kann beim Build überschrieben werden:

```text
gradlew.bat assembleDebug -PopsuchtUrl=http://dein-host:63816/
```

Die App prüft beim Start standardmäßig die GitHub-Releases von
`Julien-winter/opsucht-radar`. Sie liest nur Release-Metadaten und öffnet bei
einer neueren Version die Release-Seite; sie installiert nichts automatisch.
Für Forks oder Test-Repositories kann die URL beim Build überschrieben werden:

```text
gradlew.bat assembleDebug -PopsuchtUpdateApi=https://api.github.com/repos/OWNER/REPO/releases/latest
```

Lässt man `opsuchtUpdateApi` weg, findet keine Update-Abfrage statt. Dadurch
bleibt die App auch für private oder noch nicht veröffentlichte Builds ruhig.

Standardmäßig wird `http://45.93.249.214:63816/` geladen. HTTP ist absichtlich
freigeschaltet, weil der aktuelle Radar-Host ohne HTTPS betrieben wird. Für
eine Veröffentlichung im Play Store sollte der Host auf HTTPS umgestellt und
`usesCleartextTraffic` entfernt werden.
