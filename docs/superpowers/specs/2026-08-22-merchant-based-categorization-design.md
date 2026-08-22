# Regelbasierte Ausgaben-Kategorisierung (keine KI) — Design

**Datum:** 2026-08-22
**Status:** genehmigt, bereit für Implementierungsplan

## Kontext

Fafnir zeigt Transaktionen aktuell ohne Kategorie (Dashboard + Transaktionsliste
sind seit dem letzten Redesign live, siehe
`docs/superpowers/specs/2026-08-21-dashboard-and-csv-import-design.md`).
102 Test-Transaktionen sind lokal importiert.

**Wichtiger Befund vor diesem Design:** `src/db/schema.ts` enthält bereits
Kategorisierungs-Scaffolding aus der ursprünglichen Projektanlage, das nirgends
verdrahtet ist (per grep bestätigt — keine Referenz außerhalb von
`schema.ts`):

- `categories.parentId` — hierarchische Kategorien, ungenutzt.
- `transactions.categoryId` + `transactions.categoryIsManual` — ein
  "aufgelöster Wert direkt auf der Zeile"-Paar.
- `categorizationRules` — eine Keyword-/Regex-/Contains-Matching-Engine mit
  Priorität. Genau die Art automatischer Vorschläge, die dieses Feature
  explizit ausschließt.

Dieses alte Design passt nicht zum neuen Ansatz (Gegenpartei-Regel + separates
Override-Feld, aufgelöst zur Anzeigezeit statt gespeichert). Entscheidung
(mit Nutzer abgestimmt): **aufräumen** — alte Tabelle/Spalten entfernen,
`categories` weiterverwenden, aber ohne `parentId`.

## Ziel

1. Jede Transaktion zeigt eine Kategorie an — automatisch aus einer
   Gegenpartei-Regel oder manuell überschrieben.
2. Der Nutzer kategorisiert jede Gegenpartei nur einmal, nicht jede Buchung.
3. Einzelfall-Ausnahmen sind pro Transaktion überschreibbar, ohne die
   allgemeine Regel zu ändern.

Explizit außerhalb des Scopes: automatische Kategorie-Vorschläge über
Keyword-Listen, KI-/ML-Kategorisierung, Betrags-/Datums-basierte Regeln, eine
feste vorgegebene Kategorienliste im Code, Änderungen an Dashboard/Trend-
Berechnung.

## 1. Datenmodell & Migration

Migration auf dem bestehenden Schema:

- `categorizationRules`-Tabelle **entfernen** (ungenutzt, falsches Modell).
- `transactions.categoryId` und `transactions.categoryIsManual` **entfernen**
  (ungenutzt, mehrdeutig benannt für das neue Modell).
- `categories.parentId` **entfernen** (ungenutzt, keine Hierarchie im Scope).
- `categories` bleibt: `id`, `name` — **neu:** Unique-Index auf `name`, damit
  freie Nutzereingabe keine Duplikate anhäuft.
- **Neue Tabelle `merchantCategoryRules`** (`merchant_category_rules`): `id`,
  `merchantKey` (text, **unique** Index), `categoryId` (FK → categories.id,
  not null).
- **Neues Feld** `transactions.categoryOverrideId` (nullable FK →
  categories.id) — ersetzt das alte `categoryId`/`categoryIsManual`-Paar.

## 2. Gegenpartei-Identität & Auflösungslogik

Reale Testdaten: alle 102 importierten Transaktionen haben
`counterparty = NULL`; der Händlername wird stattdessen aus `purpose` über
`deriveTransactionDisplay()` rekonstruiert (Kartenterminal-Buchungen, siehe
`src/lib/transaction-display.ts`). Die Gegenpartei-Identität muss deshalb
beide Fälle einheitlich abdecken.

- **`getMerchantKey(tx)`** (neu, `src/lib/merchant-key.ts`): liefert
  `deriveTransactionDisplay(tx).title` — exakt der bereits über
  `normalizeMerchantName()` normalisierte Text, den der Nutzer als
  Gegenpartei/Titel sieht. Kein separater Normalisierungspfad nötig.
- **`resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById)`**
  (neu, `src/lib/category-resolution.ts`), reine Funktion:
  1. `tx.categoryOverrideId` gesetzt? → diese Kategorie.
  2. sonst: `rulesByMerchantKey[getMerchantKey(tx)]` vorhanden? → diese
     Kategorie.
  3. sonst: kein Ergebnis → "Unkategorisiert".
- Kein Betrags-, Datums- oder sonstiger Heuristik-Einfluss.
- Unit-tests direkt gegen die reine Funktion, im Stil der bestehenden
  `lib/`-Tests (`transaction-display.test.ts`,
  `transaction-grouping.test.ts`), mit Fixtures aus den echten 102
  importierten Zeilen.

## 3. Mutationen — Server Actions

Neu unter `src/app/(app)/actions/categories.ts`:

- `setMerchantRule(merchantKey, { categoryId } | { newCategoryName })` —
  Upsert in `merchant_category_rules`; bei `newCategoryName` wird zuerst die
  Kategorie angelegt (bei Namenskollision mit dem Unique-Index die
  bestehende Kategorie wiederverwenden statt Fehler zu werfen).
