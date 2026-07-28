# St. Louis Archers Console Proof of Concept

This repository tests whether a Custom GPT can update shared franchise state and whether an open browser console can display that update without a manual refresh.

## Already configured

- `index.html` polls GitHub Issue #1 every second.
- `openapi.yaml` defines the read and write Custom GPT Actions.
- `gpt-instructions.txt` contains the temporary GPT instructions.
- `TEST_PLAN.md` contains the test procedure.
- Issue #1 stores the shared test state.

## Remaining manual steps

1. Enable GitHub Pages from **Settings → Pages → Deploy from a branch → main → /(root)**.
2. Create a fine-grained personal access token limited to this repository with **Issues: Read and write** and **Metadata: Read**.
3. Create a temporary Custom GPT.
4. Paste `gpt-instructions.txt` into its instructions.
5. Add an Action using `openapi.yaml` and configure bearer-token authentication.
6. Open the GitHub Pages site and run the commands in `TEST_PLAN.md`.

Do not place the token in this repository or inside `index.html`.
