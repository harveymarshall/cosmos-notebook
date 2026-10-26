# Cosmos Notebook infrastructure, managed by Terraform and applied only from GitHub Actions
# (.github/workflows/infra.yml). Replaces infra/cloudformation.yaml.

terraform {
  required_version = ">= 1.10" # S3 native state locking (use_lockfile)

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # State lives in a private, versioned S3 bucket created once by infra/bootstrap/bootstrap.sh.
  # The bucket name includes the AWS account ID, so the workflow passes it in with
  # -backend-config="bucket=..." (TF_STATE_BUCKET in deploy.env).
  backend "s3" {
    key          = "cosmos-notebook/terraform.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
      Repo      = var.github_repo
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy" "boundary" {
  name = "tf-${var.project}-boundary"
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  # Every role Terraform manages carries this permissions boundary, so nothing here can
  # ever be given more power than the boundary allows (see infra/bootstrap/bootstrap.sh).
  boundary_arn = data.aws_iam_policy.boundary.arn
}
