#!/usr/bin/env bash
# roq.sh — Read-Only Query against the linked Supabase project.
#
# Exists so an agent can read production without being able to write it.
# `supabase db query --linked` can run ANY SQL; this wraps it so it cannot.
#
# TWO LAYERS, and only one of them is a real control:
#
#   1. A syntactic guard (below). Useful for catching mistakes and giving a
#      clear error, but it is NOT the security boundary. Postgres allows
#      data-modifying CTEs -- `WITH x AS (DELETE FROM t RETURNING *) SELECT
#      * FROM x` is a statement that starts with WITH and deletes rows --
#      and `SELECT my_function()` can write anything the function can.
#      Any keyword-matching guard is defeatable by someone who wants to.
#
#   2. SET TRANSACTION READ ONLY. This is the real control, and it is
#      enforced by the server, not by this script. Postgres refuses
#      INSERT/UPDATE/DELETE/DDL inside a read-only transaction, including
#      inside CTEs and inside functions, no matter how they are spelled.
#      The trailing ROLLBACK is belt-and-braces on top of that.
#
# Layer 1 exists to fail fast with a readable message. Layer 2 is why this
# script can be trusted.
#
# Usage:
#   ./scripts/roq.sh "SELECT count(*) FROM public.users"
#   ./scripts/roq.sh -f query.sql
#   echo "SELECT 1" | ./scripts/roq.sh
#   ./scripts/roq.sh -o json "SELECT ..."     # table (default) | json | csv

set -euo pipefail

PROJECT_DIR="${AIOMNI_DIR:-$HOME/AIOmni}"
FORMAT="table"
SQL=""
SQL_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--file)   SQL_FILE="$2"; shift 2 ;;
    -o|--output) FORMAT="$2";   shift 2 ;;
    -h|--help)   sed -n '2,30p' "$0"; exit 0 ;;
    *)           SQL="$1";      shift ;;
  esac
done

if [[ -n "$SQL_FILE" ]]; then
  [[ -r "$SQL_FILE" ]] || { echo "roq: cannot read $SQL_FILE" >&2; exit 1; }
  SQL="$(cat "$SQL_FILE")"
elif [[ -z "$SQL" ]]; then
  # No SQL argument and no file: read stdin, but only if it is piped.
  if [[ ! -t 0 ]]; then SQL="$(cat)"; fi
fi

[[ -n "${SQL// /}" ]] || { echo "roq: no SQL given" >&2; exit 1; }

# ── Layer 1: syntactic guard ──────────────────────────────────────────
# Lives in scripts/roq_guard.js rather than inline bash, because hand-rolling
# a string and comment stripper in shell is how a guard becomes decorative.
# It ran in python until an Xcode CLT update on 2026-09-15 made
# /usr/bin/python3 refuse to run and took this path down mid-incident; there
# is no other python on this machine. Ported to node, logic unchanged.
GUARD_OUT="$(printf '%s' "$SQL" | node "$(dirname "$0")/roq_guard.js")"
if [[ "$GUARD_OUT" != "OK" ]]; then
  echo "roq: $GUARD_OUT" >&2
  exit 2
fi

# ── Layer 2: server-enforced read-only transaction ────────────────────
WRAPPED="$(mktemp -t roq)"
trap 'rm -f "$WRAPPED"' EXIT
{
  echo "BEGIN;"
  echo "SET TRANSACTION READ ONLY;"
  printf '%s' "$SQL"
  # The caller's SQL may or may not end in a semicolon; add one either way.
  echo ";"
  echo "ROLLBACK;"
} > "$WRAPPED"

cd "$PROJECT_DIR"
exec supabase db query --linked -f "$WRAPPED" -o "$FORMAT"
