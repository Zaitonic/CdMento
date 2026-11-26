import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Shield,
  Users,
  Activity,
  MessageSquare,
  AlertTriangle,
  Server,
  Key,
  Download,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  SlidersHorizontal,
  FileText,
  X,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { api, json } from "../../lib/api";
import { useSession } from "../../lib/Session";
import { UsersPage } from "./UsersPage";
import "./admin.css";

function authMethodClass(method?: string) {
  const key = (method || "").toLowerCase();
  if (key === "google") return "admin-badge-google";
  if (key === "email" || key === "password") return "admin-badge-email";
  if (key === "local-demo" || key === "demo") return "admin-badge-local-demo";
  return "admin-badge-firebase";
}

type TabKind =
  | "dashboard"
  | "access"
  | "activity"
  | "feedback"
  | "errors"
  | "system";

interface KPIs {
  total_users: number;
  daily_logins: number;
  active_users_today: number;
  open_tickets: number;
  unresolved_errors: number;
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

interface ErrorLog {
  id: string;
  method: string;
  path: string;
  error_type: string;
  message: string;
  severity: string;
  status: string;
  timestamp: string;
}

interface SystemStats {
  auth_mode: string;
  data_backend: string;
  ai_enabled: boolean;
  ai_provider: string;
  ai_model: string;
  ocr_enabled: boolean;
  python_version: string;
  platform: string;
  max_upload_mb: number;
  admin_emails: string[];
}

export default function AdminPanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, account, logout } = useSession();

  const [activeTab, setActiveTab] = useState<TabKind>("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [userDropdown, setUserDropdown] = useState(false);
  const [loading, setLoading] = useState(true);

  // KPIs
  const [kpis, setKpis] = useState<KPIs>({
    total_users: 0,
    daily_logins: 0,
    active_users_today: 0,
    open_tickets: 0,
    unresolved_errors: 0,
  });

  // Access Logs
  const [accessLogs, setAccessLogs] = useState<AccessLog[]>([]);
  const [accessTotal, setAccessTotal] = useState(0);
  const [accessSearch, setAccessSearch] = useState("");
  const [accessStatus, setAccessStatus] = useState("all");
  const [accessPage, setAccessPage] = useState(1);
  const pageSize = 15;

  // Activity Logs
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activitySearch, setActivitySearch] = useState("");
  const [activityPage, setActivityPage] = useState(1);

  // Feedback Tickets
  const [feedback, setFeedback] = useState<FeedbackTicket[]>([]);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [feedbackStatus, setFeedbackStatus] = useState("all");
  const [editingTicket, setEditingTicket] = useState<FeedbackTicket | null>(
    null,
  );
  const [editStatus, setEditStatus] = useState("open");
  const [editNotes, setEditNotes] = useState("");

  // Error Logs
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [errorTotal, setErrorTotal] = useState(0);

  // System Stats
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);

  // Load KPI data
  const loadKpis = async () => {
    try {
      const res = await api<KPIs>("/admin/dashboard/kpis");
      setKpis(res);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load live user count");
    }
  };

  // Load Access Logs
  const loadAccessLogs = async () => {
    try {
      const query = new URLSearchParams({
        skip: String((accessPage - 1) * pageSize),
        limit: String(pageSize),
      });
      if (accessSearch) query.set("search", accessSearch);
      if (accessStatus !== "all") query.set("status", accessStatus);
      const res = await api<{ items: AccessLog[]; total: number }>(
        `/admin/access_logs?${query.toString()}`,
      );
      setAccessLogs(res.items || []);
      setAccessTotal(res.total || 0);
    } catch {
      // ignore
    }
  };

  // Load Activity Logs
  const loadActivityLogs = async () => {
    try {
      const query = new URLSearchParams({
        skip: String((activityPage - 1) * pageSize),
        limit: String(pageSize),
      });
      if (activitySearch) query.set("search", activitySearch);
      const res = await api<{ items: ActivityLog[]; total: number }>(
        `/admin/activity_logs?${query.toString()}`,
      );
      setActivityLogs(res.items || []);
      setActivityTotal(res.total || 0);
    } catch {
      // ignore
    }
  };

  // Load Feedback
  const loadFeedback = async () => {
    try {
      const query = new URLSearchParams();
      if (feedbackStatus !== "all") query.set("status", feedbackStatus);
      const res = await api<{ items: FeedbackTicket[]; total: number }>(
        `/admin/feedback_support?${query.toString()}`,
      );
      setFeedback(res.items || []);
      setFeedbackTotal(res.total || 0);
    } catch {
      // ignore
    }
  };

  // Load Error Logs
  const loadErrorLogs = async () => {
    try {
      const res = await api<{ items: ErrorLog[]; total: number }>(
        "/admin/error_logs",
      );
      setErrorLogs(res.items || []);
      setErrorTotal(res.total || 0);
    } catch {
      // ignore
    }
  };

  // Load System Stats
  const loadSystemStats = async () => {
    try {
      const res = await api<SystemStats>("/admin/system_stats");
      setSystemStats(res);
    } catch {
      // ignore
    }
  };

  // Refresh all data
  const refreshAll = async () => {
    setLoading(true);
    await Promise.all([
      loadKpis(),
      loadAccessLogs(),
      loadActivityLogs(),
      loadFeedback(),
      loadErrorLogs(),
      loadSystemStats(),
    ]);
    setLoading(false);
  };

  useEffect(() => {
    refreshAll();
    const refreshTimer = window.setInterval(() => {
      if (!document.hidden) refreshAll();
    }, 10000);
    const handleFocus = () => refreshAll();
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  useEffect(() => {
    loadAccessLogs();
  }, [accessPage, accessStatus, accessSearch]);

  useEffect(() => {
    loadActivityLogs();
  }, [activityPage, activitySearch]);

  useEffect(() => {
    loadFeedback();
  }, [feedbackStatus]);

  // CSV Exporter
  const exportToCSV = (data: any[], filename: string) => {
    if (!data.length) {
      toast.info("No data to export");
      return;
    }
    const headers = Object.keys(data[0]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [
        headers.join(","),
        ...data.map((row) =>
          headers
            .map((field) => {
              const val = row[field] ?? "";
              return `"${String(val).replace(/"/g, '""')}"`;
            })
            .join(","),
        ),
      ].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${filename}`);
  };

  // Handle Save Ticket Note
  const saveTicketNote = async () => {
    if (!editingTicket) return;
    try {
      await api<FeedbackTicket>(
        `/admin/feedback_support/${editingTicket.id}`,
        {
          method: "PATCH",
          body: json({
            status: editStatus,
            admin_notes: editNotes,
          }),
        },
      );
      toast.success("Ticket updated successfully");
      setEditingTicket(null);
      loadFeedback();
      loadKpis();
    } catch {
      toast.error("Failed to update ticket");
    }
  };

  // Guard: if user is not admin
  if (!account?.is_admin && account?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
        <Shield size={56} className="text-purple-600 mb-4 animate-bounce" />
        <h2 className="text-2xl font-bold mb-2">Administrator Access Required</h2>
        <p className="text-gray-500 max-w-md mb-6">
          Your account ({account?.email || "Current user"}) does not have
          administrator privileges to view the Monitoring Console.
        </p>
        <button
          className="admin-btn primary"
          onClick={() => navigate("/workspace")}
        >
          <ArrowLeft size={16} /> Back to Workspace
        </button>
      </div>
    );
  }

  if (location.pathname === "/admin/users") return <UsersPage />;

  const tabTitles: Record<TabKind, string> = {
    dashboard: "Dashboard Overview",
    access: "Login & Access Monitoring",
    activity: "Activity Feed & Audit Trail",
    feedback: "Feedback & Support Inquiries",
    errors: "Issues & Error Tracking",
    system: "System Infrastructure Stats",
  };

  return (
    <div className="admin-container">
      {/* 1. Collapsible Sidebar */}
      <aside className={`admin-sidebar ${collapsed ? "collapsed" : ""}`}>
        <div className="admin-sidebar-header">
          {!collapsed && (
            <div className="admin-brand">
              <Shield size={20} className="text-purple-400" />
              <span>CdMento</span>
              <span className="badge">Admin</span>
            </div>
          )}
          <button
            className="p-1 rounded text-gray-400 hover:text-white"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="admin-nav">
          <button
            className={`admin-nav-item ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            <Shield size={18} />
            <span>Dashboard</span>
          </button>
          <button
            className="admin-nav-item"
            onClick={() => navigate("/admin/users")}
          >
            <Users size={18} />
            <span>Users / Accounts</span>
          </button>
          <button
            className={`admin-nav-item ${activeTab === "access" ? "active" : ""}`}
            onClick={() => setActiveTab("access")}
          >
            <Users size={18} />
            <span>Access Logs</span>
          </button>
          <button
            className={`admin-nav-item ${activeTab === "activity" ? "active" : ""}`}
            onClick={() => setActiveTab("activity")}
          >
            <Activity size={18} />
            <span>Activity Feed</span>
          </button>
          <button
            className={`admin-nav-item ${activeTab === "feedback" ? "active" : ""}`}
            onClick={() => setActiveTab("feedback")}
          >
            <MessageSquare size={18} />
            <span>Feedback & Support</span>
          </button>
          <button
            className={`admin-nav-item ${activeTab === "errors" ? "active" : ""}`}
            onClick={() => setActiveTab("errors")}
          >
            <AlertTriangle size={18} />
            <span>Issues & Errors</span>
          </button>
          <button
            className={`admin-nav-item ${activeTab === "system" ? "active" : ""}`}
            onClick={() => setActiveTab("system")}
          >
            <Server size={18} />
            <span>System Stats</span>
          </button>
        </nav>

        <div className="admin-sidebar-footer">
          <button
            className="admin-nav-item"
            onClick={() => navigate("/workspace")}
            title="Return to Student Workspace"
          >
            <ArrowLeft size={16} />
            {!collapsed && <span>Workspace</span>}
          </button>
          <button
            className="admin-nav-item text-red-400 hover:text-red-300"
            onClick={logout}
            title="Sign out"
          >
            <LogOut size={16} />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* 2. Main Workspace */}
      <div className="admin-main">
        {/* Header */}
        <header className="admin-header">
          <div className="admin-header-left">
            <span className="admin-breadcrumb">
              Admin <ChevronRight size={14} />
              <b>{tabTitles[activeTab]}</b>
            </span>
          </div>

          <div className="admin-header-right">
            <button
              className="admin-btn"
              onClick={refreshAll}
              title="Refresh all metrics"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              <span>Refresh</span>
            </button>

            {/* User Dropdown */}
            <div className="admin-user-menu">
              <button
                className="admin-user-btn"
                onClick={() => setUserDropdown(!userDropdown)}
              >
                <div className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">
                  A
                </div>
                <span className="font-medium text-xs">
                  {account?.display_name || "Admin"}
                </span>
                <ChevronRight size={12} className="rotate-90 text-gray-400" />
              </button>

              {userDropdown && (
                <div className="admin-user-dropdown">
                  <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 text-xs">
                    <p className="font-bold">{account?.display_name}</p>
                    <p className="text-gray-500 truncate">{account?.email}</p>
                    <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] bg-purple-100 text-purple-700 font-semibold">
                      Role: Admin
                    </span>
                  </div>
                  <button onClick={() => navigate("/workspace")}>
                    <ExternalLink size={14} /> Back to App
                  </button>
                  <button onClick={() => navigate("/profile")}>
                    <SlidersHorizontal size={14} /> Profile Settings
                  </button>
                  <button
                    onClick={logout}
                    className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content Body */}
        <div className="admin-content">
          {/* Always Visible: KPI Cards Grid */}
          <section className="admin-kpi-grid">
            <div
              className="admin-kpi-card clickable"
              onClick={() => navigate("/admin/users")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate("/admin/users");
                }
              }}
              role="button"
              tabIndex={0}
              title="Open Users / Accounts"
            >
              <div className="admin-kpi-icon bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-300">
                <Users size={24} />
              </div>
              <div className="admin-kpi-info">
                <h4>Total Users</h4>
                <div className="number">{kpis.total_users}</div>
              </div>
            </div>

            <div className="admin-kpi-card">
              <div className="admin-kpi-icon bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300">
                <Activity size={24} />
              </div>
              <div className="admin-kpi-info">
                <h4>Daily Logins</h4>
                <div className="number">{kpis.daily_logins}</div>
              </div>
            </div>

            <div className="admin-kpi-card">
              <div className="admin-kpi-icon bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300">
                <Clock size={24} />
              </div>
              <div className="admin-kpi-info">
                <h4>Active Today</h4>
                <div className="number">{kpis.active_users_today}</div>
              </div>
            </div>

            <div className="admin-kpi-card">
              <div className="admin-kpi-icon bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                <MessageSquare size={24} />
              </div>
              <div className="admin-kpi-info">
                <h4>Open Tickets</h4>
                <div className="number">{kpis.open_tickets}</div>
              </div>
            </div>

            <div className="admin-kpi-card">
              <div className="admin-kpi-icon bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-300">
                <AlertTriangle size={24} />
              </div>
              <div className="admin-kpi-info">
                <h4>Unresolved Issues</h4>
                <div className="number">{kpis.unresolved_errors}</div>
              </div>
            </div>
          </section>

          {/* TAB 1: DASHBOARD OVERVIEW */}
          {activeTab === "dashboard" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent Access Logs Snapshot */}
              <div className="admin-card">
                <div className="admin-card-header">
                  <h3>Recent Login Activity</h3>
                  <button
                    className="admin-btn"
                    onClick={() => setActiveTab("access")}
                  >
                    View All
                  </button>
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Method</th>
                        <th>Status</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accessLogs.slice(0, 5).map((log) => (
                        <tr key={log.id}>
                          <td className="font-medium text-xs">{log.email}</td>
                          <td>
                            <span className={`admin-badge ${authMethodClass(log.auth_method)}`}>
                              {log.auth_method}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`admin-badge ${log.status === "success" ? "success" : "danger"}`}
                            >
                              {log.status === "success" ? "✅ Success" : "❌ Failed"}
                            </span>
                          </td>
                          <td className="text-xs text-gray-500">
                            {new Date(log.timestamp).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Feedback Summary Snapshot */}
              <div className="admin-card">
                <div className="admin-card-header">
                  <h3>Support & Inquiries</h3>
                  <button
                    className="admin-btn"
                    onClick={() => setActiveTab("feedback")}
                  >
                    Manage Tickets
                  </button>
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Subject</th>
                        <th>Category</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {feedback.slice(0, 5).map((t) => (
                        <tr key={t.id}>
                          <td className="font-medium text-xs truncate max-w-[160px]">
                            {t.subject}
                          </td>
                          <td>
                            <span className="admin-badge info">{t.category}</span>
                          </td>
                          <td>
                            <span
                              className={`admin-badge ${t.status === "resolved" ? "success" : t.status === "in_progress" ? "info" : "warning"}`}
                            >
                              {t.status}
                            </span>
                          </td>
                          <td>
                            <button
                              className="text-xs text-purple-600 hover:underline"
                              onClick={() => {
                                setEditingTicket(t);
                                setEditStatus(t.status);
                                setEditNotes(t.admin_notes || "");
                              }}
                            >
                              Review
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* System Infrastructure Card */}
              <div className="admin-card lg:col-span-2">
                <div className="admin-card-header">
                  <h3>System Infrastructure</h3>
                  <span className="admin-badge success">● Operational</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                  <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <p className="text-gray-400 uppercase font-semibold">
                      Auth Provider
                    </p>
                    <p className="font-bold text-sm mt-1">
                      {systemStats?.auth_mode || "google"}
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <p className="text-gray-400 uppercase font-semibold">
                      Database Backend
                    </p>
                    <p className="font-bold text-sm mt-1">
                      {systemStats?.data_backend || "sqlite"}
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <p className="text-gray-400 uppercase font-semibold">
                      Active AI Provider
                    </p>
                    <p className="font-bold text-sm mt-1">
                      {systemStats?.ai_provider || "Cloudflare Workers AI"}
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <p className="text-gray-400 uppercase font-semibold">
                      OCR Engine
                    </p>
                    <p className="font-bold text-sm mt-1">CPU / ONNX (Offline)</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LOGIN & ACCESS MONITORING */}
          {activeTab === "access" && (
            <div className="admin-card">
              <div className="admin-card-header">
                <div>
                  <h3>Login & Access Monitoring</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Audited security logs for authentication and session attempts.
                  </p>
                </div>
                <div className="admin-card-header-actions">
                  <div className="admin-search-bar">
                    <Search size={14} className="text-gray-400" />
                    <input
                      id="admin-access-search"
                      name="access-search"
                      aria-label="Search login and access logs"
                      placeholder="Search email, IP, auth..."
                      value={accessSearch}
                      onChange={(e) => {
                        setAccessSearch(e.target.value);
                        setAccessPage(1);
                      }}
                    />
                  </div>
                  <select
                    id="admin-access-status"
                    name="access-status"
                    aria-label="Filter access logs by status"
                    className="admin-select"
                    value={accessStatus}
                    onChange={(e) => {
                      setAccessStatus(e.target.value);
                      setAccessPage(1);
                    }}
                  >
                    <option value="all">All Statuses</option>
                    <option value="success">Success Only</option>
                    <option value="failed">Failed Only</option>
                  </select>
                  <button
                    className="admin-btn"
                    onClick={() => exportToCSV(accessLogs, "access_logs.csv")}
                  >
                    <Download size={14} /> Export CSV
                  </button>
                </div>
              </div>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>User / Email</th>
                      <th>Role</th>
                      <th>Timestamp</th>
                      <th>Auth Method</th>
                      <th>Status</th>
                      <th>IP Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accessLogs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-gray-400">
                          No access logs matched your criteria.
                        </td>
                      </tr>
                    ) : (
                      accessLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="font-medium">{log.email}</td>
                          <td>
                            <span
                              className={`admin-badge ${log.role === "admin" ? "info" : "secondary"}`}
                            >
                              {log.role}
                            </span>
                          </td>
                          <td className="text-xs text-gray-500">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td>
                            <span className={`admin-badge ${authMethodClass(log.auth_method)} font-mono`}>
                              {log.auth_method}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`admin-badge ${log.status === "success" ? "success" : "danger"}`}
                            >
                              {log.status === "success" ? (
                                <>
                                  <CheckCircle2 size={12} /> Success
                                </>
                              ) : (
                                <>
                                  <XCircle size={12} /> Failed
                                </>
                              )}
                            </span>
                          </td>
                          <td className="font-mono text-xs text-gray-500">
                            {log.ip}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="admin-pagination">
                <span>
                  Showing {accessLogs.length} of {accessTotal} records
                </span>
                <div className="admin-pagination-btns">
                  <button
                    className="admin-btn"
                    disabled={accessPage <= 1}
                    onClick={() => setAccessPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={14} /> Previous
                  </button>
                  <span className="px-3 py-1 text-xs font-semibold flex items-center">
                    Page {accessPage} of{" "}
                    {Math.max(1, Math.ceil(accessTotal / pageSize))}
                  </span>
                  <button
                    className="admin-btn"
                    disabled={accessPage * pageSize >= accessTotal}
                    onClick={() => setAccessPage((p) => p + 1)}
                  >
                    Next <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: ACTIVITY FEED */}
          {activeTab === "activity" && (
            <div className="admin-card">
              <div className="admin-card-header">
                <div>
                  <h3>Activity Feed & Audit Trail</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    System operations, content generation, and resource updates.
                  </p>
                </div>
                <div className="admin-card-header-actions">
                  <div className="admin-search-bar">
                    <Search size={14} className="text-gray-400" />
                    <input
                      id="admin-activity-search"
                      name="activity-search"
                      aria-label="Search activity logs"
                      placeholder="Search activity..."
                      value={activitySearch}
                      onChange={(e) => {
                        setActivitySearch(e.target.value);
                        setActivityPage(1);
                      }}
                    />
                  </div>
                  <button
                    className="admin-btn"
                    onClick={() =>
                      exportToCSV(activityLogs, "activity_logs.csv")
                    }
                  >
                    <Download size={14} /> Export CSV
                  </button>
                </div>
              </div>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Action</th>
                      <th>Target Resource</th>
                      <th>Metadata</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-gray-400">
                          No activity events recorded yet.
                        </td>
                      </tr>
                    ) : (
                      activityLogs.map((act) => (
                        <tr key={act.id}>
                          <td className="font-medium text-xs">{act.user}</td>
                          <td>
                            <span className="admin-badge info">{act.action}</span>
                          </td>
                          <td className="font-medium">{act.target}</td>
                          <td className="text-xs text-gray-500 font-mono">
                            {act.metadata || "—"}
                          </td>
                          <td className="text-xs text-gray-500">
                            {new Date(act.timestamp).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="admin-pagination">
                <span>
                  Showing {activityLogs.length} of {activityTotal} events
                </span>
                <div className="admin-pagination-btns">
                  <button
                    className="admin-btn"
                    disabled={activityPage <= 1}
                    onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={14} /> Previous
                  </button>
                  <span className="px-3 py-1 text-xs font-semibold flex items-center">
                    Page {activityPage} of{" "}
                    {Math.max(1, Math.ceil(activityTotal / pageSize))}
                  </span>
                  <button
                    className="admin-btn"
                    disabled={activityPage * pageSize >= activityTotal}
                    onClick={() => setActivityPage((p) => p + 1)}
                  >
                    Next <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: FEEDBACK & SUPPORT */}
          {activeTab === "feedback" && (
            <div className="admin-card">
              <div className="admin-card-header">
                <div>
                  <h3>Feedback & Support Inquiries</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Student feedback, bug reports, and resolution notes.
                  </p>
                </div>
                <div className="admin-card-header-actions">
                  <select
                    id="admin-feedback-status"
                    name="feedback-status"
                    aria-label="Filter feedback by status"
                    className="admin-select"
                    value={feedbackStatus}
                    onChange={(e) => setFeedbackStatus(e.target.value)}
                  >
                    <option value="all">All Statuses</option>
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                  <button
                    className="admin-btn"
                    onClick={() => exportToCSV(feedback, "feedback_tickets.csv")}
                  >
                    <Download size={14} /> Export CSV
                  </button>
                </div>
              </div>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Category</th>
                      <th>Subject & Message</th>
                      <th>Status</th>
                      <th>Internal Notes</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedback.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-gray-400">
                          No feedback tickets in this filter.
                        </td>
                      </tr>
                    ) : (
                      feedback.map((ticket) => (
                        <tr key={ticket.id}>
                          <td className="text-xs font-medium">{ticket.user}</td>
                          <td>
                            <span className="admin-badge info">
                              {ticket.category}
                            </span>
                          </td>
                          <td className="max-w-[280px]">
                            <p className="font-semibold text-xs text-gray-800 dark:text-gray-200">
                              {ticket.subject}
                            </p>
                            <p className="text-xs text-gray-500 truncate mt-0.5">
                              {ticket.message}
                            </p>
                          </td>
                          <td>
                            <span
                              className={`admin-badge ${
                                ticket.status === "resolved"
                                  ? "success"
                                  : ticket.status === "in_progress"
                                    ? "info"
                                    : "warning"
                              }`}
                            >
                              {ticket.status}
                            </span>
                          </td>
                          <td className="text-xs text-gray-500 italic max-w-[150px] truncate">
                            {ticket.admin_notes || "None"}
                          </td>
                          <td>
                            <button
                              className="admin-btn text-xs py-1 px-2.5"
                              onClick={() => {
                                setEditingTicket(ticket);
                                setEditStatus(ticket.status);
                                setEditNotes(ticket.admin_notes || "");
                              }}
                            >
                              Manage
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: ISSUES & ERRORS */}
          {activeTab === "errors" && (
            <div className="admin-card">
              <div className="admin-card-header">
                <div>
                  <h3>Issues & Error Tracking</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Logged runtime exceptions, API errors, and server events.
                  </p>
                </div>
                <div className="admin-card-header-actions">
                  <button
                    className="admin-btn"
                    onClick={() => exportToCSV(errorLogs, "error_logs.csv")}
                  >
                    <Download size={14} /> Export CSV
                  </button>
                </div>
              </div>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Endpoint</th>
                      <th>Error Type</th>
                      <th>Message</th>
                      <th>Severity</th>
                      <th>Status</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errorLogs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-emerald-600">
                          <CheckCircle2 size={32} className="mx-auto mb-2" />
                          Zero unresolved errors detected in the system!
                        </td>
                      </tr>
                    ) : (
                      errorLogs.map((err) => (
                        <tr key={err.id}>
                          <td className="font-mono text-xs">
                            <span className="font-bold">{err.method}</span> {err.path}
                          </td>
                          <td className="font-semibold text-xs text-red-600">
                            {err.error_type}
                          </td>
                          <td className="text-xs text-gray-600 max-w-[260px] truncate">
                            {err.message}
                          </td>
                          <td>
                            <span
                              className={`admin-badge ${err.severity === "high" ? "danger" : "warning"}`}
                            >
                              {err.severity}
                            </span>
                          </td>
                          <td>
                            <span className="admin-badge secondary">
                              {err.status}
                            </span>
                          </td>
                          <td className="text-xs text-gray-500">
                            {new Date(err.timestamp).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: SYSTEM STATS */}
          {activeTab === "system" && systemStats && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="admin-card">
                <div className="admin-card-header">
                  <h3>Environment Configuration</h3>
                </div>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-gray-500">Auth Mode</span>
                    <span className="font-mono font-bold">
                      {systemStats.auth_mode}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-gray-500">Data Storage Backend</span>
                    <span className="font-mono font-bold">
                      {systemStats.data_backend}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-gray-500">Max Upload Limit</span>
                    <span className="font-bold">
                      {systemStats.max_upload_mb} MB
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-gray-500">AI Service Active</span>
                    <span className="font-bold text-emerald-600">
                      {systemStats.ai_enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-gray-500">OCR Pipeline</span>
                    <span className="font-bold">
                      {systemStats.ocr_enabled
                        ? "Active (CPU ONNX)"
                        : "Disabled"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="admin-card">
                <div className="admin-card-header">
                  <h3>Runtime & Host Platform</h3>
                </div>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-gray-500">Python Version</span>
                    <span className="font-mono font-bold">
                      {systemStats.python_version}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-gray-500">Operating System</span>
                    <span className="font-mono">{systemStats.platform}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-gray-500">AI Model</span>
                    <span className="font-mono text-purple-600 font-semibold truncate max-w-[200px]">
                      {systemStats.ai_model}
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-gray-500">Admin Email Whitelist</span>
                    <span className="text-gray-700 dark:text-gray-300 font-mono text-[11px] truncate max-w-[200px]">
                      {systemStats.admin_emails.join(", ")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Ticket Edit Modal */}
      {editingTicket && (
        <div className="admin-modal-overlay">
          <div className="admin-modal">
            <div className="admin-modal-header">
              <h3 className="font-bold text-sm">
                Manage Support Ticket: {editingTicket.subject}
              </h3>
              <button
                className="text-gray-400 hover:text-gray-600"
                onClick={() => setEditingTicket(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="admin-modal-body">
              <div>
                <label className="text-xs font-semibold text-gray-500" htmlFor="admin-ticket-status">
                  User Inquiry
                </label>
                <p className="text-xs p-3 bg-gray-50 dark:bg-gray-800 rounded mt-1 text-gray-700 dark:text-gray-300">
                  {editingTicket.message}
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500">
                  Ticket Status
                </label>
                <select
                  id="admin-ticket-status"
                  name="ticket-status"
                  className="admin-select w-full mt-1"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500" htmlFor="admin-ticket-notes">
                  Internal Admin Notes
                </label>
                <textarea
                  id="admin-ticket-notes"
                  name="ticket-notes"
                  className="admin-input w-full mt-1 h-24"
                  placeholder="Add resolution or investigation notes..."
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                className="admin-btn"
                onClick={() => setEditingTicket(null)}
              >
                Cancel
              </button>
              <button className="admin-btn primary" onClick={saveTicketNote}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

