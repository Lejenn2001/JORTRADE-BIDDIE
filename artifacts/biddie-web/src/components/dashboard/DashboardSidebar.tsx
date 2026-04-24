import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Activity,
  BarChart3,
  MessageSquare,
  Wallet,
  Settings,
  LogOut,
  Bot,
  Menu,
  X,
  Users,
  PieChart,
  Shield,
  Crosshair,
  Megaphone,
  FlaskConical,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import jortradeLogo from "@/assets/jortrade-logo.png";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Users, label: "Jortrade Chat", path: "/dashboard/community" },
  { icon: Activity, label: "Decision Engine", path: "/dashboard/signals" },
  { icon: FlaskConical, label: "Paper Trades", path: "/dashboard/paper-trades" },
  { icon: Crosshair, label: "Breakout Scanner", path: "/dashboard/breakout" },
  { icon: BarChart3, label: "Market View", path: "/dashboard/market" },
  { icon: PieChart, label: "Analytics", path: "/dashboard/analytics" },
  { icon: Megaphone, label: "Trump Feed", path: "/dashboard/trump" },
  { icon: Settings, label: "Settings", path: "/dashboard/settings" },
];

const DashboardSidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, isAdmin } = useAuth();

  const allNavItems = isAdmin
    ? [...navItems, { icon: Shield, label: "Admin", path: "/dashboard/admin" }]
    : navItems;
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-card border border-border/60"
      >
        <Menu className="h-5 w-5 text-foreground" />
      </button>

      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`
          fixed lg:static z-50 h-screen w-[240px] glass-panel border-r border-border/60 flex flex-col p-4 shrink-0
          transition-transform duration-200
          ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        <button
          onClick={() => setOpen(false)}
          className="lg:hidden absolute top-4 right-4"
        >
          <X className="h-5 w-5 text-muted-foreground" />
        </button>

        <Link to="/" className="flex items-center justify-center mb-4">
          <img src={jortradeLogo} alt="JORTRADE" className="h-28 w-auto" />
        </Link>

        <nav className="flex-1 space-y-0.5">
          {allNavItems.map((item) => {
            const isActive = location.pathname === item.path ||
              (item.path === "/dashboard" && location.pathname === "/dashboard");
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-colors ${
                  isActive
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-destructive transition-colors w-full mt-2 border-t border-border/40 pt-2"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </nav>
      </aside>
    </>
  );
};

export default DashboardSidebar;
