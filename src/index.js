/**
 * AWS Lambda function handler with Bedrock LLM integration
 * Includes cost controls to prevent unexpected billing
 * Uses API Key authentication for Bedrock (resolved from SSM via CloudFormation dynamic reference)
 */
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const region = process.env.APP_REGION || 'ap-south-1';

// Initialize Bedrock client
// We'll override the signing middleware to use API key instead of AWS credentials
const bedrockClient = new BedrockRuntimeClient({ 
    region
});

// Bedrock API Key resolved from SSM Parameter Store via CloudFormation dynamic reference
const BEDROCK_API_KEY = process.env.BEDROCK_API_KEY;

// Cost control constants from environment variables
const MAX_INPUT_LENGTH = parseInt(process.env.MAX_INPUT_LENGTH || '1000', 10);
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '256', 10);
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    // Changing the file to see if this makes a new build,also again to see if this makes a new build
    // Validate API key is present (resolved from SSM at deployment time)
    if (!BEDROCK_API_KEY) {
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                message: 'Bedrock API Key not configured. Please ensure the SSM parameter /aws-gameday/bedrock-api-key exists and is accessible.',
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
        
        // Prepare prompt for Bedrock
        const prompt = `You are a helpful assistant. Respond to the following in a brief, friendly manner: ${input}`;
        
        // Prepare Bedrock request with cost controls
        const bedrockRequest = {
            modelId: MODEL_ID,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: MAX_TOKENS, // CRITICAL: Limit output tokens to control costs
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ]
            })
        };
        
        console.log(`Calling Bedrock with model: ${MODEL_ID}, max_tokens: ${MAX_TOKENS}, input_length: ${input.length}`);
        
        // Invoke Bedrock model with API key authentication
        const command = new InvokeModelCommand(bedrockRequest);
        
        // Override Authorization header with API key before request is sent
        // This middleware modifies the request after AWS signature is added
        command.middlewareStack.add(
            (next) => async (args) => {
                // Modify the request BEFORE sending
                if (args.request?.headers) {
                    // Remove ALL Authorization headers (AWS SDK adds one with Signature V4)
                    const headerKeys = Object.keys(args.request.headers);
                    for (const key of headerKeys) {
                        if (key.toLowerCase() === 'authorization') {
                            delete args.request.headers[key];
                        }
                    }
                    // Add our Bedrock API key as Bearer token
                    args.request.headers['authorization'] = `Bearer ${BEDROCK_API_KEY}`;
                }
                
                // Continue with the modified request
                return next(args);
            },
            {
                step: 'finalizeRequest',
                priority: 999, // Run last to override any previous Authorization header
                name: 'bedrockApiKeyAuthOverride'
            }
        );
        
        const bedrockResponse = await bedrockClient.send(command);
        
        // Parse Bedrock response
        const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
        const bedrockOutput = responseBody.content[0].text;
        
        // Log token usage for cost tracking
        const usage = responseBody.usage || {};
        console.log('Bedrock usage:', {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            totalTokens: usage.input_tokens + usage.output_tokens
        });
        
        // Return response with Bedrock output
        const response = {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
            },
            body: JSON.stringify({
                message: `Hello World ${input}`,
                bedrockResponse: bedrockOutput,
                usage: {
                    inputTokens: usage.input_tokens || 0,
                    outputTokens: usage.output_tokens || 0,
                    model: MODEL_ID
                },
                timestamp: new Date().toISOString(),
                requestId: event.requestContext?.requestId || 'N/A'
            })
        };
        
        return response;
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

