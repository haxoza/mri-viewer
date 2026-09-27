import { useEffect, useState, type RefObject } from 'react';
import { ActionMenu } from '../../app/ActionMenu';
import { Dialog } from '../../app/Dialog';
import { registerAgentTools } from './webmcp';
import { probeWebMcp } from './capabilities';
export function AgentTools({ workspace }: { workspace: RefObject<HTMLDivElement | null> }) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('Disabled');
  const [capabilities, setCapabilities] = useState(probeWebMcp);
  const [expanded, setExpanded] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const { available } = capabilities;
  const recheck = () =>
    setCapabilities((previous) => {
      const next = probeWebMcp();
      return next.diagnostics === previous.diagnostics && next.api === previous.api
        ? previous
        : next;
    });
  useEffect(() => {
    if (!expanded && !diagnostics) return;
    // Browser bridges may be injected after React's initial render.
    const timer = window.setInterval(recheck, 1000);
    window.addEventListener('focus', recheck);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', recheck);
    };
  }, [expanded, diagnostics]);
  useEffect(() => {
    if (!enabled || !available || !workspace.current) return;
    return registerAgentTools(workspace.current, setStatus);
  }, [enabled, available, capabilities.api, workspace]);
  return (
    <>
      <ActionMenu
        label="Agent tools"
        onOpenChange={(open) => {
          setExpanded(open);
          if (open) recheck();
        }}
      >
        {(close) => (
          <>
            <p className="menu-status" role="status">
              {!available ? 'Unavailable in this browser' : enabled ? status : 'Disabled'}
            </p>
            <button
              role="menuitem"
              aria-label={enabled ? 'Disable agent tools' : 'Enable agent tools'}
              disabled={!available}
              onClick={() => {
                setEnabled(!enabled);
                setStatus('Registering…');
              }}
            >
              {enabled ? 'Disable for this session' : 'Enable for this session'}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                close();
                setDiagnostics(true);
              }}
            >
              Connection diagnostics
            </button>
            <p className="menu-note">
              DICOM files stay in this browser. Images shared with your desktop agent enter that
              agent's conversation.
            </p>
          </>
        )}
      </ActionMenu>
      {diagnostics && (
        <Dialog title="Agent connection" onClose={() => setDiagnostics(false)}>
          <p role="status">
            {available ? 'Agent tools are available in this browser.' : capabilities.reason}
          </p>
          <p>
            Capability checks only; no examination data. Copy this text when reporting a connection
            problem.
          </p>
          <textarea
            aria-label="WebMCP diagnostics"
            readOnly
            rows={9}
            value={capabilities.diagnostics}
            style={{ width: '100%', fontSize: 12 }}
          />
          <button onClick={recheck}>Recheck connection</button>
          <p>
            Capture prepares a live view for a browser screenshot. Restore controls with the visible
            button or Escape. Export creates frozen downloads. Pixels may contain burned-in
            identifiers.
          </p>
          <p>
            Ellipse marks stay at the same screen position through slice, pan and zoom changes. No
            anatomical tracking or measurements.
          </p>
        </Dialog>
      )}
    </>
  );
}
