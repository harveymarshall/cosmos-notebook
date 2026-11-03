#!/usr/bin/env bash
# Stops Terraform from creating a second copy of the live site. If the state is empty, a plan
# would "create" every resource from scratch - which for this site means a new member pool,
# a new database and a new web address. Only a brand-new install should ever do that, and it
# has to say so with ALLOW_FRESH_INSTALL=true.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "$(terraform state list 2>/dev/null || true)" ] && [ "${ALLOW_FRESH_INSTALL:-}" != "true" ]; then
  echo "::error::Terraform state is empty. The live site's state lives in TF_STATE_BUCKET - check the backend settings in deploy.env. For a brand-new copy of the site, set the repository variable ALLOW_FRESH_INSTALL=true (see infra/README.md)."
  exit 1
fi
