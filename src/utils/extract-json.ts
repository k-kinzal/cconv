import * as v from 'valibot';

export function extractJsonFromResponse<T>(response: string, schema?: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>): T {
  // First, filter out debug lines
  const lines = response.split('\n');
  const nonDebugLines = lines.filter(line => {
    const trimmed = line.trim();
    return trimmed !== '' &&
           !trimmed.startsWith('[DEBUG]') && 
           !trimmed.startsWith('[INFO]') &&
           !trimmed.startsWith('[WARNING]') &&
           !trimmed.startsWith('[ERROR]');
  });
  
  // Join non-debug lines and try to parse as complete JSON
  const cleanedResponse = nonDebugLines.join('\n');
  
  let jsonResult = null;
  
  // STEP 1: Check if this is a Claude command result object first
  let resultObject = null;
  try {
    const parsed = JSON.parse(cleanedResponse);
    if (parsed && parsed.type === 'result') {
      resultObject = parsed;
    }
  } catch {
    // Not a Claude result object, continue with other strategies
  }
  
  // STEP 2: If it's a Claude result, check for execution errors first
  if (resultObject) {
    // Check if this is an error response
    if (resultObject.subtype === 'error_during_execution') {
      const errorMessage = resultObject.error_message || resultObject.message || 'Claude execution error occurred';
      const enhancedError = new Error(`Claude execution error: ${errorMessage}`) as Error & { response?: string; isExecutionError?: boolean };
      enhancedError.response = response;
      enhancedError.isExecutionError = true;
      throw enhancedError;
    }
    
    // Check for direct result field first (Claude CLI format)
    if (resultObject.result && typeof resultObject.result === 'string') {
      try {
        // Try to parse the result directly as JSON
        jsonResult = JSON.parse(resultObject.result);
        if (jsonResult) {
          // Successfully parsed direct JSON from result field
          if (schema) {
            try {
              return v.parse(schema, jsonResult);
            } catch (error) {
              if (v.isValiError(error)) {
                const errorDetails = `Invalid format: ${error.message}. Issues: ${JSON.stringify(error.issues, null, 2)}`;
                console.error(errorDetails);
                console.error('Invalid result:', JSON.stringify(jsonResult, null, 2));
                
                const enhancedError = new Error(errorDetails) as Error & { validationError?: unknown; response?: string };
                enhancedError.validationError = error;
                enhancedError.response = response;
                throw enhancedError;
              }
              throw error;
            }
          }
          return jsonResult as T;
        }
      } catch (parseError) {
        // Check if the JSON might be truncated
        if (resultObject.result.length > 9000 && (parseError as Error).message.includes('Unexpected end of JSON input')) {
          const truncatedError = new Error('Response appears to be truncated. The output may be too large.') as Error & { response?: string; isTruncated?: boolean };
          truncatedError.response = response;
          truncatedError.isTruncated = true;
          throw truncatedError;
        }
        // If direct parsing fails for other reasons, continue with other strategies
      }
    }
    
    const content = resultObject.result || resultObject.content || resultObject.response || resultObject.output;
    if (typeof content === 'string') {
      // Try multiple extraction strategies in order of preference
      
      // Strategy 1: Look for markdown codeblock with escaped newlines (common in JSON responses)
      let codeBlockMatch = content.match(/```json\\n([\s\S]*?)\\n```/);
      if (codeBlockMatch) {
        try {
          const jsonString = codeBlockMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
          jsonResult = JSON.parse(jsonString);
        } catch {
          // Continue to next strategy
        }
      }
      
      // Strategy 2: Look for regular markdown codeblock
      if (!jsonResult) {
        codeBlockMatch = content.match(/```json\s*\n([\s\S]*?)\n?\s*```/);
        if (codeBlockMatch) {
          try {
            jsonResult = JSON.parse(codeBlockMatch[1]);
          } catch {
            // Continue to next strategy
          }
        }
      }
      
      // Strategy 3: Look for any JSON object in the content
      if (!jsonResult) {
        const objectMatch = content.match(/\{\s*"success"\s*:\s*(true|false)[\s\S]*?\}/);
        if (objectMatch) {
          try {
            jsonResult = JSON.parse(objectMatch[0]);
          } catch {
            // Continue to next strategy
          }
        }
      }
      
      // Strategy 4: Try to parse entire content as JSON
      if (!jsonResult) {
        try {
          jsonResult = JSON.parse(content);
        } catch {
          // Continue to next strategy
        }
      }
      
      // Strategy 5: Create failure response
      if (!jsonResult) {
        jsonResult = {
          success: false,
          description: "Failed to extract valid JSON from LLM response",
          startLine: 1,
          endLine: 1,
          originalContent: "",
          fixedContent: "",
          reasoning: "LLM did not return expected JSON format",
          confidence: 0,
          appliedChange: "No change applied due to parsing failure"
        };
      }
    } else if (Array.isArray(content) || typeof content === 'object') {
      jsonResult = content;
    }
  }
  
  // STEP 3: Fallback - try direct JSON extraction if not a Claude result
  if (!jsonResult) {
    // Look for JSON array pattern first
    const arrayMatch = cleanedResponse.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) {
      try {
        jsonResult = JSON.parse(arrayMatch[0]);
      } catch {
        // Continue to next approach
      }
    }
    
    // If no array found, look for single JSON object
    if (!jsonResult) {
      const objectMatch = cleanedResponse.match(/\{\s*[\s\S]*\s*\}/);
      if (objectMatch) {
        try {
          jsonResult = JSON.parse(objectMatch[0]);
        } catch {
          // Continue to next approach
        }
      }
    }
  }
  
  
  if (!jsonResult) {
    const errorDetails = `Could not extract JSON from response. Response length: ${response.length} bytes`;
    console.error(errorDetails);
    console.error('Full response:', response);
    console.error('Cleaned response:', cleanedResponse);
    
    // Create enhanced error with response
    const enhancedError = new Error(errorDetails) as Error & { response?: string };
    enhancedError.response = response;
    throw enhancedError;
  }
  
  // If a schema is provided, validate the result
  if (schema) {
    try {
      const validatedResult = v.parse(schema, jsonResult);
      return validatedResult;
    } catch (error) {
      if (v.isValiError(error)) {
        const errorDetails = `Invalid format: ${error.message}. Issues: ${JSON.stringify(error.issues, null, 2)}`;
        console.error(errorDetails);
        console.error('Invalid result:', JSON.stringify(jsonResult, null, 2));
        
        // Create enhanced error with validation details and original response
        const enhancedError = new Error(errorDetails) as Error & { validationError?: unknown; response?: string };
        enhancedError.validationError = error;
        enhancedError.response = response;
        throw enhancedError;
      }
      throw error;
    }
  }
  
  // If no schema provided, return as-is (for backward compatibility)
  return jsonResult as T;
}