---
name: cicd-pipeline-creation
description: Use when creating CI/CD pipelines for any project. Use when asked to "set up CI/CD", "create a pipeline", "automate deployments", "configure Gitea Actions", "set up Vercel/Render/AWS", or similar. Apply regardless of hosting platform, language, or framework.
---

# CI/CD Pipeline Creation

A CI/CD pipeline must be complete, verifiable, and safe. Every pipeline must have these elements:

## Required elements

**1. Test stage** — runs on every push and pull request

- Install dependencies
- Run tests
- Fail if tests don't pass

**2. Deploy stage** — runs only after tests pass, on specific branches

- Deploy to a real hosting service (Vercel, Render, AWS, etc.)
- Not just "build and push" — actual deployment must happen

**3. Verification stage** — runs immediately after deploy

- Hit the health endpoint
- Confirm the service is responding
- Fail if health check fails

**4. Rollback strategy** — documented or automated

- If deploy fails, how do you rollback?
- Either auto-rollback or manual rollback steps documented

**5. Secrets documentation** — list every required secret

- What secrets are needed?
- Where are they configured?
- How do you set them up?

## Common mistakes — and the responses

**"I'll just push to Docker and that's the deploy."**
Pushing an image is not deploying. Deploy means the service is running and accessible. You must have a step that actually deploys to a hosting service.

**"I'll add health checks later."**
Without verification, you don't know if the deploy succeeded. A health check is required immediately after deploy.

**"Rollback is complex, I'll skip it."**
Rollback is required. Either document the manual steps or implement auto-rollback. Production failures happen.

**"I'll assume people know what secrets to set."**
List every secret explicitly. Example: `RENDER_API_KEY`, `VERCEL_TOKEN`, `AWS_ACCESS_KEY_ID`. Say where to configure them (Gitea repo secrets, environment variables, etc.).

**"Staging is optional."**
For production safety, staging is required. Test on staging first, then promote to production.

## Red flags — stop and reassess

- You created a pipeline that builds/pushes but never deploys
- You have no health check or verification after deploy
- You have no rollback strategy (documented or automated)
- You didn't list the required secrets
- You're deploying straight to production with no staging
- You assume "someone will figure out" the secrets

## Checklist per pipeline

- [ ] Test stage: installs deps, runs tests, fails on test failure
- [ ] Deploy stage: deploys to actual hosting service (not just build/push)
- [ ] Verification stage: health check hits endpoint, confirms response
- [ ] Rollback strategy: documented or automated
- [ ] Secrets documented: list every secret, say where to configure
- [ ] Staging environment: test on staging before production (for production pipelines)

## Example structure (Gitea Actions)

```yaml
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: deploy to staging (Vercel/Render/etc.)
      - run: curl -f http://staging.example.com/health

  deploy-production:
    needs: deploy-staging
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: deploy to production
      - run: curl -f https://example.com/health
      # On failure: revert to previous deployment (see rollback docs)
```

## Secrets documentation format

At the end of your pipeline file or in a README, list:

```
Required secrets:
- VERCEL_TOKEN: Vercel API token (configure in Gitea repo secrets)
- RENDER_API_KEY: Render API key (configure in Gitea repo secrets)
- SERVICE_ID: Your service ID from Vercel/Render

Setup:
1. Go to Gitea repo → Settings → Actions → Secrets
2. Add each secret with the correct value
3. Verify in a test deploy
```
