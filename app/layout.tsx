export const metadata = {
  title: 'Zoe Medical',
  description: 'Clinical document intelligence',
};

// Without this, mobile browsers render at a ~980px desktop width and shrink everything to
// unreadable. device-width makes the layout actually use the phone's real width.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Poppins loaded globally so BOTH tools (Medical + Hair) share the same typeface. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" />
        <style dangerouslySetInnerHTML={{ __html: `
          html, body { -webkit-text-size-adjust: 100%; margin: 0; padding: 0; }
          * { box-sizing: border-box; }
          /* Simple pages (e.g. /review) use a bare <main>; keep them readable. The full-bleed
             apps use an inline-styled <main>, so they're excluded and stay full width. */
          main:not([style]) { max-width: 900px; margin: 0 auto; padding: 24px; }
          @media (max-width: 640px) { main:not([style]) { padding: 14px; } }
        ` }} />
      </head>
      <body style={{ fontFamily: "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
