# Benutzerhandbuch für Viessmann Climate API

Dieser Adapter verbindet ioBroker mit Anlagen, die über die Viessmann Climate Solutions Cloud API erreichbar sind. Die Anlage stellt die Cloud-Verbindung typischerweise über ein Vitoconnect-Gateway her.

Das erste verifizierte Referenzsystem ist eine Wärmepumpe Vitocal 300-G BWC 301.C16 mit Vitoconnect. Andere Anlagen können abweichende Features und Befehle liefern und müssen einzeln geprüft werden.

## Voraussetzungen

Benötigt werden Node.js 22 oder 24, js-controller ab 6.0.11, Admin ab 7.6.20, ein Viessmann-Developer-Konto und eine kompatible, mit der Cloud verbundene Anlage. Der OAuth-Client wird im [Viessmann Developer Portal](https://app.developer.viessmann-climatesolutions.com/) angelegt. Zusätzlich sollten die [API-Produkte des Herstellers](https://developer.viessmann-climatesolutions.com/start/api-products.html) geprüft werden. Die verfügbaren Features hängen weiterhin von der konkreten Anlage und dem Konto ab.

Das Projekt befindet sich noch im Vorabtest. Review-Builds nur über **Adapter → Installation aus eigener URL** in ioBroker Admin und zunächst in einer separaten Testinstanz installieren.

## OAuth-Anmeldung

1. Die exakte Callback-URI aus der Adapterkonfiguration im Viessmann-OAuth-Client registrieren, beispielsweise `http://<iobroker-host>:8097/callback`.
2. Die Client-ID eintragen. Ein Client-Secret nur eintragen, wenn es der OAuth-Client tatsächlich verlangt.
3. Den Callback aktiviert lassen, die Login-URL erzeugen und die Viessmann-Anmeldung in einem Browser abschließen, der die Callback-Adresse erreichen kann.
4. Nach erfolgreichem Callback `info.connection`, `raw` und `summary` prüfen.

Das native Instanzobjekt und die Callback-URL niemals veröffentlichen. Sie können Tokens, Autorisierungscode, OAuth-State, Installations-IDs oder Gateway-Kennungen enthalten.

## Polling und API-Limits

Das Standardintervall beträgt fünf Minuten. Der Adapter führt einen lokalen Zähler über rollierende 24 Stunden und verwendet standardmäßig ein Sicherheitsbudget von 1.450 Aufrufen. Das ist nur eine lokale Schätzung. Maßgeblich sind das gebuchte Viessmann-API-Produkt und die aktuellen Angaben in der [Viessmann API FAQ](https://developer.viessmann-climatesolutions.com/start/faq.html).

Polling-Aufrufe laufen seriell. Fehlgeschlagene Anfragen werden nach einem Timeout abgebrochen und mit wachsendem Abstand wiederholt. Weitere Instanzen oder Anwendungen können dasselbe externe Kontingent verbrauchen.

## Schreibzugriff freigeben

Schreibbefehle bleiben gesperrt, bis sowohl die globale Freigabe als auch die Freigabe des konkreten Befehls aktiv sind.

1. Erfolgreich pollen und den gewünschten Befehl unter `writes.discovered` prüfen.
2. Sicherstellen, dass die API den Befehl als ausführbar meldet, und seine Parameter kontrollieren.
3. `writeEnabled` in der Instanzkonfiguration aktivieren.
4. Nur den passenden State `writes.allowlist.<feature>.<command>.enabled` einschalten.
5. Die erforderlichen JSON-Parameter in den erzeugten `control`-State oder in `write.command` schreiben.
6. `write.lastResult` und die Reaktion der realen Anlage prüfen.

Die Befehle werden seriell und mit Mindestabstand ausgeführt. Wenn im Normalbetrieb keine Schreibzugriffe benötigt werden, `writeEnabled` nach dem Test wieder deaktivieren.

## Wichtige Objektgruppen

- `raw`: vollständiger generischer Feature-Baum
- `summary`: ausgewählte, gut lesbare States
- `writes.discovered`: Metadaten und Parameter gefundener Befehle
- `writes.allowlist`: Freigabe einzelner Befehle
- `control`: schreibbare States für freigegebene Befehle
- `write.lastResult`: Ergebnis des letzten Befehls
- `diagnostics.api.limit.*`: lokale Diagnose des Aufrufbudgets

Der ausführliche [Adapter-Leitfaden](../adapter-guide.md) enthält State-Beispiele und Command-Payloads.

## Support

Öffentliche Fehler und Funktionswünsche über die Issue-Vorlagen des Repositorys melden. Versionen und ein minimales Beispiel angeben, aber OAuth-Daten, Installations-IDs, Gateway-Seriennummern und personenbezogene Informationen entfernen. Sicherheitslücken gemäß [SECURITY.md](../../SECURITY.md) vertraulich melden.

Dieses Projekt ist unabhängig von Viessmann und von anderen Viessmann-Adaptern für ioBroker. Es besteht keine Kompatibilitäts- oder automatische Migrationszusage für deren Objektmodelle.

Die Software wurde mit AI-Unterstützung entwickelt. Der Adapter besitzt keine AI-Laufzeitfunktion und sendet keine Betriebs- oder Benutzerdaten an einen AI-Dienst.
