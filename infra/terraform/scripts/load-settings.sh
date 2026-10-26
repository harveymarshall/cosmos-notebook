#!/usr/bin/env bash
# Reads the Terraform settings from deploy.env (not secrets) into the GitHub Actions job.
# Prints ready=true when everything is set. Before infra/bootstrap/bootstrap.sh has been run
# the settings are missing, and AWS steps are skipped (or, with --require, the job fails).
set -euo pipefail
cd "$(dirname "$0")/../../.."
[ -f deploy.env ] && set -a && . ./deploy.env && set +a
ready=true
for k in AWS_REGION TF_STATE_BUCKET TF_PLAN_ROLE_ARN TF_APPLY_ROLE_ARN; do
  if [ -z "${!k:-}" ]; then
    ready=false
    echo "::notice::$k is not set in deploy.env yet - run infra/bootstrap/bootstrap.sh first (see infra/README.md)."
  else
    echo "$k=${!k}" >>"${GITHUB_ENV:-/dev/null}"
  fi
done
echo "ready=$ready" >>"${GITHUB_OUTPUT:-/dev/null}"
if [ "$ready" != true ] && [ "${1:-}" = "--require" ]; then exit 1; fi
