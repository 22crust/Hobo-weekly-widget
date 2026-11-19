import React from "react";

export type ActiveTab = "planner" | "notes";

interface BottomTabBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
}

export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  activeTab,
  onSelectTab,
}) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 safe-bottom bg-hobo-paper/95 backdrop-blur-sm border-t border-hobo-lineDark">
      <div className="grid grid-cols-2 h-12 max-w-2xl mx-auto">
        <button
          type="button"
          onClick={() => onSelectTab("planner")}
          className={`flex items-center justify-center text-[11px] uppercase tracking-[0.14em] transition-colors ${
            activeTab === "planner"
              ? "text-hobo-red font-medium bg-hobo-redSoft/50"
              : "text-hobo-muted hover:text-hobo-ink"
          }`}
        >
          <span>Planner</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTab("notes")}
          className={`flex items-center justify-center text-[11px] uppercase tracking-[0.14em] border-l border-hobo-line transition-colors ${
            activeTab === "notes"
              ? "text-hobo-red font-medium bg-hobo-redSoft/50"
              : "text-hobo-muted hover:text-hobo-ink"
          }`}
        >
          <span>Notes</span>
        </button>
      </div>
    </nav>
  );
};
