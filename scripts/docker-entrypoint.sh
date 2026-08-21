#!/bin/sh
# Runs as root (see Dockerfile: no USER before ENTRYPOINT). Bind-mounting a
# host directory over /app/data replaces whatever ownership the image set up
# at build time — on a fresh host, Docker auto-creates that directory as
# root, which the non-root app user can't write into. Fix it up here, once,
# on every boot, then drop to the unprivileged user for the real process.
set -e

chown -R nextjs:nodejs /app/data

exec su-exec nextjs "$@"
