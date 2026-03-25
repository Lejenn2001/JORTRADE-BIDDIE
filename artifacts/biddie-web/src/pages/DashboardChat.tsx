import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import AIChatPanel from "@/components/dashboard/AIChatPanel";

const DashboardChat = () => {
  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 overflow-hidden p-4 lg:p-6">
          <div className="h-full">
            <AIChatPanel />
          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardChat;
