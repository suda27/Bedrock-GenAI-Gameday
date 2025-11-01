import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ChatMessage {
  input: string;
  bedrockResponse?: string;
  cached?: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    model: string;
  };
  timestamp?: string;
  error?: string;
}

export interface ApiResponse {
  message: string;
  bedrockResponse: string;
  cached: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    model: string;
  };
  timestamp: string;
  requestId: string;
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  // Update this with your API Gateway endpoint
  // Get it from: aws cloudformation describe-stacks --stack-name aws-gameday --query 'Stacks[0].Outputs[?OutputKey==`HelloWorldApi`].OutputValue' --output text
  private apiUrl = 'https://5xezz9agp5.execute-api.ap-south-1.amazonaws.com/dev/hello';

  constructor(private http: HttpClient) { }

  /**
   * Update the API URL (set this to your deployed API Gateway endpoint)
   */
  setApiUrl(url: string): void {
    this.apiUrl = url;
  }

  /**
   * Get the current API URL
   */
  getApiUrl(): string {
    return this.apiUrl;
  }

  /**
   * Send a message to the TravelBuddy API
   */
  sendMessage(input: string): Observable<ApiResponse> {
    const headers = new HttpHeaders({
      'Content-Type': 'application/json'
    });

    return this.http.post<ApiResponse>(this.apiUrl, { input }, { headers });
  }
}

