# Jupiter fluid: practice

Rebuilding the fluid hero of thesunwilldie.com from a blank page, writing the code myself, with Claude Code as a teacher.

## Starting a session

1. Open this folder in VS Code.
2. Start Claude Code in it. It reads `CLAUDE.md` (how to teach) and `PROGRESS.md` (where I stopped) by itself.
3. Say "let's continue" (or "let's start" the first time).

## Running the pages

```sh
python3 -m http.server 8000
```

Run it in this folder, then open:

- <http://localhost:8000/reference/>: the finished version
- <http://localhost:8000/my-hero/>: mine

Stop the server with Ctrl+C.

## What is where

| | |
| --- | --- |
| `ROADMAP.md` | the lesson plan, stages 0–6 |
| `PROGRESS.md` | where I am, and a log of sessions |
| `reference/` | the finished hero, copied from the site. Not to be edited. |
| `my-hero/` | my version (created in step 1.1) |
| `assets/jupiter/` | the photo |
| `notes/` | how the fluid works, with the maths |
