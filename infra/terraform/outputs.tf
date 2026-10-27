# The values deploy.env needs. After any change here, check deploy.env still matches.

output "site_url" {
  description = "SITE_URL - the live site"
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "s3_bucket" {
  description = "S3_BUCKET"
  value       = aws_s3_bucket.site.id
}

output "cloudfront_distribution_id" {
  description = "CLOUDFRONT_DISTRIBUTION_ID"
  value       = aws_cloudfront_distribution.site.id
}

output "api_function_name" {
  description = "API_FUNCTION_NAME"
  value       = aws_lambda_function.api.function_name
}

output "tracker_function_name" {
  description = "TRACKER_FUNCTION_NAME - Mission Control's tracker"
  value       = aws_lambda_function.tracker.function_name
}

output "user_pool_id" {
  description = "Where member accounts live - add admins here"
  value       = aws_cognito_user_pool.members.id
}

output "cognito_client_id" {
  description = "COGNITO_CLIENT_ID"
  value       = aws_cognito_user_pool_client.web.id
}

output "aws_role_arn" {
  description = "AWS_ROLE_ARN - the role the Deploy workflow uses"
  value       = aws_iam_role.deploy.arn
}

output "region" {
  description = "AWS_REGION and COGNITO_REGION"
  value       = var.region
}
