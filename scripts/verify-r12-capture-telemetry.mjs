import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const route=fs.readFileSync(path.join(root,'server/routes/maps/extension.ts'),'utf8');
const checks=[
 ['extension 1.0.9',route.includes("const EXTENSION_VERSION = '1.0.9'")],
 ['breakdown',route.includes('const rejectionBreakdown = { invalidIdentity: 0, quality: 0, closedBusiness: 0, noSupportedContact: 0, suppressed: 0 }')],
 ['closed is telemetry only',route.includes("if (closed) { rejected += 1; rejectionBreakdown.closedBusiness += 1; continue; }")],
 ['no contact telemetry only',route.includes("effective.eligibilityStatus !== 'ready_to_save') { rejected += 1; rejectionBreakdown.noSupportedContact += 1; continue; }")],
 ['manual pending only on insert',route.includes("review_state: 'pending'")],
 ['no automatic invalid insert',!route.includes("review_state: ['closed_business','no_supported_contact'].includes(eligibilityStatus) ? 'invalid' : 'pending'")],
 ['response breakdown',route.includes('rejectionBreakdown,')],
];
for(const [n,ok] of checks){if(!ok)throw new Error('missing:'+n)}console.log('verify-r12-capture-telemetry: ok');
