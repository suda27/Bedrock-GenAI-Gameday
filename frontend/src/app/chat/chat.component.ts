import { Component, OnInit, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { ApiService } from '../services/api.service';

interface Message {
  text: string;
  sender: 'user' | 'assistant';
  timestamp: Date;
  cached?: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  error?: boolean; // Changed to boolean to match usage
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, AfterViewChecked {
  @ViewChild('chatContainer') private chatContainer!: ElementRef;
  @ViewChild('messageInput') private messageInput!: ElementRef;

  messages: Message[] = [];
  userMessage: string = '';
  isLoading: boolean = false;
  apiUrl: string = '';
  showApiConfig: boolean = false;
  suggestions: string[] = [];
  isLoadingSuggestions: boolean = false;
  suggestionsCollapsed: boolean = false;

  constructor(private apiService: ApiService) {
    // Load API URL from environment or use default
    this.apiUrl = this.apiService.getApiUrl();
  }

  ngOnInit(): void {
    // Add welcome message
    this.addWelcomeMessage();
    
    // Load initial suggestions
    this.loadSuggestions();
    
    // Focus on input
    setTimeout(() => {
      if (this.messageInput) {
        this.messageInput.nativeElement.focus();
      }
    }, 100);
  }

  ngAfterViewChecked(): void {
    this.scrollToBottom();
  }

  private addWelcomeMessage(): void {
    this.messages.push({
      text: "👋 Hi! I'm TravelBuddy, your AI travel assistant. I can help you find information about travel packages to Asia. Try asking me:\n\n• \"What packages are available from Bengaluru to Bangkok?\"\n• \"Show me Singapore travel packages\"\n• \"What's the cost for a 6-night Thailand package?\"\n\nHow can I help you today?",
      sender: 'assistant',
      timestamp: new Date()
    });
  }

  sendMessage(): void {
    if (!this.userMessage.trim() || this.isLoading) {
      return;
    }

    const userMsg = this.userMessage.trim();
    this.userMessage = '';

    // Add user message
    this.messages.push({
      text: userMsg,
      sender: 'user',
      timestamp: new Date()
    });

    // Show loading state
    this.isLoading = true;

    // Build conversation history for context (last 10 messages to limit token usage)
    const conversationHistory = this.messages
      .slice(-10) // Last 10 messages
      .map(msg => ({
        role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
        content: msg.text
      }));

    // Send to API with conversation history
    this.apiService.sendMessage(userMsg, conversationHistory).subscribe({
      next: (response) => {
        this.isLoading = false;
        
        // Add assistant response
        this.messages.push({
          text: response.bedrockResponse,
          sender: 'assistant',
          timestamp: new Date(),
          cached: response.cached,
          usage: response.usage
        });
        
        // Update suggestions with follow-up questions
        if (response.suggestions && response.suggestions.length > 0) {
          this.suggestions = response.suggestions;
        }
      },
      error: (error) => {
        this.isLoading = false;
        console.error('API Error:', error);
        
        let errorMessage = 'Sorry, I encountered an error. Please try again.';
        
        if (error.error?.message) {
          errorMessage = `Error: ${error.error.message}`;
        } else if (error.message) {
          errorMessage = `Error: ${error.message}`;
        }

        this.messages.push({
          text: errorMessage,
          sender: 'assistant',
          timestamp: new Date(),
          error: true
        });
      }
    });
  }

  onEnterKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  updateApiUrl(): void {
    if (this.apiUrl.trim()) {
      this.apiService.setApiUrl(this.apiUrl.trim());
      this.showApiConfig = false;
      alert('API URL updated successfully!');
    }
  }

  toggleApiConfig(): void {
    this.showApiConfig = !this.showApiConfig;
  }

  clearChat(): void {
    this.messages = [];
    this.addWelcomeMessage();
    this.loadSuggestions(); // Reload initial suggestions
  }

  loadSuggestions(): void {
    this.isLoadingSuggestions = true;
    this.apiService.getSuggestions().subscribe({
      next: (response) => {
        this.suggestions = response.suggestions || [];
        this.isLoadingSuggestions = false;
      },
      error: (error) => {
        console.error('Error loading suggestions:', error);
        // Fallback suggestions
        this.suggestions = [
          'What packages are available?',
          'Show me travel options',
          'Tell me about pricing'
        ];
        this.isLoadingSuggestions = false;
      }
    });
  }

  selectSuggestion(suggestion: string): void {
    this.userMessage = suggestion;
    // Focus input and send message
    setTimeout(() => {
      if (this.messageInput) {
        this.messageInput.nativeElement.focus();
      }
      this.sendMessage();
    }, 100);
  }

  toggleSuggestions(): void {
    this.suggestionsCollapsed = !this.suggestionsCollapsed;
  }

  formatMessage(text: string): string {
    // Convert markdown-style formatting to HTML
    // Basic formatting: **bold**, *italic*, `code`, line breaks
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  formatTimestamp(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (seconds < 60) {
      return 'Just now';
    } else if (minutes < 60) {
      return `${minutes}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  private scrollToBottom(): void {
    try {
      if (this.chatContainer) {
        this.chatContainer.nativeElement.scrollTop = 
          this.chatContainer.nativeElement.scrollHeight;
      }
    } catch (err) {
      console.error('Scroll error:', err);
    }
  }
}

