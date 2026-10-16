#!/usr/bin/env bash
# One-time migration step, run AFTER Terraform has imported everything:
#   1. checks the live stack still matches infra/cloudformation.yaml
#   2. updates the stack to infra/cloudformation-retain.yaml (every resource set to Retain;
#      no resource properties change, so nothing in AWS is touched)
#   3. checks every resource is now marked Retain
#   4. deletes the old stack. Because of step 2, AWS keeps every resource - only
#      CloudFormation's record of them goes away. Terraform is then the only owner.
# Run by the "retire-cloudformation" step of .github/workflows/infra.yml (needs approval).
set -euo pipefail

STACK="${STACK:-cosmos-notebook}"
REGION="${AWS_REGION:-eu-west-2}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
LIVE="$(mktemp)"
trap 'rm -f "$LIVE"' EXIT

if ! aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" >/dev/null 2>&1; then
  echo "Stack $STACK no longer exists - nothing to retire."
  exit 0
fi

count_retain() { grep -c '^    DeletionPolicy: Retain' "$1" || true; }
count_resources() { grep -c '^    Type: AWS::' "$1" || true; }

aws cloudformation get-template --region "$REGION" --stack-name "$STACK" --template-stage Original \
  --query TemplateBody --output text >"$LIVE"

if [ "$(count_retain "$LIVE")" != "$(count_resources "$LIVE")" ]; then
  echo "1/4 Checking the live stack matches infra/cloudformation.yaml"
  if ! diff -q <(sed 's/[[:space:]]*$//' "$LIVE") <(sed 's/[[:space:]]*$//' "$ROOT/infra/cloudformation.yaml") >/dev/null; then
    echo "::error::The live stack's template differs from infra/cloudformation.yaml. Stopping so nothing unexpected changes:"
    diff <(sed 's/[[:space:]]*$//' "$LIVE") <(sed 's/[[:space:]]*$//' "$ROOT/infra/cloudformation.yaml") || true
    exit 1
  fi

  echo "2/4 Marking every resource Retain (no resources change)"
  aws cloudformation update-stack --region "$REGION" --stack-name "$STACK" \
    --template-body "file://$ROOT/infra/cloudformation-retain.yaml" \
    --capabilities CAPABILITY_IAM \
    --parameters ParameterKey=GitHubRepo,UsePreviousValue=true ParameterKey=GitHubBranch,UsePreviousValue=true \
                 ParameterKey=CreateGitHubOIDCProvider,UsePreviousValue=true \
                 ParameterKey=ApiRateLimit,UsePreviousValue=true ParameterKey=ApiBurstLimit,UsePreviousValue=true >/dev/null
  aws cloudformation wait stack-update-complete --region "$REGION" --stack-name "$STACK"
  aws cloudformation get-template --region "$REGION" --stack-name "$STACK" --template-stage Original \
    --query TemplateBody --output text >"$LIVE"
else
  echo "1-2/4 Stack already marks every resource Retain"
fi

echo "3/4 Checking every resource is kept on delete"
r=$(count_resources "$LIVE"); k=$(count_retain "$LIVE")
if [ "$r" = 0 ] || [ "$r" != "$k" ]; then
  echo "::error::Only $k of $r resources are set to Retain - not deleting the stack."
  exit 1
fi

echo "4/4 Deleting the old stack record ($r resources stay in AWS)"
aws cloudformation delete-stack --region "$REGION" --stack-name "$STACK"
aws cloudformation wait stack-delete-complete --region "$REGION" --stack-name "$STACK"
echo "CloudFormation stack $STACK retired. Terraform now owns everything."
