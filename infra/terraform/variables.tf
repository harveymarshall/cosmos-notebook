variable "region" {
  description = "AWS region for everything except CloudFront (which is global)."
  type        = string
  default     = "eu-west-2"
}

variable "project" {
  description = "Name prefix for resources. Must stay \"cosmos-notebook\" for the existing site."
  type        = string
  default     = "cosmos-notebook"
}

variable "github_repo" {
  description = "GitHub repository (owner/name) allowed to deploy the site."
  type        = string
  default     = "harveymarshall/cosmos-notebook"
}

variable "github_branch" {
  description = "Branch that deploys the site."
  type        = string
  default     = "main"
}

variable "api_rate_limit" {
  description = "Average API requests per second allowed across the whole site (protects the bill)."
  type        = number
  default     = 20
}

variable "api_burst_limit" {
  description = "Short bursts of API requests allowed above the rate limit."
  type        = number
  default     = 40
}

# ---------------------------------------------------------------------------------------
# Names of resources that CloudFormation created with generated names. They are filled in
# by infra/terraform/scripts/discover.sh (existing.auto.tfvars) so Terraform adopts the
# live resources instead of creating new ones. Leave them null on a brand-new install.

variable "site_bucket_name" {
  description = "Existing website bucket name, or null to generate one."
  type        = string
  default     = null
}

variable "table_name" {
  description = "Existing DynamoDB table name, or null for \"<project>-data\"."
  type        = string
  default     = null
}

variable "api_role_name" {
  description = "Existing API Lambda role name, or null to generate one."
  type        = string
  default     = null
}

variable "deploy_role_name" {
  description = "Existing GitHub deploy role name, or null to generate one."
  type        = string
  default     = null
}

variable "api_invoke_statement_id" {
  description = "Statement ID of the existing permission that lets API Gateway call the Lambda."
  type        = string
  default     = "AllowApiGatewayInvoke"
}

variable "create_github_oidc_provider" {
  description = "Manage the account's GitHub OIDC identity provider here (one per AWS account)."
  type        = bool
  default     = true
}
