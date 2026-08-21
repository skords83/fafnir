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

- **Better Auth** (`better-auth` + `@better-auth/drizzle-adapter`),
  E-Mail/Passwort-Login. Ein einziger Benutzer, angelegt über ein
  Einmal-Seed-Skript (`scripts/create-user.ts`, ruft
  `auth.api.signUpEmail()` auf), keine öffentliche Registrierungs-UI.
  - *Alternativen erwogen:* handgestrickte Cookie-Session (kein neuer
    Dependency, aber mehr Eigenwartung) und HTTP-Basic-Auth (am einfachsten,
    aber kein sauberes Login/Logout). Nutzer hat sich zunächst bewusst für
    NextAuth (Auth.js) entschieden — **Korrektur während der
    Implementierungsplanung:** Auth.js/NextAuth befindet sich seit
    September 2025 im Wartungsmodus (Team ist zu Better Auth gewechselt,
    siehe https://github.com/nextauthjs/next-auth/discussions/13252 und
    https://better-auth.com/blog/authjs-joins-better-auth). Dem Nutzer
    vorgelegt, der sich daraufhin für den Wechsel zu Better Auth
    entschieden hat.
- Schema (`user`, `session`, `account`, `verification`) wird per Better-Auth-
  CLI generiert (`npx auth@latest generate --config ./src/auth.ts --output
  ./src/db/auth-schema.ts`), nicht von Hand geschrieben.
- Route-Handler `src/app/api/auth/[...all]/route.ts` (`toNextJsHandler(auth)`)
  + zentrale `src/auth.ts`-Konfiguration (`betterAuth({...})`, `nextCookies()`
  als letztes Plugin).
- `src/proxy.ts` schützt alle Routen außer `/api/auth/*` und `/login`,
  leitet nicht eingeloggte Requests zu `/login` um (optimistischer Check via
  `getSessionCookie()`; echte Validierung via `auth.api.getSession()` in
  jeder Server Action, siehe Next.js Server-Actions-Sicherheitsmodell:
  jede Server Action ist ein öffentlich erreichbarer POST-Endpunkt).
  - **Korrektur während der Implementierungsplanung:** Next.js 16 hat
    `middleware.ts` zugunsten von `proxy.ts` (exportierte Funktion muss
    `proxy` heißen, nicht `middleware`) abgelöst — dokumentierter Breaking
    Change, siehe AGENTS.md-Hinweis zur Next.js-Doku-Prüfpflicht.
- Seiten: `/login` (Formular, `authClient.signIn.email(...)`), `/`
  (Dashboard, geschützt), `/import` (CSV-Upload, geschützt).

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

- ~~Genaue NextAuth-v5-Konfiguration~~ — erledigt: Wechsel zu Better Auth
  (siehe Abschnitt 1), genaue Konfiguration ist im Implementierungsplan
  ausformuliert.
- Ob `import_batches` einen Status/Fehlerfall-Eintrag bekommt, wenn der
  Import komplett fehlschlägt (Transaktion rollt zurück, kein Batch-Eintrag
  nötig — zu prüfen anhand des existierenden Schemas). **Entschieden:** kein
  Batch-Eintrag bei Fehlschlag, da `db.transaction()` bei einem Fehler
  vollständig zurückrollt (better-sqlite3-Semantik) — es gibt nach einem
  Fehler keinen Teilzustand, der protokolliert werden müsste. Der Fehler
  wird stattdessen als Rückgabewert der Server Action ans UI gereicht.
