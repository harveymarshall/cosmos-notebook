# Keyless deploys from GitHub Actions. GitHub proves which repo and branch is running and
# AWS hands it a short-lived session for the deploy role. No keys are stored anywhere.
#
# Two different roles use GitHub's identity:
#   - the deploy role below (managed here): uploads the site and API code on every push
#   - tf-cosmos-notebook-plan / -apply (created once by infra/bootstrap/bootstrap.sh):
#     run Terraform. They live outside this configuration on purpose, so Terraform can
#     never change its own permissions.

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_github_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

locals {
  github_oidc_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:aws:iam::${local.account_id}:oidc-provider/token.actions.githubusercontent.com"
  repo_owner      = split("/", var.github_repo)[0]
  repo_name       = split("/", var.github_repo)[1]
}

data "aws_iam_policy_document" "deploy_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # GitHub uses either "repo:owner/name:..." or, newer, "repo:owner@<id>/name@<id>:..."
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repo}:ref:refs/heads/${var.github_branch}",
        "repo:${local.repo_owner}@*/${local.repo_name}@*:ref:refs/heads/${var.github_branch}",
      ]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = var.deploy_role_name
  name_prefix          = var.deploy_role_name == null ? "${var.project}-deploy-" : null
  description          = "Lets GitHub Actions upload the site, update the API code and clear the cache - nothing else."
  assume_role_policy   = data.aws_iam_policy_document.deploy_assume.json
  permissions_boundary = local.boundary_arn
}

data "aws_iam_policy_document" "deploy" {
  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
  }
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
  statement {
    effect    = "Allow"
    actions   = ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration"]
    resources = [aws_lambda_function.api.arn, aws_lambda_function.tracker.arn]
  }
  # Run the tracker once after a deploy, so Mission Control has fresh data straight away
  statement {
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.tracker.arn]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy-site"
  role   = aws_iam_role.deploy.name
  policy = data.aws_iam_policy_document.deploy.json
}
