# Website files (private S3 bucket) served through CloudFront, with /api/* sent to the API.

resource "aws_s3_bucket" "site" {
  bucket        = var.site_bucket_name
  bucket_prefix = var.site_bucket_name == null ? "${var.project}-site-" : null

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "site_bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }

  # Lets S3 answer "404 Not Found" (instead of "403") for pages that don't exist
  statement {
    sid       = "AllowCloudFrontList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_bucket.json
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.project}-oac"
  description                       = ""
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Turns /experiments/weigh-jupiter/ into /experiments/weigh-jupiter/index.html
resource "aws_cloudfront_function" "index_rewrite" {
  name    = "${var.project}-index-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Serve index.html for folder-style URLs"
  publish = true
  code    = file("${path.module}/functions/index-rewrite.js")
}

# CloudFront only passes the login header on GET requests if it is part of the cache key.
# Max TTL of 1 second plus the API's "no-store" header means nothing is actually cached.
resource "aws_cloudfront_cache_policy" "api" {
  name        = "${var.project}-api"
  comment     = "Forward the Authorization header and query strings; effectively no caching"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 1

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = false
    enable_accept_encoding_brotli = false
    cookies_config {
      cookie_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "all"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Authorization"]
      }
    }
  }
}

locals {
  managed_caching_optimized      = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  managed_security_headers       = "67f7725c-6f97-4210-82d7-5512b31e9d03"
  managed_all_viewer_except_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  site_origin_id                 = "site-bucket"
  api_origin_id                  = "api"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "${var.project} site"
  default_root_object = "index.html"
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  price_class         = "PriceClass_100"

  origin {
    origin_id                = local.site_origin_id
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id   = local.api_origin_id
    domain_name = "${aws_apigatewayv2_api.api.id}.execute-api.${var.region}.amazonaws.com"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = local.site_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.managed_caching_optimized
    response_headers_policy_id = local.managed_security_headers

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index_rewrite.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = local.api_origin_id
    viewer_protocol_policy     = "https-only"
    compress                   = true
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.api.id
    origin_request_policy_id   = local.managed_all_viewer_except_host
    response_headers_policy_id = local.managed_security_headers
  }

  # Only 404 is mapped (S3 answers 404 for missing pages thanks to ListBucket above),
  # so the API's own 401/403 answers reach the app unchanged.
  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  lifecycle {
    # A new distribution would mean a new web address.
    prevent_destroy = true
  }
}
