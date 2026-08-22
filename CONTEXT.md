# Codeback Project Context & Architecture Guide

## 1. Product Overview & Core Architecture
Codeback is a generalized AI-powered Instagram DM Customer Intelligence, Lead Qualification, Sales & Support SaaS.
The platform serves **any Instagram business or creator**:
- Video & Photo Editors
- Product Sellers
- Used Phone & Laptop Sellers
- Clothing & Fashion Boutiques
- Freelancers & Solopreneurs
- Agencies & Studios
- Coaches & Consultants
- Content Creators & Influencers (with full Brand Deal pipeline support preserved)

---

## 2. Architecture & Data Model

### Database Models (`backend/prisma/schema.prisma`)
- `User`: Email & Password authentication (`passwordHash`), `role` (USER / ADMIN), `onboardingCompleted` (Boolean).
- `BusinessProfile`: Persistent business context for AI intelligence (1:1 with `User`).
  - `businessName`, `businessTypes`, `primaryCategory`, `description`
  - `productsServices`, `pricingInfo`, `targetAudience`, `locationDelivery`
  - `paymentMethods`, `faqData`, `policies`, `aiInstructions`, `prohibitedTopics`
  - `tone`, `autoReplyMode` (`smart`, `suggest_only`, `human_only`), `minConfidenceScore`
- `InstagramAccount`: Connected Instagram Professional account with encrypted access tokens (`AES-256-GCM`).
- `Conversation`:
  - `category`, `intent`, `customerType`, `leadQuality` (0-100), `purchaseIntent` (0-100)
  - `riskLevel` (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), `scamProbability` (0-100)
  - `aiExplanation`, `recommendedAction`, `needsHuman`, `priority`, `priorityScore`
  - `autoReplyEnabled`, `autoReplyPrompt`
- `AIAnalysis`: Versioned append-only audit trail of AI classifications.
- `Message`: Inbound and outbound message records with `aiStatus` tracking.

---

## 3. UI Layout & Frontend Structure

### 3-Column Structured Inbox (`/inbox`)
1. **Column 1 (`.filterSidebar`)**: Dedicated vertical sidebar containing:
   - Vertically stacked Connected Accounts list (`🌐 All Accounts`, `📸 @username`).
   - Vertically stacked Smart Folders (`All`, `Unread`, `Important`, `Hot Leads`, `Leads & Inquiries`, `Customers`, `Questions`, `Support`, `Brand Deals / Collabs`, `Needs Human`, `Spam & Scams`).
   - Bottom-left user profile card link (`.filterSidebarFooter` / `sidebarProfileBtn`) pointing to `/profile`.
2. **Column 2 (`.convPanel`)**: Squeezed conversation list (300px min-width) containing:
   - Header with count badge.
   - Conversation cards with contact avatar, 24h window dot, top row with name and time pushed to opposite ends (`justify-content: space-between`), single-line ellipsis preview (`white-space: nowrap`), and wrapped compact badges (`flex-wrap: wrap; gap: 4px`).
3. **Column 3 (`.chatPanel`)**: Expansive chat workspace with AI DM Intelligence card, `✨ AI Summary` callout, 24h window countdown, message stream, `🧹 Clear Chat`, `🗑️ Delete Chat`, and grounded AI composer.

### Profile Page & Account Deletion (`/profile`)
- **Navigation Access**: Left-down corner in sidebars and right-top corner in global header actions.
- **Features**: User details, display name update, password update, connected Instagram accounts overview, and AI knowledge base summary.
- **Danger Zone**: Full account deletion (`DELETE /auth/account`) with confirmation modal requiring typing `DELETE`.

### Onboarding Flow (`/onboarding`)
- **3-Step Setup**: Basic Identity (Step 1), Business Category Selection (Step 2), Train AI Knowledge Base (Step 3).
- **Default Knowledge Templates**: Pre-filled with realistic, high-converting defaults for all 12 categories (`video_editor`, `photo_editor`, `graphic_designer`, `product_seller`, `used_devices`, `clothing`, `freelancer`, `agency`, `coach_consultant`, `creator`, `local_business`, `ecommerce`), with `other` left clean for custom input.
- **One-Click Reset**: `↺ Reset Defaults` button to restore standard templates anytime.

---

## 4. Intelligent Multi-Stage Auto-Reply Safety Decision Model
The auto-reply system follows strict safety rules:
1. **Per-Conversation Scope**: Only active for conversations where `autoReplyEnabled === true`.
2. **Mode Check**: Skipped if `businessProfile.autoReplyMode === 'human_only'`.
3. **Window Check**: Must be within Meta's 24-hour messaging window.
4. **Risk Gate**: Blocked if `riskLevel` is `HIGH` or `CRITICAL`, `scamProbability >= 30%`, or message is spam/scam/abusive.
5. **Anti-Hallucination Grounding**: AI replies strictly quote prices, turnaround times, and policies defined in `BusinessProfile`.

---

## 5. Test Suites & Verification Results
All test suites pass 100%:
- `backend/scripts/test-general-saas.js`: 28/28 passed (Auth, Onboarding, 10-category intelligence, auto-reply gate, anti-hallucination)
- `backend/scripts/test-chat-delete.js`: 11/11 passed (Clear chat & full conversation delete with tenant isolation)
- `backend/scripts/test-isolation.js`: 29/29 passed (Tenant data isolation & session boundary)
- `backend/scripts/test-ai-failover.js`: 10/10 passed (Multi-provider failover chain)
- `backend/scripts/test-auto-reply.js`: 11/11 passed (Per-conversation auto-reply engine)
- `npm run build` in `frontend/`: 20/20 static routes compiled successfully with 0 errors.

---

## 6. Important Rules & Directives
- **DO NOT run Git commands** (`git commit`, `git push`, `git checkout`, etc.) unless the user explicitly asks to commit/push.
- **Maintain Session & Tenant Safety**: All queries must filter by `instagramAccount: { userId: req.userId }`.
- **Grounded AI Answers**: Never remove anti-hallucination system prompt constraints.
