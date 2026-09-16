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

---

### 14. Data & Privacy

- No specific data retention requirements
- No HIPAA considerations (no PHI stored)
- US-based users only (no GDPR compliance required)
- Users can delete accounts via settings portal
- All account deletions are final
- Terms of Service and Privacy Policy required

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

