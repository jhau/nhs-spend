export const metadata = {
  title: "NHS Spend Explorer",
  description: "Explore NHS spending data imported via Drizzle ORM.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

