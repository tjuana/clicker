import type { ServerErrorCode } from '@clicker/protocol';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { strings } from './strings';
import { theme } from './theme';

/** Kills the double-tap zoom on the buttons the game is played with. */
const TOUCH_STYLE: CSSProperties = { touchAction: 'manipulation', userSelect: 'none' };

export function Screen({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: theme.bg,
        color: theme.text,
        boxSizing: 'border-box',
        display: 'flex',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      {/* `margin: auto` centres the column vertically and, unlike `align-items: center`,
          never clips the top of content taller than the viewport. */}
      <div
        style={{
          width: '100%',
          maxWidth: 860,
          margin: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  onPointerDown?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  testId?: string;
  style?: CSSProperties;
}

export function Button({
  children,
  onClick,
  onPointerDown,
  disabled = false,
  variant = 'primary',
  testId,
  style,
}: ButtonProps) {
  const primary = variant === 'primary';
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      onPointerDown={onPointerDown}
      disabled={disabled}
      style={{
        ...TOUCH_STYLE,
        padding: '14px 20px',
        fontSize: 16,
        fontWeight: 600,
        borderRadius: 10,
        border: `1px solid ${primary ? theme.gold : theme.border}`,
        background: primary ? theme.gold : theme.surface,
        color: primary ? theme.bg : theme.text,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** A quiet, text-only action: for things that must be reachable but never compete with the game. */
export function LinkButton({
  children,
  onClick,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{
        alignSelf: 'flex-start',
        background: 'none',
        border: 'none',
        color: theme.muted,
        textDecoration: 'underline',
        cursor: 'pointer',
        padding: 0,
        font: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

const COPIED_FOR_MS = 2000;

/** Copies `value`; a browser that refuses clipboard access gets the link as selectable text instead. */
export function CopyButton({
  value,
  label,
  testId,
}: {
  value: string;
  label: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const copy = (): void => {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_FOR_MS);
      },
      () => setBlocked(true),
    );
  };

  if (blocked) {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, color: theme.muted }}>
        {label}
        <input
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          style={{
            padding: 10,
            borderRadius: 8,
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            color: theme.text,
          }}
        />
      </label>
    );
  }

  return (
    <Button variant="secondary" onClick={copy} testId={testId}>
      {copied ? strings.copied : label}
    </Button>
  );
}

/**
 * A link meant to be read and sent, with copying as a convenience rather than the only way out.
 * A bare copy button hides what you are about to share and leaves nothing to fall back on.
 */
export function ShareLink({
  value,
  label,
  testId,
}: {
  value: string;
  label: string;
  testId?: string;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
        style={{
          flex: '1 1 260px',
          minWidth: 0,
          padding: 12,
          borderRadius: 10,
          border: `1px solid ${theme.border}`,
          background: theme.surface,
          color: theme.text,
          font: 'inherit',
        }}
      />
      <CopyButton value={value} label={strings.copy} testId={testId} />
    </div>
  );
}

export function ErrorNote({ code }: { code: ServerErrorCode | null }) {
  if (code === null) return null;
  return <p style={{ color: theme.danger, margin: 0 }}>{strings.errors[code]}</p>;
}
