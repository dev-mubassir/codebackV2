# Codeback — Instagram DM Inbox SaaS

A multi-tenant Instagram DM inbox where users can connect their Professional account, receive DMs in real-time via webhooks, and reply from a web UI.

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Next.js Frontend  │────▶│   Express Backend    │────▶│ Instagram Graph │
│    (port 3000)      │◀────│    (port 4000)       │◀────│      API        │
│                     │ WS  │                      │     │                 │
│  • Landing page     │     │  • OAuth flow        │     │ • OAuth tokens  │
│  • Dashboard        │     │  • Webhook handler   │     │ • Send messages │
│  • Inbox + Chat     │     │  • REST API          │     │ • User profiles │
└─────────────────────┘     │  • Socket.io         │     └─────────────────┘
                            └──────────┬───────────┘
                                       │
                            ┌──────────▼───────────┐
                            │    SQLite Database    │
                            │   (codeback.db)       │
                            └──────────────────────┘
```

## Prerequisites

- **Node.js** 18+ (https://nodejs.org)
- **A Meta Developer App** with the "Instagram" product enabled
- **ngrok** (or similar) to expose localhost for webhooks

## Meta App Configuration

### 1. Create a Meta App

1. Go to [Meta for Developers](https://developers.facebook.com)
2. Create a new app → select **"Other"** → **"Business"** type
3. Add the **Instagram** product (Business Login for Instagram)

### 2. Configure Instagram Login

1. In your app settings, go to **Instagram > Basic Display**
2. Add the **OAuth Redirect URI**: `http://localhost:4000/auth/instagram/callback`
   - For production, use your actual domain
3. Note your **App ID** and **App Secret** from App Settings > Basic

### 3. Required Permissions

Your app needs these permissions (request in App Review for production):
- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`
- `instagram_business_content_publish`

### 4. Configure Webhooks

1. Go to **Instagram > Webhooks** in your app dashboard
2. Set the **Callback URL**: `https://<your-ngrok-url>/webhooks/instagram`
3. Set the **Verify Token**: same as `WEBHOOK_VERIFY_TOKEN` in your `.env`
4. Subscribe to fields: `messages`, `message_reactions`, `messaging_seen`

> **Note:** Webhooks require HTTPS. Use ngrok to tunnel your local server:
> ```bash
> ngrok http 4000
> ```

## Quick Start

### 1. Clone and configure

```bash
# Copy the env template
cp .env.example backend/.env

# Edit backend/.env and fill in:
# - INSTAGRAM_APP_ID
# - INSTAGRAM_APP_SECRET
# - WEBHOOK_VERIFY_TOKEN (any random string, must match Meta App webhook config)
# - SESSION_SECRET (any random string)
```

### 2. Start the backend

```bash
cd backend
npm install
npx prisma db push    # Creates the SQLite database
npm run dev            # Starts on http://localhost:4000
```

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev            # Starts on http://localhost:3000
```

### 4. Set up ngrok (for webhooks)

```bash
ngrok http 4000
```

Copy the ngrok HTTPS URL and configure it as your webhook URL in the Meta App dashboard.

### 5. Test the flow

1. Open `http://localhost:3000` in your browser
2. Click **"Connect with Instagram"**
3. Authorize the app with your Instagram Professional account
4. You'll be redirected to the dashboard
5. Click **"Open Inbox"** to view conversations
6. Send a DM to your Instagram account from another account
7. The message should appear in real-time in the inbox
8. Reply from the inbox UI

## Project Structure

```
codeback/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma       # Database schema (5 tables)
│   ├── src/
│   │   ├── index.js            # Express server entry point
│   │   ├── lib/
│   │   │   ├── instagram.js    # Instagram Graph API helpers
│   │   │   └── crypto.js       # AES-256-GCM token encryption
│   │   ├── middleware/
│   │   │   └── auth.js         # Session auth middleware
│   │   └── routes/
│   │       ├── auth.js         # OAuth flow (connect Instagram)
│   │       ├── webhook.js      # Webhook handler (receive DMs)
│   │       ├── api.js          # Conversations, messages, reply
│   │       └── accounts.js     # Account management
│   ├── .env                    # Environment variables
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.js         # Landing page
│   │   │   ├── dashboard/      # Dashboard (connected accounts)
│   │   │   └── inbox/          # Inbox (conversations + chat)
│   │   └── lib/
│   │       └── api.js          # Backend API client
│   ├── .env.local
│   └── package.json
├── .env.example                # Environment template
├── main.py                     # Reference: Instagram token exchange script
└── README.md
```

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/instagram` | Start Instagram OAuth flow |
| GET | `/auth/instagram/callback` | OAuth callback handler |
| GET | `/auth/me` | Get current logged-in user |
| POST | `/auth/logout` | Log out |

### API
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/conversations` | List conversations (with 24h window status) |
| GET | `/api/conversations/:id/messages` | Get messages for a conversation |
| POST | `/api/conversations/:id/reply` | Send a reply |
| POST | `/api/contacts/:id/refresh-profile` | Force-refresh a contact's profile |
| GET | `/api/accounts` | List connected IG accounts |
| DELETE | `/api/accounts/:id` | Disconnect an account |

### Webhook
| Method | Path | Description |
|--------|------|-------------|
| GET | `/webhooks/instagram` | Webhook verification (Meta) |
| POST | `/webhooks/instagram` | Receive webhook events |

### Utility
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `INSTAGRAM_APP_ID` | ✅ | Meta App ID |
| `INSTAGRAM_APP_SECRET` | ✅ | Meta App Secret |
| `WEBHOOK_VERIFY_TOKEN` | ✅ | Webhook verification token |
| `DATABASE_URL` | ✅ | SQLite: `file:./codeback.db` |
| `SESSION_SECRET` | ✅ | Session cookie secret |
| `TOKEN_ENCRYPTION_KEY` | ❌ | 64-char hex for AES-256 encryption |
| `PORT` | ❌ | Backend port (default: 4000) |
| `FRONTEND_URL` | ❌ | Frontend URL (default: http://localhost:3000) |
| `REDIRECT_URI` | ✅ | OAuth callback URL |
| `SKIP_SIGNATURE_VERIFICATION` | ❌ | Skip webhook signature check |

## Security Notes

- **Tokens are encrypted** at rest using AES-256-GCM
- **Webhook signatures** are verified using `X-Hub-Signature-256`
- **Session cookies** are HTTP-only with SameSite protection
- **24-hour messaging window** is enforced on the backend
- **Echo messages** (`is_echo`) are filtered to prevent duplicates

## Troubleshooting

### Webhook not receiving messages
- Make sure ngrok is running and the URL matches your Meta App config
- Check that the verify token matches
- Set `SKIP_SIGNATURE_VERIFICATION=true` temporarily for debugging
- Check the backend console logs for detailed webhook payloads

### OAuth callback fails
- Verify `REDIRECT_URI` matches exactly in both `.env` and Meta App settings
- Make sure your Instagram account is a Professional account (Business or Creator)
- Check the backend console for the specific error

### Can't reply to messages
- The 24-hour messaging window may have expired
- The user must send you a new message first
- Check the window status badge in the chat header
