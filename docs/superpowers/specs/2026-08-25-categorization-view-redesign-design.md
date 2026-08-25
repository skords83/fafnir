# Kategorisierungs-Ansicht: Zusammenführung von Übersicht und Detail — Design

**Datum:** 2026-08-25
**Status:** genehmigt, bereit für Implementierungsplan

## Kontext

Zwei bestehende UI-Stellen decken die Kategorisierung von Buchungen heute
nur unvollständig ab:

1. `/categorize` (`src/app/(app)/categorize/page.tsx`) gruppiert
   unkategorisierte Buchungen nach Gegenpartei, zeigt aber nur Gegenpartei-
   Name und Buchungsanzahl — keine Einzelbuchungen, keine Verwendungszwecke.
   Die "Verwendungszweck enthält"-Regel lässt sich hier über
   `MerchantCategoryForm` zwar technisch anlegen, aber blind: der Nutzer
   sieht den Text, den er matchen will, nirgends.
2. Die `CategoryBadge`-Komponente (`src/components/transactions/category-badge.tsx`),
   eingebettet in `TransactionList` auf Dashboard (`src/app/(app)/page.tsx`)
   und Kontoansicht (`src/app/(app)/accounts/[id]/page.tsx`), fungiert als
   De-facto-Detailansicht pro Einzelbuchung: Klick auf das Status-Badge
   klappt ein Popover mit "Nur diese Buchung" und "Alle Buchungen dieser
   Gegenpartei" auf. Sie zeigt zwar an, ob eine Verwendungszweck-Regel
   greift (`merchantRulePurposeContains`), bietet aber kein Eingabefeld, um
   eine *neue* Verwendungszweck-Regel zu erstellen.

Dieses Design referenziert
`docs/superpowers/specs/2026-08-22-merchant-based-categorization-design.md`
(Datenmodell für Regeln) und
`docs/superpowers/specs/2026-08-24-category-management-design.md`, dessen
Kontext-Abschnitt genau diese Lücke bereits als "eigenen, späteren
Design-Zyklus" ankündigt.

**Kein Schema-Update nötig.** Die kombinierte Regel-Entität existiert
bereits: `merchantCategoryRules.purposeContains` (nullable, Substring-Filter)
neben `categoryId`. Auflösungsreihenfolge in `src/lib/category-resolution.ts`
ist bereits: Override (`transactions.categoryOverrideId`) → purpose-scoped
Regel (längster Substring-Match zuerst) → Gegenpartei-Fallback-Regel →
unkategorisiert. `applyMerchantRule(merchantKey, purposeContains, target)`
(in `category-mutations.ts`) legt Regeln bereits inkl. Overlap-Validierung
und Upsert-Logik an — wird unverändert wiederverwendet.

## Ziel

Eine Ansicht unter `/categorize` ersetzt beide bisherigen Zugänge:

1. Gruppierung nach Gegenpartei bleibt (Datenquelle: bestehende
   `buildCategoryLookups`/`resolveTransactionCategory`-Logik).
2. Jede Gruppe ist standardmäßig eingeklappt; Klick auf den Gruppenkopf
   klappt sie auf/zu.
3. Aufgeklappt zeigt jede Gruppe jede Einzelbuchung mit Datum, Betrag,
   vollständigem Verwendungszweck, Status-Badge, und direkt darunter zwei
   Regel-Zeilen ("Nur diese Buchung", "Verwendungszweck enthält" — Textfeld
   vorbefüllt mit dem kompletten Verwendungszweck, frei editierbar).
4. Buchungen einer Gruppe werden erst beim ersten Aufklappen nachgeladen
   (Lazy Load), nicht initial für alle Gruppen.
5. `CategoryBadge` entfällt vollständig aus `TransactionList` (Dashboard +
   Kontoansicht) — einheitlich für alle Buchungen, nicht nur unkategorisierte.
   Jede Zeile verlinkt stattdessen auf `/categorize?merchant=<merchantKey>`,
   was die passende Gruppe serverseitig vorab aufgeklappt lädt.

Explizit außerhalb des Scopes: Icons, Suche/Filter innerhalb der Ansicht,
Datenbank-Schema-Änderungen.

## 1. Datenmodell

Keine Änderung. Nur neue Lesezugriffe.

## 2. Server Actions

Neu in `src/app/(app)/actions/categories.ts` (das ist die `'use server'`-
Grenze, die `category-mutations.ts` für Client Components konsumierbar
macht — `getMerchantTransactions` ist eine reine Query, keine Mutation,
gehört aber aus demselben Grund hierher, nicht nach `category-mutations.ts`):

- `getMerchantTransactions(merchantKey: string): Promise<MerchantTransactionRow[]>`
  Lädt `id`, `bookingDate`, `amountCents`, `purpose`, `categoryOverrideId`
  für alle Buchungen dieser Gegenpartei, plus die aufgelöste effektive
  Kategorie und die greifende Regel (analog zur bestehenden
  `TransactionListRow`-Konstruktion in den Seiten, die `TransactionList`
  befüllen). Wird vom Client bei jedem ersten Aufklappen einer Gruppe
  aufgerufen.

