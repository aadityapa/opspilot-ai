# Governance and personal data

What the application keeps about people, who can get it out, how it is removed, and what is
written down when any of that happens. Written to be checked against the code, not to reassure.

## What is stored about a person

| Data | Where | Why |
| --- | --- | --- |
| Name, email, role | `User` | Identity and authorisation |
| Password hash (scrypt) | `User.passwordHash` | Sign-in. The password itself is never stored |
| Authenticator secret, encrypted (AES-256-GCM under `APP_SECRET`) | `User.mfaSecret` | Second factor |
| Recovery codes, hashed (SHA-256), one row each | `RecoveryCode` | Second factor fallback; a row is deleted when used |
| Failed sign-in count, lock expiry, last sign-in, password change date | `User` | Lockout and account hygiene |
| Sessions: token hash, created, last seen, source address, user agent | `Session` | Sign-in state and the "where you are signed in" list |
| Password reset tokens, hashed, with expiry | `PasswordReset` | Reset links; deleted when used or expired |
| Audit events with source address | `Event` | Security and administrative record |
| Tickets, replies, internal notes, assets, notifications | operational tables | The product |
| AI usage: operation, outcome, token counts, duration | `AiUsage` | Cost and limits. **Prompts and answers are never stored** |
| Job title, location, phone, department, manager | `User` | Directory and approvals routing (Phase 6) |
| Notification preferences | `User.notifyPrefs` | Which kinds a person wants to hear about |
| Attachments: file name, type, size, hash, uploader; the bytes under `UPLOAD_DIR` | `Attachment` | Ticket evidence. Removed with the ticket; not part of erasure unless the ticket is |
| Ratings and comments | `Survey` | Satisfaction reports |
| Followers, mentions, saved views, approvals decided | `Watcher`, `_mentions`, `SavedView`, `Approval` | Collaboration; saved views are deleted with the account |

Nothing is stored in the browser beyond the session cookie (HttpOnly, SameSite=Strict, `__Host-`
prefixed in production) and the theme preference.

## Getting data out

- **Self-service.** Account & security → *Download my data* (`GET /api/auth/export`) returns a JSON
  file: profile, tickets where the person is requester or assignee, their replies, the audit events
  they caused, assets they own, their notifications, and AI usage totals. Producing it is itself
  audited (`DATA_EXPORTED`).
- **Administrator.** Users → Manage → *Export their data* (`GET /api/admin/users/:id/export`), same
  content, audited with the administrator as actor.
- **Audit log.** Users → *Export audit log* (`GET /api/admin/audit/export?format=csv|json&from&to&action`)
  streams the whole log in pages. The export writes an `AUDIT_EXPORTED` event naming the filter.

## Erasure

Users → Manage → *Erase account…*, confirmed by typing the person's email address
(`POST /api/admin/users/:id/erase`). It is the usual compromise between a person's right to be
forgotten and the organisation's need for operational records, and the endpoint returns exactly
this list so nobody has to guess:

**Removed:** name, email address, password, authenticator secret and recovery codes, all sessions,
reset tokens, queued notifications, source addresses on the person's audit events, asset ownership.
Open tickets assigned to them go back to the queue.

**Retained:** tickets, replies and internal notes, attributed to "Deleted user"; audit events
(actor shown as "Deleted user"); AI usage counts, which never contained content.

The account is disabled, marked with `deletedAt`, and disappears from the Users list. The action is
irreversible and audited (`USER_ERASED`). An administrator cannot erase their own account.

If your obligations require removing ticket text authored by the person as well, that is a
deliberate manual step: the retained records are exactly what the export shows, so they can be
reviewed before deciding.

## Retention

Described in [OPERATIONS.md](OPERATIONS.md#retention). In short: standalone audit events after
`RETENTION_AUDIT_DAYS`, AI usage after `RETENTION_AI_USAGE_DAYS`, delivered notifications after
`RETENTION_OUTBOX_DAYS`; ticket-bound audit events never. Zero keeps forever.

## What is audited

Every row in `Event` has an action, a detail line, a timestamp, the actor (or none, for anonymous
security events such as a failed sign-in for an unknown address), and a source address for
security events. Actions added in this phase:

`LOGIN_SUCCESS` `LOGIN_FAILED` `LOGIN_LOCKED` `LOGIN_PASSWORD_OK` `LOGOUT` `MFA_ENABLED`
`MFA_DISABLED` `MFA_ENROL_FAILED` `MFA_RECOVERY_CODE_USED` `MFA_RECOVERY_CODES_REGENERATED`
`MFA_RESET_BY_ADMIN` `PASSWORD_CHANGED` `PASSWORD_CHANGE_FAILED` `PASSWORD_RESET_REQUESTED`
`PASSWORD_RESET_LINK_ISSUED` `PASSWORD_RESET` `PASSWORD_RESET_REJECTED` `SESSION_REVOKED`
`USER_UNLOCKED` `USER_ERASED` `DATA_EXPORTED` `AUDIT_EXPORTED` `RETENTION_RUN`

`USER_CREATED` and `USER_UPDATED` predate this phase and now record role changes as well as
activation.

## Roles and permissions

The complete matrix is in [PERMISSIONS.md](PERMISSIONS.md) and is enforced by
`tests/permissions.test.ts`, which also fails if a route is registered without appearing in it.
