export const metadata = {
  title: 'Zoe Medical',
  description: 'Clinical document intelligence — Slice 1',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: 24, maxWidth: 960 }}>
        {children}
      </body>
    </html>
  );
}