Wiederverwendet, unverändert:

- `setTransactionOverride(transactionId, target)` — "Nur diese Buchung".
- `setMerchantRule(merchantKey, purposeContains, target)` — "Verwendungszweck
  enthält"-Zeile ruft dies neu mit dem *vom Nutzer editierten* Textwert auf
  (bisher wurde diese Action in `CategoryBadge` nur mit dem Wert einer
  bereits bestehenden Regel aufgerufen, nie mit freiem Nutzertext).

## 3. Seiten-Komposition (`/categorize`)

Server Component wie bisher lädt Gegenpartei-Liste + Zähler + bestehende
Regeln (unverändert). Neu: liest `searchParams.merchant` — ist er gesetzt,
wird diese eine Gruppe serverseitig als bereits aufgeklappt gerendert (inkl.
serverseitigem Laden ihrer Transaktionen, kein Client-Roundtrip nötig für
den Deep-Link-Fall) und der Client scrollt beim Mount zu
`#group-<merchantKey>` (Anchor-`id` auf dem Gruppen-Container).

Gruppenkopf: Client Component (`MerchantGroup`), hält `isOpen`-State.
- Initial `isOpen = merchantKey === searchParams.merchant`.
- Beim ersten Öffnen (falls nicht bereits serverseitig vorbefüllt): ruft
  `getMerchantTransactions(merchantKey)` auf, cached Ergebnis in
  lokalem State (kein erneuter Fetch bei Zu-/wieder Aufklappen).
- Rendert weiterhin die bestehende `MerchantCategoryForm` (Gegenpartei-
  Fallback-Regel) im Kopf, unverändert.

Pro Buchung (`TransactionDetailRow`, neue Komponente, ersetzt
`CategoryBadge`'s Popover-Inhalt durch offen sichtbare Darstellung — kein
eigener Klick zum Aufklappen mehr nötig, da die Gruppe bereits der
aufklappende Container ist):
- Datum, Betrag, Verwendungszweck (voller Text, kein Trunkieren), Status-Badge.
- "Nur diese Buchung": `CategoryPicker` + `setTransactionOverride`
  (Logik 1:1 aus `CategoryBadge` übernommen).
- "Verwendungszweck enthält": `<input>` vorbefüllt mit
  `tx.purpose` (voller Text, editierbar) + `CategoryPicker` +
  `setMerchantRule(merchantKey, inputValue, target)`.

## 4. Migration von `TransactionList`

`TransactionRow` (`src/components/transactions/transaction-list.tsx`)
verliert die `CategoryBadge`-Einbindung. Das Status-Badge (Kategoriename
oder "Unkategorisiert") wird zu
`<Link href={`/categorize?merchant=${merchantKey}#group-${merchantKey}`}>`.
`TransactionListRow`/`TransactionListRowProps` verlieren die für
`CategoryBadge` nötigen Zusatzfelder (`overrideCategoryId`,
`merchantRuleCategoryId`, `merchantRulePurposeContains`), die aufrufenden
Seiten (`page.tsx`, `accounts/[id]/page.tsx`) vereinfachen ihre Queries
entsprechend (nur noch `effectiveCategory` für die Anzeige nötig).

`CategoryBadge` selbst wird gelöscht — ihre Picker-Logik lebt jetzt in
`TransactionDetailRow`.

## 5. Performance

Lazy Load pro Gruppe (Abschnitt 3) verhindert, dass alle Buchungen aller
Gegenparteien initial im DOM landen. Innerhalb einer sehr großen Gruppe wird
kein zusätzliches Paging eingeführt (außerhalb des Scopes) — die
Datenmenge pro Gegenpartei ist in der Praxis klein genug (siehe bestehendes
Collapse-Pattern in `transaction-grouping.ts` für den Größenordnungs-Kontext).

## 6. Testing

- `category-mutations.test.ts`, `category-resolution.test.ts`: unverändert
  gültig (keine Logikänderung).
- Neu: Test für `getMerchantTransactions` (korrekte Felder, korrekte
  Gegenpartei-Filterung).
- Neu: Komponenten-/Integrationstest für `/categorize` — Gruppen starten
  eingeklappt, Aufklappen lädt Buchungen nach, `?merchant=`-Deep-Link öffnet
  die richtige Gruppe vorab.
- Neu: Test, dass `TransactionList` keine Kategorisierungs-UI mehr rendert,
  nur noch den Link zu `/categorize`.
- Anpassen: bestehende Tests, die `CategoryBadge`-Verhalten in
  `TransactionList` prüften, wandern (soweit inhaltlich noch relevant) zu
  Tests für `TransactionDetailRow` in `/categorize`.
