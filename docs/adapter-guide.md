# Adapter Guide

Diese Dokumentation beschreibt die oeffentliche Adapter-Funktion, die
Konfiguration und die wichtigsten ioBroker-State-Gruppen.

## Was der Adapter macht

Der Adapter verbindet ioBroker mit der Viessmann Climate Solutions REST API. Er
liest Installationen, Geraete und Features aus, bildet die Daten generisch unter
`raw` ab und erstellt zusaetzlich gut lesbare Zusammenfassungen unter `summary`.

Schreibzugriffe sind bewusst abgesichert:

- globale Freigabe ueber `writeEnabled` in der Adapter-Konfiguration
- dynamische Freigabe pro Viessmann-Command unter `writes.allowlist`
- serielle Write-Queue mit Mindestabstand zwischen Schreibbefehlen
- letzter Erfolg oder Fehler unter `write.lastResult`

Der Adapter fuehrt keine Schreibbefehle aus, solange `writeEnabled` nicht aktiv
ist und der konkrete Command nicht in der Allowlist freigegeben wurde.

## Konfiguration

### OAuth

Im Tab `OAuth` werden die Viessmann API Zugangsdaten und der Login eingerichtet.

Wichtige Felder:

- `clientId`: Client-ID aus dem Viessmann Developer Portal.
- `clientSecret`: optional, nur falls der Viessmann Client ein Secret verlangt.
- `oauthPublicRedirectUri`: Callback-URI, die im Viessmann Client registriert
  sein muss, zum Beispiel `http://<iobroker-host>:8097/callback`.
- `oauthCallbackEnabled`: startet waehrend des Logins einen temporaeren
  Callback-Server.
- `port`: Port fuer den temporaeren Callback, Standard `8097`.

Nach dem Klick auf `Viessmann Login-URL erzeugen` wird der Login im Browser
abgeschlossen. Access- und Refresh-Tokens werden geschuetzt in der nativen
ioBroker-Konfiguration gespeichert.

### Polling

Im Tab `Polling` wird festgelegt, wie haeufig die Viessmann API gelesen wird.

- `pollIntervalMinutes`: Leseintervall in Minuten. Fuer normalen Betrieb sind
  5 Minuten oder mehr sinnvoll, damit das API-Budget geschont wird.
- `dailyRequestBudget`: lokale Obergrenze fuer die Rolling-24h-Schaetzung.

### Writes

Im Tab `Writes` werden Schreibzugriffe global aktiviert und gedrosselt.

- `writeEnabled`: globale Freigabe fuer alle Writes.
- `minWriteIntervalSeconds`: Mindestabstand zwischen zwei Writes.

Auch bei aktivem `writeEnabled` muss jeder konkrete Viessmann-Command zusaetzlich
unter `writes.allowlist` freigegeben werden.

## State-Gruppen

Alle State-IDs liegen unter der Adapterinstanz, zum Beispiel
`viessmann-climate-api.0`.

### `info`

Statusinformationen zur Adapterverbindung.

Beispiel:

```text
viessmann-climate-api.0.info.connection
```

### `raw`

Generische Spiegelung der Viessmann API-Daten. Diese Struktur ist technisch und
orientiert sich nah an Features, Properties und Commands der API.

Beispiele:

```text
viessmann-climate-api.0.raw.devices.<deviceId>.features.<feature>.properties.<property>
viessmann-climate-api.0.raw.devices.<deviceId>.features.<feature>.commands.<command>
```

### `summary`

Lesbare Zusammenfassung wichtiger Werte fuer Dashboards, Visualisierungen und
Skripte.

Beispiele:

```text
viessmann-climate-api.0.summary.system.outsideTemperature
viessmann-climate-api.0.summary.dhw.temperature.current
viessmann-climate-api.0.summary.heatPump.compressor.active
```

### `writes.discovered`

Dynamisch gefundene Viessmann-Commands. Der State-Wert ist JSON und enthaelt
unter anderem:

- `deviceId`
- `featureName`
- `commandName`
- `executable`
- `params`

Hier findest du die richtige Syntax und den erwarteten Aufbau der Parameter fuer
einen Write.

