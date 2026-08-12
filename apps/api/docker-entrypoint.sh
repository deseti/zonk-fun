#!/bin/sh
set -eu

mkdir -p /data/zonk-objects
chown -R nobody:nobody /data/zonk-objects
exec su-exec nobody "$@"
