# Barebones reader

Run `npm install`, then `npm run dev`. Run `npm test` and `npm run build` for checks.

This A4 prototype uses Preact, Vite 5 and strict TypeScript. It deliberately has no decorative theme. Buttons remain semantic buttons styled as text.

The catalog loads `public/catalog.json`; the checked-in snapshot is empty because content fixtures have not landed on main. Replace it with the real snapshot when available. Search and country/scope filters work on approved and flagged books. Metadata is rendered as text.

Upload currently validates PDF magic and size locally. It does not send files. SDK downloads, submission, wallet actions and curator queue are explicitly marked as not connected. No shared SDK interfaces are created or edited.