- `setTransactionOverride(transactionId, { categoryId } | { newCategoryName })`
  — setzt nur `category_override_id` auf einer einzelnen Zeile.
- Beide rufen `revalidatePath` für die betroffenen Seiten (`/`,
  `/accounts/[id]`, `/categorize`) auf.
- Jede Server Action prüft die Session (`requireSession()`), analog zu den
  bestehenden Actions.

## 4. Transaktionsliste — Kategorie-Badge pro Zeile

- `TransactionListRow` bekommt ein zusätzliches Feld: die aufgelöste
  Kategorie (Label + Quelle: Override/Regel/keine), serverseitig berechnet
  über `resolveTransactionCategory()`.
- Jede Zeile zeigt ein dezentes Badge neben/unter dem Gegenpartei-Namen
  (Label der Kategorie, oder "Unkategorisiert" in gedämpfter Farbe) — kleine
  neue Client-Komponente, da Interaktivität nötig ist.
- Klick auf das Badge klappt die Zeile inline auf (gleiches visuelles Muster
  wie das bestehende `<details>` für "weitere Buchungen") und zeigt zwei
  kleine native Formulare:
  - **"Nur diese Buchung"** → `setTransactionOverride`.
  - **"Alle Buchungen dieser Gegenpartei"** → `setMerchantRule`.
  - Beide: natives `<select>` mit bestehenden Kategorien + Option
    "+ Neue Kategorie anlegen", die bei Auswahl ein Textfeld einblendet.
- Kein neues UI-Komponenten-Framework — Projekt hat aktuell nur `Button` als
  UI-Primitive; native `<select>`/`<details>`/`<form>` passen zum
  bestehenden minimalen Stil.

## 5. Neue Route `/categorize` — Sammelansicht "Unkategorisiert"

- Server Component, lädt Transaktionen kontoübergreifend, löst jede über
  `resolveTransactionCategory()` auf, behält nur die unaufgelösten.
- Gruppiert nach `getMerchantKey()` — **eine Zeile pro Gegenpartei**, nicht
  pro Transaktion, mit Anzahl der betroffenen Buchungen.
- Pro Gegenpartei dasselbe Zuweisungs-Formular wie in Abschnitt 4 (nur die
  "alle Buchungen"-Variante, da es keine Einzeltransaktion ist) →
  `setMerchantRule`. Nach Zuweisung verschwindet die Gegenpartei beim
  nächsten Laden aus der Liste (jetzt aufgelöst).
- Dashboard (`/`) bekommt einen kleinen Link/Badge ("N Gegenparteien
  unkategorisiert") mit Link auf `/categorize`. Kein sonstiger Eingriff ins
  Dashboard/Trend-Berechnung.

## 6. Tests & Verifikation

- Unit-Tests: `resolveTransactionCategory()` (Override gewinnt vor Regel,
  Regel vor "keine", "keine" wenn nichts zutrifft) und `getMerchantKey()`,
  mit Fixtures aus den echten importierten Daten.
- Manuelle Verifikation gegen die echten 102 importierten Transaktionen:
  - Mindestens eine Gegenpartei über `/categorize` einer Regel zuordnen →
    prüfen, dass alle ihre Buchungen in der Transaktionsliste die Kategorie
    zeigen und die Gegenpartei aus `/categorize` verschwindet.
  - Mindestens eine Einzeltransaktion einer anderen, sonst
    unkategorisierten oder anders kategorisierten Gegenpartei per Override
    umkategorisieren → prüfen, dass nur diese eine Zeile die
    Override-Kategorie zeigt, alle anderen Buchungen derselben Gegenpartei
    unverändert bleiben.
- Migrations-Check: bestehende 102 Testdaten überleben Schema-Änderung
  (Spalten-Drop auf `transactions`/`categories`) ohne Datenverlust.

## Akzeptanzkriterien (aus der Arbeitsanweisung, unverändert)

- [ ] `categories`- und `merchant_category_rules`-Tabellen sowie
  `category_override_id`-Feld an `transactions` sind angelegt.
- [ ] Auflösungslogik (Override → Regel → "Unkategorisiert") ist korrekt
  implementiert und in der Transaktionsliste sichtbar.
- [ ] Sammelansicht zeigt unkategorisierte Gegenparteien gruppiert, nicht
  Transaktion für Transaktion.
- [ ] Eine gesetzte Regel wirkt sofort auf alle bestehenden und künftigen
  Buchungen derselben Gegenpartei.
- [ ] Override lässt sich an einer einzelnen Transaktion setzen, ohne die
  Regel für die restliche Gegenpartei zu verändern.
- [ ] Bestehende 102 Testdaten werden genutzt, um die Zuordnung manuell zu
  verifizieren (mind. ein Fall mit Regel, mind. ein Fall mit Override).
- [ ] Keine Kategorie wird automatisch anhand von Betrag oder Datum vergeben.

## Offene Punkte für den Implementierungsplan

Keine — alle Design-Entscheidungen sind mit dem Nutzer abgestimmt
(Schema-Aufräumung, Route statt Dashboard-Abschnitt, Inline-Formular statt
Detailseite, abgeleiteter Titel als Gegenpartei-Identität).
