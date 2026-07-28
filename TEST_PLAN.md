# Archers Console Proof-of-Concept Test

This test measures three things:

1. Whether ChatGPT asks for approval before a custom Action runs.
2. How long the Action takes to read and write shared state.
3. How quickly the open console changes without a manual refresh.

## One-time setup

1. Create a public GitHub repository named `archers-console-test`.
2. Create Issue #1 with the title `Archers Console Test State`.
3. Paste the contents of `initial-issue-body.json` into the issue body.
4. Enable GitHub Pages from the repository's main branch and root folder.
5. Upload `index.html` to the repository root.
6. Create a fine-grained GitHub personal access token restricted to this repository with:
   - Issues: Read and write
   - Metadata: Read
7. Create a custom GPT in ChatGPT on the web.
8. Add the text from `gpt-instructions.txt` to its instructions.
9. Add a new Action and paste `openapi.yaml`.
10. Configure Action authentication as API Key:
    - Type: Bearer
    - Secret: your fine-grained GitHub token
11. Open the GitHub Pages console in another tab.
12. In the GPT Preview, say: `Read the current test state.`
13. Then say: `Send test update: ARCHERS SYNC TEST ONE`.

## Timing

Start a stopwatch when you submit the update message.

Record:
- Time until ChatGPT asks for approval, if it does.
- Time until ChatGPT confirms the write.
- Time until the console visibly changes.

Because the console polls once per second, console delay after GitHub accepts the write should usually be 0–1 second.

## Pass criteria

The proof of concept passes when:
- The GPT can read Issue #1.
- The GPT can update Issue #1.
- The console changes without refreshing.
- Approval behavior is acceptable.
- Total delay feels tolerable.

## Security note

Use a fine-grained token limited only to the test repository. Delete the token after the experiment if the system is not adopted.
