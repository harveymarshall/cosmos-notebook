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
  terraform/                      the whole site: S3, CloudFront, Cognito, DynamoDB, Lambda, API, IAM
    scripts/discover.sh           one-time: finds the live CloudFormation resources to import
    scripts/retire-cloudformation.sh  one-time: hands everything over and removes the old stack
  cloudformation.yaml             the old template (kept until the migration is finished)
  cloudformation-retain.yaml      the old template with every resource set to Retain
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
- **No accidental second site.** If Terraform state is empty and there is nothing to import,
  the workflow refuses to plan (`scripts/guard.sh`).

## Moving from CloudFormation (one time)

The live site was created by the CloudFormation stack `cosmos-notebook`. These steps make
Terraform adopt the **same** resources — no new site, no downtime, members and data untouched.

0. **Merge the Terraform pull request.** This changes nothing in AWS. Its first workflow run
   will stop early (Terraform's roles don't exist yet, and the guard refuses to plan without
   imports) — that's expected.
1. **Bootstrap (CloudShell, ~2 minutes).** AWS console → region London → CloudShell:
   ```bash
   git clone https://github.com/harveymarshall/cosmos-notebook && bash cosmos-notebook/infra/bootstrap/bootstrap.sh
   ```
   It prints three values. They are already in `deploy.env`; check they match.
2. **Protect production (GitHub, 1 minute).** Repo → Settings → Environments → `production`
   (create it if missing) → **Required reviewers** → add yourself.
3. **Discover.** Actions → *Infrastructure (Terraform)* → Run workflow → `discover`.
   This writes `imports.tf` and `existing.auto.tfvars` to the `terraform-import` branch.
4. **Review the import plan.** Open a pull request from `terraform-import`. The plan should say
   it will **import** every resource and make only small in-place changes (tags, and the
   permissions boundary on the two roles). It must not **destroy** or **replace** anything.
5. **Merge and approve.** Merging runs the plan again; approve the `production` deployment to
   apply. Terraform now manages everything (CloudFormation still has its record too).
6. **Retire CloudFormation.** Run workflow → `retire-cloudformation` and approve. It checks
   Terraform owns everything, marks every stack resource *Retain*, deletes the old stack record
   (resources stay), and confirms Terraform still sees no changes.
7. **Tidy up.** Delete `imports.tf`, `infra/cloudformation*.yaml` and `scripts/deploy.sh`'s
   CloudFormation notes in a final pull request.

## Brand-new install (someone else's copy)

Set `github_repo` in `infra/terraform/variables.tf`, run the bootstrap in your account, put its
three values in `deploy.env`, delete `existing.auto.tfvars` if present, and run the workflow once
with the repository variable `ALLOW_FRESH_INSTALL` set to `true`. Then
copy `terraform output` into `deploy.env`.
