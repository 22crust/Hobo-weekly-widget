import React, { useEffect, useState } from "react";
import { Update } from "@tauri-apps/plugin-updater";
import {
  AlertCircle,
  Check,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import {
  ACCENT_COLOR_PRESETS,
  DEFAULT_ACCENT_HEX,
  getAppSettings,
  getSavedAccentColorSync,
  saveAccentColor,
  saveAppSettings,
} from "../../db/appSettingsRepo";
import {
  detectCalendarProvider,
  getLatestCalendarFeedResults,
  onCalendarFeedResultsUpdated,
  splitCalendarUrlEntries,
  syncGoogleCalendarIcs,
} from "../../services/icsSync";
import {
  checkGithubRemoteFile,
  cleanAllDeletedTasksAndSync,
  extractRemoteTasks,
  pushLocalDataToGithubNow,
  resolveInitialGithubMigration,
  syncConfigToRustBackend,
  testGithubConnection,
} from "../../services/githubSyncService";
import {
  AppSettings,
  CalendarFeedSyncResult,
  PlannerBackupPayload,
  StorageMode,
} from "../../types/planner";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsSaved: () => void;
  availableUpdate?: Update | null;
  isInstallingUpdate?: boolean;
  updateProgressPct?: number | null;
  updateError?: string | null;
  onInstallUpdate?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSettingsSaved,
  availableUpdate = null,
  isInstallingUpdate = false,
  updateProgressPct = null,
  updateError = null,
  onInstallUpdate,
}) => {
  const [initialMode, setInitialMode] = useState<StorageMode>("local");
  const [storageMode, setStorageMode] = useState<StorageMode>("local");
  const [calendarEntries, setCalendarEntries] = useState<string[]>([""]);
  const [visibleCalendarIdx, setVisibleCalendarIdx] = useState<
    Record<number, boolean>
  >({});
  const [feedStatuses, setFeedStatuses] = useState<
    Record<string, CalendarFeedSyncResult>
  >(() => getLatestCalendarFeedResults());
  const [isSyncingFeeds, setIsSyncingFeeds] = useState(false);

  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubFilePath, setGithubFilePath] = useState("planner-data.json");
  const [accentColor, setAccentColor] = useState(() =>
    getSavedAccentColorSync()
  );
  const [showToken, setShowToken] = useState(false);

  const [isTesting, setIsTesting] = useState(false);
  const [isCleaningDeleted, setIsCleaningDeleted] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [pendingRemoteConflict, setPendingRemoteConflict] =
    useState<PlannerBackupPayload | null>(null);

  useEffect(() => {
    return onCalendarFeedResultsUpdated((results) => {
      setFeedStatuses(results);
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setStatusMessage(null);
    setPendingRemoteConflict(null);
    setAccentColor(getSavedAccentColorSync());
    setFeedStatuses(getLatestCalendarFeedResults());

    void getAppSettings().then((s) => {
      setInitialMode(s.storage_mode);
      setStorageMode(s.storage_mode);
      const rawUrls = s.calendar_urls || s.google_ical_urls || "";
      const entries = splitCalendarUrlEntries(rawUrls);
      setCalendarEntries(entries.length > 0 ? entries : [""]);
      setGithubOwner(s.github_owner);
      setGithubRepo(s.github_repo);
      setGithubToken(s.github_token);
      setGithubFilePath(s.github_file_path || "planner-data.json");
    });
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectAccentColor = (hex: string) => {
    setAccentColor(hex);
    void saveAccentColor(hex);
  };

  const getJoinedCalendarUrls = (): string =>
    calendarEntries
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
      .join("\n");

  const buildDraftSettings = (): AppSettings => {
    const joinedUrls = getJoinedCalendarUrls();
    return {
      storage_mode: storageMode,
      google_ical_urls: joinedUrls,
      calendar_urls: joinedUrls,
      github_owner: githubOwner.trim(),
      github_repo: githubRepo.trim(),
      github_token: githubToken.trim(),
      github_file_path:
        githubFilePath.trim().replace(/^\/+/, "") || "planner-data.json",
      accent_color: accentColor.trim() || DEFAULT_ACCENT_HEX,
    };
  };

  const handleRefreshCalendarFeeds = async () => {
    setIsSyncingFeeds(true);
    try {
      const saved = await saveAppSettings(buildDraftSettings());
      const nonEmpty = splitCalendarUrlEntries(saved.calendar_urls);
      const syncResult = await syncGoogleCalendarIcs(nonEmpty);
      if (syncResult.feedResults) {
        setFeedStatuses(syncResult.feedResults);
      }
      onSettingsSaved();
    } finally {
      setIsSyncingFeeds(false);
    }
  };

  const handleSaveLocalMode = async () => {
    setIsTesting(true);
    setIsSyncingFeeds(true);
    setStatusMessage(null);
    try {
      const saved = await saveAppSettings(buildDraftSettings());
      await syncConfigToRustBackend(saved);
      setInitialMode(saved.storage_mode);
      const nonEmpty = splitCalendarUrlEntries(saved.calendar_urls);
      const syncResult = await syncGoogleCalendarIcs(nonEmpty);
      if (syncResult.feedResults) {
        setFeedStatuses(syncResult.feedResults);
      }
      setStatusMessage({
        type: "success",
        text: "Settings saved locally.",
      });
      onSettingsSaved();
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsTesting(false);
      setIsSyncingFeeds(false);
    }
  };

  const handleTestAndSaveGithub = async () => {
    setIsTesting(true);
    setIsSyncingFeeds(true);
    setStatusMessage(null);
    const draft = buildDraftSettings();

    try {
      await testGithubConnection(draft);

      const saved = await saveAppSettings(draft);
      await syncConfigToRustBackend(saved);

      const nonEmpty = splitCalendarUrlEntries(saved.calendar_urls);
      const syncResult = await syncGoogleCalendarIcs(nonEmpty);
      if (syncResult.feedResults) {
        setFeedStatuses(syncResult.feedResults);
      }

      const remoteCheck = await checkGithubRemoteFile(saved);

      if (!remoteCheck.exists || !remoteCheck.payload) {
        const count = await pushLocalDataToGithubNow(true);
        setInitialMode("github");
        setStatusMessage({
          type: "success",
          text: `Connected & transferred ${count} local task${
            count === 1 ? "" : "s"
          } to GitHub backup.`,
        });
        onSettingsSaved();
      } else if (initialMode === "local") {
        setPendingRemoteConflict(remoteCheck.payload);
      } else {
        const msg = await resolveInitialGithubMigration(
          "merge",
          remoteCheck.payload
        );
        setStatusMessage({
          type: "success",
          text: `Connection verified. ${msg}`,
        });
        onSettingsSaved();
      }
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsTesting(false);
      setIsSyncingFeeds(false);
    }
  };

  const handleResolveConflict = async (
    choice: "keep_local" | "keep_remote" | "merge"
  ) => {
    if (!pendingRemoteConflict) return;
    setIsTesting(true);
    setStatusMessage(null);
    try {
      const summary = await resolveInitialGithubMigration(
        choice,
        pendingRemoteConflict
      );
      setPendingRemoteConflict(null);
      setInitialMode("github");
      setStatusMessage({
        type: "success",
        text: summary,
      });
      onSettingsSaved();
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleCleanDeletedTasks = async () => {
    setIsCleaningDeleted(true);
    setStatusMessage(null);
    try {
      const { purgedTasks, purgedImages } = await cleanAllDeletedTasksAndSync();
      const total = purgedTasks + purgedImages;
      setStatusMessage({
        type: "success",
        text:
          total > 0
            ? `Purged ${purgedTasks} deleted task${
                purgedTasks === 1 ? "" : "s"
              }${
                purgedImages > 0
                  ? ` and ${purgedImages} deleted sticker${
                      purgedImages === 1 ? "" : "s"
                    }`
                  : ""
              } from SQLite${
                storageMode === "github" ? " & synced to GitHub." : "."
              }`
            : "No soft-deleted tasks or stickers to purge.",
      });
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsCleaningDeleted(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 select-none p-4">
      <div className="w-full max-w-[460px] bg-hobo-paper border border-hobo-lineDark text-hobo-ink flex flex-col max-h-[90vh] overflow-hidden shadow-sm">
        {/* Modal Header */}
        <div className="px-4 py-2.5 border-b border-hobo-lineDark flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.16em] font-normal text-hobo-ink">
            SETTINGS &amp; SYNC
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0 outline-none"
          >
            <X className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-4 overflow-y-auto text-xs font-light">
          {/* 0. App Update Available Banner (always visible in Settings when an update exists, even if skipped) */}
          {availableUpdate && onInstallUpdate && (
            <div className="p-2.5 border border-hobo-red bg-hobo-redSoft space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-hobo-red font-normal">
                    UPDATE AVAILABLE (v{availableUpdate.version})
                  </div>
                  <div className="text-[10px] text-hobo-ink">
                    A newer version is ready to install.
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isInstallingUpdate}
                  onClick={onInstallUpdate}
                  className="px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] bg-hobo-red text-white hover:opacity-90 disabled:opacity-60 transition-opacity border border-hobo-red inline-flex items-center gap-1.5 shrink-0"
                >
                  {isInstallingUpdate ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Download className="w-3 h-3 stroke-[1.75]" />
                  )}
                  <span>
                    {isInstallingUpdate
                      ? updateProgressPct !== null
                        ? `${updateProgressPct}%`
                        : "Updating..."
                      : "Update"}
                  </span>
                </button>
              </div>
              {updateError && (
                <div className="text-[10px] text-hobo-red">{updateError}</div>
              )}
            </div>
          )}

          {/* 1. Accent Colour Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-[10px] uppercase tracking-[0.14em] text-hobo-ink font-normal">
                ACCENT COLOUR
              </label>
              <span className="text-[10px] uppercase tracking-wider text-hobo-muted font-mono">
                {accentColor.toUpperCase()}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 pt-0.5">
              {/* Tasteful Hobonichi-inspired preset swatches */}
              <div className="flex items-center gap-2">
                {ACCENT_COLOR_PRESETS.map((preset) => {
                  const isActive =
                    accentColor.toLowerCase() === preset.hex.toLowerCase();
                  return (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => handleSelectAccentColor(preset.hex)}
                      style={{ backgroundColor: preset.hex }}
                      className={`w-5 h-5 border transition-transform ${
                        isActive
                          ? "border-hobo-ink scale-110 ring-1 ring-hobo-ink/50"
                          : "border-hobo-lineDark hover:scale-105"
                      }`}
                    />
                  );
                })}
              </div>

              {/* Custom color picker + hex input */}
              <div className="flex items-center gap-1.5">
                <label className="relative flex items-center cursor-pointer">
                  <input
                    type="color"
                    value={
                      /^#[0-9a-fA-F]{6}$/.test(accentColor)
                        ? accentColor
                        : DEFAULT_ACCENT_HEX
                    }
                    onChange={(e) => handleSelectAccentColor(e.target.value)}
                    className="w-5 h-5 p-0 border border-hobo-lineDark bg-transparent cursor-pointer"
                  />
                </label>
                <input
                  type="text"
                  value={accentColor}
                  onChange={(e) => handleSelectAccentColor(e.target.value)}
                  maxLength={7}
                  className="w-16 bg-white/60 border border-hobo-lineDark px-1.5 py-0.5 text-[10px] font-mono text-hobo-ink uppercase outline-none focus:border-hobo-red"
                />
              </div>
            </div>
          </div>

          {/* 2. Multi-Calendar Feeds (Google Calendar, Apple iCloud webcal://, Outlook .ics) */}
          <div className="space-y-2 pt-2 border-t border-hobo-line">
            <div className="flex items-center justify-between">
              <label className="block text-[10px] uppercase tracking-[0.14em] text-hobo-ink font-normal">
                CALENDAR FEEDS (GOOGLE, APPLE ICLOUD, OUTLOOK .ICS)
              </label>
              <button
                type="button"
                disabled={isSyncingFeeds || isTesting}
                onClick={handleRefreshCalendarFeeds}
                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.1em] text-hobo-muted hover:text-hobo-red bg-transparent border-0 p-0 transition-colors"
              >
                <RefreshCw
                  className={`w-2.5 h-2.5 stroke-[1.75] ${
                    isSyncingFeeds ? "animate-spin" : ""
                  }`}
                />
                <span>Refresh</span>
              </button>
            </div>

            <div className="space-y-2">
              {calendarEntries.map((entryUrl, idx) => {
                const trimmed = entryUrl.trim();
                const providerLabel = trimmed
                  ? detectCalendarProvider(trimmed)
                  : `Calendar #${idx + 1}`;
                const feedStatus = trimmed ? feedStatuses[trimmed] : undefined;
                const isRevealed = Boolean(visibleCalendarIdx[idx]);

                return (
                  <div key={idx} className="space-y-1">
                    {/* Provider Auto-Detection Badge & Sync Status Indicator */}
                    <div className="flex items-center justify-between gap-2 text-[9px] tracking-[0.08em]">
                      <span className="uppercase text-hobo-muted font-normal">
                        {providerLabel}
                      </span>

                      {trimmed && (
                        <div className="flex items-center gap-1">
                          {isSyncingFeeds ? (
                            <span className="inline-flex items-center gap-1 text-hobo-muted">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              <span>Syncing...</span>
                            </span>
                          ) : feedStatus ? (
                            feedStatus.ok ? (
                              <span className="inline-flex items-center gap-0.5 text-hobo-ink">
                                <Check className="w-2.5 h-2.5 stroke-[2]" />
                                <span>Synced</span>
                              </span>
                            ) : (
                              <span
                                title={feedStatus.error ?? "Invalid URL / Fetch Error"}
                                className="inline-flex items-center gap-0.5 text-hobo-red"
                              >
                                <AlertCircle className="w-2.5 h-2.5 stroke-[1.75]" />
                                <span>Invalid URL / Fetch Error</span>
                              </span>
                            )
                          ) : null}
                        </div>
                      )}
                    </div>

                    {/* Masked Calendar URL Input + Show/Hide Eye Toggle + Remove Entry */}
                    <div className="flex items-center gap-1">
                      <div className="relative flex-1 flex items-center">
                        <input
                          type={isRevealed ? "text" : "password"}
                          value={entryUrl}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCalendarEntries((prev) =>
                              prev.map((item, i) => (i === idx ? val : item))
                            );
                          }}
                          placeholder="https://... or webcal://p123-caldav.icloud.com/..."
                          className="w-full bg-white/60 border border-hobo-lineDark pl-2 pr-7 py-1 text-[11px] text-hobo-ink placeholder:text-hobo-faint outline-none focus:border-hobo-red font-light"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setVisibleCalendarIdx((prev) => ({
                              ...prev,
                              [idx]: !prev[idx],
                            }))
                          }
                          className="absolute right-1.5 text-hobo-muted hover:text-hobo-ink bg-transparent border-0 p-0.5"
                        >
                          {isRevealed ? (
                            <EyeOff className="w-3.5 h-3.5 stroke-[1.5]" />
                          ) : (
                            <Eye className="w-3.5 h-3.5 stroke-[1.5]" />
                          )}
                        </button>
                      </div>

                      {(calendarEntries.length > 1 || trimmed.length > 0) && (
                        <button
                          type="button"
                          onClick={() => {
                            if (calendarEntries.length === 1) {
                              setCalendarEntries([""]);
                            } else {
                              setCalendarEntries((prev) =>
                                prev.filter((_, i) => i !== idx)
                              );
                            }
                          }}
                          className="p-1 text-hobo-muted hover:text-hobo-red bg-transparent border-0 shrink-0"
                        >
                          <X className="w-3 h-3 stroke-[1.5]" />
                        </button>
                      )}
                    </div>

                    {/* Small "+ add new calendar" button underneath each entry */}
                    <div className="pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setCalendarEntries((prev) => {
                            const next = [...prev];
                            next.splice(idx + 1, 0, "");
                            return next;
                          });
                        }}
                        className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.1em] text-hobo-muted hover:text-hobo-red bg-transparent border-0 p-0 transition-colors"
                      >
                        <Plus className="w-2.5 h-2.5 stroke-[1.75]" />
                        <span>Add new calendar</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. Storage & Backup Mode Segmented Toggle */}
          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase tracking-[0.14em] text-hobo-ink font-normal">
              STORAGE &amp; BACKUP MODE
            </label>
            <div className="grid grid-cols-2 border border-hobo-lineDark">
              <button
                type="button"
                onClick={() => {
                  setStorageMode("local");
                  setPendingRemoteConflict(null);
                  setStatusMessage(null);
                }}
                className={`py-1.5 px-2 text-[10px] uppercase tracking-[0.1em] transition-colors border-r border-hobo-lineDark ${
                  storageMode === "local"
                    ? "bg-hobo-redSoft text-hobo-red font-normal"
                    : "bg-transparent text-hobo-muted hover:text-hobo-ink"
                }`}
              >
                Local Only (This PC)
              </button>
              <button
                type="button"
                onClick={() => {
                  setStorageMode("github");
                  setStatusMessage(null);
                }}
                className={`py-1.5 px-2 text-[10px] uppercase tracking-[0.1em] transition-colors ${
                  storageMode === "github"
                    ? "bg-hobo-redSoft text-hobo-red font-normal"
                    : "bg-transparent text-hobo-muted hover:text-hobo-ink"
                }`}
              >
                Local + GitHub Backup
              </button>
            </div>
          </div>

          {/* 4. Conditional GitHub Configuration Fields */}
          {storageMode === "github" && (
            <div className="space-y-2.5 pt-2 border-t border-hobo-line">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="block text-[9px] uppercase tracking-[0.12em] text-hobo-muted">
                    GITHUB USERNAME
                  </label>
                  <input
                    type="text"
                    value={githubOwner}
                    onChange={(e) => setGithubOwner(e.target.value)}
                    placeholder="e.g. octocat"
                    className="w-full bg-white/60 border border-hobo-lineDark px-2 py-1 text-[11px] text-hobo-ink placeholder:text-hobo-faint outline-none focus:border-hobo-red font-light"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[9px] uppercase tracking-[0.12em] text-hobo-muted">
                    PRIVATE REPOSITORY NAME
                  </label>
                  <input
                    type="text"
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    placeholder="e.g. planner-backup"
                    className="w-full bg-white/60 border border-hobo-lineDark px-2 py-1 text-[11px] text-hobo-ink placeholder:text-hobo-faint outline-none focus:border-hobo-red font-light"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[9px] uppercase tracking-[0.12em] text-hobo-muted">
                  PERSONAL ACCESS TOKEN (CONTENTS: READ &amp; WRITE)
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showToken ? "text" : "password"}
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder="github_pat_..."
                    className="w-full bg-white/60 border border-hobo-lineDark pl-2 pr-7 py-1 text-[11px] text-hobo-ink placeholder:text-hobo-faint outline-none focus:border-hobo-red font-light"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-1.5 text-hobo-muted hover:text-hobo-ink bg-transparent border-0 p-0.5"
                  >
                    {showToken ? (
                      <EyeOff className="w-3.5 h-3.5 stroke-[1.5]" />
                    ) : (
                      <Eye className="w-3.5 h-3.5 stroke-[1.5]" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[9px] uppercase tracking-[0.12em] text-hobo-muted">
                  FILE PATH IN REPOSITORY
                </label>
                <input
                  type="text"
                  value={githubFilePath}
                  onChange={(e) => setGithubFilePath(e.target.value)}
                  placeholder="planner-data.json"
                  className="w-full bg-white/60 border border-hobo-lineDark px-2 py-1 text-[11px] text-hobo-ink placeholder:text-hobo-faint outline-none focus:border-hobo-red font-light"
                />
              </div>
            </div>
          )}

          {/* 5. Conflict Prompt when existing `planner-data.json` is detected on GitHub */}
          {pendingRemoteConflict && (
            <div className="p-3 bg-white/75 border border-hobo-lineDark space-y-2">
              <div className="text-[10px] uppercase tracking-[0.12em] text-hobo-red font-normal">
                EXISTING GITHUB BACKUP FOUND (
                {
                  extractRemoteTasks(pendingRemoteConflict).filter(
                    (t) => !t.deleted_at || t.updated_at > t.deleted_at
                  ).length
                }{" "}
                TASKS)
              </div>
              <p className="text-[11px] text-hobo-ink leading-snug">
                How would you like to sync your existing local data with the GitHub repository?
              </p>
              <div className="flex flex-col gap-1.5 pt-1">
                <button
                  type="button"
                  disabled={isTesting}
                  onClick={() => handleResolveConflict("merge")}
                  className="w-full py-1.5 px-2.5 text-left text-[10px] uppercase tracking-[0.1em] border border-hobo-red bg-hobo-redSoft text-hobo-red hover:bg-hobo-red hover:text-white transition-colors"
                >
                  1. Merge Both (Keep Newest by Timestamp &amp; All Unique Tasks)
                </button>
                <button
                  type="button"
                  disabled={isTesting}
                  onClick={() => handleResolveConflict("keep_local")}
                  className="w-full py-1.5 px-2.5 text-left text-[10px] uppercase tracking-[0.1em] border border-hobo-lineDark text-hobo-ink hover:border-hobo-red hover:text-hobo-red transition-colors"
                >
                  2. Keep Only Locally Saved Data (Overwrite GitHub)
                </button>
                <button
                  type="button"
                  disabled={isTesting}
                  onClick={() => handleResolveConflict("keep_remote")}
                  className="w-full py-1.5 px-2.5 text-left text-[10px] uppercase tracking-[0.1em] border border-hobo-lineDark text-hobo-ink hover:border-hobo-red hover:text-hobo-red transition-colors"
                >
                  3. Keep Only GitHub Repo Data (Replace Local)
                </button>
              </div>
            </div>
          )}

          {/* 6. Maintenance: Clean Deleted Tasks */}
          <div className="pt-2 border-t border-hobo-line flex items-center justify-between gap-2">
            <span className="text-[10px] text-hobo-muted">
              Soft-deleted items are auto-purged after 30 days.
            </span>
            <button
              type="button"
              disabled={isCleaningDeleted || isTesting}
              onClick={handleCleanDeletedTasks}
              className="px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] border border-hobo-lineDark text-hobo-ink hover:border-hobo-red hover:text-hobo-red bg-transparent transition-colors inline-flex items-center gap-1.5 shrink-0"
            >
              {isCleaningDeleted && (
                <Loader2 className="w-3 h-3 animate-spin" />
              )}
              <span>Clean Deleted Tasks</span>
            </button>
          </div>

          {/* Status Message */}
          {statusMessage && (
            <div
              className={`text-[11px] flex items-center gap-1.5 ${
                statusMessage.type === "success"
                  ? "text-hobo-muted"
                  : "px-2.5 py-1.5 border border-hobo-red bg-hobo-redSoft text-hobo-red"
              }`}
            >
              {statusMessage.type === "success" && (
                <Check className="w-3.5 h-3.5 shrink-0 stroke-[1.75] text-hobo-ink" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-4 py-2.5 border-t border-hobo-lineDark flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-hobo-muted hover:text-hobo-ink bg-transparent border border-hobo-lineDark transition-colors"
          >
            Close
          </button>

          {storageMode === "github" ? (
            <button
              type="button"
              disabled={isTesting}
              onClick={handleTestAndSaveGithub}
              className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] bg-hobo-red text-white hover:opacity-90 transition-opacity border border-hobo-red inline-flex items-center gap-1.5"
            >
              {isTesting && <Loader2 className="w-3 h-3 animate-spin" />}
              <span>Test &amp; Save Connection</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isTesting}
              onClick={handleSaveLocalMode}
              className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] bg-hobo-ink text-white hover:bg-hobo-red transition-colors border border-hobo-ink inline-flex items-center gap-1.5"
            >
              {isTesting && <Loader2 className="w-3 h-3 animate-spin" />}
              <span>Save Settings</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
