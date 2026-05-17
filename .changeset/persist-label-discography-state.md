---
"@trackdigger/web": patch
---

Persist label/discography page state (search input + selected entity) across route navigation. Previously, typing a label, switching to discography, then returning landed on an empty input — local `useState` in `useEntitySearch` reset when the page unmounted. Hoisted `query` and `selectedItem` into the existing `labelsAtom` / `discographyAtom` (Jotai), which live above the route boundary and survive navigation.
