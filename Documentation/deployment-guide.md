# AS3 Expense Dashboard - Deployment Guide

**Version:** 1.0
**Last Updated:** December 6, 2025
**Platform:** AWS Amplify

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [AWS Amplify Setup](#aws-amplify-setup)
4. [Environment Configuration](#environment-configuration)
5. [Build Configuration](#build-configuration)
6. [Custom Domain Setup](#custom-domain-setup)
7. [CI/CD Pipeline](#cicd-pipeline)
8. [Monitoring & Logs](#monitoring--logs)
9. [Rollback Procedures](#rollback-procedures)
10. [Security Checklist](#security-checklist)

---

## Overview

### Architecture

```
[Developer] ──push──> [GitHub] ──webhook──> [AWS Amplify]
                                                  │
                                        ┌─────────┴─────────┐
                                        │                   │
                                   [Build]            [Deploy]
                                        │                   │
                                        └─────────┬─────────┘
                                                  │
                                          [CloudFront CDN]
                                                  │
                                              [Users]
```

### Hosting Details

| Component | Technology |
|-----------|------------|
| Static Hosting | AWS Amplify |
| CDN | CloudFront (via Amplify) |
| SSL | AWS Certificate Manager |
| DNS | Route 53 (optional) |
| Backend | Supabase (external) |

---

## Prerequisites

### Required Accounts

1. **AWS Account** with admin access
2. **GitHub Account** with repository access
3. **Supabase Project** (already configured)

### Required Tools (Local Development)

```bash
# Node.js 18+ and npm
node --version  # v18.x or higher
npm --version   # 9.x or higher

# AWS CLI (optional, for advanced management)
aws --version

# Git
git --version
```

### Project Setup

Ensure the expense-dashboard project is:
1. Initialized with Vite + React
2. Connected to a GitHub repository
3. Has `.env.example` with all required variables

---

## AWS Amplify Setup

### Step 1: Access AWS Amplify Console

1. Log in to [AWS Console](https://console.aws.amazon.com/)
2. Search for "Amplify" in services
3. Click **AWS Amplify**

### Step 2: Create New App

1. Click **New app** → **Host web app**
2. Select **GitHub** as the source provider
3. Click **Connect to GitHub**
4. Authorize AWS Amplify to access your GitHub account

### Step 3: Select Repository

1. Choose the repository: `as3-auto-bookkeeper` (or subpath if mono-repo)
2. Select the branch: `main`
3. If the React app is in a subfolder, specify: `expense-dashboard`

### Step 4: Configure Build Settings

Amplify will auto-detect Vite. Verify the settings:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
```

### Step 5: Set Environment Variables

Click **Advanced settings** and add:

| Variable | Value | Description |
|----------|-------|-------------|
| VITE_SUPABASE_URL | `https://xxx.supabase.co` | Supabase project URL |
| VITE_SUPABASE_ANON_KEY | `eyJhbGci...` | Supabase anonymous key |
| VITE_APP_NAME | `AS3 Expense Dashboard` | App title |

### Step 6: Deploy

1. Review all settings
2. Click **Save and deploy**
3. Wait for build to complete (3-5 minutes)
4. Access app at the provided Amplify URL

---

## Environment Configuration

### Environment Variables

Create `.env` files for each environment:

**`.env.development`** (local development)
```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_APP_NAME=AS3 Expense Dashboard (Dev)
VITE_API_TIMEOUT=30000
```

**`.env.production`** (deployed)
```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_APP_NAME=AS3 Expense Dashboard
VITE_API_TIMEOUT=30000
```

### Environment Variable Security

- **Never commit** `.env` files to Git (add to `.gitignore`)
- Use Amplify's environment variable feature for production secrets
- Rotate Supabase anon key if exposed

---

## Build Configuration

### `amplify.yml`

Create this file in the project root:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci --production=false
    build:
      commands:
        - echo "Building for production..."
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .npm/**/*
```

### `package.json` Scripts

Ensure these scripts exist:

```json
{
    "scripts": {
        "dev": "vite",
        "build": "tsc && vite build",
        "preview": "vite preview",
        "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
        "type-check": "tsc --noEmit"
    }
}
```

### SPA Routing Configuration

Create `public/_redirects` for client-side routing:

```
/*    /index.html   200
```

Or configure in Amplify Console:
1. Go to **App settings** → **Rewrites and redirects**
2. Add rule:
   - Source: `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/>`
   - Target: `/index.html`
   - Type: `200 (Rewrite)`

---

## Custom Domain Setup

### Using Route 53 (Recommended)

1. In Amplify Console, go to **Domain management**
2. Click **Add domain**
3. Enter domain: `expenses.as3.com` (or your domain)
4. Select **Configure domain**
5. For subdomains:
   - `expenses.as3.com` → `main` branch
6. Amplify will show DNS records to add

### Manual DNS Configuration

If not using Route 53, add these records:

| Type | Name | Value |
|------|------|-------|
| CNAME | expenses | `d1234abcd.cloudfront.net` (from Amplify) |
| CNAME | _acme-challenge.expenses | `xxx.acm-validations.aws` (for SSL) |

Wait 10-30 minutes for SSL certificate validation.

---

## CI/CD Pipeline

### Automatic Deployments

With GitHub connected, Amplify automatically:
1. Detects pushes to `main` branch
2. Triggers a new build
3. Deploys if build succeeds
4. Keeps previous version for rollback

### Branch Previews

Enable preview deployments for pull requests:
1. Go to **App settings** → **Previews**
2. Toggle **Enable previews**
3. Each PR gets a unique preview URL

### Manual Deployment

To deploy without pushing to Git:

```bash
# Install Amplify CLI
npm install -g @aws-amplify/cli

# Configure CLI
amplify configure

# Deploy manually
amplify publish
```

---

## Monitoring & Logs

### Build Logs

1. Go to Amplify Console → Your App
2. Click on any deployment
3. View **Build logs** in real-time

### Access Logs

Access logs are available in CloudWatch:
1. Go to **CloudWatch** in AWS Console
2. Find log group: `/aws/amplify/xxx`
3. View access logs and errors

### Alerts

Set up CloudWatch Alarms for:
- Build failures
- High error rates (4xx, 5xx)
- Latency spikes

```bash
# Example: Create alarm for build failures
aws cloudwatch put-metric-alarm \
    --alarm-name "amplify-build-failures" \
    --metric-name BuildDuration \
    --namespace AWS/Amplify \
    --statistic Sum \
    --period 300 \
    --threshold 1 \
    --comparison-operator GreaterThanThreshold \
    --alarm-actions arn:aws:sns:us-east-1:123456789:alerts
```

---

## Rollback Procedures

### Quick Rollback via Console

1. Go to Amplify Console → Your App
2. Click **Deployments** in left sidebar
3. Find the last working deployment
4. Click **Redeploy this version**

### Rollback via Git

```bash
# Find the last working commit
git log --oneline

# Revert to that commit
git revert HEAD

# Push to trigger new deployment
git push origin main
```

### Emergency Rollback

If the app is completely broken:

1. In Amplify Console, click **Actions** → **Disconnect repository**
2. Reconnect and deploy a specific commit/tag
3. Or manually upload a `dist` folder via Amplify CLI

---

## Security Checklist

### Pre-Deployment

- [ ] Remove all console.log statements with sensitive data
- [ ] Verify `.env` files are in `.gitignore`
- [ ] Check Supabase RLS policies are enabled
- [ ] Review API key scopes (use anon key, not service role)
- [ ] Enable HTTPS only (Amplify default)

### Post-Deployment

- [ ] Test authentication flow
- [ ] Verify Supabase connection works
- [ ] Check for exposed secrets in browser dev tools
- [ ] Test all critical user flows
- [ ] Enable monitoring and alerts

### Ongoing Security

- [ ] Rotate Supabase keys quarterly
- [ ] Review Amplify access logs monthly
- [ ] Keep dependencies updated (npm audit)
- [ ] Monitor for security advisories

---

## Troubleshooting

### Build Failures

| Error | Solution |
|-------|----------|
| `npm ci` failed | Check package-lock.json is committed |
| TypeScript errors | Run `npm run type-check` locally first |
| Missing env vars | Check Amplify environment variables |
| Out of memory | Increase build instance size |

### Runtime Issues

| Issue | Solution |
|-------|----------|
| Blank page | Check browser console for errors |
| API errors | Verify Supabase URL and key |
| CORS errors | Check Supabase CORS settings |
| 404 on refresh | Configure SPA redirects |

### Common Commands

```bash
# Test production build locally
npm run build
npm run preview

# Check for TypeScript errors
npm run type-check

# Check for linting issues
npm run lint

# Analyze bundle size
npx vite-bundle-visualizer
```

---

## Cost Estimation

### AWS Amplify Pricing (as of Dec 2025)

| Resource | Free Tier | After Free Tier |
|----------|-----------|-----------------|
| Build minutes | 1000/month | $0.01/min |
| Hosting | 15 GB/month | $0.023/GB |
| Requests | 500k/month | $0.30/million |

**Estimated monthly cost for AS3:** $0-5/month (within free tier for low traffic)

### Cost Optimization

1. **Use caching** - CloudFront caches static assets
2. **Optimize images** - Compress before upload
3. **Bundle size** - Keep JS bundle small
4. **Branch previews** - Delete old previews

---

## Appendix: Full `amplify.yml`

```yaml
version: 1
applications:
  - frontend:
      phases:
        preBuild:
          commands:
            - npm ci --production=false
        build:
          commands:
            - echo "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" >> .env
            - echo "VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY" >> .env
            - echo "VITE_APP_NAME=$VITE_APP_NAME" >> .env
            - npm run build
      artifacts:
        baseDirectory: dist
        files:
          - '**/*'
      cache:
        paths:
          - node_modules/**/*
    appRoot: expense-dashboard
```

---

## Appendix: Alternative Deployment Options

### Option 2: S3 + CloudFront (Manual)

If Amplify is unavailable:

```bash
# Build locally
npm run build

# Create S3 bucket
aws s3 mb s3://as3-expense-dashboard

# Upload build
aws s3 sync dist/ s3://as3-expense-dashboard --delete

# Create CloudFront distribution
# (use AWS Console for easier setup)
```

### Option 3: Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

Add environment variables in Vercel dashboard.

---

*End of Deployment Guide*
