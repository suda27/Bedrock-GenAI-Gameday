/**
 * AWS Lambda function handler with Bedrock LLM integration
 * Includes query caching with DynamoDB for cost optimization
 * Uses API Key authentication for Bedrock (resolved from SSM via CloudFormation dynamic reference)
 */
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const crypto = require('crypto');

const region = process.env.APP_REGION || 'ap-south-1';

// Initialize clients outside handler for connection reuse (cost optimization)
const bedrockClient = new BedrockRuntimeClient({ region });
const dynamoDBClient = new DynamoDBClient({ region });

// Bedrock API Key resolved from SSM Parameter Store via CloudFormation dynamic reference
const BEDROCK_API_KEY = process.env.BEDROCK_API_KEY;

// Cost control constants from environment variables
const MAX_INPUT_LENGTH = parseInt(process.env.MAX_INPUT_LENGTH || '1000', 10);
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '256', 10);
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'travelbuddy-query-cache';

// Cache TTL: 24 hours (86400 seconds)
const CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Generate SHA-256 hash of query text for cache key
 */
function generateQueryHash(query) {
    return crypto.createHash('sha256').update(query.trim().toLowerCase()).digest('hex');
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
 * Invoke Bedrock LLM to generate response
 */
async function invokeBedrockLLM(input) {
    // Prepare simple user message
    const messages = [
        {
            role: 'user',
            content: `You are a helpful travel assistant for TravelBuddy. Respond to the following in a brief, friendly manner: ${input}`
        }
    ];
    
    // Prepare Bedrock request with cost controls
    const bedrockRequest = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: MAX_TOKENS,
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
        
        // Step 1: Generate hash of query for cache lookup
        const queryHash = generateQueryHash(input);
        console.log('Query hash:', queryHash, 'for query:', input);
        
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
