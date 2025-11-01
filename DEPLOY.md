# Deployment Guide with Bedrock API Key

## ⚠️ Important: API Key Storage

Bedrock API keys can be very long (exceeding 4096 characters), so we use **AWS Systems Manager (SSM) Parameter Store** instead of CloudFormation parameters.

## Prerequisites

1. AWS CLI configured with appropriate credentials
2. SAM CLI installed
3. Node.js dependencies installed: `npm install`

## Step 0: Store API Key in SSM Parameter Store (One-Time Setup)

**Before deploying**, store your Bedrock API key in SSM:

```bash
aws ssm put-parameter \
  --name "/poc/bedrock-api-key" \
  --value "your-bedrock-api-key-here" \
  --type "String" \
  --region ap-south-1
```

See [SETUP_SSM.md](./SETUP_SSM.md) for detailed instructions.

## Deployment Steps

### 1. Deploy Stack (No Parameters Needed!)

Once the API key is stored in SSM, you can deploy without any parameters:

```bash
sam build

sam deploy --guided
```

The Lambda will automatically fetch the API key from SSM Parameter Store at runtime.

### 2. Fast Development with `sam sync --watch` ⚡

For rapid development and testing, use `sam sync` with watch mode. This syncs code changes quickly without full CloudFormation updates:

**Initial deployment (creates the stack):**
```bash
sam sync --stack-name aws-gameday --watch
```

**After stack is created, you can use:**
```bash
sam sync --stack-name aws-gameday --watch
```

The `--watch` flag will:
- Watch for code changes and automatically sync them
- Lambda automatically fetches API key from SSM on each invocation
- Provide faster iterations during development

### 3. Update API Key After Deployment

If you need to update the API key (e.g., when short-term key expires), **just update it in SSM** - no need to redeploy:

```bash
aws ssm put-parameter \
  --name "/poc/bedrock-api-key" \
  --value "your-new-api-key" \
  --type "String" \
  --overwrite \
  --region ap-south-1
```

**Note:** After updating the SSM parameter, you need to redeploy the stack for the Lambda to get the new value (since it's resolved at deployment time via CloudFormation dynamic reference):

```bash
sam sync --stack-name aws-gameday
```

## Security Notes

⚠️ **Important**:
- The API key is stored in **SSM Parameter Store** as a SecureString (encrypted)
- Lambda fetches it at runtime (cached for 5 minutes)
- No CloudFormation parameter length limits!
- Easy to update without redeploying - just update the SSM parameter
- Short-term keys expire after a certain time - monitor and rotate as needed

## Testing After Deployment

Get your API endpoint from the CloudFormation outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name bedrock-genai-gameday \
  --query 'Stacks[0].Outputs[?OutputKey==`HelloWorldApi`].OutputValue' \
  --output text
```

Test the endpoint:
```bash
curl -X POST https://YOUR-API-ID.execute-api.ap-south-1.amazonaws.com/dev/hello \
  -H "Content-Type: application/json" \
  -d '{"input": "What is AWS?"}'
```

## Troubleshooting

**Error: "Failed to fetch Bedrock API Key from SSM"**
- Verify the SSM parameter exists: `aws ssm get-parameter --name "/poc/bedrock-api-key"`
- Check Lambda has SSM read permissions (already included in template)
- Ensure you're in the correct AWS region

**Error: "Parameter length is greater than 4096"**
- This error should no longer occur - we now use SSM Parameter Store
- If you see this, make sure you're using the updated template without CloudFormation parameters

**Error: "Authentication failed"**
- Verify the API key is valid and not expired
- Check if the key needs to be regenerated

**Error: "AccessDeniedException"**
- Ensure the Bedrock model is enabled in your AWS account
- Verify the API key has proper permissions

