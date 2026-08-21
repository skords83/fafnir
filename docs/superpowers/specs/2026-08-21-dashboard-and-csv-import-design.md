# Dashboard + CSV-Import (erstes Feature) — Design

**Datum:** 2026-08-21
**Status:** genehmigt, bereit für Implementierungsplan

## Kontext

Fafnir ist eine private Finanz-App (Einzelbenutzer, hinter Tailscale). Deployment
(Docker, GitHub Actions, Tailscale-Sidecar auf Sleipnir/Odin) ist fertig und läuft.

Bereits vorhanden:
- `src/db/schema.ts` — Drizzle-Schema mit `accounts`, `categories` (hierarchisch),
  `import_batches`, `transactions` (inkl. Dedup-Hash, `isManualCategory`-Flag),
  `categorization_rules`, `balance_snapshots`.
- `src/db/client.ts` — Drizzle/better-sqlite3-Client.
- `src/lib/import/postbank.ts` — getesteter Parser/Normalisierer für Postbank-
  "Kontoumsätze"-CSV-Exporte (deutsches Datums-/Zahlenformat, Dedup-Hashing,
  Balance-Snapshot-Extraktion aus der letzten `Kontostand;`-Zeile).

Fehlend: jede UI und jede Route. `src/app/page.tsx` ist noch das unveränderte
Next.js-Scaffold.

## Ziel dieses Features

Erste End-to-End-Scheibe der App bauen:
1. Login-Schutz zusätzlich zum Tailscale-Netzwerkschutz.
2. Ein Dashboard, das Kontostände + Verlauf über Zeit zeigt.
3. Ein minimaler CSV-Import, der echte Postbank-Exporte in die DB schreibt —
   kein Vorschau-/Review-Schritt, keine Kategorisierungs-Anwendung, kein
   Mehrbank-Support. Diese Ausbaustufen sind spätere Features.

Explizit außerhalb des Scopes: Kategorisierungsregeln-UI, Transaktionsliste/
-suche, Budget-Funktionen, Mehrbenutzer-Auth, andere Bank-CSV-Formate.

## 1. Routen & Auth

- **NextAuth v5** (`next-auth@beta`), Credentials-Provider, JWT-Session-
  Strategie. Kein DB-Adapter — ein einziger Benutzer aus Env-Vars
  (`FAFNIR_USERNAME`, `FAFNIR_PASSWORD_HASH`). Ein Einmal-Skript
  (`scripts/hash-password.mjs`) erzeugt den Passwort-Hash.
  - *Alternativen erwogen:* handgestrickte Cookie-Session (kein neuer
    Dependency, aber mehr Eigenwartung) und HTTP-Basic-Auth (am einfachsten,
    aber kein sauberes Login/Logout). Nutzer hat sich bewusst für NextAuth
    entschieden.
- Route-Handler `src/app/api/auth/[...nextauth]/route.ts` + zentrale
  `src/auth.ts`-Konfiguration (Standard-Auth.js-App-Router-Pattern).
- `middleware.ts` schützt alle Routen außer `/api/auth/*` und `/login`,
  leitet nicht eingeloggte Requests zu `/login` um.
- Seiten: `/login` (Formular, `signIn("credentials", …)`), `/` (Dashboard,
  geschützt), `/import` (CSV-Upload, geschützt).
- Vor der Implementierung: aktuelle Auth.js-v5-Doku prüfen statt sich auf
  ggf. veraltetes Trainingswissen zu verlassen (API hat sich zwischen v4 und
  v5 stark verändert). Ebenso `node_modules/next/dist/docs/` für aktuelle
  Next.js-16-App-Router-Konventionen konsultieren (siehe AGENTS.md).

## 2. Dashboard (`/`)

- Server Component, liest Konten + zugehörige `balance_snapshots` direkt per
  Drizzle (kein API-Roundtrip nötig).
- Pro Konto eine Karte: Kontoname, aktueller Saldo (jüngster Snapshot),
  Trend-Chart darunter (Recharts `LineChart`, bereits Dependency) über alle
  Snapshots des Kontos.
- Chart-Komponente ist Client Component (`"use client"`), bekommt die
  Snapshot-Daten als Props vom Server Component — kein eigener Client-Fetch.
- Leerer Zustand (keine Konten vorhanden): Hinweis-Karte "Noch keine Konten"
  mit Link zu `/import`.
- Kein Caching-Sonderfall nötig — Standard-Rendering pro Request reicht bei
  diesem Datenvolumen (privates Konto, kein High-Traffic).

## 3. CSV-Import (`/import`)

- Formular: Konto-Auswahl (bestehende Konten aus Dropdown) **oder** neuen
  Kontonamen eingeben, plus Datei-Upload. Client Component für die
  Formular-Interaktivität, die eigentliche Arbeit läuft in einer Server
  Action.
- **Server Action `importCsv(formData)`:**
  1. Ziel-Account bestimmen (bestehend wählen oder neu anlegen).
  2. Datei-Text lesen, `parseCsv()` + `normalizeRow()` aus `postbank.ts`
     anwenden.
  3. Pro Zeile `computeHash(accountId, tx)` berechnen, gegen bereits
     vorhandene Hashes im Konto abgleichen → Duplikate rausfiltern.
  4. Neue Transaktionen + (falls vorhanden) den `balanceSnapshot` aus dem
     CSV in `balance_snapshots` schreiben.
  5. Einen Eintrag in `import_batches` protokollieren (Konto, Zeitstempel,
     Anzahl importiert/übersprungen).
  6. Alles in einer einzigen DB-Transaktion (`db.transaction()`) — ein
     Fehler mittendrin darf keine Teil-Daten hinterlassen.
- Rückmeldung über `useActionState`: "X Transaktionen importiert, Y
  Duplikate übersprungen" bzw. Fehlermeldung bei kaputtem CSV (z. B.
  fehlender Header). Kein Redirect — Ergebnis direkt auf der Import-Seite.

## 4. Tests & Fehlerbehandlung

- Neue Integrationstests für die Server-Action-Logik (Dedup gegen
  vorhandene Hashes, Balance-Snapshot-Schreiben) gegen eine temporäre
  SQLite-Testdatenbank, im Stil von `postbank.test.ts`.
- Strukturell kaputte CSVs (fehlender Header, kaputtes Datum) führen zu
  einer klaren Fehlermeldung im UI, kein stiller Fehlschlag, kein
  Server-Crash.
- Auth-Middleware-Redirect-Verhalten wird manuell getestet — kein
  dediziertes Testautomatisierungs-Overhead dafür in v1.

## Offene Punkte für den Implementierungsplan

- Genaue NextAuth-v5-Konfiguration (Cookie-Name, Session-Dauer) anhand der
  aktuellen Doku statt hier vorwegzunehmen.
- Ob `import_batches` einen Status/Fehlerfall-Eintrag bekommt, wenn der
  Import komplett fehlschlägt (Transaktion rollt zurück, kein Batch-Eintrag
  nötig — zu prüfen anhand des existierenden Schemas).
