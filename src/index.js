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
 * Invoke Bedrock LLM to generate response with travel document context
 */
async function invokeBedrockLLM(input) {
    // Get travel document (cached or from S3)
    const travelDoc = await getTravelDocument();
    
    // Build prompt with travel document context
    let systemPrompt = 'You are a helpful travel assistant for TravelBuddy.';
    let userContent = input;
    
    if (travelDoc) {
        systemPrompt += ' Use the following travel package information to answer the user\'s question accurately. If the information doesn\'t contain the answer, say so politely.';
        userContent = `Travel Package Information:\n\n${travelDoc}\n\nUser Question: ${input}`;
    } else {
        userContent = `Respond to the following in a brief, friendly manner: ${input}`;
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
            messages: [
                {
                    role: 'user',
                    content: userContent
                }
            ]
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
        
        if (event.body) {
            try {
                body = JSON.parse(event.body);
                input = body.input || '';
            } catch (parseError) {
                // If JSON parsing fails, try to use body as string
                input = event.body || '';
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
        
        // Step 1: Generate hash of normalized query for cache lookup
        const normalizedQuery = normalizeQuery(input);
        const queryHash = generateQueryHash(input);
        console.log('Original query:', input);
        console.log('Normalized query:', normalizedQuery);
        console.log('Query hash:', queryHash);
        
        // Step 2: Check DynamoDB cache
        const cacheResult = await getCachedResponse(queryHash);
        
        if (cacheResult.cached) {
            // Cache HIT - return cached response (no Bedrock call = cost savings!)
            console.log('Returning cached response - Bedrock call skipped');
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
        
        // Step 3: Cache MISS - Invoke Bedrock LLM
        console.log('Cache miss - calling Bedrock LLM');
        const bedrockResult = await invokeBedrockLLM(input);

        // Log token usage for cost tracking
        console.log('Bedrock usage:', {
            inputTokens: bedrockResult.usage.input_tokens,
            outputTokens: bedrockResult.usage.output_tokens,
            totalTokens: (bedrockResult.usage.input_tokens || 0) + (bedrockResult.usage.output_tokens || 0)
        });

        // Step 4: Store response in cache for future requests
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

        // Step 5: Return response
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
