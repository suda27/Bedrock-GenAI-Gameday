# Quick Start - Deploy with Your Bedrock API Key

## ⚠️ Important: Store API Key in SSM First!

Since Bedrock API keys can be very long, we use **SSM Parameter Store** instead of CloudFormation parameters.

## Step 1: Store API Key in SSM (One-Time Setup)

```bash
aws ssm put-parameter \
  --name "/poc/bedrock-api-key" \
  --value "YOUR_API_KEY" \
  --type "String" \
  --region ap-south-1
```

## Step 2: Deploy (No Parameters Needed!)

### Option 1: Standard Deploy
```bash
sam build && sam deploy --guided
```

### Option 2: Fast Sync with Watch Mode (Recommended) ⚡
```bash
sam sync --stack-name aws-gameday --watch
```

The `--watch` flag will automatically sync your code changes as you develop!

## Step-by-Step

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Store API Key in SSM:**
   ```bash
   aws ssm put-parameter \
     --name "/aws-gameday/bedrock-api-key" \
     --value "YOUR_API_KEY_HERE" \
     --type "SecureString" \
     --region ap-south-1
   ```

3. **Build:**
   ```bash
   sam build
   ```

4. **Deploy Options:**

   **Option A - Standard Deploy (first time - guided):**
   ```bash
   sam deploy --guided
   ```

   **Option B - Fast Sync (recommended for development):**
   ```bash
   sam sync --stack-name aws-gameday --watch
   ```

## Using sam sync --watch

**Benefits:**
- ✅ Faster code sync (skips full CloudFormation updates)
- ✅ Automatically watches for file changes
- ✅ Great for rapid development iterations
- ✅ No parameters needed - API key is in SSM

**First Time:**
```bash
sam sync --stack-name aws-gameday --watch
```

**After Stack Exists:**
```bash
sam sync --stack-name aws-gameday --watch
```

**To Update API Key (Redeploy Required):**
```bash
aws ssm put-parameter \
  --name "/poc/bedrock-api-key" \
  --value "YOUR_NEW_API_KEY" \
  --type "String" \
  --overwrite \
  --region ap-south-1

# Redeploy to pick up the new key
sam sync --stack-name aws-gameday
```

The API key is resolved at deployment time via CloudFormation dynamic reference, so a redeploy is needed.

## What Changed

✅ API key stored in **SSM Parameter Store** (no length limits!)  
✅ API key resolved at deployment time via CloudFormation dynamic reference  
✅ No CloudFormation parameters needed  
✅ Easy to update - update SSM parameter and redeploy  
✅ `sam sync --watch` works perfectly  

## Notes

- The API key is stored in SSM Parameter Store as a String type
- Lambda gets the key from environment variable (resolved at deployment time)
- If your key expires, update it in SSM and redeploy the stack
- The key is sent as `Authorization: Bearer <api-key>` header to Bedrock
- `sam sync --watch` is perfect for Gameday - fast iterations and quick testing!
