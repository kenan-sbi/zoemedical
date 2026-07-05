export const metadata = {
  title: 'Zoe Medical',
  description: 'Clinical document intelligence — Slice 1',
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
        <style dangerouslySetInnerHTML={{ __html: `
          html, body { -webkit-text-size-adjust: 100%; }
          * { box-sizing: border-box; }
          /* Body padding is for the simple pages (home/login/review); the workspace/console are
             position:fixed full-bleed and ignore it. Shrink it on phones so content isn't squeezed. */
          body { margin: 0 auto; padding: 24px; max-width: 960px; }
          @media (max-width: 640px) { body { padding: 14px; } }
        ` }} />
      </head>
      <body style={{ fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
