# FuBot disaster backup and restore

The generated archive is self-contained and includes the current application source,
the verified SQLite database, uploads, knowledge documents, WhatsApp authentication
profiles, and environment files. Treat it like a password: it contains secrets.

## Create and upload

```bash
npm run backup
```

Upload both the newest `futhing-*.tar.gz` and its matching `.sha256` file from
`backend/data/backups/production/` to private storage. Never publish the archive or
commit it to Git.

## Restore after losing the server

Install Node.js 20+ and `tar`, download the two files, then verify and extract:

```bash
sha256sum -c futhing-YYYYMMDDTHHMMSSZ.tar.gz.sha256
tar -xzf futhing-YYYYMMDDTHHMMSSZ.tar.gz
mkdir bootstrap
tar -xzf futhing-YYYYMMDDTHHMMSSZ/application.tar.gz -C bootstrap
node bootstrap/backend/scripts/restore-production-backup.js "$PWD/futhing-YYYYMMDDTHHMMSSZ" --target=/opt/fubot
cd /opt/fubot
npm ci
npm start
```

The example above assumes the archive was extracted into a directory containing the
backup. The restore target must be empty, which prevents accidental overwrites.

If `manifest.json` says `qdrant.rebuildRequired: true`, start Qdrant and re-index the
knowledge documents from the dashboard. The original documents and their SQLite
metadata are preserved. If a Qdrant snapshot file is present, restore that snapshot
before starting normal traffic.

For the most reliable WhatsApp profile copy, briefly stop the app before a manual
backup. A live backup still excludes Chromium's transient lock files and is restorable,
but WhatsApp may occasionally request a new QR login after a host/browser-version change.
