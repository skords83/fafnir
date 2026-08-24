# Kategorien verwalten (umbenennen, löschen) — Design

**Datum:** 2026-08-24
**Status:** genehmigt, bereit für Implementierungsplan

## Kontext

Kategorien (`categories`-Tabelle: `id`, `name`, unique Index auf `name`)
werden aktuell ausschließlich beiläufig über den `CategoryPicker` angelegt
("+ Neue Kategorie anlegen" beim Zuweisen). Es gibt keine eigene Seite und
keine Server Actions, um eine bereits angelegte Kategorie umzubenennen oder
zu löschen — das ist die Lücke, die dieses Design schließt. Teil eines
größeren, vom Nutzer gemeldeten Feedback-Bündels zur Kategorisierungs-UX
(siehe `docs/superpowers/specs/2026-08-22-merchant-based-categorization-design.md`
für das zugrunde liegende Datenmodell); die anderen beiden Teile
(Verwendungszweck-Regeln direkt aus der Buchungsliste anlegen; Buchungen in
`/categorize` sichtbar machen) werden als eigene, spätere Design-Zyklen
behandelt.

Referenzielle Situation: `transactions.categoryOverrideId` (nullable FK) und
`merchantCategoryRules.categoryId` (FK, **not null**) referenzieren
`categories.id`; `foreign_keys = ON` ist in `src/db/client.ts` gesetzt. Ein
naives `DELETE` auf eine genutzte Kategorie schlägt also mit einem rohen
SQLite-Constraint-Fehler fehl — die Anwendung muss das explizit und
verständlich handhaben.

## Ziel

1. Bestehende Kategorien lassen sich umbenennen.
2. Bestehende Kategorien lassen sich löschen — aber nur, solange sie nicht
   mehr in Gebrauch sind. Ist eine Kategorie noch referenziert, wird das
   Löschen verweigert und die Anzahl der betroffenen Buchungen/Regeln
   angezeigt, damit der Nutzer weiß, was er vorher woanders umkategorisieren
   muss.
3. Die Seite ist sowohl über einen festen Navigationslink als auch von
   `/categorize` aus erreichbar.

Explizit außerhalb des Scopes: Zusammenführen/Mergen zweier Kategorien beim
Löschen, automatisches Umhängen betroffener Buchungen/Regeln auf
"Unkategorisiert", Anlegen neuer Kategorien auf dieser Seite (deckt der
`CategoryPicker` bereits ab), hierarchische Kategorien.

## 1. Datenmodell

Keine Schema-Änderung. Nur neue Lesezugriffe (Nutzungszähler) und neue
Mutations auf der bestehenden `categories`-Tabelle.

## 2. Server Actions

Neu in `src/app/(app)/actions/category-mutations.ts` (reines DB-Handling,
wirft bei Fehlern — Muster wie `applyMerchantRule`/`applyTransactionOverride`):

- `renameCategory(categoryId: number, name: string): Promise<void>`
  Trimmt `name`; wirft bei leerem Ergebnis. Führt das `UPDATE` aus und fängt
  den Unique-Constraint-Fehler (Namenskollision mit einer anderen Kategorie)
  ab, um eine verständliche deutschsprachige Fehlermeldung zu werfen statt
  den rohen SQLite-Fehler durchzureichen.
- `deleteCategory(categoryId: number): Promise<void>`
  Zählt **serverseitig neu** (nicht auf clientseitig übergebene Zahlen
  vertrauen — Race gegen eine zwischenzeitlich angelegte Regel/Override):
  Anzahl `transactions` mit `categoryOverrideId = categoryId` und Anzahl
  `merchantCategoryRules` mit `categoryId = categoryId`. Sind beide 0, wird
  gelöscht. Sonst wirft die Funktion eine Fehlermeldung mit den aktuellen
  Zahlen, z. B. „Kategorie wird noch von 3 Buchungen und 1 Regel verwendet.“

Neu in `src/app/(app)/actions/categories.ts` (Session-Check + Wrapping in
`ActionResult` + `revalidatePath`, gleiches Muster wie die bestehenden
`setMerchantRule`/`setTransactionOverride`):

- `renameCategory(categoryId, name): Promise<ActionResult>`
- `deleteCategory(categoryId): Promise<ActionResult>`

Beide nutzen den bestehenden `revalidateCategorizedPages()`-Helper
(revalidiert bereits `/`, `/accounts/[id]`, `/categorize`) und erweitern ihn
zusätzlich um `/categories`, da Kategorienamen auf all diesen Seiten
auftauchen.

## 3. Seite `/categories`

Neue Server Component `src/app/(app)/categories/page.tsx`:

- Lädt alle Kategorien, alle `transactions.categoryOverrideId`-Werte und
  alle `merchantCategoryRules.categoryId`-Werte in drei schlanken Queries
  (nur die benötigten Spalten) und aggregiert die beiden Zähler pro
  Kategorie in JS — gleicher Stil wie die Merchant-Gruppierung in
  `categorize/page.tsx`, kein SQL-Join.
- Rendert eine Liste (`CategoryRow` pro Kategorie), alphabetisch sortiert
  nach Name.
- Kopfbereich mit Link „← Zurück" wie auf `/categorize`.

Client Component `src/app/(app)/categories/category-row.tsx`:

- **Umbenennen:** Textfeld vorbefüllt mit dem aktuellen Namen + „Speichern"-
  Button. Button aktiv nur wenn der getrimmte Wert nicht leer und
  verschieden vom aktuellen Namen ist. Fehler (z. B. Namenskollision) werden
  inline unter der Zeile angezeigt.
- **Löschen:** Zeigt die beiden Zähler immer an (Transparenz auch ohne
  Löschversuch), z. B. „12 Buchungen · 2 Regeln". Ist mindestens einer der
  Zähler > 0, ist der „Löschen"-Button deaktiviert (`disabled` +
  `title`-Attribut mit Erklärung); sonst ist er aktiv. Ein serverseitiger
  Fehler (Race-Fall: zwischen Seitenaufruf und Klick wurde die Kategorie neu
  referenziert) wird ebenfalls inline angezeigt — der Button bleibt in dem
  Fall nicht fälschlich "erfolgreich".

## 4. Navigation

- `src/app/(app)/layout.tsx`: neuer Link „Kategorien" neben „Import".
- `src/app/(app)/categorize/page.tsx`: zusätzlicher Link „Kategorien
  verwalten" (führt zu `/categories`).

## 5. Fehlerbehandlung

Beide Actions folgen dem bestehenden `ActionResult`-Discriminated-Union
(`{ ok: true } | { ok: false; error: string }`), keine geworfenen Exceptions
über die Server-Action-Grenze hinweg — gleiches Muster wie
`setMerchantRule`/`setTransactionOverride` in `actions/categories.ts`.

## 6. Tests

Erweiterung von `src/app/(app)/actions/category-mutations.test.ts`:

- `renameCategory`: erfolgreiches Umbenennen; leerer/nur-Leerzeichen-Name
  wirft; Umbenennen auf einen bereits vergebenen Namen wirft eine
  verständliche Fehlermeldung.
- `deleteCategory`: erfolgreiches Löschen einer unbenutzten Kategorie;
  Löschen einer Kategorie mit Transaktions-Override wirft und lässt die
  Kategorie unangetastet; Löschen einer Kategorie mit Merchant-Regel wirft
  ebenso; Zähler in der Fehlermeldung stimmen.
