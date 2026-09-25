import KpiCard from '../ui/KpiCard';

// The four statistics tiles above the account table.
//
// Every figure is counted from the accounts the API actually returned on this
// request — nothing here is a constant, a seed value, or a remembered number.
// If the list is empty the tiles read 0, which is the truth, rather than a
// placeholder that looks like data.
//
// "2FA ENROLLED" is worded deliberately. UserResource.twoFactorEnabled
// reports whether Supabase holds a verified MFA factor for the account, which
// is not the same claim as "this account is challenged for a code at sign-in"
// — the login flow does not currently issue that challenge (see
// src/pages/Login.jsx and src/context/AuthContext.jsx). Labelling the tile
// "2FA Enabled" would assert an enforcement guarantee this system does not
// currently make, so it says what is true: a factor is enrolled.
export default function UserStatsCards({ users }) {
  const total = users.length;
  const active = users.filter((u) => u.isActive).length;
  const inactive = total - active;
  const enrolled = users.filter((u) => u.twoFactorEnabled).length;

  return (
    <div className="kpi-grid kpi-grid-primary">
      <KpiCard label="Total Users" value={total} caption="Users" cls="accent" />
      <KpiCard
        label="Active Users"
        value={active}
        caption="Accounts"
        cls="success"
      />
      <KpiCard
        label="Inactive Users"
        value={inactive}
        caption="Accounts"
        cls={inactive > 0 ? 'warning' : 'info'}
      />
      <KpiCard
        label="2FA Enrolled"
        value={`${enrolled} / ${total}`}
        caption="Security"
        cls={enrolled === total && total > 0 ? 'success' : 'orange'}
      />
    </div>
  );
}
