# Oberkategorien (Kategorie-Gruppen) — Design

Date: 2026-08-26

## Ziel

Kategorien können optional einer Oberkategorie zugeordnet werden, um in der Statistik
sinnvolle Blöcke (z. B. "Wohnen" aus Gas, Wasser, Grundsteuer, Einrichtung) auswerten zu
können, statt vieler kleiner Einzelposten. Die Zuordnungslogik für Buchungen (Regeln,
Overrides, Auflösungsreihenfolge) bleibt vollständig unverändert — Oberkategorien wirken
sich ausschließlich auf Anzeige/Auswertung aus.

## Nicht Teil dieser Änderung

- Keine automatische oder KI-gestützte Zuordnung von Kategorien zu Oberkategorien —
  ausschließlich manuelle Zuordnung durch den Nutzer.
- Keine Änderung an der Regel- oder Override-Logik für Buchungen, an `/categorize`, oder
  an `category-resolution.ts`.
- Keine dritte Verschachtelungsebene.
- Kein neues "Kategorie anlegen"-Formular auf `/categories` — die Seite bleibt reine
  Verwaltung (Umbenennen, Löschen, jetzt zusätzlich Oberkategorie zuordnen) bestehender
  Kategorien; neue Kategorien entstehen weiterhin ausschließlich implizit über den
  Regel-Picker auf `/categorize` (`CategoryTarget: { type: 'newCategory' }`).

## Datenmodell

Neue nullable Spalte auf `categories`:

```ts
// src/db/schema.ts
import { sqliteTable, text, integer, uniqueIndex, index, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  parentCategoryId: integer('parent_category_id').references((): AnySQLiteColumn => categories.id),
}, (t) => ({
  uniqueName: uniqueIndex('uniq_category_name').on(t.name),
}));
```

- `AnySQLiteColumn` (statt `any`) für den selbstreferenzierenden Fremdschlüssel-Typ —
  vermeidet den ESLint-`no-explicit-any`-Fehler, der bei einem früheren Anlauf mit
  Kategorie-Hierarchien auftrat.
- Kein `onDelete`-Cascade: Löschen einer Kategorie, die selbst als Oberkategorie
  referenziert wird, ist serverseitig blockiert (siehe Validierung unten), Cascade würde
  also nie greifen.
- Migration über `npm run db:generate` (Drizzle-Kit erzeugt die SQL-Migration
  `ALTER TABLE categories ADD parent_category_id integer REFERENCES categories(id)`),
  danach `npm run db:migrate` / `db:migrate:runtime` wie bei bisherigen Migrationen.
- Buchungen, Regeln (`merchantCategoryRules.categoryId`) und
  `transactions.categoryOverrideId` referenzieren weiterhin ausschließlich die normale
  Kategorie — hier ändert sich nichts.

## UI: `/categories` — Verwalten

**`CategoryRow`** (`src/app/(app)/categories/category-row.tsx`) bekommt neben dem
bestehenden Umbenennen-Formular ein zusätzliches `<select>` "Oberkategorie":

- Optionen: "Keine" plus alle Kategorien mit `parentCategoryId === null`, ausgenommen die
  Kategorie selbst. Eine Kategorie, die bereits selbst als Oberkategorie für andere dient,
  bleibt in dieser Liste wählbar — das ist der Normalfall beim Hinzufügen einer zweiten,
  dritten usw. Kategorie zu einer bestehenden Gruppe. Die dritte-Ebene-Prävention sitzt
  stattdessen ausschließlich serverseitig in `setCategoryParent` (Guards unten): sie
  verhindert, dass die *bearbeitete* Kategorie selbst einen Parent bekommt, wenn sie schon
  Kinder hat — nicht, dass sie als Parent für andere gewählt werden kann.
- Ändern der Auswahl ruft sofort eine neue Server Action `setCategoryParent(categoryId,
  parentId | null)` auf (eigener kleiner State/Transition, analog zum bestehenden
  Umbenennen-Formular — kein gemeinsames Submit mit dem Namensfeld).

**`CategoriesPage`** (`src/app/(app)/categories/page.tsx`) gruppiert die Liste visuell:

- Kategorien werden nach `parentCategoryId` gruppiert; jede Oberkategorie erscheint als
  Überschrift, ihre zugeordneten Kategorien (weiterhin je eine eigene `CategoryRow`,
  Umbenennen/Löschen/Zuordnen bleiben pro Zeile funktionsfähig) darunter, alphabetisch wie
  bisher.
