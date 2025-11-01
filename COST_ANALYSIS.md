# Complete Cost Analysis - AWS Gameday Project

## Overview
This document provides a comprehensive cost analysis of all AWS services used in this project.

---

## ✅ Active Services (Currently In Use)

### 1. **AWS Lambda** 💰
**Configuration:**
- Memory: 256 MB
- Timeout: 30 seconds
- Runtime: Node.js 20.x
- Architecture: x86_64

**Pricing (as of 2024):**
- First 1M requests/month: **FREE**
- $0.20 per 1M requests after free tier
- $0.0000166667 per GB-second
- 400,000 GB-seconds free per month

**Estimated Cost:**
- **Typical usage (100-1000 requests): $0.00** (within free tier)
- **Heavy usage (10,000 requests): ~$0.00-0.02**
- **Cost per request: ~$0.0000002** (after free tier)

**Cost Protection:** ✅ Already optimized (low memory, reasonable timeout)

---

### 2. **API Gateway REST API** 💰
**Configuration:**
- Type: REST API
- Stage: dev

**Pricing (as of 2024):**
- First 1M API calls/month: **FREE** (for REST APIs)
- $3.50 per 1M API calls after free tier
- No data transfer charges for first 1GB/month

**Estimated Cost:**
- **Typical usage (100-1000 requests): $0.00** (within free tier)
- **Heavy usage (10,000 requests): $0.00** (within free tier)
- **Cost per request: ~$0.0000035** (after free tier)

**Cost Protection:** ✅ REST API has generous free tier

---

### 3. **Amazon Bedrock (Claude 3 Haiku)** 💰💰
**This is your MAIN cost driver!**

**Configuration:**
- Model: Claude 3 Haiku (cheapest Claude model)
- Max input: 1000 characters (~250 tokens)
- Max output: 256 tokens
- Input validation: ✅ Enabled

**Pricing (as of 2024):**
- Input: **$0.25 per 1M tokens**
- Output: **$1.25 per 1M tokens**

**Estimated Cost Per Request:**
- Average input: ~200 tokens → **$0.00005** (input)
- Average output: ~150 tokens → **$0.0001875** (output)
- **Total per request: ~$0.0002375** (~0.024 cents)

**Monthly Scenarios:**
- **100 requests**: ~$0.02
- **1,000 requests**: ~$0.24
- **10,000 requests**: ~$2.40
- **100,000 requests**: ~$24.00

**Cost Protection Measures:** ✅✅✅
- ✅ Using cheapest Claude model (Haiku)
- ✅ Input length limit (1000 chars = ~250 tokens)
- ✅ Output token limit (256 tokens max)
- ✅ Input validation prevents large requests
- ✅ Token usage logging for monitoring

**⚠️ WARNING:** If you accidentally change to:
- Claude 3 Sonnet: **12x more expensive** (~$2.88 per 10k requests)
- Claude 3 Opus: **60x more expensive** (~$144 per 10k requests)

---

### 4. **AWS Systems Manager (SSM) Parameter Store** 💰
**Configuration:**
- 1 parameter stored
- Type: String (non-encrypted)

**Pricing (as of 2024):**
- Standard parameters: **FREE**
- Advanced parameters: $0.05 per parameter per month

**Estimated Cost:**
- **$0.00** (using standard parameters)

**Cost Protection:** ✅ Using free tier

---

### 5. **CloudWatch Logs** 💰
**Configuration:**
- Lambda logs all invocations
- API Gateway access logs (if enabled)

**Pricing (as of 2024):**
- First 5 GB ingested/month: **FREE**
- First 5 GB stored/month: **FREE**
- $0.50 per GB ingested after free tier
- $0.03 per GB stored per month after free tier

**Estimated Cost:**
- **Typical usage: $0.00** (within free tier)
- **Heavy usage (10k requests): ~$0.00-0.10** (depends on log size)

**Cost Protection:** ✅ Generous free tier covers most use cases

---

## 🔒 Services With Permissions (Not Currently Used)

These services have **full permissions** in your IAM role but are **NOT actively used**, so they cost **$0.00**:

