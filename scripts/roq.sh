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
# Runs in python because doing this in bash means hand-rolling a string and
# comment stripper, and getting that subtly wrong is how a guard becomes
# decorative.
GUARD_OUT="$(printf '%s' "$SQL" | python3 -c '
import re, sys

sql = sys.stdin.read()
s = sql

# Strip, in order: block comments, line comments, dollar-quoted bodies,
# single-quoted literals, double-quoted identifiers. Everything that could
# legitimately CONTAIN a semicolon or a scary keyword is removed first, so
# the checks below only ever look at real SQL tokens.
s = re.sub(r"/\*.*?\*/", " ", s, flags=re.S)
s = re.sub(r"--[^\n]*", " ", s)
s = re.sub(r"\$([A-Za-z_]*)\$.*?\$\1\$", " {} ", s, flags=re.S)
s = re.sub(r"'"'"'(?:[^'"'"']|'"'"''"'"')*'"'"'", " {} ", s)
s = re.sub(r'"'"'"(?:[^"]|"")*"'"'"', " ident ", s)

s = s.strip().rstrip(";").strip()

def fail(msg):
    print("REFUSED: " + msg)
    sys.exit(0)

if not s:
    fail("empty statement")

if ";" in s:
    fail("multiple statements are not allowed (found a ; between statements)")

if not re.match(r"^(select|with|table|values|explain|show)\b", s, re.I):
    fail("must begin with SELECT / WITH / TABLE / VALUES / EXPLAIN / SHOW")

# Write keywords anywhere in the statement. Catches data-modifying CTEs,
# which is the case a "starts with SELECT" check misses entirely.
WRITE = (r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|"
         r"copy|call|do|vacuum|analyze|reindex|refresh|cluster|lock|comment|"
         r"set|reset|begin|start|commit|rollback|savepoint|prepare|deallocate|"
         r"discard|listen|notify|unlisten|import|security)\b")
m = re.search(WRITE, s, re.I)
if m:
    fail("statement contains a write/session keyword: " + m.group(0).upper())

# Functions that read the filesystem, execute programs, or disrupt the
# server. A read-only transaction stops the writes but not all of these.
DANGER = (r"\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|"
          r"lo_import|lo_export|dblink|pg_terminate_backend|pg_cancel_backend|"
          r"pg_sleep|pg_reload_conf|set_config|pg_logical_emit_message)\b")
m = re.search(DANGER, s, re.I)
if m:
    fail("statement calls a restricted function: " + m.group(0))

print("OK")
')"

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
