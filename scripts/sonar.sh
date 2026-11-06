#!/usr/bin/env bash
# Runs a repo's own scripts/sonar.sh — the local SonarCloud PR scan — from the
# monorepo root. Every option is passed through; see that script's --help.
#
# Usage: scripts/sonar.sh <repo> [options]
#   <repo>  frontend | management-fe | backend | management-be
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
(($#)) || { echo "usage: scripts/sonar.sh <frontend|management-fe|backend|management-be> [options]" >&2; exit 2; }
repo=$1
shift
script=$ROOT/lib/epr-register-enrol-${repo#epr-register-enrol-}/scripts/sonar.sh
[[ -x $script ]] || { echo "sonar: no $script — only repos CI scans with SonarCloud have one; if this one should, check out a newer main there" >&2; exit 2; }
exec "$script" "$@"
