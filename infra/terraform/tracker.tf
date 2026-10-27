# Mission Control's tracker: one small Lambda, woken by EventBridge on three schedules. It
# fetches spacecraft positions (NASA JPL Horizons), live Deep Space Network contacts and
# mission news, and saves them as JSON in the website bucket under live/ — where CloudFront
# already serves them to the /missions/ page. No new bucket, API route or database.
#
# Like the API, Terraform owns the function's settings and the Deploy workflow uploads its
# code (tracker/) on every push.
#
# Cost: about 9,000 runs a month of a few seconds each at 128 MB — inside Lambda's
# always-free allowance — plus a few thousand tiny S3 writes (pennies).

resource "aws_cloudwatch_log_group" "tracker" {
  name              = "/aws/lambda/${var.project}-tracker"
  retention_in_days = 14
}

resource "aws_iam_role" "tracker" {
  name_prefix          = "${var.project}-tracker-"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume.json
  permissions_boundary = local.boundary_arn
}

resource "aws_iam_role_policy_attachment" "tracker_logs" {
  role       = aws_iam_role.tracker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# It may only read and write its own live/ files — nothing else in the bucket.
data "aws_iam_policy_document" "tracker_bucket" {
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.site.arn}/live/*"]
  }
}

resource "aws_iam_role_policy" "tracker_bucket" {
  name   = "live-files"
  role   = aws_iam_role.tracker.name
  policy = data.aws_iam_policy_document.tracker_bucket.json
}

# Placeholder code for the first apply only; the Deploy workflow uploads the real tracker.
data "archive_file" "tracker_placeholder" {
  type        = "zip"
  output_path = "${path.module}/.build/tracker-placeholder.zip"
  source {
    filename = "index.mjs"
    content  = <<-EOT
      export const handler = async () => {
        console.log('The tracker has not been deployed yet. Push to main to deploy it.');
        return 'placeholder';
      };
    EOT
  }
}

resource "aws_lambda_function" "tracker" {
  function_name = "${var.project}-tracker"
  description   = "Mission Control tracker: spacecraft positions, DSN contacts and news -> live/*.json. Code is uploaded by the deploy step."
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 128
  timeout       = 120
  role          = aws_iam_role.tracker.arn

  filename         = data.archive_file.tracker_placeholder.output_path
  source_code_hash = data.archive_file.tracker_placeholder.output_base64sha256

  environment {
    variables = {
      SITE_BUCKET = aws_s3_bucket.site.id
    }
  }

  depends_on = [aws_cloudwatch_log_group.tracker]

  lifecycle {
    # Code changes ship through the Deploy workflow, not Terraform.
    ignore_changes = [filename, source_code_hash, s3_bucket, s3_key, s3_object_version]
  }
}

# dsn:       which Deep Space Network dishes are talking to which spacecraft right now
# positions: where every spacecraft is (one point a day, 180 days back to 5 days ahead)
# news:      mission headlines
locals {
  tracker_schedules = {
    dsn       = { rate = var.tracker_dsn_schedule, jobs = ["dsn"] }
    positions = { rate = "rate(6 hours)", jobs = ["positions"] }
    news      = { rate = "rate(3 hours)", jobs = ["news"] }
  }
}

resource "aws_cloudwatch_event_rule" "tracker" {
  for_each            = local.tracker_schedules
  name                = "${var.project}-tracker-${each.key}"
  description         = "Mission Control: run the tracker's ${each.key} job"
  schedule_expression = each.value.rate
}

resource "aws_cloudwatch_event_target" "tracker" {
  for_each = local.tracker_schedules
  rule     = aws_cloudwatch_event_rule.tracker[each.key].name
  arn      = aws_lambda_function.tracker.arn
  input    = jsonencode({ jobs = each.value.jobs })
}

resource "aws_lambda_permission" "tracker_schedule" {
  for_each      = local.tracker_schedules
  statement_id  = "AllowSchedule-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tracker.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.tracker[each.key].arn
}
