/**
 * Shared between the `setCategoryParent` guard error (`category-mutations.ts`) and the
 * `/categories` UI tooltip (`category-row.tsx`) explaining why a category that already has
 * children can't itself be given an Oberkategorie — keeps the two wordings from drifting.
 */
export const CATEGORY_HAS_CHILDREN_MESSAGE =
  'Diese Kategorie ist selbst Oberkategorie anderer Kategorien und kann keine eigene Oberkategorie erhalten.';
