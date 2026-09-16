import { MAX_NAME_LENGTH } from '@clicker/protocol';
import { useState } from 'react';
import { savedName } from '../room-link';
import { useClient } from '../store';
import { strings } from '../strings';
import { theme } from '../theme';
import { Button, ErrorNote, Screen } from '../ui';

export function Join({ onEnter }: { onEnter: (name: string) => void }) {
  const [name, setName] = useState(savedName);
  const error = useClient((state) => state.lastError);
  const trimmed = name.trim();

  return (
    <Screen>
      {/* The room id is a 22-character token: useless to a human and far too loud for a heading. */}
      <h1 style={{ fontSize: 28, margin: 0 }}>{strings.joinTitle}</h1>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ color: theme.muted }}>{strings.nameLabel}</span>
        <input
          data-testid="name-input"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder={strings.namePlaceholder}
          onChange={(event) => setName(event.currentTarget.value)}
          style={{
            padding: 14,
            fontSize: 16,
            borderRadius: 10,
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            color: theme.text,
          }}
        />
      </label>
      <Button testId="enter" disabled={trimmed === ''} onClick={() => onEnter(trimmed)}>
        {strings.enter}
      </Button>
      <ErrorNote code={error} />
    </Screen>
  );
}
