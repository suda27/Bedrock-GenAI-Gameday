import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  template: `
    <div class="app-container">
      <header class="app-header">
        <h1>✈️ TravelBuddy</h1>
        <p class="subtitle">Your AI Travel Assistant for Asia Packages</p>
      </header>
      <main class="app-main">
        <app-chat></app-chat>
      </main>
      <footer class="app-footer">
        <p>Powered by AWS Bedrock | Claude 3 Haiku</p>
      </footer>
    </div>
  `,
  styles: [`
    .app-container {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    
    .app-header {
      background: rgba(255, 255, 255, 0.95);
      padding: 1.5rem 2rem;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      text-align: center;
    }
    
    .app-header h1 {
      margin: 0;
      font-size: 2.5rem;
      color: #667eea;
      font-weight: 700;
    }
    
    .subtitle {
      margin: 0.5rem 0 0 0;
      color: #666;
      font-size: 1rem;
    }
    
    .app-main {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 2rem;
    }
    
    .app-footer {
      background: rgba(255, 255, 255, 0.95);
      padding: 1rem;
      text-align: center;
      color: #666;
      font-size: 0.875rem;
    }
  `]
})
export class AppComponent {
  title = 'travelbuddy';
}

