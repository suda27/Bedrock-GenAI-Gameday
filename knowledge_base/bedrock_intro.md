# Introduction to Amazon Bedrock

**Amazon Bedrock** is a fully managed service to build and scale Generative AI applications using foundation models (FMs).  

**Supported Models:**  
- Anthropic Claude  
- Amazon Titan  
- Meta Llama  
- Mistral AI models

**Key Features:**  
- Single API to access multiple foundation models.  
- Integration with AWS security, monitoring, and compliance tools.  
- Pay-per-use pricing — no need to manage GPU infrastructure.

**Common Use Cases:**  
- Intelligent chatbots  
- Summarization and content generation  
- Code and document assistants  
- Knowledge retrieval via RAG pipelines

**Example Flow:**  
1. Retrieve user query  
2. Gather context (using Amazon Kendra or OpenSearch)  
3. Pass combined context and query to Bedrock model  
4. Return summarized, contextual answer
