# CollabBoard — TODO / Future Work

## Access Control (Phase 3 — Deferred)

### Board Access Levels
- [ ] Three tiers: **Public** (anyone with link), **Authenticated** (logged-in users only), **Private** (invite-only by email)
- [ ] Board creator is the only one who can set/change access level
- [ ] Settings panel on board page (owner only) to configure access

### Invite System
- [ ] Invite by email for private boards (type email addresses in settings panel)
- [ ] Shareable invite links that auto-grant access when opened
- [ ] Access denied page: "Please request access from the board owner" + button back to dashboard

### Roles
- [ ] **Owner**: full control, can delete board, change access, manage roles
- [ ] **Editor**: can create/edit/delete objects, full collaboration
- [ ] **Viewer**: can see real-time cursors and presence, but cannot create/edit/delete objects (read-only board)

### Firebase Security Rules
- [ ] Update rules to enforce access levels server-side
- [ ] Rules check board membership for authenticated/private boards
- [ ] Viewer role enforced at rule level (deny writes to objects/connectors)

### Board Management
- [ ] Soft delete boards (owner only) — mark as deleted, hide from dashboard, retain data
- [ ] Restore deleted boards?

---

## Team Support (Deferred — Future)
- [ ] Create teams with members
- [ ] Team members auto-get access to all team boards
- [ ] Team dashboard / team board section
- [ ] Team roles (admin, member)

---

## AI Agent (Deferred to Last)
- [ ] Enable Firebase Blaze plan (pay-as-you-go)
- [ ] Set OpenAI API key: `firebase functions:secrets:set OPENAI_API_KEY`
- [ ] Deploy Cloud Functions: `firebase deploy --only functions`
- [ ] Wire up AICommandInput to call the Cloud Function
- [ ] 11 command types across 4 categories (creation, manipulation, layout, complex templates)

---

## Submission Deliverables
- [ ] README with setup guide + architecture overview + deployed link
- [ ] Demo video (3–5 min)
- [ ] AI Development Log (1 page)
- [ ] AI Cost Analysis (projections for 100/1K/10K/100K users)
- [ ] Social post (X or LinkedIn)
