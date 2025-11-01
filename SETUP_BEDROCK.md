# Bedrock Setup Guide - Critical Steps Before Deployment

## ⚠️ IMPORTANT: Enable Bedrock Model First!

Before deploying, you **MUST** enable the Bedrock model in your AWS account:

1. Go to AWS Console → **Amazon Bedrock**
2. Navigate to **Model access** (left sidebar)
3. Click **"Manage model access"** or **"Enable model access"**
4. Select **"Claude 3 Haiku"** (the model we're using - it's the cheapest!)
5. Click **"Save changes"**

**Why this matters**: Without enabling the model, your Lambda will get `AccessDeniedException` errors.

## Cost Protection Features Already Built-In:

✅ **Input length limit**: 1000 characters max  
✅ **Output token limit**: 256 tokens max (prevents runaway costs)  
✅ **Cheap model**: Using Claude Haiku (~$0.25 per 1M input tokens)  
✅ **Token usage logging**: All requests log token usage for tracking  
✅ **Connection reuse**: Bedrock client initialized outside handler

## Estimated Cost Per Request:

With default settings (1000 char input + 256 token output):
- **Input tokens**: ~250 tokens (assuming ~4 chars per token)
- **Output tokens**: ~256 tokens (our limit)
- **Cost per request**: ~**$0.0001** (0.01 cents)
- **1000 requests**: ~**$0.10** (10 cents)

## Before Gameday - Set Up Billing Alerts:

1. Go to AWS Console → **Billing Dashboard**
2. Click **"Preferences"**
3. Enable **"Receive Billing Alerts"**
4. Go to **CloudWatch** → **Alarms** → Create billing alarm
5. Set thresholds: $5, $10, $50

## Testing Locally:

```bash
# Install dependencies
npm install

# Test with SAM Local (requires Docker)
sam local start-api

# Test the endpoint
curl -X POST http://localhost:3000/hello \
  -H "Content-Type: application/json" \
  -d '{"input": "What is AWS?"}'
```

## Model Options (if you need to change):

In `template.yaml`, change `BEDROCK_MODEL_ID`:

**Cheap (for practice):**
- `anthropic.claude-3-haiku-20240307-v1:0` ← **Current (Recommended)**

**Moderate cost:**
- `anthropic.claude-3-sonnet-20240229-v1:0`

**Expensive (avoid for practice!):**
- `anthropic.claude-3-opus-20240229-v1:0` ← **10x more expensive!**

## Common Issues:

**AccessDeniedException**: Model not enabled in Bedrock console  
**ValidationException**: Check model ID format  
**Timeout**: Increase Lambda timeout in template.yaml (currently 30s)

