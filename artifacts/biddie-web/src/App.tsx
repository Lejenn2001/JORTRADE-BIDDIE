import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import Ecosystem from "./pages/Ecosystem.tsx";
import Index from "./pages/Index.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import DashboardSignals from "./pages/DashboardSignals.tsx";
import DashboardMarket from "./pages/DashboardMarket.tsx";
import DashboardChat from "./pages/DashboardChat.tsx";

import DashboardCommunity from "./pages/DashboardCommunity.tsx";
import DashboardAnalytics from "./pages/DashboardAnalytics.tsx";
import DashboardSettings from "./pages/DashboardSettings.tsx";
import DashboardBreakout from "./pages/DashboardBreakout.tsx";
import DashboardTrump from "./pages/DashboardTrump.tsx";
import DashboardAdmin from "./pages/DashboardAdmin.tsx";
import Login from "./pages/Login.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import Signup from "./pages/Signup.tsx";
import Contact from "./pages/Contact.tsx";
import NotFound from "./pages/NotFound.tsx";
import ProtectedRoute from "./components/ProtectedRoute.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/ecosystem" element={<Ecosystem />} />
            <Route path="/biddieai" element={<Index />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/dashboard/signals" element={<ProtectedRoute><DashboardSignals /></ProtectedRoute>} />
            <Route path="/dashboard/market" element={<ProtectedRoute><DashboardMarket /></ProtectedRoute>} />
            <Route path="/dashboard/chat" element={<ProtectedRoute><DashboardChat /></ProtectedRoute>} />
            <Route path="/dashboard/pnl" element={<ProtectedRoute><DashboardAnalytics /></ProtectedRoute>} />
            <Route path="/dashboard/community" element={<ProtectedRoute><DashboardCommunity /></ProtectedRoute>} />
            <Route path="/dashboard/analytics" element={<ProtectedRoute><DashboardAnalytics /></ProtectedRoute>} />
            <Route path="/dashboard/breakout" element={<ProtectedRoute><DashboardBreakout /></ProtectedRoute>} />
            <Route path="/dashboard/trump" element={<ProtectedRoute><DashboardTrump /></ProtectedRoute>} />
            <Route path="/dashboard/settings" element={<ProtectedRoute><DashboardSettings /></ProtectedRoute>} />
            <Route path="/dashboard/admin" element={<ProtectedRoute><DashboardAdmin /></ProtectedRoute>} />
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
