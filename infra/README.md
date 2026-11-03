# Infrastructure

Everything in AWS is described in **Terraform** (`infra/terraform`) and changed only by
GitHub Actions (`.github/workflows/infra.yml`):

| When | What happens |
| --- | --- |
| Pull request touching `infra/terraform` | Format check, validate, and a **read-only plan** in the run summary |
| Merge to `main` | Plan, then **apply after you approve** the `production` environment |
| Every push to `main` | `deploy.yml` uploads the website and API code (unchanged) |

Nothing is changed by hand in the AWS console. The only exceptions are the one-time
bootstrap below and billing settings such as CloudFront's pricing plan.

```
infra/
  bootstrap/bootstrap.sh          one-time: state bucket + Terraform's own roles
  terraform/                      the whole site: S3, CloudFront, Cognito, DynamoDB, Lambda, API, IAM, domain
    existing.auto.tfvars          names of the live resources (keep - see below)
    scripts/guard.sh              refuses to plan against empty state
```

## Safety rails

- **Members and data can't be deleted by Terraform.** The user pool, table, website bucket
  and CloudFront distribution have `prevent_destroy`; the pool and table also have AWS deletion
  protection; and the Terraform role is explicitly denied `DeleteUserPool`, `DeleteTable` and
  `DeleteBucket`.
- **Terraform can't read member data.** Both Terraform roles are denied reading users or
  table items.
- **No privilege escalation.** Every role Terraform manages must carry the
  `tf-cosmos-notebook-boundary` permissions boundary, and the Terraform roles themselves are
  created by the bootstrap script, outside Terraform, so a workflow can never widen its own access.
- **No keys.** GitHub proves its identity to AWS (OIDC). Plans use a read-only role; applies
  use a separate role that only the `production` environment can use.
- **No accidental second site.** If Terraform state is empty, the workflow refuses to plan
  (`scripts/guard.sh`) unless `ALLOW_FRESH_INSTALL` is set.

## History

The site was first created by a CloudFormation stack. In November 2026 Terraform imported
every resource, and the stack was retired (resources kept, record deleted). Some resources
still have the generated names CloudFormation gave them; `existing.auto.tfvars` pins those
names so Terraform keeps them. Don't delete it.

## Brand-new install (someone else's copy)

1. Set `github_repo` in `infra/terraform/variables.tf` and delete `existing.auto.tfvars`.
2. **Bootstrap** (AWS console, region London, CloudShell, about 2 minutes):
   ```bash
   git clone https://github.com/<you>/cosmos-notebook && bash cosmos-notebook/infra/bootstrap/bootstrap.sh
   ```
   Put the three values it prints in `deploy.env`.
3. **Protect production:** Repo → Settings → Environments → `production` → **Required
   reviewers** → add yourself.
4. Set the repository variable `ALLOW_FRESH_INSTALL` to `true`, then Actions → *Infrastructure
   (Terraform)* → Run workflow, and approve the apply. Delete the variable afterwards.
5. Copy `terraform output` (shown in the apply's run summary) into `deploy.env`, and push.

## Custom domain

The domain is registered at Cloudflare, which also runs its DNS; CloudFront serves the site
(`infra/terraform/domain.tf`). Nothing is created until `DOMAIN_NAME` is set.

1. Add two repository secrets: `CLOUDFLARE_API_TOKEN` (a token limited to *Zone → DNS → Edit*
   for this zone) and `CLOUDFLARE_ZONE_ID` (from the zone's Overview page).
2. Set `DOMAIN_NAME=yourdomain.com` in `deploy.env` and push. The Infrastructure workflow
   requests a certificate in us-east-1, adds the validation and site records in Cloudflare
   (DNS only, grey cloud), and attaches the domain to CloudFront. `www.` redirects to the bare domain.
3. Once that apply has finished, change `SITE_URL` in `deploy.env` to `https://yourdomain.com`
   so the next deploy builds links and the sitemap with the new address.

The old `*.cloudfront.net` address redirects to the domain (301), as does `www.`. The API
(`/api/*`) answers on both, since the redirect only applies to pages.