- Ein Abschnitt "Ohne Oberkategorie" am Ende enthält alle Kategorien ohne
  `parentCategoryId` — inklusive Kategorien, die selbst als Oberkategorie für andere
  dienen (sie sind erst durch ihre Kinder eine "Gruppe", nicht durch einen eigenen
  Parent-Eintrag).
- Eine Kategorie kann jederzeit über das Select einer Oberkategorie zugewiesen oder wieder
  auf "Keine" gesetzt werden; das hat keine Auswirkung auf bereits zugeordnete Buchungen.

## UI: Dashboard / Statistik

- `calculateCategoryBreakdown` (`src/lib/dashboard-stats.ts`) bleibt unverändert — einzige
  Quelle für die Pro-Kategorie-Aggregation.
- Neue Funktion `groupBreakdownByParent(points: CategoryBreakdownPoint[], categoriesById:
  Map<number, { name: string; parentCategoryId: number | null }>): CategoryBreakdownPoint[]`:
  reiner Nachbearbeitungsschritt, bucketet vorhandene `CategoryBreakdownPoint`s nach
  `parentCategoryId ?? categoryId`, summiert `amountCents`, berechnet `percentage` neu.
  Ungruppierte Kategorien (kein `parentCategoryId` gesetzt, und nicht selbst Parent) laufen
  unverändert als eigener Posten durch — identisch zum bisherigen Verhalten.
- `DashboardPage` (`src/app/(app)/page.tsx`) übergibt zusätzlich zur bestehenden
  `categoryBreakdown` die Parent-Zuordnung (aus den bereits geladenen `categoryRows`) an
  `CategoryPieChart` — keine zusätzliche DB-Abfrage.
- `CategoryPieChart` (`src/components/dashboard/category-pie-chart.tsx`) bekommt einen
  Zwei-Optionen-Umschalter ("Oberkategorie" / "Kategorie") über dem Chart, `useState`
  mit Default `'category'` (heutiges Verhalten unverändert). Die Auswahl bestimmt, welches
  der beiden vorab berechneten `CategoryBreakdownPoint[]`-Arrays Chart und Legende
  speisen — keine neue Interaktion auf den einzelnen Slices.
- Der Umschalter wird nur gerendert, wenn mindestens eine Kategorie ein `parentCategoryId`
  gesetzt hat (sonst sind beide Ansichten identisch und der Umschalter wäre nutzloses UI).
- Stil: bestehendes Dark-Mode-Design, IBM Plex Sans, wie überall sonst im Dashboard.

## Validierung

Neue Funktion `setCategoryParent(categoryId: number, parentId: number | null): Promise<void>`
in `src/app/(app)/actions/category-mutations.ts` (plus dünner `'use server'`-Wrapper mit
`requireSession()` + `revalidatePath('/categories')`/`revalidatePath('/')` in
`src/app/(app)/actions/categories.ts`, analog zu `renameCategory`/`deleteCategory`).
Wirft deutschsprachige Fehler (gleicher Stil wie bestehende Mutations) bei:

1. `parentId === categoryId` — Kategorie kann nicht ihre eigene Oberkategorie sein.
2. Die Zielkategorie (`parentId`) hat selbst bereits ein `parentCategoryId` gesetzt — würde
   Ebene 3 erzeugen.
3. `categoryId` wird aktuell von mindestens einer anderen Kategorie als Oberkategorie
   referenziert (`parentCategoryId === categoryId` bei irgendeiner anderen Kategorie) —
   würde Ebene 3 von unten erzeugen, wenn diese Kategorie selbst einen Parent bekäme.

`parentId === null` (Zuordnung entfernen) ist immer erlaubt, keine Guards nötig.

## Testing

- `dashboard-stats.test.ts`: neue Fälle für `groupBreakdownByParent` — mehrere
  Kinder werden zu einem Posten summiert; ungruppierte Kategorien bleiben einzeln;
  Prozentwerte summieren sich wieder auf ~100.
- Tests für die drei Guards in `setCategoryParent` (gleiche Teststruktur wie bestehende
  Tests für `renameCategory`/`deleteCategory`).
- Keine Änderungen an bestehenden Tests für Regel-/Override-Logik erwartet, da
  `category-resolution.ts` nicht angefasst wird.
