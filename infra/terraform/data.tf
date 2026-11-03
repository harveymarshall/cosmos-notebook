# The database: one DynamoDB table (single-table design, see api/src/store.js).
# Holds every notebook, post and comment, so it is protected three ways: prevent_destroy,
# deletion protection in AWS, and an explicit deny on dynamodb:DeleteTable for the Terraform role.

resource "aws_dynamodb_table" "main" {
  name                        = coalesce(var.table_name, "${var.project}-data")
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "PK"
  range_key                   = "SK"
  deletion_protection_enabled = true

  dynamic "attribute" {
    for_each = ["PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK"]
    content {
      name = attribute.value
      type = "S"
    }
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}
