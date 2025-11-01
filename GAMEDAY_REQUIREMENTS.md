# AWS Gameday Scenario: TravelBuddy AI Travel Assistant

## 📋 Project Overview

**Company:** TravelBuddy  
**Goal:** Build an AI-powered travel support assistant that helps end users answer queries about different travel packages across Asia.

**Core Use Case:** Users can ask natural language questions about travel packages, and the system provides accurate, contextual answers based on the travel package documentation.

---

## 🎯 Key Requirements

### 1. **RAG (Retrieval Augmented Generation) Implementation**
   - Retrieve relevant context from travel package documents
   - Use vector embeddings to find semantically similar content
   - Generate accurate responses using retrieved context

### 2. **Query Caching (Semantic Cache)**
   - Cache responses to avoid redundant LLM calls (cost optimization)
   - Use semantic hash matching (similar queries → same cached answer)
   - Store cache in DynamoDB for fast retrieval

### 3. **Knowledge Base**
   - Source: `travel_details.md` file stored in S3
   - Contains: 10+ travel packages across Asia (Thailand, Singapore, Malaysia, Indonesia, Vietnam, Japan)
   - Each package includes: Cost, duration, meals, highlights, accommodation details

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────┐
│          User Interface (UI)            │
│  (React/Amplify or Simple HTML page)    │
└─────────────────┬───────────────────────┘
                  │ HTTP Request
                  ▼
┌─────────────────────────────────────────┐
│           API Gateway                   │
│      (POST /query endpoint)             │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│         AWS Lambda Function             │
│      (Node.js/Python handler)           │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             ▼             ▼
┌─────────┐  ┌─────────┐  ┌──────────┐
│DynamoDB │  │OpenSearch│  │ Bedrock  │
│(Cache)  │  │(Vector   │  │ (Claude/ │
│         │  │ Search)  │  │  Titan)  │
└─────────┘  └─────────┘  └──────────┘
                  │
                  ▼
            ┌─────────┐
            │   S3    │
            │(Docs)   │
            └─────────┘
```

---

## 🔄 Lambda Execution Flow (7 Steps)

### **Step 1: Check Cache**
- Query DynamoDB using semantic hash of user query
- If match found → **Return cached response** (skip to Step 7)
- If not found → Continue to Step 2

### **Step 2: Create Query Embedding**
- Use **Bedrock Titan Embeddings Model** to generate vector embedding of user query
- Converts natural language query to high-dimensional vector representation

### **Step 3: Vector Search (RAG Retrieval)**
- Query **OpenSearch** vector index with the query embedding
- Retrieve top-K most semantically similar document chunks from knowledge base
- Returns relevant passages from `travel_details.md` that match the query intent

### **Step 4: Construct RAG Context**
- Combine retrieved document chunks into context
- Format: "Based on the following travel packages: [retrieved chunks]"

### **Step 5: Generate Response with Bedrock LLM**
- Send to **Bedrock Claude 3 Haiku**:
  - System prompt: "You are a helpful travel assistant for TravelBuddy..."
  - User query: Original user question
  - Context: Retrieved document chunks from OpenSearch
- LLM generates accurate, contextual answer

### **Step 6: Cache & Log Response**
- Store in **DynamoDB**:
  - Semantic hash of query (for future cache hits)
  - LLM response
  - Timestamp
  - Retrieved document chunks (for audit)
- Optionally log to S3 for analysis

### **Step 7: Return Response**
- Send final answer to API Gateway
- Return to user via frontend

---

## 📊 AWS Services Required

| Service | Purpose | Current Status |
|---------|---------|----------------|
| **API Gateway** | REST API endpoint | ✅ Already configured |
| **Lambda** | Main orchestration logic | ✅ Already configured |
| **DynamoDB** | Query cache + chat history | ❌ Need to create table |
| **OpenSearch** | Vector search for RAG | ❌ Need to create domain & index |
| **Bedrock** | LLM (Claude) + Embeddings (Titan) | ✅ Already configured |
| **S3** | Knowledge base storage | ❌ Need to create bucket & upload docs |
| **CloudWatch** | Logging & monitoring | ✅ Already configured |

---

## 📁 Data Structure

### **S3 Knowledge Base**
- File: `travel_details.md`
- Location: S3 bucket (to be created)
- Content: 10 travel packages with details

### **DynamoDB Cache Schema**
```
Partition Key: query_hash (string) - Semantic hash of query
Attributes:
  - query_text (string)
  - response (string)
  - context_chunks (list) - Retrieved document chunks used
  - timestamp (number)
  - token_usage (object) - Input/output tokens for cost tracking
