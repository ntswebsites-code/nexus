'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastApi {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export const useToast = () => useContext(ToastContext);

/**
 * Renders children followed by the fixed-position toast element, exactly like
 * the original page (`<main>` then `<div class="toast">` as body siblings).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('Pack submitted');
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((text: string) => {
    setMessage(text);
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 1800);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={visible ? 'toast show' : 'toast'} id="toast">
        {message}
      </div>
    </ToastContext.Provider>
  );
}
