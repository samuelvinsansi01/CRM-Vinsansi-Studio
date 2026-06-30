import { canTransition, type EntityKind } from '../state-machine';

export type PermissionContext = {
  hasValidInstagram?: boolean;
};

export function getPermissions(entity: EntityKind, status: unknown, context: PermissionContext = {}) {
  const can = (action: Parameters<typeof canTransition>[0]['action'], toStatus?: unknown) =>
    canTransition({ entity, fromStatus: status, toStatus, action }).allowed;

  const instagramOverrideAllowed = can('instagram_override') && context.hasValidInstagram !== false;

  return {
    canEdit: () => can('edit'),
    canApprove: () => can('approve', 'approved'),
    canReject: () => can('reject', 'rejected'),
    canInvalidate: () => can('invalidate', 'invalid'),
    canQueue: () => can('queue', 'queued'),
    canSend: () => can('send'),
    canRetry: () => can('reprocess', 'queued'),
    canPause: () => can('pause', 'paused'),
    canResume: () => can('resume', 'queued'),
    canArchive: () => can('archive', 'archived'),
    canRestore: () => can('restore'),
    canInstagramOverride: () => instagramOverrideAllowed,
    canSelect: () => can('send') || can('pause', 'paused') || can('resume', 'queued') || can('reprocess', 'queued') || can('invalidate', 'invalid'),
  };
}

export function permissionsFor(entity: EntityKind, status: unknown, context: PermissionContext = {}) {
  return getPermissions(entity, status, context);
}