```

### **OpenSearch Index Schema**
```
Index Name: travel-knowledge-base
Fields:
  - id (string)
  - chunk_text (text) - Document chunk content
  - package_name (keyword)
  - package_location (keyword)
  - embedding (vector) - Titan embedding vector
  - metadata (object)
```

---

## 💰 Cost Considerations

### **New Components:**
- **OpenSearch**: ~$0.10/hour for t3.small instance (~$72/month if always on)
  - For Gameday: Use smallest instance, can stop when not in use
- **DynamoDB**: 
  - Free tier: 25 GB storage, 25 WCU, 25 RCU
  - For Gameday: Should be free or <$1
- **S3**: 
  - First 5 GB free
  - For Gameday: <$0.01 (document is tiny)

### **Cost Protection:**
- ✅ Semantic caching reduces Bedrock calls by 30-70%
- ✅ Already using cheapest Claude model (Haiku)
- ✅ Token limits in place
- ⚠️ OpenSearch running costs need monitoring

---

## 🎯 Success Criteria for Gameday

1. ✅ User can query travel packages via API
2. ✅ System retrieves relevant context from knowledge base
3. ✅ Responses are accurate and contextual
4. ✅ Cache mechanism reduces redundant LLM calls
5. ✅ System handles various query types:
   - Package pricing questions
   - Destination highlights
   - Duration inquiries
   - Comparison queries
   - Custom package details

---

## 🚀 Implementation Phases

### **Phase 1: Foundation** (Current State)
- ✅ Lambda function with Bedrock integration
- ✅ API Gateway endpoint
- ✅ Basic cost controls

### **Phase 2: Knowledge Base Setup**
- ⏳ Create S3 bucket
- ⏳ Upload `travel_details.md`
- ⏳ Chunk document for vector search

### **Phase 3: Vector Search (OpenSearch)**
- ⏳ Create OpenSearch domain
- ⏳ Create vector index
- ⏳ Generate embeddings for document chunks
- ⏳ Ingest embeddings into OpenSearch

### **Phase 4: Caching (DynamoDB)**
- ⏳ Create DynamoDB table
- ⏳ Implement semantic hash generation
- ⏳ Implement cache check/store logic

### **Phase 5: RAG Integration**
- ⏳ Integrate OpenSearch query in Lambda
- ⏳ Implement context retrieval and formatting
- ⏳ Update Bedrock prompt with RAG context

### **Phase 6: Optimization & Testing**
- ⏳ Test various query types
- ⏳ Validate cache hit rates
- ⏳ Monitor costs and performance

---

## 📝 Sample Queries (Test Cases)

1. "What's the cost for a 4-night Bangkok package?"
2. "Show me packages in Bali under ₹90,000"
3. "What's included in the Singapore Family Fun package?"
4. "Compare Thailand and Malaysia packages"
5. "What activities are available in Phuket?"
6. "Tell me about Japan package highlights"

---

## ⚠️ Gameday Considerations

1. **OpenSearch Setup**: May take 15-30 minutes to create domain
2. **Initial Embedding Generation**: One-time cost to embed all documents
3. **Cache Warming**: Consider pre-loading common queries
4. **Error Handling**: Graceful degradation if OpenSearch unavailable
5. **Cost Monitoring**: Watch OpenSearch + Bedrock costs during event

---

## 🎓 Learning Objectives

This scenario demonstrates:
- ✅ RAG pattern implementation
- ✅ Vector search with OpenSearch
- ✅ Semantic caching for cost optimization
- ✅ Multi-service AWS integration
- ✅ Production-ready AI application architecture

---

**Status:** Ready to proceed with implementation! 🚀

