'use client';
import { useEffect, useState } from 'react';

// Shared top bar across both tools, so the doctor can flip between the Medical workspace and the
// Hair console in one tap. `onMenu` (workspace only) surfaces the patient-drawer hamburger on phones.
function useIsMobile(bp = 860) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const on = () => setM(mq.matches);
    on(); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on);
  }, [bp]);
  return m;
}

const TEAL = '#0d857b', DARK = '#0b6f66', INK = '#123', LINE = '#e6e3de', SUB = '#5b6b68';

export function TopNav({ active, onMenu }: { active: 'medical' | 'hair'; onMenu?: () => void }) {
  const isMobile = useIsMobile();
  async function lock() {
    await fetch('/api/console/login', { method: 'DELETE' }).catch(() => {});
    window.location.href = '/';
  }
  const tab = (key: 'medical' | 'hair', href: string, icon: string, label: string) => {
    const on = active === key;
    return (
      <a href={href} style={{
        display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none',
        padding: isMobile ? '7px 12px' : '7px 15px', borderRadius: 8, fontSize: 13.5, fontWeight: 700,
        color: on ? '#fff' : SUB, background: on ? TEAL : 'transparent',
        boxShadow: on ? '0 1px 3px rgba(13,133,123,.35)' : 'none', whiteSpace: 'nowrap',
      }}>
        <span style={{ fontSize: 15 }}>{icon}</span>{label}
      </a>
    );
  };
  return (
    <header style={{
      height: 50, flexShrink: 0, display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14,
      padding: isMobile ? '0 10px' : '0 16px', background: '#fff', borderBottom: `1px solid ${LINE}`,
      fontFamily: 'Poppins, system-ui, sans-serif', zIndex: 40,
    }}>
      {onMenu && isMobile && (
        <button onClick={onMenu} aria-label="Patients"
          style={{ width: 36, height: 36, borderRadius: 9, border: `1px solid ${LINE}`, background: '#fff', color: TEAL, cursor: 'pointer', fontSize: 17, display: 'grid', placeItems: 'center', flexShrink: 0 }}>☰</button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(145deg, ${TEAL}, ${DARK} 70%)`, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, boxShadow: '0 2px 6px rgba(13,133,123,.30)' }}>Z</div>
        {!isMobile && <div style={{ fontWeight: 800, fontSize: 15, color: INK, letterSpacing: -0.3 }}>Zoe</div>}
      </div>
      <div style={{ display: 'flex', gap: 4, background: '#f2f1ee', padding: 4, borderRadius: 11 }}>
        {tab('medical', '/workspace', '🩺', 'Medical')}
        {tab('hair', '/console', '💈', 'Hair')}
      </div>
      <div style={{ flex: 1 }} />
      <button onClick={lock} title="Lock (sign out)"
        style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${LINE}`, background: '#fff', color: SUB, borderRadius: 8, padding: isMobile ? '7px 10px' : '7px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        🔒{!isMobile && <span>Lock</span>}
      </button>
    </header>
  );
}
