# Dictionaries / const maps

## Prefer lookups over if/else or ternary chains

When branching on a union of known string values, use a `Record` dictionary instead of a chain of `if/else` or ternaries. TypeScript enforces that every member of the union has an entry — adding a new union member without updating the map is a compile error.

```tsx
// bad — ternary chain, easy to miss a case
const icon =
  source === "youtube" ? <YouTubeIcon /> :
  source === "bandcamp" ? <BandcampIcon /> :
  <GenericIcon />;

// good — exhaustive by construction
type Source = "youtube" | "bandcamp" | "generic";

const SOURCE_ICONS: Record<Source, React.ReactNode> = {
  youtube:  <YouTubeIcon />,
  bandcamp: <BandcampIcon />,
  generic:  <GenericIcon />,
};

// usage
{SOURCE_ICONS[source]}
```

The same applies to strings, numbers, or any other mapped output:

```ts
// good
const LABEL: Record<Status, string> = {
  pending: "Pending",
  done:    "Done",
  failed:  "Failed",
};
```

## `as const satisfies` for primitive-valued maps

When values are primitives (strings, numbers, booleans), prefer `as const satisfies` over an explicit annotation. This preserves narrow literal types while still validating the shape:

```ts
// bad — values widened to string, no narrow inference
const PHASE_ROUTES: Record<PhaseName, string> = { assessing: "assess", ... };

// good — values stay as literal types, shape still checked
const PHASE_ROUTES = {
  assessing: "assess",
  ...
} as const satisfies Record<PhaseName, string>;
```

For non-primitive values (JSX, objects, functions) use the explicit `Record<K, V>` annotation instead — `as const` adds no value there.
