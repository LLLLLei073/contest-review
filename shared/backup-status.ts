export interface AutomaticBackupStatus {
  supported: boolean;
  enabled: boolean;
  directory: string | null;
  lastSuccess: string | null;
  error: string | null;
}
export const unsupportedBackup: AutomaticBackupStatus = {
  supported: false,
  enabled: false,
  directory: null,
  lastSuccess: null,
  error: null,
};
export function backupReminderDue(
  lastDownload: string | null,
  snoozedUntil: string | null,
  now = Date.now(),
) {
  if (snoozedUntil && Date.parse(snoozedUntil) > now) return false;
  return (
    !lastDownload ||
    !Number.isFinite(Date.parse(lastDownload)) ||
    now - Date.parse(lastDownload) >= 7 * 86400000
  );
}
