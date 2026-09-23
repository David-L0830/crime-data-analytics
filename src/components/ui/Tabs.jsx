import { useId, useRef, useState } from 'react';

// Accessible tab strip (WAI-ARIA Tabs pattern, automatic activation): the
// selected tab is the only one in the Tab order, and Arrow Left/Right, Home
// and End move between tabs. Only the selected panel is rendered, so a panel
// that loads data on mount loads when it is opened, not with the page.
//
// tabs: [{ id, label, icon?, content }]
export default function Tabs({ tabs, label, defaultTab }) {
  const baseId = useId();
  const [selected, setSelected] = useState(defaultTab ?? tabs[0]?.id);
  const tabRefs = useRef({});

  const tabId = (id) => `${baseId}-tab-${id}`;
  const panelId = (id) => `${baseId}-panel-${id}`;

  const select = (id) => {
    setSelected(id);
    tabRefs.current[id]?.focus();
  };

  const onKeyDown = (event) => {
    const index = tabs.findIndex((t) => t.id === selected);
    const last = tabs.length - 1;
    const next = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(tabs[next].id);
  };

  const active = tabs.find((t) => t.id === selected) ?? tabs[0];

  return (
    <div className="tabs">
      <div
        className="tabs-list"
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab) => {
          const isSelected = tab.id === active.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={isSelected}
              aria-controls={panelId(tab.id)}
              tabIndex={isSelected ? 0 : -1}
              className={`tabs-trigger${isSelected ? ' active' : ''}`}
              onClick={() => setSelected(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div
        className="tabs-panel"
        role="tabpanel"
        id={panelId(active.id)}
        aria-labelledby={tabId(active.id)}
        tabIndex={0}
      >
        {active.content}
      </div>
    </div>
  );
}
