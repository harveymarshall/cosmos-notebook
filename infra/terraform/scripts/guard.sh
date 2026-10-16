#!/usr/bin/env bash
# Stops Terraform from creating a second copy of the live site. If the state is empty and
# there are no import blocks, a plan would "create" every resource from scratch - which for
# this site means a new member pool, a new database and a new web address. Only a brand-new
# install should ever do that, and it has to say so with ALLOW_FRESH_INSTALL=true.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "$(terraform state list 2>/dev/null || true)" ] && [ ! -f imports.tf ] && [ "${ALLOW_FRESH_INSTALL:-}" != "true" ]; then
  echo "::error::Terraform state is empty and there is no imports.tf. Run the 'discover' step first so Terraform adopts the live resources (see infra/README.md)."
  exit 1
fi
