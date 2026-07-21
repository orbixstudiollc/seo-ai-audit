import { useEffect, useState } from "react";
import {
  HISTORY_CHANGED_EVENT,
  loadHistory,
  mergeHistoryRecords,
  storeHistory,
  type AuditHistoryRecord,
} from "@/lib/history";
import { loadCloudHistory } from "@/lib/cloud/history";
import { ACCOUNT_OWNER_CHANGED_EVENT } from "@/lib/auth/events";
import { useLocalSettings } from "@/app/hooks/useLocalSettings";

/**
 * Local history immediately, then merged with cloud on hydrate/account-change
 * (shared by the Growth tab and the per-site hub so both read one history
 * list the same way — extracted from G1's GrowthOverview effect verbatim).
 */
export function useMergedHistory(): { records: AuditHistoryRecord[]; ready: boolean } {
  const [records, setRecords] = useState<AuditHistoryRecord[]>([]);
  const [ready, setReady] = useState(false);
  const { settings } = useLocalSettings();

  useEffect(() => {
    let active = true;
    const syncLocal = () => {
      setRecords(loadHistory(window.localStorage));
      setReady(true);
    };
    const hydrate = async () => {
      syncLocal();
      const cloud = await loadCloudHistory();
      if (!active || cloud === null) return;
      const merged = mergeHistoryRecords(cloud, loadHistory(window.localStorage), settings.historyLimit);
      storeHistory(window.localStorage, merged);
      setRecords(merged);
    };
    void hydrate();
    const syncAccount = () => void hydrate();
    window.addEventListener(HISTORY_CHANGED_EVENT, syncLocal);
    window.addEventListener("storage", syncLocal);
    window.addEventListener(ACCOUNT_OWNER_CHANGED_EVENT, syncAccount);
    return () => {
      active = false;
      window.removeEventListener(HISTORY_CHANGED_EVENT, syncLocal);
      window.removeEventListener("storage", syncLocal);
      window.removeEventListener(ACCOUNT_OWNER_CHANGED_EVENT, syncAccount);
    };
  }, [settings.historyLimit]);

  return { records, ready };
}