- **DynamoDB**: $0.00 (no tables created)
- **S3**: $0.00 (no buckets accessed)
- **Step Functions**: $0.00 (no state machines created)
- **OpenSearch**: $0.00 (no domains created)

**Note:** IAM permissions don't cost money. Only actual resource usage charges.

---

## 📊 Total Cost Summary

### Typical Gameday Usage (100-1,000 requests):
| Service | Cost |
|---------|------|
| Lambda | $0.00 (free tier) |
| API Gateway | $0.00 (free tier) |
| Bedrock (Haiku) | $0.02 - $0.24 |
| SSM Parameter Store | $0.00 |
| CloudWatch Logs | $0.00 (free tier) |
| **TOTAL** | **~$0.02 - $0.24** |

### Heavy Usage (10,000 requests):
| Service | Cost |
|---------|------|
| Lambda | $0.00 (free tier) |
| API Gateway | $0.00 (free tier) |
| Bedrock (Haiku) | ~$2.40 |
| SSM Parameter Store | $0.00 |
| CloudWatch Logs | ~$0.05 |
| **TOTAL** | **~$2.45** |

### Very Heavy Usage (100,000 requests):
| Service | Cost |
|---------|------|
| Lambda | ~$0.02 |
| API Gateway | $0.00 (free tier) |
| Bedrock (Haiku) | ~$24.00 |
| SSM Parameter Store | $0.00 |
| CloudWatch Logs | ~$0.50 |
| **TOTAL** | **~$24.52** |

---

## 🎯 Cost Optimization Status

### ✅ Already Implemented:
1. **Cheapest Claude model** (Haiku vs Opus/Sonnet)
2. **Input validation** (max 1000 chars)
3. **Output token limits** (256 tokens max)
4. **Free tier services** (Lambda, API Gateway)
5. **Standard SSM parameters** (free)
6. **Efficient memory allocation** (256 MB Lambda)
7. **Token usage logging** (for monitoring)

### 💡 Potential Further Optimizations (if needed):
1. Reduce `MAX_TOKENS` from 256 to 128 (if responses are usually shorter)
2. Reduce `MAX_INPUT_LENGTH` from 1000 to 500 (if inputs are usually shorter)
3. Use provisioned concurrency only if needed (costs extra)
4. Enable API Gateway caching (if requests repeat)

---

## 🚨 Cost Alerts Setup (CRITICAL!)

**Set these up NOW to avoid surprises:**

```bash
# Create billing alerts via AWS Console or CLI
# Recommended thresholds:
- $5 alert (early warning)
- $10 alert (getting significant)
- $50 alert (stop immediately!)
```

**Steps:**
1. AWS Console → Billing Dashboard → Preferences
2. Enable "Receive Billing Alerts"
3. CloudWatch → Alarms → Create billing alarm
4. Set thresholds and email notifications

---

## 📈 Cost Monitoring

### Real-Time Monitoring:
- **CloudWatch Metrics**: Lambda invocations, duration, errors
- **Bedrock Usage**: Token counts in Lambda response logs
- **API Gateway Metrics**: Request count, latency, 4xx/5xx errors

### Monthly Review:
- Check AWS Cost Explorer
- Review Bedrock usage statistics
- Verify all services are necessary

---

## 🎮 For AWS Gameday

**Recommended Approach:**
- **Budget**: Plan for ~$5-10 maximum (very conservative)
- **Monitor**: Check costs every hour during gameday
- **Emergency Stop**: If costs exceed $10, consider reducing requests or switching to mock responses
- **Post-Gameday**: Review actual costs and optimize if needed

**Estimated Gameday Cost: $0.50 - $5.00** (assuming 500-5000 requests)

---

## ✅ Bottom Line

**For typical Gameday usage, this project is VERY cost-effective:**
- Most services are free (within free tier)
- Bedrock costs are controlled and predictable
- Total cost should be **<$5** for typical usage
- Well-protected against runaway costs

**Main Cost Driver:** Bedrock API calls (~95% of total cost)

**Risk Level:** 🟢 **LOW** (with current safeguards in place)

