import { Component, type ReactNode } from 'react';
import { strings } from './strings';
import { theme } from './theme';

/**
 * A scene whose asset fails to load throws from inside `useLoader`, and with nothing to catch it
 * React unmounts the whole app. The HUD, the keys and the race itself do not need the picture, so
 * a failed scene costs the picture and a line saying so.
 */
export class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <p
        data-testid="scene-failed"
        style={{ color: theme.muted, margin: 0, padding: 16, textAlign: 'center' }}
      >
        {strings.sceneFailed}
      </p>
    );
  }
}
