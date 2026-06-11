# JavaScript modules

The dashboard uses classic browser scripts. Keep the script order in `index.html`:
later files depend on globals declared by earlier files. `app.js` runs the final
bootstrap before the compatibility layers are applied.

## Load order

1. `adapters/supabase-adapter.js`: Supabase client adapter.
2. `core/prelude.js`: error guards, safe defaults, constants, and authentication.
3. `modules/crm.js`: CRM drawer and lead workflow base.
4. `modules/crm/search.js`: global lead search.
5. `modules/crm/home-dashboards.js`: CRM home dashboards.
6. `modules/crm/followups.js`: follow-up center.
7. `modules/crm/supabase-sync.js`: primary Supabase CRM synchronization.
8. `modules/crm/presentations.js`: lead presentation links.
9. `modules/crm/dashboard-kanban.js`: executive metrics, kanban, and CRM polish.
10. `modules/evolution.js`: Evolution API integration and lead messaging.
11. `modules/whatsapp-operations.js`: WhatsApp queue base, campaigns, and templates.
12. `modules/whatsapp/queue-control.js`: queue pause state and template preparation.
13. `modules/whatsapp/chips.js`: chip configuration and daily usage distribution.
14. `modules/whatsapp/dispatch-preview.js`: initial dispatch preview and execution.
15. `modules/whatsapp/dispatch-schedule.js`: dispatch rhythm and block rules.
16. `modules/whatsapp/dispatch-runtime.js`: timed dispatch loop and runtime state.
17. `modules/whatsapp/responses.js`: Evolution webhook response handling.
18. `modules/whatsapp/audit.js`: queue audit cards, list, and CSV export.
19. `modules/supabase-operations.js`: operational data persistence.
20. `modules/conversations.js`: conversation synchronization.
21. `core/legacy-state.js`: defaults, shared state, pagination, and date helpers.
22. `modules/assignment.js`: attribution and WhatsApp backlog actions.
23. `core/navigation-storage.js`: navigation and local storage helpers.
24. `modules/leads-base.js`: permanent lead inventory and controlled recovery.
25. `modules/imports-validation.js`: lead extract helpers and business category filter.
26. `modules/imports/home-dashboard.js`: commercial home dashboard render.
27. `modules/imports/workflow-actions.js`: pagination and lead workflow actions.
28. `modules/imports/history-excluded.js`: history and excluded domains panels.
29. `modules/imports/importer.js`: Apify JSON preview and lead import.
30. `modules/imports/validation.js`: number validation tabs and actions.
31. `modules/legacy-dispatch.js`: link validation and routing into attribution.
32. `modules/dispatch/chip-slots.js`: per-chip batch state and send controls.
33. `modules/dispatch/chip-panels.js`: chip accordions and WhatsApp panel render.
34. `modules/dispatch/company-list.js`: company list and per-chip queue render.
35. `modules/dispatch/batch-images.js`: IndexedDB storage for batch images.
36. `modules/dispatch/queue-state.js`: queue synchronization and item actions.
37. `modules/dispatch/schedule-config.js`: automatic schedule and Evolution dispatch config.
38. `modules/dispatch/legacy-batch-send.js`: legacy single-queue batch sending.
39. `modules/instagram.js`: Instagram queue base and sent-state actions.
40. `modules/instagram/redirects.js`: redirect link creation and updates.
41. `modules/instagram/settings.js`: chip, business category, and template settings.
42. `modules/instagram/assignment.js`: manual leads and Instagram attribution queue.
43. `modules/instagram/week-templates.js`: weekly Instagram state and message templates.
44. `modules/instagram/dashboard.js`: backlog, daily allocation, and status dashboard.
45. `modules/tracking.js`: tracking export and the remaining tracking actions.
46. `app.js`: final bootstrap, timeline helpers, and startup checks.
47. `compatibility/sidebar-legacy.js`: guarded mobile and legacy sidebar handlers.
48. `modules/chips-compatibility.js`: chip form compatibility and Evolution config resolution.
49. `modules/whatsapp-manual-send.js`: manual WhatsApp sending compatibility layers.
50. `compatibility/queue-conversation.js`: safe queue and conversation compatibility helpers.
51. `modules/import-inbox.js`: import classification, inbox, badges, and grouped menu compatibility.
52. `modules/whatsapp-supabase.js`: authenticated WhatsApp message synchronization.
53. `compatibility/sidebar-recovery.js`: guarded legacy sidebar recovery routines.
54. `compatibility/stability-guards.js`: final queue, Instagram, and null-data guards.

When moving code between files, preserve this dependency order or replace the
shared global explicitly.
