# JavaScript modules

The dashboard uses classic browser scripts. Keep the script order in
`public/index.html`: later files depend on globals declared by earlier files.

## Current load order

1. `adapters/supabase-adapter.js`
2. `core/prelude.js`
3. `modules/crm.js`
4. `modules/crm/search.js`
5. `modules/crm/home-dashboards.js`
6. `modules/crm/followups.js`
7. `modules/crm/supabase-sync.js`
8. `modules/crm/presentations.js`
9. `modules/crm/dashboard-kanban.js`
10. `modules/evolution.js`
11. `modules/whatsapp-operations.js`
12. `modules/whatsapp/chips.js`
13. `modules/whatsapp/responses.js`
14. `modules/whatsapp/audit.js`
15. `modules/supabase-operations.js`
16. `modules/conversations.js`
17. `core/legacy-state.js`
18. `modules/assignment.js`
19. `core/navigation-storage.js`
20. `modules/leads-base.js`
21. `modules/imports-validation.js`
22. `modules/imports/home-dashboard.js`
23. `modules/imports/workflow-actions.js`
24. `modules/imports/history-excluded.js`
25. `modules/imports/importer.js`
26. `modules/imports/validation.js`
27. `modules/legacy-dispatch.js`
28. `modules/dispatch/chip-slots.js`
29. `modules/dispatch/chip-panels.js`
30. `modules/dispatch/company-list.js`
31. `modules/dispatch/batch-images.js`
32. `modules/dispatch/queue-state.js`
33. `modules/dispatch/schedule-config.js`
34. `modules/instagram.js`
35. `modules/instagram/redirects.js`
36. `modules/instagram/settings.js`
37. `modules/instagram/assignment.js`
38. `modules/instagram/week-templates.js`
39. `modules/instagram/dashboard.js`
40. `modules/tracking.js`
41. `app.js`
42. `modules/chips-compatibility.js`
43. `modules/whatsapp-manual-send.js`
44. `modules/whatsapp-supabase.js`

## Notes

- Removed legacy sidebar recovery/watchdog scripts and the old WhatsApp V27/V30/V32 dispatch UI.
- The active WhatsApp dispatch flow is `modules/dispatch/*`.
- `modules/whatsapp-operations.js` is retained only for compatibility helpers and legacy queue data migration.
- Console debug logs are off by default. Enable temporarily with:

```js
localStorage.setItem('vs_debug_logs', '1');
```
