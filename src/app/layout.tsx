import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

export const metadata = {
  title: "NHS Spend Explorer",
  description: "Explore NHS spending data imported via Drizzle ORM.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen overflow-hidden bg-slate-50">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar />
          <main className="flex-1 overflow-hidden">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

