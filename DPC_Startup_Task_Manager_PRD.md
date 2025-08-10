# Product Requirements Document (PRD)
## DPC Startup Task Manager

---

### 1. Overview

The DPC Startup Task Manager is a collaborative, multi-tenant task management tool designed specifically for Direct Primary Care (DPC) clinic founders. It provides a clean, minimal experience for teams of up to 3 users per clinic to manage a preloaded set of categorized tasks that guide them through launching their clinic.

**This tool is also designed as a lead magnet** for the broader *DirectCareTools.com* platform. By offering this high-value tool for free, it builds trust and engagement with potential clinic owners while collecting qualified email leads for future marketing and product offerings.

---

### 2. Goals

- Help DPC physicians successfully launch their clinics using a structured, prebuilt checklist
- Support simple collaboration among small founding teams (up to 3 users)
- Stay laser-focused on essential startup tasks without distraction
- Maintain a clean, intuitive UI across desktop and mobile

---

### 3. Target Audience

- DPC Clinic founders and early team members (e.g., co-founders, administrative help)
- Typical users are clinicians or operations-minded individuals, not tech-savvy power users
- US-based users only

---

### 4. User Roles & Permissions

- All users within a clinic have equal permissions
- No admin/super-admin distinctions
- Each user can:
  - View all tasks
  - Add/edit/delete tasks
  - Assign tasks (including to self or others)
  - Add comments to tasks
  - Invite additional users (max 3 per clinic)
  - Delete the organization (with emphatic / dangerous warning)
  - Delete their account from settings portal (all deletions are final)

---

### 5. Multi-Tenancy & Team Management

- Each clinic is its own organization (tenant)
- Up to 3 users per organization
- Users are isolated to one clinic/organization (no org switching)

---

### 6. Authentication & User Flow

- Users access the tool via a link from directcaretools.com/tools/startup-task-manager
- New invited users must create a new account (no existing account joining)
- Unified login system across *DirectCareTools.com* suite
- Supports SSO (if feasible)
- Shared authentication for this and other tools

---

### 7. Onboarding Wizard

Upon first login, users complete a short setup flow:

1. Email / User Name  
2. Clinic Name  
3. Target Launch Date (used to auto-generate due dates)  
4. Invite up to 2 additional users  
5. Clinic Location (City, State) – optional

---

### 8. Task Behavior

| Feature               | Specification |
|----------------------|----------------|
| Preloaded Tasks      | 150 tasks in master list (provided by product owner) |
| Custom Tasks         | Users can create new tasks, assign tags, set due dates |
| Categories           | Tasks organized by tags (minimum 3 categories, potentially more) |
| Subtasks             | One level deep only |
| Due Dates            | Based on launch date, editable |
| Attachments          | Not supported |
| Hyperlinks           | Allowed in task text; sanitized |
| Recurring Tasks      | Not needed |
| Comments/Notes       | Supported on each task |
| Task Status          | Checkbox (done = strikethrough, undone = normal) |
| Visibility           | Completed tasks hidden by default; toggle to show |
| Task Assignment      | Can assign to specific team members during creation |
| Task Priority        | Pre-determined but user-editable |

---

### 9. Task List UI / UX

- Grouped by priority (custom order)
- Drag-and-drop supported for reordering
- Tags displayed on tasks
- Search, filter, and sort capabilities
- Responsive design (mobile, tablet, desktop)
- Minimalist interface using:
  - Flat UI (no gradients/shadows)
  - Lucide Icons
  - Clean typography and spacing
- **Empty States**: When all tasks in a category are complete, hide category for cleanliness
- **Bulk Actions**: Option to mark all tasks in a category as complete/incomplete (with warning confirmation)
- **No Progress Indicators**: Intentionally excluded to avoid pressure

---

### 10. Collaboration Behavior

- No real-time socket-style sync required
- Near-instant syncing for multi-user sessions (optimistic UI preferred)
- App prevents race conditions

---

### 11. Notifications & Reminders

- No email or in-app notifications required for MVP
- No scheduled reminders

---

### 12. Analytics & Reporting

- No dashboards or charts needed
- No admin summaries or emailed reports
- Optional: Simple CSV export functionality (if easy to implement)

---

### 13. Technical Requirements

