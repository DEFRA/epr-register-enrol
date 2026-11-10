# OJ vs CM parity: run book

Compares every application submitted from OJ to CM. The only step that touches the live databases is the dump (step 1),
run in the CDP shell with a read-only user against a secondary. Everything after that runs against the archives restored
into a throwaway MongoDB. The [README](README.md) explains what is compared and how to read the report.

> **Production data: perform every operation in this run book within CDP.** Run the dump (step 1) in the CDP shell.
> Run restore, snapshot, compare and clean-up (steps 2 to 5) on a **Defra Virtual Desktop (DVD)**. Never move
> production archives, snapshots or reports to a personal or local machine. The only exception is sharing the report
> under the "Sharing the report" rule below. A local machine may be used for steps 2 to 5 with non-production data only.

You need Docker, `mongosh`, `openssl` (included with Git for Windows) and Node 18+ wherever steps 2 to 5 run. It has not
yet been confirmed that a Defra Virtual Desktop provides all four (Docker in particular); check before you take the dump,
and ask the platform team if any is missing. If `scripts/src/` has changed, run `node scripts/build.mjs` in the scripts
folder first.

## Handling rules (production data)

These files contain names, emails, phone numbers and addresses from production. Throughout:

- **Production data stays within CDP:** the CDP shell for the dump, then a Defra Virtual Desktop for everything else.
- **Work outside the repository and outside any synced folder** (for example `C:\secure\parity-<date>` on the Defra
  Virtual Desktop, or on a BitLocker-encrypted disk for non-production data). Never keep archives, snapshots or reports
  inside the git workspace. `diagnostics/.gitignore` and the Claude Code deny rules are a backstop only: the deny rules
  stop Claude Code's Read tool, not a shell command such as `cat`, so they do not make the files unreadable.
- **Do not paste output, files or screenshots into AI tools or chat.** Describe a problem instead.
- **Retention:** delete the archives, snapshots and reports once the report is signed off, and no later than 14 days
  after the dump (use a shorter limit if your data owner sets one). Record the deletion in one line:
  `deleted <files> on <date> by <name>`.
- **Sharing the report:** use only the channel approved by the data owner, to a named recipient list. The shared
  output is `parity-summary.pdf`, `parity-report.csv` and `parity-report-detailed.csv`. Emails are masked in the reports, but names, phone numbers and addresses are not.

## 1. Dump (in CDP)

Use a **read-only** database user, and run off-peak. Run each command in the shell for that service, where `MONGO_URI`
points at its database. Dump only the one collection each, from a secondary, then encrypt:

```bash
mongodump --uri=${MONGO_URI} --db=<oj database> --collection=accreditationApplications --readPreference=secondary --gzip --archive=oj.backup.archive   # OJ
mongodump --uri=${MONGO_URI} --db=<cm database> --collection=workItems --readPreference=secondary --gzip --archive=cm.backup.archive                   # CM

openssl enc -aes-256-cbc -pbkdf2 -salt -in oj.backup.archive -out oj.backup.archive.enc   # prompts for a passphrase
openssl enc -aes-256-cbc -pbkdf2 -salt -in cm.backup.archive -out cm.backup.archive.enc
rm oj.backup.archive cm.backup.archive
```

- Do not print or paste `MONGO_URI`; it contains credentials.
- Take both dumps close together and note when. Check the names are not swapped.
- Move only the `.enc` files, by the route your platform team approves, then **delete them from the CDP shell**. For
  production data the destination must be a Defra Virtual Desktop. For non-production data it may be a local machine.
- Send the passphrase by a different channel from the files.

## 2. Restore (Defra Virtual Desktop; local for non-production data only)

Work in your secure folder. Decrypt, then restore into a scratch instance that only listens on localhost and keeps its
data in memory (`--tmpfs`), so nothing is written to disk. `mongorestore` is not part of mongosh, so run it in the
container, which includes it:

```powershell
openssl enc -d -aes-256-cbc -pbkdf2 -in oj.backup.archive.enc -out oj.backup.archive
openssl enc -d -aes-256-cbc -pbkdf2 -in cm.backup.archive.enc -out cm.backup.archive

docker run -d --name parity-scratch --tmpfs /data/db -p 127.0.0.1:27018:27017 mongo:7
docker cp oj.backup.archive parity-scratch:/tmp/oj.backup.archive
docker cp cm.backup.archive parity-scratch:/tmp/cm.backup.archive
docker exec parity-scratch mongorestore --gzip --archive=/tmp/oj.backup.archive --nsInclude="<oj database>.accreditationApplications"
docker exec parity-scratch mongorestore --gzip --archive=/tmp/cm.backup.archive --nsInclude="<cm database>.workItems"
```

Check the databases arrived (names differ by environment):

```powershell
mongosh "mongodb://localhost:27018" --quiet --eval "db.adminCommand({listDatabases:1}).databases.forEach(d => print(d.name)); undefined"
```

