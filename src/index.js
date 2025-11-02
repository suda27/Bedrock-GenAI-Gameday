/**
 * AWS Lambda function handler with Bedrock LLM integration
 * Includes query caching with DynamoDB for cost optimization
 * Uses API Key authentication for Bedrock (resolved from SSM via CloudFormation dynamic reference)
 */
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const region = process.env.APP_REGION || 'ap-south-1';

// Initialize clients outside handler for connection reuse (cost optimization)
const bedrockClient = new BedrockRuntimeClient({ region });
const dynamoDBClient = new DynamoDBClient({ region });
const s3Client = new S3Client({ region });

// Bedrock API Key resolved from SSM Parameter Store via CloudFormation dynamic reference
const BEDROCK_API_KEY = process.env.BEDROCK_API_KEY;

// Cost control constants from environment variables
const MAX_INPUT_LENGTH = parseInt(process.env.MAX_INPUT_LENGTH || '1000', 10);
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '256', 10);
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'travelbuddy-query-cache';
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'gameday-bedrock';
const S3_DOCUMENT_KEY = process.env.S3_DOCUMENT_KEY || 'travel_details.md';

// Cache TTL: 24 hours (86400 seconds)
const CACHE_TTL_SECONDS = 24 * 60 * 60;

// In-memory cache for S3 travel document (reused across Lambda invocations)
let cachedTravelDoc = null;
let travelDocCacheTimestamp = null;
const TRAVEL_DOC_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache TTL

// Common stop words to remove during normalization for better cache hits
const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'were', 'will', 'with', 'what', 'which', 'who',
    'where', 'when', 'how', 'can', 'could', 'should', 'would'
]);

/**
 * Normalize query text for better semantic cache matching
 * Handles variations like:
 * - "What are the travel packages available from Bengaluru to Bangkok?"
 * - "What are the travel packages from Bengaluru to Bangkok?"
 * Both will normalize to similar strings (removing stop words, normalizing whitespace)
 */
function normalizeQuery(query) {
    if (!query) return '';
    
    // Convert to lowercase
    let normalized = query.toLowerCase();
    
    // Remove punctuation (keep spaces and alphanumeric)
    normalized = normalized.replace(/[^\w\s]/g, ' ');
    
    // Normalize whitespace (multiple spaces to single space)
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    // Split into words and remove stop words
    const words = normalized.split(' ').filter(word => {
        // Remove empty strings and stop words
        return word.length > 0 && !STOP_WORDS.has(word);
    });
    
    // Join words back with single space
    normalized = words.join(' ').trim();
    
    return normalized;
}

/**
 * Generate SHA-256 hash of normalized query text for cache key
 * Normalization helps catch semantically similar queries
 */
