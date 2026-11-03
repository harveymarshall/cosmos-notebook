#!/usr/bin/env bash
# ONE-TIME setup for Terraform, run by the AWS account owner in AWS CloudShell (eu-west-2):
#
#   git clone https://github.com/harveymarshall/cosmos-notebook && bash cosmos-notebook/infra/bootstrap/bootstrap.sh
#
# Creates the few things Terraform can't safely create for itself:
#   1. tf-<project>-state-<account>   private, versioned S3 bucket holding Terraform state
#   2. tf-<project>-boundary          permissions boundary: the most any role Terraform
#                                     manages can ever be allowed to do (no IAM, no deleting
#                                     the member pool or the database)
#   3. tf-<project>-plan              read-only role for GitHub Actions to show plans on pull
#                                     requests (cannot read member data)
#   4. tf-<project>-apply             role for GitHub Actions to apply changes, only from the
#                                     "production" environment (which needs your approval)
#
# Safe to run again: it updates everything in place. Costs pennies (a tiny S3 bucket).
set -euo pipefail

PROJECT="${PROJECT:-cosmos-notebook}"
REPO="${REPO:-harveymarshall/cosmos-notebook}"
REGION="${AWS_REGION:-eu-west-2}"
STACK="${STACK:-cosmos-notebook}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
OWNER="${REPO%%/*}"
NAME="${REPO##*/}"
STATE_BUCKET="tf-${PROJECT}-state-${ACCOUNT}"
BOUNDARY_ARN="arn:aws:iam::${ACCOUNT}:policy/tf-${PROJECT}-boundary"
OIDC_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say() { printf '\n== %s\n' "$*"; }

# ------------------------------------------------------------------ 1. state bucket
say "State bucket $STATE_BUCKET"
if ! aws s3api head-bucket --bucket "$STATE_BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
fi
aws s3api put-public-access-block --bucket "$STATE_BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$STATE_BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"old-state-versions","Status":"Enabled","Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":90}}]}'
cat >"$TMP/state-policy.json" <<EOF
{"Version":"2012-10-17","Statement":[{"Sid":"HttpsOnly","Effect":"Deny","Principal":"*","Action":"s3:*",
 "Resource":["arn:aws:s3:::$STATE_BUCKET","arn:aws:s3:::$STATE_BUCKET/*"],
 "Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}
EOF
aws s3api put-bucket-policy --bucket "$STATE_BUCKET" --policy "file://$TMP/state-policy.json"

# ------------------------------------------------------------------ GitHub identity provider
say "GitHub identity provider"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
fi

# ------------------------------------------------------------------ 2. permissions boundary
say "Permissions boundary tf-${PROJECT}-boundary"
cat >"$TMP/boundary.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AppServices",
      "Effect": "Allow",
      "Action": ["dynamodb:*", "logs:*", "cognito-idp:*", "s3:*", "cloudfront:*", "lambda:*",
                 "ses:*", "sns:*", "scheduler:*", "events:*", "xray:*", "cloudwatch:*"],
      "Resource": "*"
    },
    {
      "Sid": "NeverIamOrAccount",
      "Effect": "Deny",
      "Action": ["iam:*", "organizations:*", "account:*", "sts:AssumeRole"],
      "Resource": "*"
    },
    {
      "Sid": "NeverDeleteMembersOrData",
      "Effect": "Deny",
      "Action": ["cognito-idp:DeleteUserPool", "dynamodb:DeleteTable", "s3:DeleteBucket"],
      "Resource": "*"
    }
  ]
}
EOF
if aws iam get-policy --policy-arn "$BOUNDARY_ARN" >/dev/null 2>&1; then
  # Keep within IAM's limit of 5 versions: drop the oldest non-default version first
  old=$(aws iam list-policy-versions --policy-arn "$BOUNDARY_ARN" \
    --query 'Versions[?IsDefaultVersion==`false`].VersionId' --output text | tr '\t' '\n' | sort -V | head -1)
  count=$(aws iam list-policy-versions --policy-arn "$BOUNDARY_ARN" --query 'length(Versions)' --output text)
  if [ "$count" -ge 5 ] && [ -n "$old" ]; then aws iam delete-policy-version --policy-arn "$BOUNDARY_ARN" --version-id "$old"; fi
  aws iam create-policy-version --policy-arn "$BOUNDARY_ARN" --policy-document "file://$TMP/boundary.json" --set-as-default >/dev/null
else
  aws iam create-policy --policy-name "tf-${PROJECT}-boundary" \
    --description "Ceiling for every role Terraform manages for ${PROJECT}" \
    --policy-document "file://$TMP/boundary.json" >/dev/null
