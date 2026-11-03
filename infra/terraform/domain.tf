# Custom domain: registered at Cloudflare (Cloudflare runs DNS), served by CloudFront.
#
# Set DOMAIN_NAME in deploy.env to switch it on. Until then nothing here is created and the
# site stays on its *.cloudfront.net address. Needs two repository secrets:
#   CLOUDFLARE_API_TOKEN - a token limited to "Zone -> DNS -> Edit" for this one zone
#   CLOUDFLARE_ZONE_ID   - from the zone's Overview page in Cloudflare
#
# CloudFront only accepts certificates from us-east-1, hence the second AWS provider.

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
      Repo      = var.github_repo
    }
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment, so the token never touches code or state.
provider "cloudflare" {}

locals {
  custom_domain = var.domain_name != ""
  site_domains  = local.custom_domain ? [var.domain_name, "www.${var.domain_name}"] : []
}

resource "aws_acm_certificate" "site" {
  count                     = local.custom_domain ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = var.domain_name
  subject_alternative_names = ["www.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true

    precondition {
      condition     = var.cloudflare_zone_id != ""
      error_message = "DOMAIN_NAME is set but the CLOUDFLARE_ZONE_ID secret is empty - add it in GitHub (Settings -> Secrets and variables -> Actions)."
    }
  }
}

# The DNS records that prove to AWS we own the domain (one per name on the certificate).
resource "cloudflare_dns_record" "acm_validation" {
  for_each = local.custom_domain ? {
    for o in aws_acm_certificate.site[0].domain_validation_options : o.domain_name => o
  } : {}

  zone_id = var.cloudflare_zone_id
  name    = trimsuffix(each.value.resource_record_name, ".")
  type    = each.value.resource_record_type
  content = trimsuffix(each.value.resource_record_value, ".")
  ttl     = 60
  proxied = false
  comment = "ACM validation for ${var.project} (Terraform)"
}

# Waits until AWS has issued the certificate, so CloudFront never gets a pending one.
resource "aws_acm_certificate_validation" "site" {
  count                   = local.custom_domain ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.site[0].arn
  validation_record_fqdns = [for r in cloudflare_dns_record.acm_validation : r.name]
}

# The site itself. DNS-only (grey cloud): CloudFront is already the CDN, and putting
# Cloudflare's proxy in front of it causes caching and certificate trouble.
# Cloudflare flattens the CNAME at the apex, so the bare domain works too.
resource "cloudflare_dns_record" "site" {
  for_each = toset(local.site_domains)

  zone_id = var.cloudflare_zone_id
  name    = each.value
  type    = "CNAME"
  content = aws_cloudfront_distribution.site.domain_name
  ttl     = 300
  proxied = false
  comment = "${var.project} site (Terraform)"
}

# Sends www.<domain> and the *.cloudfront.net address to the bare domain, so there's one
# address for links and search engines. /api/* doesn't use this function, so it's unaffected.
resource "aws_cloudfront_function" "www_redirect" {
  count   = local.custom_domain ? 1 : 0
  name    = "${var.project}-www-redirect"
  runtime = "cloudfront-js-2.0"
  comment = "Redirect www and cloudfront.net to the bare domain, then serve index.html for folder URLs"
  publish = true
  code    = templatefile("${path.module}/functions/www-redirect.js.tftpl", { domain = var.domain_name })
}