If one is missing, the dump user could not read it. Ask for a dump from a user who can.

## 3. Snapshot (Defra Virtual Desktop; local for non-production data only)

Set `$S` to the `diagnostics/data-parity/scripts` folder of your repository checkout. Optional window: `PARITY_START` is
inclusive, `PARITY_END` is exclusive, ISO-8601 (UTC if no offset). Use the same window for both runs. To include all of
5 November, end at `2026-11-06T00:00:00Z`. Omit `--eval` to cover every submitted application. Always end the `--eval`
string with `; undefined`.

PowerShell:

```powershell
$S = "<path to>\diagnostics\data-parity\scripts"
$W = "PARITY_START='2026-09-01T00:00:00Z'; PARITY_END='2026-11-06T00:00:00Z'; undefined"
mongosh "mongodb://localhost:27018/<oj database>" --quiet --eval $W --file "$S\oj-snapshot.js" | Out-File -Encoding utf8 oj.jsonl
mongosh "mongodb://localhost:27018/<cm database>" --quiet --eval $W --file "$S\cm-snapshot.js" | Out-File -Encoding utf8 cm.jsonl
```

Bash:

```bash
S=<path to>/diagnostics/data-parity/scripts
W="PARITY_START='2026-09-01T00:00:00Z'; PARITY_END='2026-11-06T00:00:00Z'; undefined"
mongosh "mongodb://localhost:27018/<oj database>" --quiet --eval "$W" --file "$S/oj-snapshot.js" > oj.jsonl
mongosh "mongodb://localhost:27018/<cm database>" --quiet --eval "$W" --file "$S/cm-snapshot.js" > cm.jsonl
```

The snapshot time in each file is when the script ran, not when the dump was taken, so the report's snapshot gap reads
near zero. If the dumps were taken far apart, treat `oj-edit-not-resubmitted` and `oj-post-decision-edit` rows with care.

## 4. Compare (Defra Virtual Desktop; local for non-production data only)

```bash
node "$S/compare.mjs" oj.jsonl cm.jsonl --out ./out
```

OJ file first, then CM. Without `--out` the reports go to `./out`. Add `--differences-only` to omit matched applications.

`--include-pii` writes unmasked values and `parity-report.json`. It is refused unless you name the approver:
`--include-pii --approved-by "<approver and ticket>"`. The approver is recorded in the summary. Use it only for a
controlled follow-up and delete the output as soon as it is done.

The compare refuses a file with a missing or mismatched trailer count, the wrong service or an unsupported script
version, and warns if the two files used different windows. Outputs in `./out`:

- `parity-summary.pdf`: counts, window, warnings; applications by OJ status (count and %); applications
  with differences counted by section, and by section and issue; top differing applications with a one-line
  summary of where their differences are (A4, written by `scripts/pdf.mjs` with no
  dependencies). Row breakdowns each total the quoted number of difference rows, including list items present on one
  side only (`ITEM_MISSING_CM` / `ITEM_MISSING_OJ`), so a swapped file or site is counted even when the list sizes match.
- `parity-report.csv`: one row per application; the `issues` cell lists everything that differs.
- `parity-report-detailed.csv`: one row per difference, for filtering and pivoting.

## 5. Clean up (on the machine where steps 2 to 4 ran)

```powershell
docker rm -fv parity-scratch
```

`-v` also removes the container's volume. Then delete the `.archive`, `.enc` and `.jsonl` files and the `out` folder
(or keep only what is needed until sign-off, within the retention limit above), and record the deletion.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `mongodump` says `unknown option nsInclude` | `nsInclude` belongs to `mongorestore`. Dump with `--db` and `--collection`. |
| `mongorestore` is not recognized | Run it inside the container as in step 2, or install the MongoDB Database Tools. |
| `openssl` is not recognized (PowerShell) | Use Git Bash, or add `C:\Program Files\Git\usr\bin` to the PATH. |
| `bad decrypt` | Wrong passphrase, or the file was changed in transfer. |
| `The term 'W=PARITY_START=...' is not recognized` | Bash syntax in PowerShell. Use `$W = "..."` and `--eval $W`. |
| `Invalid left-hand side expression` or `X is not defined` in mongosh | A shell command was typed inside mongosh. Run `exit` first. |
| `line 1 is not valid JSON` | Extra text in the file. Re-run with `--quiet` and `; undefined` after `--eval`. |
| Trailer missing or count mismatch | Output was cut short. Re-run the snapshot. |
| `--include-pii ... needs --approved-by` | Add `--approved-by "<approver and ticket>"`. |
| `EBUSY` writing the report | A report file is open in Excel. Close it or use another `--out`. |
| Windows differ warning | The files used different windows. Re-run with the same values. |
| Everything `MISSING_IN_OJ` or `MISSING_IN_CM` | Wrong database name, an empty restore, or a window that excludes one side. Check step 2 and the window. |
