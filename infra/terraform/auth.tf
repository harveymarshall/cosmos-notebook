# Member accounts (Cognito). The user pool holds every member's login, so it can never be
# destroyed or replaced by Terraform: prevent_destroy here, deletion protection in AWS, and
# the Terraform role is explicitly denied cognito-idp:DeleteUserPool.

resource "aws_cognito_user_pool" "members" {
  name                     = "${var.project}-members"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"

  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_uppercase                = false
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your Cosmos Notebook code"
    email_message        = "Welcome to Cosmos Notebook! Your confirmation code is {####}"
  }

  lifecycle {
    prevent_destroy = true
    # Standard attributes come from AWS defaults; changing the schema would force a new pool.
    ignore_changes = [schema]
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name                          = "web"
  user_pool_id                  = aws_cognito_user_pool.members.id
  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  access_token_validity         = 60
  id_token_validity             = 60
  refresh_token_validity        = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "admins" {
  name         = "admins"
  description  = "Can review library suggestions and remove community posts"
  user_pool_id = aws_cognito_user_pool.members.id
}
