# TravelBuddy Frontend - Angular Chat Application

A modern, responsive Angular chat interface for the TravelBuddy AI Travel Assistant.

## 🚀 Features

- ✨ **Modern UI** - Beautiful gradient design with smooth animations
- 💬 **Real-time Chat** - Interactive chat interface with message history
- 💾 **Cache Indicators** - Shows when responses come from cache
- 📊 **Token Usage** - Displays token consumption per response
- ⚙️ **API Configuration** - Easy API endpoint configuration
- 📱 **Responsive Design** - Works on desktop and mobile devices
- ⚡ **Fast & Lightweight** - Optimized Angular application

## 📋 Prerequisites

1. **Node.js 18+** installed
2. **npm** or **yarn** package manager
3. **Angular CLI 17+** (will be installed with dependencies)

## 🔧 Installation

1. **Navigate to frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

   This will install:
   - Angular 17
   - Angular Forms & HTTP Client
   - TypeScript
   - All required dependencies

## 🏃 Running the Application

### Development Server

```bash
npm start
```

The application will start at `http://localhost:4200`

Angular CLI will automatically open your browser. If not, navigate to the URL manually.

### Build for Production

```bash
npm run build
```

The compiled files will be in the `dist/travelbuddy` folder.

## ⚙️ Configuration

### Update API Endpoint

The default API URL is set in `src/app/services/api.service.ts`:

```typescript
private apiUrl = 'https://5xezz9agp5.execute-api.ap-south-1.amazonaws.com/dev/hello';
```

**Option 1: Change in code**
Edit `frontend/src/app/services/api.service.ts` and update the `apiUrl` variable.

**Option 2: Configure at runtime**
Click the ⚙️ gear icon in the chat header to configure the API URL without code changes.

## 📁 Project Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── app.component.ts          # Main app component
│   │   ├── app.module.ts             # Angular module
│   │   ├── chat/
│   │   │   ├── chat.component.ts     # Chat component logic
│   │   │   ├── chat.component.html   # Chat template
│   │   │   └── chat.component.css    # Chat styles
│   │   └── services/
│   │       └── api.service.ts        # API service for backend calls
│   ├── index.html                    # Main HTML file
│   ├── main.ts                       # Application entry point
│   └── styles.css                    # Global styles
├── angular.json                      # Angular configuration
├── package.json                      # Dependencies
└── tsconfig.json                     # TypeScript configuration
```

## 🎨 Features Explained

### Chat Interface
- **Message Bubbles**: User messages (right, purple) and assistant messages (left, white)
- **Typing Indicator**: Shows "Thinking..." with animated dots when API is processing
- **Auto-scroll**: Automatically scrolls to latest message
- **Keyboard Shortcuts**: Enter to send, Shift+Enter for new line

### Cache Indicators
- **💾 Cached Badge**: Shows when response came from DynamoDB cache
- **Token Usage**: Displays total tokens used (input + output)

### API Configuration
- Click ⚙️ gear icon to configure API endpoint
- Updates take effect immediately
- Useful for switching between dev/staging/production APIs

## 🐛 Troubleshooting

### "Module not found" errors
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Port 4200 already in use
```bash
# Use a different port
ng serve --port 4201
```

### CORS errors
- Ensure your API Gateway has CORS enabled (already configured in backend)
- Check browser console for specific CORS error messages

### API connection fails
- Verify API Gateway endpoint is correct
- Check API Gateway is deployed and active
- Verify API endpoint is publicly accessible
- Check browser console for error details

## 📦 Deployment Options

### Option 1: Deploy to AWS Amplify (Recommended)

1. Push code to GitHub/GitLab/Bitbucket
2. Go to AWS Amplify Console
3. Connect repository
4. Build settings (auto-detected):
   ```yaml
   version: 1
   frontend:
     phases:
       preBuild:
         commands:
           - npm install
       build:
         commands:
           - npm run build
     artifacts:
       baseDirectory: dist/travelbuddy
       files:
         - '**/*'
   ```
5. Deploy!

### Option 2: Deploy to S3 + CloudFront

1. Build the app:
   ```bash
   npm run build
   ```

2. Upload to S3:
   ```bash
   aws s3 sync dist/travelbuddy/ s3://your-bucket-name --delete
   ```

3. Configure S3 bucket for static website hosting
4. (Optional) Set up CloudFront for CDN

### Option 3: Deploy to Netlify/Vercel

Both platforms support Angular out of the box:
- **Netlify**: Connect GitHub repo, set build command: `npm run build`, publish directory: `dist/travelbuddy`
- **Vercel**: Connect GitHub repo, framework preset: Angular

## 🔐 Environment Configuration (Optional)

For different environments, create `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'https://your-api-id.execute-api.ap-south-1.amazonaws.com/dev/hello'
};
```

Then use it in `api.service.ts`:
```typescript
import { environment } from '../environments/environment';
private apiUrl = environment.apiUrl;
```

## 📱 Mobile Responsiveness

The application is fully responsive:
- Works on desktop, tablet, and mobile
- Touch-friendly interface
- Optimized for small screens

## 🎯 Testing

Run unit tests:
```bash
npm test
```

## 📚 Angular Resources

- [Angular Documentation](https://angular.io/docs)
- [Angular CLI Reference](https://angular.io/cli)
- [Angular Style Guide](https://angular.io/guide/styleguide)

---

**Built with Angular 17** ⚡