fi

# ------------------------------------------------------------------ helper: trust policy + role
trust() { # $1 = list of GitHub "sub" endings, e.g. pull_request ref:refs/heads/main
  local subs="" s
  for s in "$@"; do
    subs="$subs\"repo:${REPO}:${s}\",\"repo:${OWNER}@*/${NAME}@*:${s}\","
  done
  cat <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Federated":"$OIDC_ARN"},
 "Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{"StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com"},
              "StringLike":{"token.actions.githubusercontent.com:sub":[${subs%,}]}}}]}
EOF
}
role() { # $1 = name, $2 = description, $3 = trust file
  if aws iam get-role --role-name "$1" >/dev/null 2>&1; then
    aws iam update-assume-role-policy --role-name "$1" --policy-document "file://$3"
  else
    aws iam create-role --role-name "$1" --description "$2" --max-session-duration 3600 \
      --assume-role-policy-document "file://$3" >/dev/null
  fi
}

# ------------------------------------------------------------------ 3. plan role (read-only)
say "Plan role tf-${PROJECT}-plan"
trust pull_request "ref:refs/heads/main" >"$TMP/plan-trust.json"
role "tf-${PROJECT}-plan" "Read-only: lets GitHub Actions show Terraform plans for ${PROJECT}" "$TMP/plan-trust.json"
aws iam attach-role-policy --role-name "tf-${PROJECT}-plan" --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
cat >"$TMP/plan-extra.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StateLockForPlans",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::${STATE_BUCKET}/*.tflock"
    },
    {
      "Sid": "NoMemberData",
      "Effect": "Deny",
      "Action": ["cognito-idp:ListUsers", "cognito-idp:ListUsersInGroup", "cognito-idp:AdminGetUser",
                 "dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan",
                 "dynamodb:PartiQLSelect", "dynamodb:GetRecords", "dynamodb:ExportTableToPointInTime"],
      "Resource": "*"
    }
  ]
}
EOF
aws iam put-role-policy --role-name "tf-${PROJECT}-plan" --policy-name plan-extras \
  --policy-document "file://$TMP/plan-extra.json"

# ------------------------------------------------------------------ 4. apply role
say "Apply role tf-${PROJECT}-apply"
trust "environment:production" >"$TMP/apply-trust.json"
role "tf-${PROJECT}-apply" "Lets GitHub Actions apply Terraform for ${PROJECT} (production environment only)" "$TMP/apply-trust.json"
P="${PROJECT}"
A="${ACCOUNT}"
R="${REGION}"
cat >"$TMP/apply.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {"Sid": "State", "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
     "Resource": ["arn:aws:s3:::${STATE_BUCKET}", "arn:aws:s3:::${STATE_BUCKET}/*"]},
    {"Sid": "Read", "Effect": "Allow", "Resource": "*",
     "Action": ["iam:Get*", "iam:List*", "s3:ListAllMyBuckets", "s3:GetBucketLocation", "cloudfront:*",
                "cognito-idp:CreateUserPool", "cognito-idp:ListUserPools", "cognito-idp:Describe*",
                "dynamodb:Describe*", "dynamodb:List*", "lambda:List*", "lambda:Get*", "logs:Describe*", "logs:List*",
                "apigateway:GET", "cloudformation:ValidateTemplate", "cloudwatch:*", "budgets:ViewBudget",
                "acm:*", "route53:*", "ses:*", "scheduler:List*", "scheduler:Get*", "events:List*", "events:Describe*"]},
    {"Sid": "SiteBuckets", "Effect": "Allow", "Action": "s3:*",
     "Resource": ["arn:aws:s3:::${P}-*", "arn:aws:s3:::${P}-*/*"]},
    {"Sid": "Members", "Effect": "Allow", "Action": "cognito-idp:*", "Resource": "arn:aws:cognito-idp:${R}:${A}:userpool/*"},
    {"Sid": "Database", "Effect": "Allow", "Action": "dynamodb:*",
     "Resource": ["arn:aws:dynamodb:${R}:${A}:table/${P}-*", "arn:aws:dynamodb:${R}:${A}:table/${P}-*/*"]},
    {"Sid": "Functions", "Effect": "Allow", "Action": "lambda:*", "Resource": "arn:aws:lambda:${R}:${A}:function:${P}-*"},
    {"Sid": "Api", "Effect": "Allow", "Action": "apigateway:*", "Resource": "arn:aws:apigateway:${R}::/*"},
    {"Sid": "Logs", "Effect": "Allow", "Action": "logs:*",
     "Resource": ["arn:aws:logs:${R}:${A}:log-group:/aws/lambda/${P}-*", "arn:aws:logs:${R}:${A}:log-group:/aws/lambda/${P}-*:*"]},
    {"Sid": "AlertsAndSchedules", "Effect": "Allow", "Action": ["sns:*", "scheduler:*", "events:*", "budgets:*"],
     "Resource": ["arn:aws:sns:*:${A}:${P}-*", "arn:aws:scheduler:${R}:${A}:schedule/*/${P}-*",
                  "arn:aws:scheduler:${R}:${A}:schedule-group/${P}*", "arn:aws:events:${R}:${A}:rule/${P}-*",
                  "arn:aws:budgets::${A}:budget/${P}-*"]},
    {"Sid": "RolesMustCarryBoundary", "Effect": "Allow",
     "Action": ["iam:CreateRole", "iam:PutRolePermissionsBoundary", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
                "iam:PutRolePolicy", "iam:DeleteRolePolicy"],
     "Resource": "arn:aws:iam::${A}:role/${P}-*",
     "Condition": {"StringEquals": {"iam:PermissionsBoundary": "${BOUNDARY_ARN}"}}},
    {"Sid": "RoleUpkeep", "Effect": "Allow",
     "Action": ["iam:UpdateRole", "iam:UpdateRoleDescription", "iam:UpdateAssumeRolePolicy", "iam:TagRole",
                "iam:UntagRole", "iam:DeleteRole"],
     "Resource": "arn:aws:iam::${A}:role/${P}-*"},
    {"Sid": "PassAppRoles", "Effect": "Allow", "Action": "iam:PassRole", "Resource": "arn:aws:iam::${A}:role/${P}-*",
     "Condition": {"StringEquals": {"iam:PassedToService": ["lambda.amazonaws.com", "scheduler.amazonaws.com"]}}},
    {"Sid": "GitHubIdentity", "Effect": "Allow",
     "Action": ["iam:CreateOpenIDConnectProvider", "iam:UpdateOpenIDConnectProviderThumbprint",
                "iam:AddClientIDToOpenIDConnectProvider", "iam:RemoveClientIDFromOpenIDConnectProvider",
                "iam:TagOpenIDConnectProvider", "iam:UntagOpenIDConnectProvider"],
     "Resource": "${OIDC_ARN}"},
    {"Sid": "Migration", "Effect": "Allow",
     "Action": ["cloudformation:Describe*", "cloudformation:GetTemplate*", "cloudformation:List*",
                "cloudformation:UpdateStack", "cloudformation:DeleteStack"],
     "Resource": "arn:aws:cloudformation:${R}:${A}:stack/${STACK}/*"},
    {"Sid": "NeverDeleteMembersOrData", "Effect": "Deny", "Resource": "*",
     "Action": ["cognito-idp:DeleteUserPool", "dynamodb:DeleteTable", "s3:DeleteBucket",
                "iam:DeleteOpenIDConnectProvider", "iam:DeleteRolePermissionsBoundary"]},
    {"Sid": "NeverReadMemberData", "Effect": "Deny", "Resource": "*",
     "Action": ["cognito-idp:ListUsers", "cognito-idp:ListUsersInGroup", "cognito-idp:AdminGetUser",
                "cognito-idp:AdminCreateUser", "cognito-idp:AdminDeleteUser", "cognito-idp:AdminSetUserPassword",
                "cognito-idp:AdminUpdateUserAttributes", "cognito-idp:AdminInitiateAuth",
                "dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:PutItem",
                "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem", "dynamodb:PartiQL*"]},
    {"Sid": "NeverTouchTerraformItself", "Effect": "Deny", "Action": ["iam:Create*", "iam:Update*", "iam:Put*",
     "iam:Delete*", "iam:Attach*", "iam:Detach*", "iam:Tag*", "iam:Untag*", "iam:SetDefaultPolicyVersion"],
     "Resource": ["arn:aws:iam::${A}:role/tf-*", "arn:aws:iam::${A}:policy/tf-*"]}
  ]
}
EOF
aws iam put-role-policy --role-name "tf-${PROJECT}-apply" --policy-name apply \
  --policy-document "file://$TMP/apply.json"

# ------------------------------------------------------------------ done
say "Done. Put these in deploy.env (they are not secrets):"
cat <<EOF
TF_STATE_BUCKET=$STATE_BUCKET
TF_PLAN_ROLE_ARN=arn:aws:iam::${ACCOUNT}:role/tf-${PROJECT}-plan
TF_APPLY_ROLE_ARN=arn:aws:iam::${ACCOUNT}:role/tf-${PROJECT}-apply
EOF