| Component     | Preference |
|---------------|------------|
| Frontend      | Bolt.new-generated React frontend |
| Backend       | Node/Express or Bolt's backend |
| Database      | Supabase (self-hosted) or Postgres via Coolify |
| Hosting       | Coolify (self-hosted VPS) |
| Icons         | [Lucide.dev](https://lucide.dev) |
| Mobile        | Full responsive support |
| Scalability   | Support for hundreds of orgs and users |
| Security      | Rate limiting to prevent abuse |
| Offline       | No offline support needed |

#### 13.1 Security Best Practices

- **Row Level Security (RLS)**: Implement RLS on all database tables to ensure users can only access data within their organization
  - Organizations table: Users can only see their own organization
  - Users table: Users can only see other users within their organization
  - Tasks table: Users can only access tasks belonging to their organization
  - Comments table: Users can only access comments on tasks within their organization
- **Secure Authentication**: 
  - Enforce strong password policies (minimum 8 characters, mix of letters/numbers/symbols)
  - Secure handling of authentication tokens with proper expiration
  - Consider MFA as future enhancement
- **Input Validation**: 
  - Robust server-side validation on all API endpoints
  - Client-side validation for user experience
  - Sanitize all user inputs to prevent XSS attacks
- **Authorization Checks**: All API endpoints must verify user permissions before data access/modification
- **Rate Limiting**: 
  - Authentication endpoints: 5 attempts per minute per IP
  - API endpoints: 100 requests per minute per user
  - Task creation: 50 tasks per hour per user
- **Secure Communication**: All traffic must use HTTPS in production
- **Dependency Management**: Regular security updates for all third-party libraries
- **Error Handling**: Generic error messages in production to avoid information leakage
- **Session Management**: Secure session handling with proper timeout and invalidation

#### 13.2 Performance Optimization

**Database Performance:**
- **Indexing Strategy**:
  - Primary indexes on all foreign keys (organization_id, user_id, task_id)
  - Composite index on (organization_id, created_at) for task listing
  - Index on (organization_id, completed) for filtering completed tasks
  - Index on (organization_id, due_date) for date-based queries
  - Index on (organization_id, assigned_to) for user-specific task queries
- **Query Optimization**:
  - Use SELECT with specific columns instead of SELECT *
  - Implement pagination for task lists (50 tasks per page)
  - Use database-level filtering instead of client-side filtering
  - Avoid N+1 queries by using proper JOINs or batch queries

**Frontend Performance:**
- **Code Splitting**: Implement route-based code splitting for faster initial load
- **Lazy Loading**: Load task details and comments on demand
- **Bundle Optimization**: 
  - Tree shaking to remove unused code
  - Minification and compression of assets
  - Separate vendor bundles for better caching
- **Image Optimization**: 
  - Use WebP format where supported
  - Implement responsive images for different screen sizes
  - Compress all images to appropriate quality levels
- **Caching Strategy**:
  - Browser caching for static assets (CSS, JS, images)
  - API response caching for relatively static data (user profiles, organization info)
  - Service worker for offline-first experience (future enhancement)

**API Performance:**
- **Response Optimization**: Send only required data fields to minimize payload size
- **Optimistic UI**: Immediate UI updates with rollback on failure
- **Debounced Requests**: Debounce search and filter operations
- **Connection Pooling**: Efficient database connection management

**Performance Targets:**
- Initial page load: < 3 seconds on 3G connection
- Task list rendering: < 500ms for up to 200 tasks
- Task creation/update: < 200ms perceived response time
- Search results: < 1 second for any query

---

### 14. Data & Privacy

- No specific data retention requirements
- No HIPAA considerations (no PHI stored)
- US-based users only (no GDPR compliance required)
- Users can delete accounts via settings portal
- All account deletions are final
- Terms of Service and Privacy Policy required

#### 14.1 Privacy Best Practices

- **Data Minimization**: Only collect data essential for application functionality
  - Required: Email, name, clinic name, target launch date
  - Optional: Clinic location, phone number
  - Never collect: SSN, financial information, personal health information
- **User Consent**: 
  - Clear opt-in for marketing communications during signup
  - Separate consent for product updates vs promotional emails
  - Easy opt-out mechanism in all communications
- **Data Retention Policy**:
  - Active user data: Retained as long as account is active
  - Deleted account data: Permanently purged within 30 days
  - Backup data: Retained for 90 days maximum for disaster recovery
  - Analytics data: Anonymized and aggregated, retained for 2 years
- **Data Access Controls**:
  - User data accessible only to authorized personnel on need-to-know basis
  - All data access logged and auditable
  - No sharing of user data with third parties except as required by law
- **Data Portability**: Users can export their data in JSON format
- **Privacy by Design**: 
  - Default privacy settings favor user privacy
  - Minimal data collection at signup
  - Clear privacy notices at point of data collection
- **Third-Party Integrations**:
  - ConvertKit integration: Only email and consent status shared
  - Analytics: Use privacy-focused analytics (no personal data tracking)
  - No social media tracking pixels or unnecessary third-party scripts

---

### 15. Lead Capture & Email Integration

- **Email Required**: All users must sign up with email
- **List Integration**: Connect to ConvertKit (now Kit.com)
- **Opt-In**: Include opt-in for updates during signup
- **CTAs**:
  - "Get more resources" link
  - Footer links to other tools from DirectCareTools.com
- **No Exit Intent**: Intentionally excluded to avoid annoying users

---

### 16. Future Enhancements / Upgrade Path

- **Donation Support**:
  - Link to Stripe-powered "Support the Developer" donation page
- **Content Upgrades**: Potential future addition of downloadable resources
- **Referral System**: To be handled via email sequences, not built into app

---

### 17. Design System & Styling

The application should maintain consistency with the DirectCareTools.com design system by using the following base CSS files as the foundation (and/or implementing the tailwind config file if utilizing tailwind), with AI models adding additional styles as needed:

**design-tokens.css**: styles/design-tokens.css
**base-ui.css**: styles/base-ui.css
**tailwind.config.js**: styles/tailwind.config.js

Any additional CSS should build upon these foundations while maintaining the same design principles and token usage.

---

