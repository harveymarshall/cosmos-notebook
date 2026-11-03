#!/usr/bin/env bash
# Deploy from your own computer instead of GitHub Actions.
# Needs the AWS CLI, signed in (aws configure / aws sso login), and the values from
# your CloudFormation stack's Outputs tab:
#
#   export AWS_REGION=eu-west-2 S3_BUCKET=... CLOUDFRONT_DISTRIBUTION_ID=... \
#          API_FUNCTION_NAME=... COGNITO_CLIENT_ID=... SITE_URL=https://...
#   ./scripts/deploy.sh
set -euo pipefail
for v in AWS_REGION S3_BUCKET CLOUDFRONT_DISTRIBUTION_ID API_FUNCTION_NAME COGNITO_CLIENT_ID; do
  [ -n "${!v:-}" ] || { echo "Please set $v (see the CloudFormation Outputs tab)"; exit 1; }
done

cd "$(dirname "$0")/.."
# Stellar Lab engine (needs Rust: rustup target add wasm32-unknown-unknown)
npm run --silent test:wasm >/dev/null && npm run --silent build:wasm
node --test api/test/*.test.js test/*.test.js >/dev/null && echo "Tests passed"
COGNITO_REGION="$AWS_REGION" REQUIRE_WASM=1 node build.js

rm -f lambda.zip
(cd api && zip -qr ../lambda.zip index.mjs package.json src -x 'src/fake-dynamo.js')
aws lambda update-function-code --function-name "$API_FUNCTION_NAME" --zip-file fileb://lambda.zip >/dev/null
aws lambda wait function-updated --function-name "$API_FUNCTION_NAME"
echo "API updated"

aws s3 sync dist "s3://$S3_BUCKET" --delete \
  --exclude "*.html" --exclude "*.xml" --exclude "*.txt" --exclude "*.json" --exclude "*.js" --exclude "*.css" \
  --cache-control "public,max-age=86400"
aws s3 sync dist "s3://$S3_BUCKET" --delete \
  --exclude "*" --include "*.html" --include "*.xml" --include "*.txt" --include "*.json" --include "*.js" --include "*.css" \
  --cache-control "public,max-age=60"
aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" --paths "/*" >/dev/null

echo "Deployed. Changes are live within a minute or two."