function generateQueryHash(query) {
    const normalized = normalizeQuery(query);
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Check if a query is a generic/fallback suggestion that requires context
 * These queries are too generic and should always go to LLM with conversation history
 */
function isGenericFallbackQuery(query) {
    const genericQueries = [
        'tell me more',
        'what else can you help with',
        'what else',
        'show me more',
        'tell me more about this',
        'what else can you help',
        'what are the other options',
        'more information',
        'any other',
        'other options'
    ];
    
    const normalized = normalizeQuery(query);
    return genericQueries.includes(normalized.toLowerCase().trim());
}

/**
 * Generate suggested questions based on travel document and conversation context
 * Includes caching to reduce Bedrock calls and handle scale
 * Includes retry logic with exponential backoff for throttling errors
 */
async function generateSuggestions(conversationHistory = [], retryCount = 0) {
    const maxRetries = 2;
    const baseDelay = 1000; // 1 second base delay
    
    // Create cache key for suggestions
    // For initial suggestions (no history): use static key "initial_suggestions"
    // For follow-up: hash the last exchange (last user + assistant messages)
    let suggestionsCacheKey;
    if (conversationHistory.length === 0) {
        suggestionsCacheKey = 'initial_suggestions';
    } else {
        const lastExchange = conversationHistory.slice(-2);
        const exchangeText = lastExchange.map(msg => `${msg.role}:${msg.content}`).join('|');
        suggestionsCacheKey = 'suggestions_' + crypto.createHash('sha256').update(exchangeText).digest('hex').substring(0, 16);
    }
    
    // Check cache first (24 hour TTL)
    try {
        const cacheCheck = await dynamoDBClient.send(new GetItemCommand({
            TableName: DYNAMODB_TABLE_NAME,
            Key: { queryHash: { S: suggestionsCacheKey } }
        }));
        
        if (cacheCheck.Item && cacheCheck.Item.response) {
            const cachedSuggestions = JSON.parse(cacheCheck.Item.response.S);
            const ttl = parseInt(cacheCheck.Item.ttl?.N || '0');
            if (Date.now() / 1000 < ttl) {
                console.log('Using cached suggestions for key:', suggestionsCacheKey);
                return cachedSuggestions;
            }
        }
    } catch (cacheError) {
        console.warn('Error checking suggestions cache:', cacheError);
        // Continue to generate new suggestions if cache check fails
    }
    
    try {
        // Get travel document
        const travelDoc = await getTravelDocument();
        
        // Build context for suggestions
        let contextPrompt = '';
        if (conversationHistory.length > 0) {
            // Extract last exchange for context
            const lastExchange = conversationHistory.slice(-2);
            contextPrompt = `Based on the recent conversation:\n`;
            lastExchange.forEach(msg => {
                contextPrompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
            });
            contextPrompt += '\nGenerate 3-4 relevant follow-up questions the user might want to ask about travel packages.';
        } else {
            // Initial suggestions - based on travel document
            contextPrompt = `Based on the following travel package information, generate 4-5 interesting questions a user might ask to get started. Make them diverse and cover different aspects like pricing, destinations, package details, etc.`;
        }
        
        const systemPrompt = `You are a helpful travel assistant for TravelBuddy. ${travelDoc ? 'Here is the travel package information:\n\n' + travelDoc + '\n\nIMPORTANT: Only suggest questions about destinations and packages that are ACTUALLY listed in the information above. Do NOT suggest questions about destinations not in the catalog (e.g., Sri Lanka, Maldives, etc.).' : ''}Generate suggested questions that are:\n- Short and conversational (10-15 words max)\n- Relevant to travel packages listed in the information\n- Easy to understand\n- Specific enough to be useful\n- Based ONLY on destinations/countries mentioned in the provided information\n\nReturn ONLY a JSON array of question strings, no other text. Example: ["What packages are available to Thailand?", "Show me Singapore travel options", "What's the cost for a 5-night package?"]`;
        
        const userContent = contextPrompt;
        
        // Prepare Bedrock request for suggestions
        const bedrockRequest = {
            modelId: MODEL_ID,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 200, // Shorter for suggestions
                system: systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: userContent
                    }
                ]
            })
        };
        
        const command = new InvokeModelCommand(bedrockRequest);
        
        // Add API key authentication
        command.middlewareStack.add(
            (next) => async (args) => {
                if (args.request?.headers) {
                    const headerKeys = Object.keys(args.request.headers);
                    for (const key of headerKeys) {
                        if (key.toLowerCase() === 'authorization') {
                            delete args.request.headers[key];
                        }
                    }
                    args.request.headers['authorization'] = `Bearer ${BEDROCK_API_KEY}`;
                }
                return next(args);
            },
            {
                step: 'finalizeRequest',
                priority: 999,
                name: 'bedrockApiKeyAuthOverride'
            }
        );
        
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const suggestionsText = responseBody.content[0].text.trim();
        
        // Parse JSON array from response
        // Try to extract JSON array from the response (might have markdown code blocks)
        let suggestions = [];
        try {
            // Remove markdown code blocks if present
            const jsonMatch = suggestionsText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                suggestions = JSON.parse(jsonMatch[0]);
            } else {
                // Fallback: split by newlines and extract questions
                const lines = suggestionsText.split('\n').filter(line => line.trim());
                suggestions = lines
                    .map(line => line.replace(/^\d+[\.\)]\s*/, '').replace(/^[-*]\s*/, '').trim())
                    .filter(line => line.length > 0 && line.length < 100)
                    .slice(0, 5); // Limit to 5 suggestions
            }
        } catch (parseError) {
            console.error('Error parsing suggestions JSON:', parseError);
            // Fallback: return default suggestions
            if (conversationHistory.length > 0) {
                suggestions = [
                    'Tell me more about this package',
                    'What are the highlights?',
                    'What is the total cost?'
                ];
            } else {
                suggestions = [
                    'What packages are available to Thailand?',
                    'Show me Singapore travel packages',
                    'What are the best destinations?',
                    'Tell me about package pricing'
                ];
            }
        }
        
        // Ensure we have valid suggestions array
        if (!Array.isArray(suggestions) || suggestions.length === 0) {
            suggestions = conversationHistory.length > 0 
                ? ['Tell me more', 'What else can you help with?']
                : ['What packages are available?', 'Show me travel options'];
        }
        
        // Limit to 4-5 suggestions
        const finalSuggestions = suggestions.slice(0, 5);
        
        // Cache the suggestions for 24 hours
        try {
            const ttl = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours
            await dynamoDBClient.send(new PutItemCommand({
                TableName: DYNAMODB_TABLE_NAME,
                Item: {
                    queryHash: { S: suggestionsCacheKey },
                    response: { S: JSON.stringify(finalSuggestions) },
                    queryText: { S: conversationHistory.length === 0 ? 'initial_suggestions' : 'follow_up_suggestions' },
                    ttl: { N: ttl.toString() },
                    usage: { 
                        M: {
                            inputTokens: { N: '0' },
                            outputTokens: { N: '0' },
                            model: { S: 'suggestions_cache' }
                        }
                    }
                }
            }));
            console.log('Cached suggestions for key:', suggestionsCacheKey);
        } catch (cacheError) {
            console.warn('Error caching suggestions:', cacheError);
            // Continue even if caching fails
        }
        
        return finalSuggestions;
    } catch (error) {
        // Handle throttling with retry logic
        if (error.name === 'ThrottlingException' && retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
            console.warn(`ThrottlingException for suggestions, retrying after ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return generateSuggestions(conversationHistory, retryCount + 1);
        }
        
        // For other errors or max retries reached, return default suggestions
        console.error('Error generating suggestions:', error.name || error.message);
        
        // Return default suggestions based on context (don't cache defaults)
        return conversationHistory.length > 0
            ? ['Tell me more', 'What else can you help with?', 'Show me other packages']
            : ['What packages are available?', 'Show me travel options', 'Tell me about pricing'];
    }
}

/**
 * Check DynamoDB cache for existing response
 */
async function getCachedResponse(queryHash) {
    try {
        const command = new GetItemCommand({
            TableName: DYNAMODB_TABLE_NAME,
            Key: {
                queryHash: { S: queryHash }
            }
        });
        
        const response = await dynamoDBClient.send(command);
        
        if (response.Item) {
            console.log('Cache HIT for query hash:', queryHash);
            return {
                cached: true,
                response: response.Item.response?.S,
                queryText: response.Item.queryText?.S,
                timestamp: response.Item.timestamp?.N,
                usage: response.Item.usage ? JSON.parse(response.Item.usage.S) : null
            };
        }
        
        console.log('Cache MISS for query hash:', queryHash);
        return { cached: false };
    } catch (error) {
        console.error('Error checking cache:', error);
        // If cache check fails, continue without cache (don't block request)
        return { cached: false };
    }
}

/**
 * Store response in DynamoDB cache
 */
async function cacheResponse(queryHash, queryText, response, usage) {
    try {
        const ttl = Math.floor(Date.now() / 1000) + CACHE_TTL_SECONDS;
        
        const command = new PutItemCommand({
            TableName: DYNAMODB_TABLE_NAME,
            Item: {
                queryHash: { S: queryHash },
                queryText: { S: queryText },
                response: { S: response },
                usage: { S: JSON.stringify(usage || {}) },
                timestamp: { N: Date.now().toString() },
                ttl: { N: ttl.toString() }
            }
        });
        
        await dynamoDBClient.send(command);
        console.log('Cached response for query hash:', queryHash);
    } catch (error) {
        console.error('Error caching response:', error);
        // Don't throw - caching failure shouldn't break the request
    }
}

/**
 * Get travel document from S3 with in-memory caching
 * Cache is reused across Lambda invocations (container reuse)
 */
async function getTravelDocument() {
    // Check if cache is valid (exists and not expired)
    if (cachedTravelDoc && travelDocCacheTimestamp && 
        (Date.now() - travelDocCacheTimestamp) < TRAVEL_DOC_CACHE_TTL_MS) {
        console.log('Using cached travel document (cache age:', Math.floor((Date.now() - travelDocCacheTimestamp) / 1000), 'seconds)');
        return cachedTravelDoc;
    }
    
    try {
        console.log('Fetching travel document from S3...');
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET_NAME,
            Key: S3_DOCUMENT_KEY
        });
        
        const response = await s3Client.send(command);
        
        // Convert stream to string
        const chunks = [];
        for await (const chunk of response.Body) {
            chunks.push(chunk);
        }
        const content = Buffer.concat(chunks).toString('utf-8');
        
        // Cache it
        cachedTravelDoc = content;
        travelDocCacheTimestamp = Date.now();
        
        console.log('Travel document cached (size:', content.length, 'characters)');
        return cachedTravelDoc;
    } catch (error) {
        console.error('Error fetching travel document from S3:', error);
        // Return empty string if S3 read fails (graceful degradation)
        // Could also return cached version if available, even if expired
        if (cachedTravelDoc) {
            console.log('Using expired cache due to S3 error');
            return cachedTravelDoc;
        }
        return '';
    }
}

/**
 * Invoke Bedrock LLM to generate response with travel document context and conversation history
 */
async function invokeBedrockLLM(input, conversationHistory = []) {
    // Get travel document (cached or from S3)
    const travelDoc = await getTravelDocument();
    
    // Build system prompt with travel document context
    let systemPrompt = 'You are a helpful travel assistant for TravelBuddy, a travel booking company specializing in Asia packages from Bengaluru.';
    systemPrompt += '\n\nPERSONA & BEHAVIOR:';
    systemPrompt += '\n- You are a friendly, professional travel booking assistant working for TravelBuddy.';
    systemPrompt += '\n- You help customers find and understand travel packages to Asian destinations.';
    systemPrompt += '\n- You do NOT discuss your AI nature, technical details, training, or comparisons with other AI models.';
    systemPrompt += '\n- If asked about being an AI or technical questions, politely redirect: "I\'m here to help you with travel packages to Asia. How can I assist you with planning your trip?"';
    systemPrompt += '\n- Focus exclusively on travel-related queries and travel package information.';
    
    if (travelDoc) {
        systemPrompt += '\n\nCRITICAL - ABSOLUTE PROHIBITION AGAINST HALLUCINATION:';
        systemPrompt += '\n\nYOU MUST NEVER:';
        systemPrompt += '\n- Create, invent, or make up ANY package that is not EXACTLY listed below';
        systemPrompt += '\n- Modify, shorten, extend, or customize ANY package details';
        systemPrompt += '\n- Create "budget versions", "shorter versions", "extended versions", or ANY variants';
        systemPrompt += '\n- Change package names, costs, durations, meals, highlights, or accommodation';
        systemPrompt += '\n- Create new package names like "Bali Getaway", "Bali Express", "Bali Budget" - these DO NOT EXIST';
        systemPrompt += '\n- Provide prices, durations, or details that differ from what is listed below';
        systemPrompt += '\n\nYOU CAN ONLY:';
        systemPrompt += '\n- List packages EXACTLY as they appear in the information below';
        systemPrompt += '\n- Use the exact package names, costs, durations, and details provided';
        systemPrompt += '\n- Quote the information verbatim from the travel package information';
        systemPrompt += '\n\nWHEN USER ASKS FOR MODIFICATIONS:';
        systemPrompt += '\nIf a user asks for: different duration, lower price, shorter package, budget option, customization, or ANY modification:';
        systemPrompt += '\nRespond EXACTLY: "I can only offer the packages exactly as listed in our catalog. I don\'t have any shorter, longer, or modified versions available. For customized packages that match your requirements, please contact our team at travelbuddy@asia.com or +91-98765-43210 and they can help create a package tailored to your needs."';
        systemPrompt += '\nDO NOT create a fake package even if the user asks for one.';
        systemPrompt += '\n\nWHEN DESTINATION NOT AVAILABLE:';
        systemPrompt += '\nIf the user asks about a destination NOT in the information below, respond: "I don\'t have any packages available for [destination] in our current catalog. Please contact us at travelbuddy@asia.com or +91-98765-43210 for custom packages."';
        systemPrompt += '\nDO NOT create packages for unavailable destinations.';
        systemPrompt += `\n\nTravel Package Information:\n\n${travelDoc}`;
    }
    
    // Build messages array with conversation history + current input
    // Claude 3 requires: messages must start with 'user' and alternate user/assistant
    const messages = [];
    
    // Add conversation history (limit to last 10 exchanges to control token usage)
    const recentHistory = conversationHistory.slice(-20); // Last 20 messages (10 exchanges)
    
    // Filter and validate history messages
    const validHistory = [];
    for (const msg of recentHistory) {
        if (msg.role && msg.content && (msg.role === 'user' || msg.role === 'assistant')) {
            validHistory.push({
                role: msg.role,
                content: msg.content
            });
        }
    }
    
    // Build messages array ensuring proper alternation
    // Find first user message in history
    let startIndex = 0;
    for (let i = 0; i < validHistory.length; i++) {
        if (validHistory[i].role === 'user') {
            startIndex = i;
            break;
        }
    }
    
    // Add valid history starting from first user message
    const historyMessages = validHistory.slice(startIndex);
    
    // Clean history to ensure proper alternation (remove consecutive same roles)
    let lastRole = null;
    for (const msg of historyMessages) {
        if (lastRole === null) {
            // First message must be user
            if (msg.role === 'user') {
                messages.push(msg);
                lastRole = 'user';
            }
        } else {
            // Ensure alternation: if last was user, next must be assistant and vice versa
            if (msg.role !== lastRole) {
                messages.push(msg);
                lastRole = msg.role;
            } else {
                // Skip consecutive same roles (merge or skip based on context)
                // If we have consecutive user messages, keep only the last one
                // If we have consecutive assistant messages, keep only the last one
                if (messages.length > 0) {
                    messages[messages.length - 1] = msg; // Replace with latest
                }
            }
        }
    }
    
    // Always end with current user message
    // If last message was user, merge current input with it
    // If last message was assistant (or empty), add current input as new message
    if (messages.length === 0) {
        // No history, start with current input
        messages.push({
            role: 'user',
            content: input
        });
    } else if (lastRole === 'user') {
        // Last message was user, merge with current input
        const lastMsg = messages[messages.length - 1];
        messages[messages.length - 1] = {
            role: 'user',
            content: lastMsg.content + '\n\n' + input
        };
    } else {
        // Last message was assistant, add current input
        messages.push({
            role: 'user',
            content: input
        });
    }
    
    // Final validation: ensure messages array is valid
    if (messages.length === 0 || messages[0].role !== 'user') {
        console.warn('Messages array validation failed, using current input only');
        messages.length = 0; // Clear array
        messages.push({
            role: 'user',
            content: input
        });
    }
    
    // Prepare Bedrock request with cost controls
    // Claude 3 Messages API uses 'system' as top-level parameter, not in messages array
    const bedrockRequest = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            messages: messages
        })
    };
    
    console.log(`Calling Bedrock with model: ${MODEL_ID}, max_tokens: ${MAX_TOKENS}, input_length: ${input.length}`);
    
    const command = new InvokeModelCommand(bedrockRequest);
    
    // Override Authorization header with API key
    command.middlewareStack.add(
        (next) => async (args) => {
            if (args.request?.headers) {
                const headerKeys = Object.keys(args.request.headers);
                for (const key of headerKeys) {
                    if (key.toLowerCase() === 'authorization') {
                        delete args.request.headers[key];
                    }
                }
                args.request.headers['authorization'] = `Bearer ${BEDROCK_API_KEY}`;
            }
            return next(args);
        },
        {
            step: 'finalizeRequest',
            priority: 999,
            name: 'bedrockApiKeyAuthOverride'
        }
    );
    
    const bedrockResponse = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    
    return {
        output: responseBody.content[0].text,
        usage: responseBody.usage || {}
    };
}

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
            },
            body: ''
        };
    }
    
    // Handle GET request for initial suggestions (when chat opens)
    // Check if this is a GET request via API Gateway
    const isGetRequest = event.httpMethod === 'GET' || 
                         event.requestContext?.http?.method === 'GET' ||
                         (event.requestContext && !event.body && event.path === '/suggestions');
    
    if (isGetRequest || event.path === '/suggestions' || (event.pathParameters && event.pathParameters.proxy === 'suggestions')) {
        try {
            const suggestions = await generateSuggestions([]);
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
                },
                body: JSON.stringify({
                    suggestions: suggestions,
                    timestamp: new Date().toISOString()
                })
            };
        } catch (error) {
            console.error('Error generating initial suggestions:', error);
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    suggestions: [
                        'What packages are available?',
                        'Show me travel options',
                        'Tell me about pricing'
                    ]
                })
            };
        }
    }
    
    // Validate API key is present (resolved from SSM at deployment time)
    if (!BEDROCK_API_KEY) {
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                message: 'Bedrock API Key not configured. Please ensure the SSM parameter /poc/bedrock-api-key exists and is accessible.',
                error: 'MissingConfiguration'
            })
        };
    }
    
    try {
        // Parse the request body
        let body = {};
        let input = '';
        let conversationHistory = [];
        
        if (event.body) {
            try {
                body = JSON.parse(event.body);
                input = body.input || '';
                conversationHistory = body.conversationHistory || [];
            } catch (parseError) {
                // If JSON parsing fails, try to use body as string
                input = event.body || '';
                conversationHistory = [];
            }
        }
        
        // COST CONTROL: Validate input length to prevent large token usage
        if (input.length > MAX_INPUT_LENGTH) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: 'Input too long',
                    message: `Input must be less than ${MAX_INPUT_LENGTH} characters. Current length: ${input.length}`,
                    maxInputLength: MAX_INPUT_LENGTH
                })
            };
        }
        
        // Step 1: Check if this is a generic fallback query that needs context
        // These queries are too generic and should always hit LLM with conversation history
        const isGenericQuery = isGenericFallbackQuery(input);
        
        // Step 2: Generate hash of normalized query for cache lookup
        const normalizedQuery = normalizeQuery(input);
        const queryHash = generateQueryHash(input);
        console.log('Original query:', input);
        console.log('Normalized query:', normalizedQuery);
        console.log('Query hash:', queryHash);
        console.log('Is generic query (will skip cache):', isGenericQuery);
        
        // Step 3: Check DynamoDB cache (skip for generic queries that need context)
        let cacheResult = { cached: false };
        if (!isGenericQuery) {
            cacheResult = await getCachedResponse(queryHash);
        } else {
            console.log('Generic fallback query detected - skipping cache, going directly to LLM:', input);
        }
        
        if (cacheResult.cached) {
            // Cache HIT - return cached response (no Bedrock call = cost savings!)
            console.log('Returning cached response - Bedrock call skipped');
            
            // Generate follow-up suggestions even for cached responses
            // Use fire-and-forget to avoid blocking the response
            let suggestions = [];
            const updatedHistory = conversationHistory.concat([
                { role: 'user', content: input },
                { role: 'assistant', content: cacheResult.response }
            ]);
            
            // Generate suggestions asynchronously with timeout
            try {
                suggestions = await Promise.race([
                    generateSuggestions(updatedHistory),
                    new Promise((resolve) => setTimeout(() => resolve(['Tell me more', 'What else?']), 3000)) // 3s timeout
                ]);
            } catch (error) {
                console.error('Error generating suggestions for cached response (non-blocking):', error);
                suggestions = ['Tell me more', 'What else can you help with?'];
            }
            
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
                },
                body: JSON.stringify({
                    message: input,
                    bedrockResponse: cacheResult.response,
                    cached: true,
                    suggestions: suggestions,
                    usage: cacheResult.usage || {
                        inputTokens: 0,
                        outputTokens: 0,
                        model: MODEL_ID
                    },
                    cachedTimestamp: cacheResult.timestamp,
                    timestamp: new Date().toISOString(),
                    requestId: event.requestContext?.requestId || 'N/A'
                })
            };
        }
        
        // Step 4: Cache MISS (or generic query) - Invoke Bedrock LLM with conversation history
        console.log('Cache miss - calling Bedrock LLM', { 
            hasHistory: conversationHistory.length > 0,
            historyLength: conversationHistory.length,
            isGenericQuery: isGenericQuery,
            skippedCache: isGenericQuery
        });
        const bedrockResult = await invokeBedrockLLM(input, conversationHistory);

        // Log token usage for cost tracking
        console.log('Bedrock usage:', {
            inputTokens: bedrockResult.usage.input_tokens,
            outputTokens: bedrockResult.usage.output_tokens,
            totalTokens: (bedrockResult.usage.input_tokens || 0) + (bedrockResult.usage.output_tokens || 0)
        });

        // Step 5: Store response in cache for future requests (skip caching for generic queries)
        // Generic queries are context-dependent, so caching them would return irrelevant responses
        if (!isGenericQuery) {
            await cacheResponse(
                queryHash,
                input,
                bedrockResult.output,
                {
                    inputTokens: bedrockResult.usage.input_tokens || 0,
                    outputTokens: bedrockResult.usage.output_tokens || 0,
                    model: MODEL_ID
                }
            );
        } else {
            console.log('Skipping cache storage for generic query:', input);
        }

        // Step 6: Generate follow-up suggestions based on conversation context
        // Use fire-and-forget to avoid blocking the response if suggestions fail
        let suggestions = [];
        const updatedHistory = conversationHistory.concat([
            { role: 'user', content: input },
            { role: 'assistant', content: bedrockResult.output }
        ]);
        
        // Generate suggestions asynchronously - don't block on errors
        try {
            suggestions = await Promise.race([
                generateSuggestions(updatedHistory),
                new Promise((resolve) => setTimeout(() => resolve(['Tell me more', 'What else?']), 3000)) // 3s timeout
            ]);
        } catch (error) {
            console.error('Error generating suggestions (non-blocking):', error);
            suggestions = ['Tell me more', 'What else can you help with?'];
        }

        // Step 7: Return response with suggestions
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
            },
            body: JSON.stringify({
                message: input,
                bedrockResponse: bedrockResult.output,
                cached: false,
                suggestions: suggestions,
                usage: {
                    inputTokens: bedrockResult.usage.input_tokens || 0,
                    outputTokens: bedrockResult.usage.output_tokens || 0,
                    model: MODEL_ID
                },
                timestamp: new Date().toISOString(),
                requestId: event.requestContext?.requestId || 'N/A'
            })
        };
    } catch (error) {
        console.error('Error:', error);
        
        // Provide helpful error messages
        let errorMessage = 'Internal Server Error';
        if (error.name === 'AccessDeniedException' || error.name === 'UnauthorizedException') {
            errorMessage = 'Bedrock access denied. Check your API key is valid and not expired.';
        } else if (error.name === 'ValidationException') {
            errorMessage = 'Invalid Bedrock request. Check model ID and request format.';
        } else if (error.statusCode === 401 || error.statusCode === 403) {
            errorMessage = 'Authentication failed. Verify your Bedrock API key.';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                message: errorMessage,
                error: error.name || 'UnknownError',
                requestId: event.requestContext?.requestId || 'N/A'
            })
        };
    }
};
