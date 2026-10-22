# Bundled Viewer catalogs

`manifest.json` enrolls the catalogs that `meta.locale` selects automatically.
The renderer reads only the files listed there, relative to this installed
directory. It never scans this directory, the working directory, or anywhere
else for language files.

`en.json` is the canonical message set and the final fallback. This fork
bundles English only: any other well-formed `meta.locale` renders English
renderer-owned copy and reports an `i18n/locale-fallback` warning unless the
document supplies `meta.translations`.

Each message resolves as: valid `meta.translations` value → selected bundled
catalog → English. See [the authoring contract](../references/authoring-contract.md).

To enroll a language, add its complete catalog here and one manifest entry.
No renderer or schema change is needed. Locale tags match case-insensitively;
region and script variants are distinct tags and are never collapsed onto
another catalog. A catalog is validated against `en.json` per key: a missing,
unknown, or placeholder-mismatched entry falls back to English and is reported
when that locale is rendered.

| Locale | Origin | Review status |
| --- | --- | --- |
| `en` | Archify source strings | Canonical |
