import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api, json } from "../../lib/api";
import { ArrowLeft, CheckCircle2, Download, RefreshCw, Search, Shield, AlertTriangle, X, XCircle } from "lucide-react";
import { toast } from "sonner";

interface User {
  uid: string;
  email: string;
  display_name: string;
  role: string;
  provider: string;
  disabled: boolean;
  email_verified: boolean;
  created_at: string;
  last_sign_in_at: string;
  login_count: number;
  activity_count: number;
}

interface UserDetail {
  uid: string;
  email: string;
  display_name: string;
  role: string;
  provider: string;
  disabled: boolean;
  email_verified: boolean;
  created_at: string;
  last_sign_in_at: string;
  logins: AccessLog[];
  activity: ActivityLog[];
  tickets: FeedbackTicket[];
}

interface AccessLog {
  id: string;
  email: string;
  role: string;
  auth_method: string;
  status: string;
  ip: string;
  timestamp: string;
}

interface ActivityLog {
  id: string;
  user: string;
  action: string;
  target: string;
  metadata?: string;
  timestamp: string;
}

interface FeedbackTicket {
  id: string;
  user: string;
  category: string;
  subject: string;
  message: string;
  status: string;
  admin_notes?: string;
  created_at: string;
  updated_at?: string;
}

interface UserListResponse {
  items?: User[];
  total?: number;
  warnings?: string[];
  degraded?: boolean;
  sources?: Record<string, number>;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatDay(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

const SOURCE_LABELS: Record<string, string> = {
  "firebase-auth": "Firebase Auth",
  "google-auth": "Google sign-in",
  "email-password": "Email signup",
  "local-demo": "Local demo",
  profile: "Profiles",
};

export const UsersPage = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [roleFilter, setRoleFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const fetchUsers = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api<UserListResponse>("/admin/users", { cache: "no-store" });
        setUsers(res.items || []);
        setTotal(res.total ?? null);
        setSourceCounts(res.sources || {});
        setWarnings(res.warnings || []);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to load users";
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    };

  useEffect(() => {
    fetchUsers();
    // Live enough for an admin console without re-reading every account
    // collection on each short poll.
    const refreshTimer = window.setInterval(() => {
      if (!document.hidden) fetchUsers();
    }, 60000);
    const handleFocus = () => fetchUsers();
    const handleVisibility = () => {
      if (!document.hidden) fetchUsers();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Filter users
  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      !search ||
      user.email.toLowerCase().includes(search.toLowerCase()) ||
      user.display_name.toLowerCase().includes(search.toLowerCase()) ||
      user.uid.toLowerCase().includes(search.toLowerCase());
    const matchesRole = !roleFilter || user.role === roleFilter;
    const matchesProvider = !providerFilter || user.provider === providerFilter;
    const matchesStatus = !filterStatus || user.disabled === (filterStatus === "disabled");
    return matchesSearch && matchesRole && matchesProvider && matchesStatus;
  });

  // Handle user click
  const handleUserClick = async (user: User) => {
    try {
      const detail = await api(`/admin/users/${user.uid}/details`);
      setSelectedUser(detail);
      setDrawerOpen(true);
    } catch (e) {
      toast.error("Failed to load user details");
    }
  };

  // Handle role change (confirmation required before removing admin access)
  const handleRoleChange = async (uid: string, newRole: string) => {
    const target = users.find((item) => item.uid === uid);
    if (
      newRole === "student" &&
      !window.confirm(
        `Remove administrator access from ${target?.email || uid}? They will keep their student workspace.`,
      )
    )
      return;
    try {
      await api(`/admin/users/${uid}/role`, {
        method: "PATCH",
        body: json({ role: newRole }),
      });
      toast.success(`Role updated to ${newRole}`);
      setSelectedUser((current) =>
        current && current.uid === uid ? { ...current, role: newRole } : current,
      );
      await fetchUsers();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to update role";
      toast.error(message);
    }
  };

  // Handle disable/enable (confirmation required before disabling)
  const handleDisable = async (uid: string, disabled: boolean) => {
    const target = users.find((item) => item.uid === uid);
    if (
      disabled &&
      !window.confirm(
        `Disable ${target?.email || uid}? They will be signed out and blocked from signing in until re-enabled.`,
      )
    )
      return;
    try {
      await api(`/admin/users/${uid}/status`, {
        method: "PATCH",
        body: json({ disabled }),
      });
      toast.success(`Account ${disabled ? "disabled" : "enabled"}`);
      setSelectedUser((current) =>
        current && current.uid === uid ? { ...current, disabled } : current,
      );
      await fetchUsers();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to update account status";
      toast.error(message);
    }
  };

  // CSV export
  const exportCSV = () => {
    if (!filteredUsers.length) return;
    const headers = ["UID", "Email", "Display Name", "Role", "Provider", "Disabled", "Email Verified", "Created At", "Last Sign In", "Login Count", "Activity Count"];
    const rows = filteredUsers.map(u => [u.uid, u.email, u.display_name, u.role, u.provider, u.disabled, u.email_verified, u.created_at, u.last_sign_in_at, u.login_count, u.activity_count]);
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "users.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="admin-users-page">
      {/* Header */}
      <div className="admin-header">
        <div className="admin-header-left">
          <button
            className="admin-back-btn"
            onClick={() => navigate("/admin")}
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="admin-title">Users / Accounts</h1>
            <p className="admin-subtitle">
              Manage all registered accounts, roles, and access status.
              {total !== null && (
                <span className="admin-source-counts">
                  {" "}
                  · {total} accounts
                  {Object.keys(sourceCounts).length > 0 &&
                    ` (${Object.entries(sourceCounts)
                      .map(([key, count]) => `${SOURCE_LABELS[key] || key}: ${count}`)
                      .join(" · ")})`}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="admin-header-right">
          <button className="admin-btn" onClick={exportCSV}>
            <Download size={16} /> Export CSV
          </button>
          <button className="admin-btn" onClick={fetchUsers} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="admin-alert admin-alert-error" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Could not load accounts.</strong>
            <p>{error}</p>
            <button className="admin-btn" onClick={fetchUsers}>
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="admin-alert admin-alert-warning" role="status">
          <AlertTriangle size={18} />
          <div>
            <strong>Some account sources could not be read.</strong>
            <ul>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="admin-filters">
        <div className="admin-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search by email, name, or UID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="admin-filter-select"
        >
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="student">Student</option>
        </select>
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="admin-filter-select"
        >
          <option value="">All Providers</option>
          <option value="google">Google</option>
          <option value="email">Email</option>
          <option value="local-demo">Local Demo</option>
          <option value="firebase">Firebase</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="admin-filter-select"
        >
          <option value="">All Statuses</option>
          <option value="disabled">Disabled Accounts</option>
          <option value="active">Active Accounts</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Created</th>
              <th>Last Sign In</th>
              <th>Logins</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="admin-loading">
                  <RefreshCw size={24} className="spin" />
                  <span>Loading users...</span>
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={8} className="admin-empty">
                  No users found matching your filters.
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.uid} onClick={() => handleUserClick(user)}>
                  <td className="admin-user-cell">
                    <div className="admin-user-avatar">
                      {(user.display_name || user.email || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="admin-user-info">
                      <div className="admin-user-name">
                        {user.display_name || "No name"}
                      </div>
                      <div className="admin-user-email">{user.email}</div>
                      <div className="admin-user-uid">UID: {user.uid}</div>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`admin-badge admin-badge-${user.role}`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`admin-badge admin-badge-${user.provider}`}
                    >
                      {user.provider}
                    </span>
                  </td>
                  <td>
                    {user.disabled ? (
                      <span className="admin-badge admin-badge-disabled">
                        <XCircle size={12} /> Disabled
                      </span>
                    ) : (
                      <span className="admin-badge admin-badge-active">
                        <CheckCircle2 size={12} /> Active
                      </span>
                    )}
                  </td>
                  <td className="admin-date">
                    {formatDay(user.created_at)}
                  </td>
                  <td className="admin-date">
                    {formatDate(user.last_sign_in_at)}
                  </td>
                  <td>{user.login_count}</td>
                  <td>
                    <div className="admin-actions">
                      <button
                        className="admin-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRoleChange(user.uid, user.role === "admin" ? "student" : "admin");
                        }}
                        title={user.role === "admin" ? "Demote to student" : "Promote to admin"}
                      >
                        <Shield size={14} />
                      </button>
                      <button
                        className="admin-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDisable(user.uid, !user.disabled);
                        }}
                        title={user.disabled ? "Enable account" : "Disable account"}
                      >
                        {user.disabled ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* User Detail Drawer */}
      {drawerOpen && selectedUser && (
        <div className="admin-drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="admin-drawer-header">
              <h3>User Details</h3>
              <button
                className="admin-drawer-close"
                onClick={() => setDrawerOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="admin-drawer-content">
              {/* Profile */}
              <div className="admin-detail-section">
                <h4>Profile</h4>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Email:</span>
                  <span className="admin-detail-value">{selectedUser.email}</span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Display Name:</span>
                  <span className="admin-detail-value">{selectedUser.display_name}</span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">UID:</span>
                  <span className="admin-detail-value">{selectedUser.uid}</span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Role:</span>
                  <span className="admin-detail-value">{selectedUser.role}</span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Provider:</span>
                  <span className="admin-detail-value">{selectedUser.provider}</span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Status:</span>
                  <span className="admin-detail-value">
                    {selectedUser.disabled ? "Disabled" : "Active"}
                  </span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Email Verified:</span>
                  <span className="admin-detail-value">
                    {selectedUser.email_verified ? "Yes" : "No"}
                  </span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Created:</span>
                  <span className="admin-detail-value">
                    {formatDate(selectedUser.created_at)}
                  </span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Last Sign In:</span>
                  <span className="admin-detail-value">
                    {formatDate(selectedUser.last_sign_in_at)}
                  </span>
                </div>
              </div>

              {/* Login History */}
              <div className="admin-detail-section">
                <h4>Login History</h4>
                {selectedUser.logins.length === 0 ? (
                  <p className="admin-empty">No login history</p>
                ) : (
                  <div className="admin-logins">
                    {selectedUser.logins.map((login) => (
                      <div key={login.id} className="admin-login-item">
                        <div className="admin-login-info">
                          <span className="admin-login-method">{login.auth_method}</span>
                          <span className="admin-login-status">{login.status}</span>
                          <span className="admin-login-ip">{login.ip}</span>
                        </div>
                        <div className="admin-login-time">
                          {new Date(login.timestamp).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Activity Feed */}
              <div className="admin-detail-section">
                <h4>Activity Feed</h4>
                {selectedUser.activity.length === 0 ? (
                  <p className="admin-empty">No activity</p>
                ) : (
                  <div className="admin-activity">
                    {selectedUser.activity.map((act) => (
                      <div key={act.id} className="admin-activity-item">
                        <div className="admin-activity-info">
                          <span className="admin-activity-action">{act.action}</span>
                          <span className="admin-activity-target">{act.target}</span>
                        </div>
                        <div className="admin-activity-time">
                          {new Date(act.timestamp).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tickets */}
              <div className="admin-detail-section">
                <h4>Submitted Tickets</h4>
                {selectedUser.tickets.length === 0 ? (
                  <p className="admin-empty">No tickets</p>
                ) : (
                  <div className="admin-tickets">
                    {selectedUser.tickets.map((ticket) => (
                      <div key={ticket.id} className="admin-ticket-item">
                        <div className="admin-ticket-info">
                          <span className="admin-ticket-category">{ticket.category}</span>
                          <span className="admin-ticket-subject">{ticket.subject}</span>
                          <span className="admin-ticket-status">{ticket.status}</span>
                        </div>
                        <div className="admin-ticket-time">
                          {new Date(ticket.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="admin-drawer-footer">
              <button
                className="admin-btn admin-btn-secondary"
                onClick={() => setDrawerOpen(false)}
              >
                Close
              </button>
              <button
                className="admin-btn admin-btn-primary"
                onClick={() => {
                  handleRoleChange(selectedUser.uid, selectedUser.role === "admin" ? "student" : "admin");
                }}
              >
                {selectedUser.role === "admin" ? "Demote to Student" : "Promote to Admin"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {filteredUsers.length === 0 && !loading && !selectedUser && (
        <div className="admin-empty-state">
          <div>
            <Shield size={48} className="mb-4" />
            <h3>No users found</h3>
            <p className="mb-4">
              No users match your current filters. Try adjusting the search, role, or provider filters.
            </p>
            <button className="admin-btn" onClick={() => setSearch("")}>
              Clear Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
