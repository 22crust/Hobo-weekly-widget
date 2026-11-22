import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  X,
} from "lucide-react";
import { MobileColorPicker } from "./MobileColorPicker";
import { SetupTutorialModal } from "./SetupTutorialModal";
import { saveAppSettings } from "../db/plannerRepo";
import {
  checkGithubRemoteFile,
  extractRemoteTasks,
  pushLocalDataToGithubNow,
  queueDebouncedGithubPush,
  resolveInitialGithubMigration,
  testGithubConnection,
} from "../services/githubSyncService";
import {
  AppSettings,
  PlannerBackupPayload,
  StorageMode,
} from "../types/planner";
import {
  getSavedTimeFormat,
  saveTimeFormat,
  TimeFormat,
} from "../../../shared/timeFormat";
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_COLOR,
  applyAccentColor,
  normalizeHexColor,
} from "../utils/accentColor";

interface MobileSettingsModalProps {
  isOpen: boolean;
  initialSettings: AppSettings | null;
  onClose: () => void;
  onSaved: () => void;
}

export const MobileSettingsModal: React.FC<MobileSettingsModalProps> = ({
  isOpen,
  initialSettings,
  onClose,
  onSaved,
}) => {
  const [storageMode, setStorageMode] = useState<StorageMode>("local");
  const [githubToken, setGithubToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubFilePath, setGithubFilePath] = useState("planner-data.json");
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT_COLOR);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(() =>
    getSavedTimeFormat()
  );

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCustomPickerOpen, setIsCustomPickerOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [migrationPrompt, setMigrationPrompt] = useState<{
    pendingSettings: AppSettings;
    remotePayload: PlannerBackupPayload;
    remoteTaskCount: number;
  } | null>(null);

  useEffect(() => {
    if (isOpen && initialSettings) {
      setStorageMode(initialSettings.storage_mode);
      setGithubToken(initialSettings.github_token);
      setGithubOwner(initialSettings.github_owner);
      setGithubRepo(initialSettings.github_repo);
      setGithubFilePath(initialSettings.github_file_path || "planner-data.json");
      setAccentColor(normalizeHexColor(initialSettings.accent_color));
      setTimeFormat(getSavedTimeFormat());
      setTestResult(null);
      setIsCustomPickerOpen(false);
      setErrorMsg(null);
      setMigrationPrompt(null);
    }
  }, [isOpen, initialSettings]);

  if (!isOpen) return null;

  const buildCandidateSettings = (): AppSettings => ({
    storage_mode: storageMode,
    github_token: githubToken.trim(),
    github_owner: githubOwner.trim(),
    github_repo: githubRepo.trim(),
    github_file_path:
      githubFilePath.trim().replace(/^\/+/, "") || "planner-data.json",
    accent_color: normalizeHexColor(accentColor),
  });

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setErrorMsg(null);
    try {
      const msg = await testGithubConnection(buildCandidateSettings());
      setTestResult({ ok: true, msg });
    } catch (err) {
      setTestResult({
        ok: false,
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const candidate = buildCandidateSettings();

    if (
      candidate.storage_mode === "github" &&
      (!candidate.github_token ||
        !candidate.github_owner ||
        !candidate.github_repo)
    ) {
      setErrorMsg(
        "Please fill in GitHub Username, Repository Name, and Personal Access Token."
      );
      return;
    }

    setIsSaving(true);
    try {
      const wasGithub = initialSettings?.storage_mode === "github";
      if (candidate.storage_mode === "github" && !wasGithub) {
        const remote = await checkGithubRemoteFile(candidate);
        if (remote.exists && remote.payload) {
          const count = extractRemoteTasks(remote.payload).filter(
            (t) => !t.deleted_at || t.updated_at > t.deleted_at
          ).length;
          setMigrationPrompt({
            pendingSettings: candidate,
            remotePayload: remote.payload,
            remoteTaskCount: count,
          });
          setIsSaving(false);
          return;
        }
      }

      await saveAppSettings(candidate);
      applyAccentColor(candidate.accent_color);
      if (candidate.storage_mode === "github") {
        await pushLocalDataToGithubNow(false);
      }
      onSaved();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleMigrationChoice = async (
    mode: "keep_local" | "keep_remote" | "merge"
  ) => {
    if (!migrationPrompt) return;
    setIsSaving(true);
    setErrorMsg(null);
    try {
      await saveAppSettings(migrationPrompt.pendingSettings);
      applyAccentColor(migrationPrompt.pendingSettings.accent_color);
      await resolveInitialGithubMigration(mode, migrationPrompt.remotePayload);
      onSaved();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/35 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-hobo-paperSolid border border-hobo-lineDark p-4 space-y-4 text-xs">
        <div className="flex items-center justify-between pb-2 border-b border-hobo-lineDark">
          <h2 className="text-sm font-medium uppercase tracking-[0.12em] text-hobo-ink">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-hobo-muted hover:text-hobo-ink"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {migrationPrompt ? (
          <div className="space-y-3">
            <p className="text-xs text-hobo-ink leading-relaxed">
              Found an existing <code>{githubFilePath}</code> on GitHub with{" "}
              <strong>{migrationPrompt.remoteTaskCount}</strong> active task(s).
              How would you like to initialize sync?
            </p>
            <div className="space-y-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleMigrationChoice("merge")}
                className="w-full py-2 px-3 bg-hobo-red text-white text-xs uppercase tracking-wider"
              >
                Merge Local & GitHub (Recommended)
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleMigrationChoice("keep_remote")}
                className="w-full py-2 px-3 border border-hobo-lineDark bg-hobo-paper text-hobo-ink text-xs uppercase tracking-wider"
              >
                Replace Local with GitHub
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleMigrationChoice("keep_local")}
                className="w-full py-2 px-3 border border-hobo-lineDark bg-hobo-paper text-hobo-ink text-xs uppercase tracking-wider"
              >
                Overwrite GitHub with Local
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
            {/* Storage & GitHub Sync */}
            <div className="space-y-2">
              <label className="block text-[11px] uppercase tracking-[0.1em] text-hobo-muted">
                Storage Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setStorageMode("local")}
                  className={`py-2 border text-xs ${
                    storageMode === "local"
                      ? "border-hobo-red bg-hobo-redSoft text-hobo-red font-medium"
                      : "border-hobo-lineDark text-hobo-ink"
                  }`}
                >
                  Local Only
                </button>
                <button
                  type="button"
                  onClick={() => setStorageMode("github")}
                  className={`py-2 border text-xs ${
                    storageMode === "github"
                      ? "border-hobo-red bg-hobo-redSoft text-hobo-red font-medium"
                      : "border-hobo-lineDark text-hobo-ink"
                  }`}
                >
                  GitHub Backup & Sync
                </button>
              </div>
            </div>

            {storageMode === "github" && (
              <div className="space-y-2.5 p-2.5 border border-hobo-line bg-hobo-paper">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-hobo-muted mb-1">
                      GitHub Username
                    </label>
                    <input
                      type="text"
                      value={githubOwner}
                      onChange={(e) => setGithubOwner(e.target.value)}
                      placeholder="owner"
                      className="w-full px-2 py-1.5 border border-hobo-lineDark bg-white/60 text-hobo-ink outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-hobo-muted mb-1">
                      Repository
                    </label>
                    <input
                      type="text"
                      value={githubRepo}
                      onChange={(e) => setGithubRepo(e.target.value)}
                      placeholder="planner-backup"
                      className="w-full px-2 py-1.5 border border-hobo-lineDark bg-white/60 text-hobo-ink outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-hobo-muted mb-1">
                    Personal Access Token
                  </label>
                  <div className="flex items-center border border-hobo-lineDark bg-white/60">
                    <input
                      type={showToken ? "text" : "password"}
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      placeholder="github_pat_..."
                      className="flex-1 px-2 py-1.5 bg-transparent text-hobo-ink outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((p) => !p)}
                      className="px-2 text-hobo-muted"
                    >
                      {showToken ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-hobo-muted mb-1">
                    Backup File Path
                  </label>
                  <input
                    type="text"
                    value={githubFilePath}
                    onChange={(e) => setGithubFilePath(e.target.value)}
                    placeholder="planner-data.json"
                    className="w-full px-2 py-1.5 border border-hobo-lineDark bg-white/60 text-hobo-ink outline-none"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    disabled={isTesting}
                    onClick={() => void handleTestConnection()}
                    className="px-2.5 py-1 border border-hobo-lineDark text-hobo-ink hover:border-hobo-red"
                  >
                    {isTesting ? "Testing..." : "Test Connection"}
                  </button>
                  {testResult && (
                    <span
                      className={`text-[11px] flex items-center gap-1 ${
                        testResult.ok ? "text-emerald-700" : "text-hobo-red"
                      }`}
                    >
                      {testResult.ok && <CheckCircle2 className="w-3 h-3" />}
                      {testResult.msg}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Accent Color */}
            <div className="space-y-2">
              <label className="block text-[11px] uppercase tracking-[0.1em] text-hobo-muted">
                Accent Color
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.hex}
                    type="button"
                    title={preset.name}
                    onClick={() => {
                      setAccentColor(preset.hex);
                      applyAccentColor(preset.hex);
                    }}
                    style={{ backgroundColor: preset.hex }}
                    className={`w-6 h-6 rounded-full border-2 transition-transform ${
                      normalizeHexColor(accentColor) === preset.hex
                        ? "border-hobo-ink scale-110"
                        : "border-transparent"
                    }`}
                  />
                ))}
                <button
                  type="button"
                  title="Custom color"
                  onClick={() => setIsCustomPickerOpen((p) => !p)}
                  style={{ backgroundColor: normalizeHexColor(accentColor) }}
                  className={`px-2 h-6 border text-[10px] uppercase tracking-wider text-white ${
                    isCustomPickerOpen
                      ? "border-hobo-ink ring-1 ring-hobo-ink"
                      : "border-hobo-lineDark"
                  }`}
                >
                  Custom
                </button>
              </div>
              {isCustomPickerOpen && (
                <MobileColorPicker
                  value={normalizeHexColor(accentColor)}
                  onChange={(hex) => {
                    setAccentColor(hex);
                    applyAccentColor(hex);
                  }}
                />
              )}
            </div>

            {/* Time Format (Synced) */}
            <div className="pt-2 border-t border-hobo-line flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-[0.12em] text-hobo-muted">
                Time Format
              </span>
              <div className="inline-flex border border-hobo-lineDark">
                <button
                  type="button"
                  onClick={() => {
                    setTimeFormat("24h");
                    saveTimeFormat("24h");
                    if (storageMode === "github") queueDebouncedGithubPush();
                  }}
                  className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] transition-colors ${
                    timeFormat === "24h"
                      ? "bg-hobo-red text-white"
                      : "bg-white/60 text-hobo-ink"
                  }`}
                >
                  24H
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTimeFormat("12h");
                    saveTimeFormat("12h");
                    if (storageMode === "github") queueDebouncedGithubPush();
                  }}
                  className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] border-l border-hobo-lineDark transition-colors ${
                    timeFormat === "12h"
                      ? "bg-hobo-red text-white"
                      : "bg-white/60 text-hobo-ink"
                  }`}
                >
                  12H
                </button>
              </div>
            </div>

            {errorMsg && (
              <p className="text-xs text-hobo-red bg-hobo-redSoft/50 p-2 border border-hobo-red/40">
                {errorMsg}
              </p>
            )}

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-hobo-lineDark">
              <button
                type="button"
                onClick={() => setIsTutorialOpen(true)}
                className="inline-flex items-center text-[10px] uppercase tracking-wider text-hobo-muted hover:text-hobo-red"
              >
                <span>Setup Tutorial</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 border border-hobo-lineDark text-hobo-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-hobo-red text-white uppercase tracking-wider"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      <SetupTutorialModal
        isOpen={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
      />
    </div>
  );
};
