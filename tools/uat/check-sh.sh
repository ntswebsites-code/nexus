#!/usr/bin/env bash
# Syntax-checks the host scripts and confirms LF line endings: bash tools/uat/check-sh.sh
set -u
cd "$(dirname "$0")/../.."
rc=0
for f in deploy/*.sh tools/uat/*.sh; do
  if bash -n "$f"; then echo "syntax ok   $f"; else echo "SYNTAX FAIL $f"; rc=1; fi
  if grep -q $'\r' "$f"; then echo "CRLF FOUND  $f"; rc=1; fi
done
exit $rc
