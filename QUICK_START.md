# Quick Start - Deploy with Your Bedrock API Key

## ⚠️ Important: Store API Key in SSM First!

Since Bedrock API keys can be very long, we use **SSM Parameter Store** instead of CloudFormation parameters.

## Step 1: Store API Key in SSM (One-Time Setup)

```bash
aws ssm put-parameter \
  --name "/aws-gameday/bedrock-api-key" \
  --value "YOUR_API_KEY" \
  --type "SecureString" \
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

**To Update API Key (No Redeploy Needed!):**
```bash
aws ssm put-parameter \
  --name "/aws-gameday/bedrock-api-key" \
  --value "YOUR_NEW_API_KEY" \
  --type "SecureString" \
  --overwrite \
  --region ap-south-1
```

Lambda will automatically pick up the new key (cached for 5 minutes).

## What Changed

✅ API key stored in **SSM Parameter Store** (no length limits!)  
✅ Lambda fetches key from SSM at runtime (cached for 5 min)  
✅ No CloudFormation parameters needed  
✅ Easy to update - just update SSM parameter  
✅ `sam sync --watch` works perfectly  

## Notes

- The API key is stored securely in SSM as a SecureString (encrypted)
- Lambda automatically fetches it on each invocation
- If your key expires, just update it in SSM - no redeploy needed!
- The key is sent as `Authorization: Bearer <api-key>` header to Bedrock
- `sam sync --watch` is perfect for Gameday - fast iterations and quick testing!
