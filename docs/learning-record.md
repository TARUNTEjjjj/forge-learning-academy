# Learning record format and restore rules

**Export my learning record** (My progress) downloads `forge-progress.json`.
**Restore a learning record** loads one back into the current browser. The code
is `lib/learning-record.ts`; the tests are `tests/learning-record.test.mjs`.

## Format version 1

```json
{
  "format": "forge-learning-record",
  "formatVersion": 1,
  "exportedAt": "2026-11-19T10:00:00.000Z",
  "profile": { "name": "", "weeklyHours": 20, "language": "python" },
  "modules": { "<module id>": { "complete": true, "evidence": "", "updatedAt": "<ISO time>" } },
  "sessions": [{ "id": "<UUID>", "minutes": 25, "note": "", "createdAt": "<ISO time>" }],
  "projects": [{ "id": "<id>", "title": "", "description": "", "code": "", "repoUrl": "", "status": "draft", "updatedAt": "<ISO time>", "files": [], "templateId": "study-tracker" }],
  "attempts": [{ "id": "<UUID>", "missionId": "<mission id>", "passed": 3, "total": 3, "category": "success", "createdAt": "<ISO time>", "source": "browser-self-report" }],
  "practiceLab": { "completed": ["<mission id>"], "drafts": { "<mission id>": "<Python code>" } }
}
```

The five sections from `profile` to `attempts` are exactly the record the
browser saves, with the same limits (`lib/progress.ts`). `files` and
`templateId` appear only on projects that have them. `practiceLab.drafts` holds
Python lab code that differs from a mission's starter, up to 30,000 characters
per mission.

Unversioned files from earlier releases are also read:

| Exported | Shape | Restored |
| --- | --- | --- |
| 30 Oct – 15 Nov 2026 | `exportedAt` and the five sections | Everything except the Python lab, which is left as it is |
| 15 Nov 2026 until this format | as above, plus `practiceLab` | Everything |

A `formatVersion` above 1 is refused with a request to reload Forge, so an older
tab never misreads a newer file.

## Not in a learning record

- **Project ZIP downloads.** A ZIP cannot be loaded. The record holds the last
  version of each project *saved in this browser* (title, description, status,
  repository URL and all files), which is what a ZIP of a saved project contains.
- **Project edits never saved in the browser** (the editor's recovery drafts).
  Download a ZIP or save the project before exporting.
- **The optional CI starter** (`.github/workflows/test.yml`), which exists only
  in the "ZIP with optional CI starter" download.
- The Git playground, the resource library's offline copy, timers in progress,
  and anything in another browser or on GitHub.

## Checks before anything is written

The file is refused, with nothing changed, when it is larger than 5 MB, is not
UTF-8 JSON, has an unknown `format` or version, has fields Forge does not
write, misses a section, or breaks a rule a save would enforce: session and
practice-result IDs must be unique UUIDs, project IDs unique safe identifiers,
project paths safe, timestamps valid, text trimmed and within limits, practice
results recorded by this browser, Python lab missions known to this version,
and the whole record within the 1,500,000-byte browser workspace.

## Merge and replace

The preview shows what each choice adds, updates and removes before you
confirm. Nothing is removed silently.

- **Merge** keeps everything in this browser. It adds modules, sessions,
  projects and practice results the file has; where both have the same module
  or project, the copy with the later `updatedAt` is kept (this browser's on a
  tie). The profile comes from the file only while this browser's is untouched.
  Python drafts are written only for missions with no draft here, and completed
  missions are combined. Practice results keep the latest 500, as every save
  does; the preview says how many older results that drops. A merge that would
  exceed 20 projects, 200 modules, 5,000 sessions or the record size is refused,
  and the preview suggests replace.

  "Later" means the date the saving device's clock gave. When devices' clocks
  disagree, an older edit can carry the later date. So whenever a restore
  overwrites this browser's copy of a module note or project, or drops older
  practice results, the preview names what it overwrites and asks you to
  download your current record first. It also says when any of those file
  copies is dated later than this device's clock, which usually means the
  exporting device's clock was ahead.
- **Replace** makes this browser match the file. Anything here that is not in
  the file is removed, including Python drafts the file does not have. The
  preview offers **Download current record first**.

## Saving and failure behaviour

A restore is one locked save through the same path as every other progress
change (`lib/browser-progress.ts`): it waits for earlier saves in the tab, is
applied only at the revision its preview showed, and commits the record,
revision and retry receipt in a single storage write. If another tab saved in
between, nothing is written and the preview refreshes. A retried restore with
the same operation ID is answered from its receipt instead of being applied
twice. Full, blocked or unconfirmed storage leaves the saved record as it was.

The Python lab is stored separately, so it is written after the record is
saved. Drafts are written first; if the browser refuses any write, the drafts
already written are put back as they were, nothing in the lab is removed and
completed missions are not changed, and the restore panel says so until you
choose another file.
Restoring the same file again with the same choice, after freeing storage,
completes it.
