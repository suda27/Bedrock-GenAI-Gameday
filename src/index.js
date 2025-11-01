/**
 * AWS Lambda function handler
 * Simple Hello World API Gateway handler
 */
exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
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
        
        // Return Hello World with input
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
                timestamp: new Date().toISOString(),
                requestId: event.requestContext?.requestId || 'N/A'
            })
        };
        
        return response;
    } catch (error) {
        console.error('Error:', error);
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                message: 'Internal Server Error',
                error: error.message
            })
        };
    }
};

