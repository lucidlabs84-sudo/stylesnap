// CSS for Shadow DOM — injected into the shadow root so it's isolated from page styles.
// This is a subset of what injectFloatingBtnStyles() provides for the page.
export const SHADOW_FLOATING_BTN_CSS = `
  #stylesnap-floating-btn {
    position: fixed !important;
    bottom: 24px !important;
    right: 24px !important;
    padding: 0 !important;
    border-radius: 50% !important;
    cursor: pointer !important;
    z-index: 9999999 !important;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s, opacity 0.3s ease !important;
    user-select: none !important;
    border: none !important;
    outline: none !important;
    background: transparent !important;
    overflow: visible !important;
    display: flex !important;
    align-items: center !important;
    box-sizing: border-box !important;
    width: 44px !important;
    height: 44px !important;
    opacity: 0.45 !important;
  }
  #stylesnap-floating-btn:hover,
  #stylesnap-floating-btn.is-active,
  #stylesnap-floating-btn.is-dragging {
    opacity: 1 !important;
  }
  #stylesnap-floating-btn-inner {
    position: relative !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 44px !important;
    height: 44px !important;
    background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
    border-radius: 50% !important;
    z-index: 2 !important;
    box-sizing: border-box !important;
    box-shadow: 0 2px 6px rgba(99, 102, 241, 0.15) !important;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s !important;
  }
  #stylesnap-floating-btn:hover #stylesnap-floating-btn-inner,
  #stylesnap-floating-btn.is-dragging #stylesnap-floating-btn-inner {
    transform: scale(1.06) translateY(-2px) !important;
  }
  #stylesnap-floating-btn.is-active #stylesnap-floating-btn-inner {
    background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.55) !important;
  }
  #stylesnap-floating-btn-ring {
    position: absolute !important;
    top: -2px !important; left: -2px !important;
    width: calc(100% + 4px) !important; height: calc(100% + 4px) !important;
    border-radius: 50% !important;
    overflow: hidden !important;
    z-index: 1 !important;
    pointer-events: none !important;
    opacity: 0 !important;
    transition: opacity 0.25s !important;
  }
  #stylesnap-floating-btn-ring::before {
    content: '' !important;
    position: absolute !important;
    top: 50% !important; left: 50% !important;
    width: 200% !important; height: 200% !important;
    margin-top: -100% !important; margin-left: -100% !important;
    transform-origin: center center !important;
    animation: stylesnap-shimmer 3s linear infinite !important;
    background: conic-gradient(
      from 0deg,
      transparent 0deg,
      rgba(99, 102, 241, 0.15) 20deg,
      rgba(99, 102, 241, 0.5) 30deg,
      #818cf8 36deg,
      #a78bfa 42deg,
      rgba(139, 92, 246, 0.5) 48deg,
      transparent 60deg,
      transparent 130deg,
      rgba(99, 102, 241, 0.15) 140deg,
      rgba(99, 102, 241, 0.5) 150deg,
      #818cf8 156deg,
      #a78bfa 162deg,
      rgba(139, 92, 246, 0.5) 168deg,
      transparent 180deg,
      transparent 250deg,
      rgba(99, 102, 241, 0.15) 260deg,
      rgba(99, 102, 241, 0.5) 270deg,
      #818cf8 276deg,
      #a78bfa 282deg,
      rgba(139, 92, 246, 0.5) 288deg,
      transparent 300deg,
      transparent 360deg
    ) !important;
  }
  #stylesnap-floating-btn.is-active #stylesnap-floating-btn-ring {
    opacity: 1 !important;
  }
  .stylesnap-mode-badge {
    position: absolute !important;
    bottom: -1px !important;
    right: -1px !important;
    min-width: 20px !important;
    height: 16px !important;
    background: rgba(99,102,241,0.85) !important;
    border: none !important;
    border-radius: 5px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    z-index: 3 !important;
    pointer-events: none !important;
    padding: 0 5px !important;
    font-size: 11px !important;
    font-weight: 600 !important;
    color: #fff !important;
    line-height: 1 !important;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
  }
  .stylesnap-mode-badge svg {
    width: 11px !important;
    height: 11px !important;
    color: #fff !important;
  }
  .stylesnap-logo-icon {
    width: 26px !important;
    height: 26px !important;
    background: #fff !important;
    color: #6366f1 !important;
    border-radius: 8px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 15px !important;
    font-weight: 900 !important;
    line-height: 1 !important;
  }
  @keyframes stylesnap-shimmer {
    0%   { transform: rotate(0deg); }
    50%  { transform: rotate(180deg); }
    100% { transform: rotate(360deg); }
  }
`

export const SHADOW_HINT_BAR_CSS = `
  #stylesnap-hint-bar {
    position: fixed;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 14px;
    background: rgba(15, 23, 42, 0.92);
    border: 1px solid rgba(99, 102, 241, 0.25);
    border-top: none;
    border-radius: 0 0 10px 10px;
    font-family: system-ui, sans-serif;
    font-size: 11px;
    color: #94a3b8;
    z-index: 9999992;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    pointer-events: auto;
    white-space: nowrap;
    backdrop-filter: blur(8px);
  }
  #stylesnap-hint-bar kbd {
    display: inline-block;
    background: rgba(255,255,255,0.1);
    color: #e2e8f0;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-family: monospace;
    margin-right: 2px;
    border: 1px solid rgba(255,255,255,0.08);
  }
  .ss-hint-sep { color: rgba(255,255,255,0.12); }
  .ss-hint-logo { font-weight: 700; color: #818cf8; margin-right: 4px; }
  .ss-hint-item { display: inline-flex; align-items: center; }
  .ss-hint-close { background: none; border: none; color: rgba(255,255,255,0.25); cursor: pointer; font-size: 14px; padding: 0 2px; margin-left: 4px; line-height: 1; }
  .ss-hint-close:hover { color: rgba(255,255,255,0.6); }
  .ss-hint-settings { background: none; border: none; color: rgba(255,255,255,0.45); cursor: pointer; font-size: 13px; padding: 0 2px; margin-left: 4px; line-height: 1; display: flex; align-items: center; }
  .ss-hint-settings:hover { color: rgba(255,255,255,0.85); }
  .ss-hint-settings svg { width: 13px; height: 13px; }
  .ss-hint-action { background: none; border: 1px solid rgba(255,255,255,0.12); border-radius: 3px; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 10px; padding: 2px 6px; margin-left: 6px; white-space: nowrap; }
  .ss-hint-action:hover { border-color: rgba(99,102,241,0.4); color: #a5b4fc; background: rgba(99,102,241,0.1); }
`
