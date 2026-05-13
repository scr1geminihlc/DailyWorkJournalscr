# Security Specification - Assistant Work Log

## Data Invariants
- A daily log must have a valid date-string ID (YYYY-MM-DD).
- `tasks` must be a map.
- `customTasks` must be a list of maps, each with `id`, `title`, and `completed`.
- `updatedAt` must be a valid ISO string or server timestamp.

## The "Dirty Dozen" Payloads (Denial Tests)
1. Write to `dailyLogs/invalid-date-format` -> Denied (ID format)
2. Create log with `customTasks` as a string -> Denied (Type safety)
3. Update log with keys not in schema -> Denied (Schema guard)
4. Anonymous user tries to delete a log -> Denied (Delete policy)
5. User tries to set `updatedAt` to a date in the past -> Denied (Temporal integrity)
6. Injecting 1MB string into a task ID -> Denied (Size guard)
7. Spoofing `supervisorFeedback` without being the supervisor (Note: Since we use client-side password, this is hard to enforce strictly without real RBAC)
8. Setting `tasks` to null -> Denied (Required field)
9. Overwriting `dailyLogs` with an array -> Denied (Type safety)
10. Massive list in `customTasks` (> 100 items) -> Denied (Resource exhaustion)
11. Reading the entire `dailyLogs` collection without being signed in -> Denied (Auth guard)
12. Modifying `updatedAt` without changing anything else -> Denied (Change policy)

## Rules Blueprint
- `allow read, write: if isSignedIn();`
- `isValidDailyLog()` helper to check schema.
- `isValidId()` for the date path.
