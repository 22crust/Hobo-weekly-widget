import { useEffect, useRef, useState } from "react";
import { addMonths, addWeeks, format, startOfWeek, subMonths, subWeeks } from "date-fns";
import { BottomTabBar, ActiveTab } from "./components/BottomTabBar";
import { CollapsibleMonthCalendar } from "./components/CollapsibleMonthCalendar";
import { DayEventsSection } from "./components/DayEventsSection";
import { GithubAuthPromptModal } from "./components/GithubAuthPromptModal";
import { MobileNotesTab } from "./components/MobileNotesTab";
import { MobileSettingsModal } from "./components/MobileSettingsModal";
import { MobileTasksSection } from "./components/MobileTasksSection";
import { MobileWeekBoard } from "./components/MobileWeekBoard";
import { TopBar } from "./components/TopBar";
import { saveAppSettings } from "./db/plannerRepo";
import { useMobilePlannerData } from "./hooks/useMobilePlannerData";
import { subscribeMidnightRollover } from "../../shared/plannerCore";

const GITHUB_AUTH_DISMISS_KEY = "lp_pwa_gh_auth_dismissed_day";

function isGithubAuthError(message: string | null): boolean {
  if (!message) return false;
  return (
    message.includes("401") ||
    message.includes("403") ||
    message.toLowerCase().includes("unauthorized") ||
    message.toLowerCase().includes("forbidden")
  );
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("planner");
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => new Date());
  const [currentWeekDate, setCurrentWeekDate] = useState<Date>(() => new Date());
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAuthPromptOpen, setIsAuthPromptOpen] = useState(false);

  const lastRealWeekRef = useRef<string>(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")
  );
  const lastRealMonthRef = useRef<string>(format(new Date(), "yyyy-MM"));

  useEffect(() => {
    return subscribeMidnightRollover(() => {
      const now = new Date();
      const nowWeek = format(
        startOfWeek(now, { weekStartsOn: 1 }),
        "yyyy-MM-dd"
      );
      if (nowWeek !== lastRealWeekRef.current) {
        lastRealWeekRef.current = nowWeek;
        setCurrentWeekDate(now);
      }
      const nowMonth = format(now, "yyyy-MM");
      if (nowMonth !== lastRealMonthRef.current) {
        lastRealMonthRef.current = nowMonth;
        setCurrentMonthDate(now);
      }
    });
  }, []);

  const {
    weekStartDate,
    weekEndDate,
    weekEvents,
    monthEvents,
    selectedDayEvents,
    datedTasks,
    weeklySidebarTasks,
    longTermSidebarTasks,
    bucketDefinitions,
    bucketLayouts,
    bucketTextByBucketId,
    settings,
    isRefreshing,
    githubSyncStatus,
    reloadData,
    actions,
  } = useMobilePlannerData(
    currentWeekDate,
    currentMonthDate,
    selectedDayDate
  );

  useEffect(() => {
    if (
      githubSyncStatus.status === "error" &&
      isGithubAuthError(githubSyncStatus.message)
    ) {
      const todayKey = format(new Date(), "yyyy-MM-dd");
      const lastDismissed = localStorage.getItem(GITHUB_AUTH_DISMISS_KEY);
      if (lastDismissed !== todayKey) {
        setIsAuthPromptOpen(true);
      }
    }
  }, [githubSyncStatus.status, githubSyncStatus.message]);

  useEffect(() => {
    const handleTaskDrop = (e: Event) => {
      const custom = e as CustomEvent<{
        syncId: string;
        zone: string;
        insertIndex?: number;
      }>;
      const { syncId, zone, insertIndex } = custom.detail || {};
      if (!syncId || !zone) return;
      if (zone.startsWith("day:")) {
        const dateStr = zone.slice(4);
        void actions.moveTaskToDate(syncId, dateStr, insertIndex);
      } else if (zone.startsWith("bucket:")) {
        const bucketId = zone.slice("bucket:".length);
        const def = bucketDefinitions.find((b) => b.id === bucketId);
        const scope =
          def?.scope ?? (bucketId === "long_term" ? "persistent" : "weekly");
        void actions.moveTaskToBucket(syncId, bucketId, scope, insertIndex);
      } else if (zone === "weekly-sidebar") {
        void actions.moveTaskToWeeklySidebar(syncId, insertIndex);
      } else if (zone === "long-term") {
        void actions.moveTaskToLongTermSidebar(syncId, insertIndex);
      }
    };
    window.addEventListener("pwa:task-drop", handleTaskDrop);
    return () => window.removeEventListener("pwa:task-drop", handleTaskDrop);
  }, [actions, bucketDefinitions]);

  const dismissAuthPromptToday = () => {
    localStorage.setItem(
      GITHUB_AUTH_DISMISS_KEY,
      format(new Date(), "yyyy-MM-dd")
    );
    setIsAuthPromptOpen(false);
  };

  return (
    <div className="min-h-screen hobonichi-grid-bg text-hobo-ink flex flex-col">
      <div className="w-full max-w-2xl mx-auto flex-1 flex flex-col bg-hobo-paper/65 border-x border-hobo-line">
        {activeTab === "planner" && (
          <TopBar
            showCalendarToggle={true}
            isCalendarExpanded={isCalendarExpanded}
            onToggleCalendar={() => setIsCalendarExpanded((prev) => !prev)}
            githubSyncStatus={githubSyncStatus}
            isRefreshing={isRefreshing}
            onRefresh={() => void actions.refreshNow()}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenGithubAuthPrompt={() => setIsAuthPromptOpen(true)}
          />
        )}

        <main className="flex-1 pb-16">
          {activeTab === "planner" ? (
            <>
              {isCalendarExpanded && (
                <CollapsibleMonthCalendar
                  currentMonthDate={currentMonthDate}
                  selectedDate={selectedDayDate}
                  monthEvents={monthEvents}
                  onPrevMonth={() =>
                    setCurrentMonthDate((prev) => subMonths(prev, 1))
                  }
                  onNextMonth={() =>
                    setCurrentMonthDate((prev) => addMonths(prev, 1))
                  }
                  onResetToday={() => {
                    const now = new Date();
                    setCurrentMonthDate(now);
                    setSelectedDayDate(format(now, "yyyy-MM-dd"));
                  }}
                  onSelectDate={(dateStr) =>
                    setSelectedDayDate((prev) =>
                      prev === dateStr ? null : dateStr
                    )
                  }
                />
              )}

              {isCalendarExpanded && selectedDayDate && (
                <DayEventsSection
                  selectedDate={selectedDayDate}
                  events={selectedDayEvents}
                  onClose={() => setSelectedDayDate(null)}
                  onAddLocalEvent={actions.addLocalEvent}
                  onUpdateLocalEvent={actions.updateLocalEvent}
                  onDeleteLocalEvent={actions.deleteLocalEvent}
                />
              )}

              <MobileWeekBoard
                weekStartDate={weekStartDate}
                weekEndDate={weekEndDate}
                weekEvents={weekEvents}
                datedTasks={datedTasks}
                onPrevWeek={() =>
                  setCurrentWeekDate((prev) => subWeeks(prev, 1))
                }
                onNextWeek={() =>
                  setCurrentWeekDate((prev) => addWeeks(prev, 1))
                }
                onResetThisWeek={() => setCurrentWeekDate(new Date())}
                onAddTaskInDay={(dateStr, title) =>
                  void actions.addTask({
                    title,
                    assigned_date: dateStr,
                    show_in_weekly: true,
                    show_in_sidebar: false,
                  })
                }
                onToggleTask={(task) => void actions.toggleTaskCompleted(task)}
                onEditTaskTitle={(syncId, title) =>
                  void actions.editTaskTitle(syncId, title)
                }
                onDeleteTask={(syncId) => void actions.deleteTask(syncId)}
                onSelectDayForEvents={(dateStr) => {
                  setIsCalendarExpanded(true);
                  setSelectedDayDate((prev) =>
                    prev === dateStr ? null : dateStr
                  );
                }}
              />

              <MobileTasksSection
                weekStartDate={weekStartDate}
                weeklyTasks={weeklySidebarTasks}
                longTermTasks={longTermSidebarTasks}
                bucketDefinitions={bucketDefinitions}
                bucketLayouts={bucketLayouts}
                bucketTextByBucketId={bucketTextByBucketId}
                onSaveBucketText={(bucketId, weekStart, content) =>
                  void actions.saveBucketText(bucketId, weekStart, content)
                }
                onAddTaskInBucket={(bucketId, scope, title) =>
                  void actions.addTask({
                    title,
                    assigned_date: null,
                    assigned_week_start:
                      scope === "persistent" ? null : weekStartDate,
                    is_long_term: scope === "persistent",
                    bucket_id: bucketId,
                    show_in_weekly: false,
                    show_in_sidebar: true,
                  })
                }
                onToggleTask={(task) => void actions.toggleTaskCompleted(task)}
                onEditTaskTitle={(syncId, title) =>
                  void actions.editTaskTitle(syncId, title)
                }
                onDeleteTask={(syncId) => void actions.deleteTask(syncId)}
                onMigrateWeeklyToPrevWeek={(syncId) =>
                  void actions.migrateTaskToPrevWeek(syncId)
                }
                onMigrateWeeklyToNextWeek={(syncId) =>
                  void actions.migrateTaskToNextWeek(syncId)
                }
                onClearCompletedInBucket={(bucketId, scope) =>
                  void actions.clearCompletedForBucket(bucketId, scope)
                }
              />
            </>
          ) : (
            <MobileNotesTab />
          )}
        </main>
      </div>

      <BottomTabBar activeTab={activeTab} onSelectTab={setActiveTab} />

      <MobileSettingsModal
        isOpen={isSettingsOpen}
        initialSettings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onSaved={() => void reloadData()}
      />

      <GithubAuthPromptModal
        isOpen={isAuthPromptOpen}
        errorMessage={githubSyncStatus.message}
        onDismissForToday={dismissAuthPromptToday}
        onUpdateToken={() => {
          setIsAuthPromptOpen(false);
          setIsSettingsOpen(true);
        }}
        onSwitchToLocal={() => {
          void saveAppSettings({ storage_mode: "local" }).then(() => {
            setIsAuthPromptOpen(false);
            void reloadData();
          });
        }}
      />
    </div>
  );
}

export default App;
