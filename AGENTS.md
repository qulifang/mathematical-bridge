# Project editing rules

- Preserve the approved public layout unless the user requests visual changes.
- Daily content belongs in content/catalog.json and media/. Use the local maintenance interface.
- Keep entry IDs, session IDs and original board numbers stable.
- Treat the catalog as authoritative. Parsed boards and release ZIPs are generated outputs.
- Commit the maintainable source to the same repository. Publish only the site built by tools/project.py via GitHub Actions.
- Name work branches `type/YYYY-MM-DD-description`. Use one of `content`, `bugfix`, `feature`, `docs`, or `chore`, the branch creation date, and a short lowercase kebab-case description. See `docs/GitHub协作与发布.md`.
- Keep credentials, private originals, local backups and generated deployment files out of commits.
- Retain server-side revision checks and localhost/origin restrictions.
- Online administration requires authenticated server APIs and storage.
- Verify actual downloads and affected maintenance workflows after changing code.
- Python 3.10+ standard library is the supported maintenance runtime.