Beispiel:

```text
viessmann-climate-api.0.writes.discovered.heating.dhw.temperature.main.setTargetTemperature
```

### `writes.allowlist`

Freigabe pro Command. Erst wenn der passende Allowlist-State auf `true` steht,
wird ein passender `control`-State erzeugt.

Beispiel:

```text
viessmann-climate-api.0.writes.allowlist.heating.dhw.temperature.main.setTargetTemperature.enabled
```

### `control`

Schreibbare States fuer freigegebene Commands. Diese States entstehen nur fuer
Commands, deren Allowlist-State aktiv ist.

Beispiel:

```text
viessmann-climate-api.0.control.heating.dhw.temperature.main.setTargetTemperature
```

Nach erfolgreichem Write aktualisiert der Adapter passende aktuelle Werte, wenn
sie aus den Parametern ableitbar sind:

```text
viessmann-climate-api.0.control.heating.dhw.temperature.main.current.value
```

### `write`

Allgemeine Write-States.

```text
viessmann-climate-api.0.write.command
viessmann-climate-api.0.write.lastResult
viessmann-climate-api.0.write.queueLength
```

`write.command` ist ein generischer JSON-Eingang fuer Skripte und Node-RED.
`write.lastResult` zeigt den letzten Erfolg oder Fehler. `write.queueLength`
zeigt die aktuelle Laenge der Queue.

### `diagnostics`

Diagnosewerte fuer Verbindung, API-Budget und Laufzeit.

```text
viessmann-climate-api.0.diagnostics.api.limit.used24h
viessmann-climate-api.0.diagnostics.api.limit.remaining24h
viessmann-climate-api.0.diagnostics.api.limit.requestTimestampsJson
viessmann-climate-api.0.diagnostics.runtime.memory.rssMb
```

## Write freigeben und ausfuehren

Beispiel: Warmwasser-Solltemperatur setzen.

### 1. Command finden

Nach einem erfolgreichen Polling pruefen, ob der Command existiert:

```text
viessmann-climate-api.0.writes.discovered.heating.dhw.temperature.main.setTargetTemperature
```

Der JSON-Wert zeigt, ob der Command `executable` ist und welche `params`
erwartet werden.

### 2. Globale Writes aktivieren

In der Adapter-Konfiguration `writeEnabled` aktivieren.

### 3. Command in der Allowlist freigeben

Den Allowlist-State auf `true` setzen:

```text
viessmann-climate-api.0.writes.allowlist.heating.dhw.temperature.main.setTargetTemperature.enabled
```

Danach baut der Adapter die Control-States neu auf. Der passende State erscheint
unter:

```text
viessmann-climate-api.0.control.heating.dhw.temperature.main.setTargetTemperature
```

### 4. Write ueber `control` ausfuehren

Den Control-State mit den Parametern als JSON setzen:

```json
{
  "temperature": 48
}
```

Nach Erfolg steht das Ergebnis unter:

```text
viessmann-climate-api.0.write.lastResult
```

Wenn der aktuelle Wert ableitbar ist, wird auch dieser State aktualisiert:

```text
viessmann-climate-api.0.control.heating.dhw.temperature.main.current.value
```

### 5. Alternative ueber `write.command`

Skripte oder Node-RED koennen stattdessen den generischen JSON-Eingang nutzen:

```json
{
  "deviceId": "0",
  "feature": "heating.dhw.temperature.main",
  "command": "setTargetTemperature",
  "params": {
    "temperature": 48
  }
}
```

Diesen JSON-Wert in folgenden State schreiben:

```text
viessmann-climate-api.0.write.command
```

Auch dieser Weg nutzt dieselbe globale Freigabe, dieselbe Allowlist und dieselbe
Queue.

## Hinweise zu sicheren Writes

- Schreibbefehle koennen reale Heizungswerte veraendern.
- Vor jedem Write den aktuellen Wert pruefen.
- Nur Commands freigeben, die du wirklich verwenden willst.
- Nach einem Test-Write `write.lastResult` und den passenden `current`-State
  pruefen.
- Bei unerwartetem Verhalten `writeEnabled` wieder deaktivieren.
