# Setting Up SSM Parameter Store for Bedrock API Key

Since Bedrock API keys can exceed CloudFormation's 4096 character limit, we use AWS Systems Manager (SSM) Parameter Store to store the API key securely.

## Step 1: Store API Key in SSM Parameter Store

**Option A: Using AWS CLI (Recommended)**

**For SecureString (encrypted - recommended):**
```bash
aws ssm put-parameter \
  --name "/poc/bedrock-api-key" \
  --value "your-bedrock-api-key-here" \
  --type "SecureString" \
  --region ap-south-1
```

**For String (plain text - use if SecureString has issues):**
```bash
aws ssm put-parameter \
  --name "/poc/bedrock-api-key" \
  --value "your-bedrock-api-key-here" \
  --type "String" \
  --region ap-south-1
```

**⚠️ Important:** The template uses `{{resolve:ssm:...}}` for String type. If you use SecureString, change the template to use `{{resolve:ssm-secure:...}}`

**Option B: Using AWS Console**

1. Go to AWS Systems Manager → Parameter Store
2. Click "Create parameter"
3. Set:
   - **Name**: `/poc/bedrock-api-key`
   - **Type**: `String` (or `SecureString` if you want encryption - then update template to use `ssm-secure`)
   - **Value**: Paste your Bedrock API key
4. Click "Create parameter"

## Step 2: Deploy Your Stack

Now you can deploy without passing the API key as a parameter:

```bash
sam build
sam sync --stack-name aws-gameday --watch
```

Or standard deploy:

```bash
sam deploy --guided
```

## Step 3: Update API Key (When Needed)

When your short-term API key expires, update it in SSM:

```bash
aws ssm put-parameter \
  --name "/poc/bedrock-api-key" \
  --value "your-new-api-key" \
  --type "String" \
  --overwrite \
  --region ap-south-1
```

**Note:** After updating the SSM parameter, you need to **update the CloudFormation stack** for the Lambda to get the new value (since it's resolved at deployment time):

```bash
sam sync --stack-name aws-gameday
# or
sam deploy
```

## Benefits

✅ No CloudFormation parameter length limits  
✅ Secure storage (can use SecureString for encryption)  
✅ API key resolved at deployment time (no runtime SSM calls)  
✅ Faster Lambda execution (no SSM API calls needed)  

## Troubleshooting

**Error: "Secure ssm-secure prefix was used for non-secure parameter"**
- Your SSM parameter is `String` type but template uses `ssm-secure`
- **Solution**: Change template to use `{{resolve:ssm:/poc/bedrock-api-key}}` (already done)

**Error: "API Key not configured"**
- Verify the parameter exists: `aws ssm get-parameter --name "/poc/bedrock-api-key"`
- Ensure you're in the correct AWS region
- Check that your deployment credentials have permission to read the SSM parameter

**Error: "AccessDeniedException"**
- Verify the SSM parameter name matches exactly: `/poc/bedrock-api-key`
- Check that your AWS credentials used for deployment have SSM read permissions

